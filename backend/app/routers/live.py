"""Router de rastreamento ao vivo"""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone
from ..core.auth import get_current_user, get_optional_user, get_db
from ..core.supabase_client import get_supabase_client, get_supabase_admin
from ..core.workspace import get_active_workspace, scope, funnel_guard
from ..core.config import get_settings
from ..services.vturb import vturb_service
from ..services.push import notify_sale
from ..services import geo as geo_service
from supabase import Client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/live", tags=["live"])

# Header opcional para validar webhooks de venda (PerfectPay, etc.)
WEBHOOK_HEADER = APIKeyHeader(name="X-Webhook-Secret", auto_error=False)

# Enquanto a migration 008 (colunas geo_* em live_beats) nÃ£o rodar no banco, o
# primeiro heartbeat com geo estoura "column ... does not exist". Este flag
# desliga o envio de geo atÃ© o prÃ³ximo restart â€” o heartbeat NUNCA falha por
# causa disso, sÃ³ deixa de alimentar o mapa.
_geo_columns_ok = True
_GEO_KEYS = ("geo_city", "geo_uf", "geo_lat", "geo_lon")

# Cache slug -> uuid do funil. O tracker embute FUNNEL_ID como o SLUG curto
# (ex: "2b23f46d"), mas lead_profiles.funnel_id / quiz_answers.funnel_id sao
# colunas UUID. Sem resolver, o insert de lead_profile estoura
# "invalid input syntax for type uuid (22P02)" e a aba Quiz & Ads fica
# zerada mesmo com milhares de respostas em quiz_answers. Cache em memoria
# evita uma query por heartbeat.
_funnel_uuid_cache: dict[str, str] = {}
# Cache da lista completa de ids de funil. Usado para resolver PREFIXO de uuid
# em memoria, porque o PostgREST NÃƒO aceita ilike em coluna uuid
# ("operator does not exist: uuid ~~* unknown", code 42883) â€” confirmado por
# teste direto contra a API. A tabela funnels eh pequena, entao buscar todos
# os ids uma vez e casar o prefixo em Python eh barato e robusto.
_funnel_ids_cache: list[str] | None = None
_funnel_ids_cache_at: float = 0.0


def _get_funnel_ids(supabase: Client) -> list[str]:
    """Retorna todos os ids de funil, com cache de 60s."""
    global _funnel_ids_cache, _funnel_ids_cache_at
    import time as _t
    now = _t.time()
    if _funnel_ids_cache is not None and (now - _funnel_ids_cache_at) < 60:
        return _funnel_ids_cache
    try:
        rows = supabase.table("funnels").select("id").limit(1000).execute()
        ids = [r["id"] for r in (rows.data or []) if r.get("id")]
        _funnel_ids_cache = ids
        _funnel_ids_cache_at = now
        return ids
    except Exception:
        return _funnel_ids_cache or []


def _resolve_funnel_uuid(supabase: Client, funnel_id: str) -> str:
    """Resolve um identificador de funil (UUID ou slug curto) para o UUID real.

    Retorna o proprio funnel_id se ja for um UUID valido encontrado na tabela,
    ou o UUID correspondente ao slug. Se nao resolver de forma alguma, devolve
    o valor original (o insert falhara como antes, mas sem regressao para os
    casos que ja funcionavam).
    """
    if not funnel_id:
        return funnel_id
    cached = _funnel_uuid_cache.get(funnel_id)
    if cached:
        return cached
    import re as _re
    is_full_uuid = bool(_re.fullmatch(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", funnel_id))
    is_hex_prefix = bool(_re.fullmatch(r"[0-9a-fA-F]{8,}", funnel_id))
    # BUG ANTERIOR (confirmado via resolver_diag em prod): todo o corpo estava
    # num unico try/except. O ramo 1 rodava eq("id", "2b23f46d") PRIMEIRO, e o
    # PostgREST REJEITA eq em coluna uuid com valor nao-uuid (lanca excecao,
    # nao retorna vazio). A excecao pulava direto pro except da linha final,
    # PULANDO o ramo 3 (prefixo em memoria) que funcionava â€” por isso o diag
    # achava o match mas a funcao devolvia o slug cru e o insert estourava
    # 22P02. Agora valida o formato ANTES e so roda os ramos que nao lancam:
    # uuid-completo so quando eh uuid valido, slug so quando nao eh hex puro,
    # e prefixo em memoria para hex de 8+ chars. Sem try amplo engolindo o
    # caminho real.
    # 1) UUID completo valido -> busca direta por id (seguro, valor eh uuid).
    if is_full_uuid:
        try:
            by_id = supabase.table("funnels").select("id").eq("id", funnel_id).execute()
            if by_id.data:
                resolved = by_id.data[0]["id"]
                _funnel_uuid_cache[funnel_id] = resolved
                return resolved
        except Exception:
            pass
    # 2) PREFIXO hex de uuid (ex: "2b23f46d" -> "2b23f46d-bc94-..."). Evidencia
    # real do banco: o tracker embute os 8 primeiros hex do UUID, nao o slug
    # nem o uuid completo. Casa em memoria contra a lista cacheada de ids
    # (PostgREST nao aceita ilike/eq-prefix em coluna uuid). Este eh o caminho
    # que o tracker real usa â€” tem que vir ANTES de qualquer consulta que
    # lance com valor nao-uuid.
    if is_hex_prefix and not is_full_uuid:
        prefix = funnel_id.lower()
        try:
            for fid in _get_funnel_ids(supabase):
                if fid.lower().startswith(prefix):
                    _funnel_uuid_cache[funnel_id] = fid
                    return fid
        except Exception:
            pass
    # 3) Slug curto (ex: "padrao-buck-mtrqoxs3") â€” so quando nao eh hex puro
    # (slugs reais tem letras fora de a-f ou hifens, entao nunca casam como
    # hex_prefix). eq em coluna text slug eh seguro.
    if not is_hex_prefix:
        try:
            by_slug = supabase.table("funnels").select("id").eq("slug", funnel_id).execute()
            if by_slug.data:
                resolved = by_slug.data[0]["id"]
                _funnel_uuid_cache[funnel_id] = resolved
                return resolved
        except Exception:
            pass
    return funnel_id

# DIAGNÃ“STICO TEMPORÃRIO: captura a Ãºltima exceÃ§Ã£o dos inserts de
# parsed_campaigns / lead_profiles / quiz_answers para eu ler via
# GET /api/live/debug/last-error (sem auth). Remover depois de achar a causa
# raiz de "track retorna 204 mas nenhuma linha aparece nas abas Campanhas/Quiz".
_last_insert_error: dict = {"error": None, "at": None}


def _upsert_beat(supabase: Client, payload: dict) -> None:
    global _geo_columns_ok
    try:
        supabase.table("live_beats").upsert(payload, on_conflict="session_id").execute()
    except Exception as exc:  # noqa: BLE001
        msg = str(exc).lower()
        if any(k in msg for k in _GEO_KEYS) and ("does not exist" in msg or "column" in msg):
            _geo_columns_ok = False
            for k in _GEO_KEYS:
                payload.pop(k, None)
            supabase.table("live_beats").upsert(payload, on_conflict="session_id").execute()
        else:
            raise


class LiveBeatRequest(BaseModel):
    funnel_id: str
    session_id: str
    device_id: Optional[str] = None
    # Identidade da visualizaÃ§Ã£o de pÃ¡gina: igual em todos os heartbeats da
    # mesma pÃ¡gina, diferente quando a pessoa navega. Ã‰ a chave de dedupe.
    # Opcional para nÃ£o quebrar snippets antigos jÃ¡ colados em produÃ§Ã£o.
    event_id: Optional[str] = None
    url: str
    referrer: Optional[str] = None
    utm: Optional[dict] = None
    # UTM da primeira pÃ¡gina visitada na sessÃ£o (first-touch).
    # O tracker persiste isso no sessionStorage e envia em todo heartbeat/quiz.
    first_utm: Optional[dict] = None
    # Quiz answer (opcional) â€” se presente, event_type = 'quiz_answer'
    event_type: Optional[str] = None  # 'pageview' | 'quiz_answer' | 'contact_form'
    question_id: Optional[str] = None
    answer_id: Optional[str] = None
    answer_value: Optional[str] = None
    # Campos de contato capturados por auto-detect de formulÃ¡rio no tracker.js.
    # Nullable: nem todo lead preenche, e o quiz continua funcionando sem elas.
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None


def _salvar_quiz_answer(supabase: Client, beat: LiveBeatRequest) -> None:
    """Salva resposta de quiz e atualiza lead_profile."""
    if not beat.question_id or not beat.answer_id:
        return

    # Extrai UTM do beat.utm
    utm = beat.utm or {}
    utm_source = utm.get("utm_source")
    utm_medium = utm.get("utm_medium")
    utm_campaign = utm.get("utm_campaign")
    utm_content = utm.get("utm_content")
    utm_term = utm.get("utm_term")

    # Resolve step_id pela URL (mesma lÃ³gica do trigger do banco)
    step_id = None
    try:
        steps = supabase.table("funnel_steps").select("id, url").eq(
            "funnel_id", beat.funnel_id
        ).execute()
        target = beat.url.split("?")[0].split("#")[0].rstrip("/")
        for s in steps.data or []:
            if (s.get("url") or "").split("?")[0].split("#")[0].rstrip("/") == target:
                step_id = s["id"]
                break
    except Exception:
        pass

    # Resolve workspace_id do funil (mesma resoluÃ§Ã£o usada em parsed_campaigns/
    # lead_profiles). Sem isso a linha de quiz_answers cai com workspace_id=NULL
    # e nunca aparece nas abas, que filtram por .eq("workspace_id", ws_id).
    ws_id = _get_workspace_id(supabase, beat.funnel_id)

    # Salva quiz_answer
    quiz_row = {
        "funnel_id": beat.funnel_id,
        "workspace_id": ws_id,
        "session_id": beat.session_id,
        "device_id": beat.device_id,
        "step_id": step_id,
        "question_id": beat.question_id,
        "answer_id": beat.answer_id,
        "answer_value": beat.answer_value,
        "utm_source": utm_source,
        "utm_medium": utm_medium,
        "utm_campaign": utm_campaign,
        "utm_content": utm_content,
        "utm_term": utm_term,
        "timestamp": beat.timestamp if hasattr(beat, 'timestamp') and beat.timestamp else "now()",
    }
    # RETRY TRANSIENTE: o Supabase esporadicamente retorna 504 Gateway Timeout
    # nos writes (confirmado via /api/live/debug/last-error). Sem retry, UM
    # timeout descarta a resposta de quiz inteira e a aba Quiz & Ads parece
    # "nao trackear". Retenta com backoff curto antes de registrar o erro.
    import time as _time_q

    def _is_transient_q(exc: Exception) -> bool:
        msg = str(exc).lower()
        return any(
            t in msg
            for t in ("504", "gateway timeout", "503", "502", "timed out", "timeout", "connection")
        )

    quiz_saved = False
    last_quiz_exc: Exception | None = None
    for attempt in range(3):
        try:
            supabase.table("quiz_answers").insert(quiz_row).execute()
            quiz_saved = True
            break
        except Exception as exc:
            last_quiz_exc = exc
            if _is_transient_q(exc) and attempt < 2:
                _time_q.sleep(0.4 * (attempt + 1))
                continue
            break

    if not quiz_saved and last_quiz_exc is not None:
        # DIAGNÃ“STICO TEMPORÃRIO: expÃµe a exceÃ§Ã£o real via /api/live/debug/last-error
        from datetime import datetime, timezone
        _last_insert_error["error"] = f"{type(last_quiz_exc).__name__}: {last_quiz_exc}"
        _last_insert_error["at"] = datetime.now(timezone.utc).isoformat()
        _last_insert_error["where"] = "quiz_answers"
        logger.exception("Erro ao salvar quiz_answer (session_id=%s)", beat.session_id)

    # Atualiza/cria lead_profile
    _atualizar_lead_profile(supabase, beat, utm, step_id)


def _atualizar_lead_profile(supabase: Client, beat: LiveBeatRequest, utm: dict, step_id: str | None) -> None:
    """Upsert do lead_profile consolidando quiz + UTM com atribuiÃ§Ã£o por parsing de slug."""
    from app.services.utm_parser import parse_utm_slug

    try:
        ws_id = _get_workspace_id(supabase, beat.funnel_id)

        # Busca modelo de atribuiÃ§Ã£o do workspace (first_touch ou last_touch)
        attribution_model = "first_touch"
        try:
            ws_result = supabase.table("workspaces").select("attribution_model").eq(
                "id", ws_id
            ).execute()
            if ws_result.data and ws_result.data[0].get("attribution_model"):
                attribution_model = ws_result.data[0]["attribution_model"]
        except Exception:
            pass

        # Escolhe UTM de atribuiÃ§Ã£o baseado no modelo
        first_utm = beat.first_utm or {}
        attribution_utm = first_utm if attribution_model == "first_touch" else utm

        # --- AUTO-CRIAÃ‡ÃƒO DE CAMPANHA POR PARSING DE SLUG UTM ---
        parsed_campaign_id = None
        parsed = parse_utm_slug(attribution_utm)
        if not parsed.is_empty():
            try:
                rpc_result = supabase.rpc("resolve_or_create_parsed_campaign", {
                    "p_slug_key": parsed.to_campaign_key(),
                    "p_creative_code": parsed.creative_code,
                    "p_campaign_code": parsed.campaign_code,
                    "p_page_code": parsed.page_code,
                    "p_platform_ad_id": parsed.platform_ad_id,
                    "p_placement": parsed.placement,
                    "p_sequence": parsed.sequence,
                    "p_version_date": parsed.version_date,
                    "p_raw_source": parsed.raw_source,
                    "p_raw_slug": parsed.raw_slug,
                    "p_workspace_id": ws_id,
                }).execute()
                if rpc_result.data:
                    # BUG FIX: RPC pode retornar parsed_campaign de outro workspace
                    # (quando mesma slug_key existe em mÃºltiplos workspaces).
                    # Verifica se o workspace_id bate; se nÃ£o, forÃ§a fallback manual.
                    rpc_pc_id = rpc_result.data
                    pc_check = supabase.table("parsed_campaigns").select("workspace_id").eq(
                        "id", rpc_pc_id
                    ).execute()
                    if pc_check.data and pc_check.data[0].get("workspace_id") == ws_id:
                        parsed_campaign_id = rpc_pc_id
                    else:
                        logger.warning(
                            "RPC retornou parsed_campaign de outro workspace (session=%s, "
                            "rpc_ws=%s, expected_ws=%s). ForÃ§ando fallback manual.",
                            beat.session_id,
                            pc_check.data[0].get("workspace_id") if pc_check.data else "unknown",
                            ws_id,
                        )
                        raise Exception("Workspace mismatch - forcing fallback")
            except Exception as exc:  # noqa: BLE001
                # BUG-11 fix: log explÃ­cito + fallback gracioso. O heartbeat NUNCA
                # deve falhar por causa do RPC de parsed_campaign â€” a venda e o
                # lead_profile continuam sendo salvos, sÃ³ sem vÃ­nculo com campanha
                # parseada. Sem esse try/except amplo, um erro no RPC (ex: coluna
                # nova nÃ£o migrada ainda) derrubava o heartbeat inteiro.
                logger.warning(
                    "RPC resolve_or_create_parsed_campaign falhou (session=%s): %s. "
                    "Tentando fallback manual.",
                    beat.session_id, str(exc),
                )
                # Fallback manual: faz upsert direto na tabela parsed_campaigns
                # (funciona tanto em modo local quanto Supabase quando o RPC falha).
                # A lÃ³gica espelha o RPC do Supabase: busca por slug_key, se nÃ£o
                # existe insere, senÃ£o retorna o ID existente.
                try:
                    slug_key = parsed.to_campaign_key()
                    # Busca primeiro com workspace_id correto
                    existing_correct = supabase.table("parsed_campaigns").select("id").eq(
                        "slug_key", slug_key
                    ).eq("workspace_id", ws_id).execute()
                    if existing_correct.data:
                        parsed_campaign_id = existing_correct.data[0]["id"]
                        # BUG FIX: incrementa session_count e atualiza last_seen_at
                        # quando a campanha jÃ¡ existe. Sem isso, o contador fica
                        # zerado para sempre apÃ³s a primeira inserÃ§Ã£o â€” era exatamente
                        # o sintoma de "35 campanhas detectadas, todas com 0 sessions".
                        try:
                            current = supabase.table("parsed_campaigns").select("session_count,campaign_name,raw_campaign").eq(
                                "id", parsed_campaign_id
                            ).execute()
                            cur_row = current.data[0] if current.data else {}
                            new_count = ((cur_row.get("session_count") or 0) + 1)
                            # BACKFILL retroativo: registros criados ANTES da
                            # migration 016 nasceram com campaign_name/raw_campaign
                            # = NULL, entao a aba Campanhas mostrava so o codigo
                            # tecnico (#bm.16.ca.01). Preenche com o nome legivel
                            # do heartbeat atual quando o campo ainda esta vazio â€”
                            # espelha o COALESCE da RPC resolve_or_create_parsed_campaign.
                            upd = {
                                "session_count": new_count,
                                "last_seen_at": "now()",
                            }
                            if not cur_row.get("campaign_name") and getattr(parsed, "campaign_name", None):
                                upd["campaign_name"] = parsed.campaign_name
                            if not cur_row.get("raw_campaign") and getattr(parsed, "raw_campaign", None):
                                upd["raw_campaign"] = parsed.raw_campaign
                            supabase.table("parsed_campaigns").update(upd).eq("id", parsed_campaign_id).execute()
                        except Exception as inc_exc:
                            logger.warning(
                                "Falha ao incrementar session_count do parsed_campaign %s: %s",
                                parsed_campaign_id, str(inc_exc),
                            )
                    else:
                        # Verifica se existe em outro workspace (constraint global de slug_key)
                        existing_any = supabase.table("parsed_campaigns").select("id, workspace_id").eq(
                            "slug_key", slug_key
                        ).execute()
                        if existing_any.data:
                            # Existe em outro workspace - atualiza workspace_id
                            old_pc_id = existing_any.data[0]["id"]
                            old_ws = existing_any.data[0]["workspace_id"]
                            logger.warning(
                                "Fallback: slug_key existe em outro workspace (session=%s, old_ws=%s, new_ws=%s). "
                                "Atualizando workspace_id do parsed_campaign.",
                                beat.session_id, old_ws, ws_id,
                            )
                            supabase.table("parsed_campaigns").update(
                                {"workspace_id": ws_id, "last_seen_at": "now()"}
                            ).eq("id", old_pc_id).execute()
                            parsed_campaign_id = old_pc_id
                        else:
                            # NÃ£o existe em nenhum workspace - cria novo
                            import uuid as _uuid
                            new_pc = {
                                "id": str(_uuid.uuid4()),
                                "workspace_id": ws_id,
                                "slug_key": slug_key,
                                "creative_code": parsed.creative_code,
                                "campaign_code": parsed.campaign_code,
                                "campaign_name": getattr(parsed, "campaign_name", None),
                                "page_code": parsed.page_code,
                                "platform_ad_id": parsed.platform_ad_id,
                                "placement": parsed.placement,
                                "sequence": parsed.sequence,
                                "version_date": parsed.version_date,
                                "raw_source": parsed.raw_source,
                                "raw_campaign": getattr(parsed, "raw_campaign", None),
                                "raw_slug": parsed.raw_slug,
                                "session_count": 1,
                            }
                            result_pc = supabase.table("parsed_campaigns").insert(new_pc).execute()
                            if result_pc.data:
                                parsed_campaign_id = result_pc.data[0]["id"]
                            logger.info(
                                "Fallback manual: parsed_campaign criada (session=%s, id=%s)",
                                beat.session_id, parsed_campaign_id,
                            )
                except Exception as fallback_exc:  # noqa: BLE001
                    logger.warning(
                        "Fallback manual de parsed_campaign tambÃ©m falhou (session=%s): %s",
                        beat.session_id, str(fallback_exc),
                    )
                    parsed_campaign_id = None

        # Busca profile existente
        existing = supabase.table("lead_profiles").select("*").eq(
            "session_id", beat.session_id
        ).execute()

        # Busca ad_campaign pelo UTM de atribuiÃ§Ã£o para preencher FKs explÃ­citas
        attributed_ad_id = None
        attributed_campaign_id = None
        ad_id_text = None
        campaign_id_text = None
        audience_json = None
        if attribution_utm.get("utm_source") or attribution_utm.get("utm_campaign"):
            try:
                query = supabase.table("ad_campaigns").select(
                    "id, ad_id, campaign_id, audience_json"
                ).eq("workspace_id", ws_id)
                if attribution_utm.get("utm_content"):
                    query = query.eq("utm_json->>utm_content", attribution_utm["utm_content"])
                if attribution_utm.get("utm_campaign"):
                    query = query.eq("utm_json->>utm_campaign", attribution_utm["utm_campaign"])
                if attribution_utm.get("utm_source"):
                    query = query.eq("utm_json->>utm_source", attribution_utm["utm_source"])
                result = query.limit(1).execute()
                if result.data:
                    attributed_ad_id = result.data[0].get("id")
                    attributed_campaign_id = result.data[0].get("id")  # mesma tabela, campanha Ã© outro campo
                    ad_id_text = result.data[0].get("ad_id")
                    campaign_id_text = result.data[0].get("campaign_id")
                    audience_json = result.data[0].get("audience_json")
            except Exception:
                pass

        # Novo quiz answer para adicionar ao array
        novo_quiz = {
            "question_id": beat.question_id,
            "answer_id": beat.answer_id,
            "answer_value": beat.answer_value,
            "step_id": step_id,
            "timestamp": beat.timestamp if hasattr(beat, 'timestamp') and beat.timestamp else "now()",
        }

        if existing.data:
            profile = existing.data[0]
            quiz_answers = profile.get("quiz_answers_json") or []
            quiz_answers.append(novo_quiz)
            update_data = {
                "quiz_answers_json": quiz_answers,
                "utm_json": utm or profile.get("utm_json"),
                "last_utm_json": utm or profile.get("last_utm_json"),
                "funnel_id": beat.funnel_id,
                "device_id": beat.device_id or profile.get("device_id"),
            }
            # Garante que workspace_id seja preenchido mesmo em updates
            # (perfis criados antes da correÃ§Ã£o tinham workspace_id=NULL)
            if ws_id and not profile.get("workspace_id"):
                update_data["workspace_id"] = ws_id
            # SÃ³ sobrescreve first_utm se ainda nÃ£o existe (preserva primeira visita)
            if not profile.get("first_utm_json") and first_utm:
                update_data["first_utm_json"] = first_utm
            # Campos de contato capturados por auto-detect de formulÃ¡rio.
            # SÃ³ sobrescreve se o tracker enviou valor novo (evita apagar
            # nome/email jÃ¡ preenchidos com dados vazios de heartbeat).
            if beat.contact_name:
                update_data["contact_name"] = beat.contact_name
            if beat.contact_email:
                update_data["contact_email"] = beat.contact_email
            # AtribuiÃ§Ã£o sÃ³ muda se encontrou ad_campaign correspondente
            if attributed_ad_id:
                update_data["attributed_ad_id"] = attributed_ad_id
                update_data["attributed_campaign_id"] = attributed_campaign_id
                update_data["ad_id"] = ad_id_text
                update_data["campaign_id"] = campaign_id_text
                update_data["audience_json"] = audience_json
            else:
                update_data["ad_id"] = ad_id_text or profile.get("ad_id")
                update_data["campaign_id"] = campaign_id_text or profile.get("campaign_id")
                update_data["audience_json"] = audience_json or profile.get("audience_json")
            # Vincula Ã  campanha detectada por parsing de slug UTM
            if parsed_campaign_id and not profile.get("parsed_campaign_id"):
                update_data["parsed_campaign_id"] = parsed_campaign_id
            supabase.table("lead_profiles").update(update_data).eq(
                "session_id", beat.session_id
            ).execute()
        else:
            insert_data = {
                "workspace_id": ws_id,
                "funnel_id": beat.funnel_id,
                "session_id": beat.session_id,
                "device_id": beat.device_id,
                "quiz_answers_json": [novo_quiz],
                "utm_json": utm,
                "first_utm_json": first_utm or None,
                "last_utm_json": utm or None,
                "ad_id": ad_id_text,
                "campaign_id": campaign_id_text,
                "attributed_ad_id": attributed_ad_id,
                "attributed_campaign_id": attributed_campaign_id,
                "audience_json": audience_json,
                "contact_name": beat.contact_name or None,
                "contact_email": beat.contact_email or None,
            }
            # Vincula Ã  campanha detectada por parsing de slug UTM
            if parsed_campaign_id:
                insert_data["parsed_campaign_id"] = parsed_campaign_id

            # Tenta insert com todos os campos; se falhar por coluna ausente
            # (migration 012 nÃ£o aplicada), remove campos problemÃ¡ticos e tenta novamente.
            # RETRY TRANSIENTE: o Supabase esporadicamente retorna 504 Gateway
            # Timeout nos writes (confirmado via /api/live/debug/last-error:
            # "APIError code 504 ... where: lead_profile"). Sem retry, UM
            # timeout mata o write inteiro e quebra toda a cadeia de atribuicao
            # (lead_profile -> parsed_campaign_id -> quiz_answers), fazendo a
            # aba Quiz & Ads parecer "nao trackear". Retenta com backoff curto
            # antes de desistir.
            import time as _time

            def _is_transient(exc: Exception) -> bool:
                msg = str(exc).lower()
                return (
                    "504" in msg
                    or "gateway timeout" in msg
                    or "503" in msg
                    or "502" in msg
                    or "timed out" in msg
                    or "timeout" in msg
                    or "connection" in msg
                )

            def _attempt_insert(data: dict) -> None:
                last_exc: Exception | None = None
                for attempt in range(3):
                    try:
                        supabase.table("lead_profiles").insert(data).execute()
                        return
                    except Exception as exc:
                        last_exc = exc
                        if _is_transient(exc) and attempt < 2:
                            _time.sleep(0.4 * (attempt + 1))
                            continue
                        raise
                if last_exc is not None:
                    raise last_exc

            try:
                _attempt_insert(insert_data)
            except Exception as insert_exc:
                error_msg = str(insert_exc)
                if "contact_email" in error_msg or "contact_name" in error_msg:
                    # Remove campos que nÃ£o existem no schema
                    insert_data.pop("contact_name", None)
                    insert_data.pop("contact_email", None)
                    logger.warning(
                        "Removendo campos contact_name/contact_email do insert (migration 012 pendente) - session=%s",
                        beat.session_id,
                    )
                    try:
                        _attempt_insert(insert_data)
                    except Exception:
                        raise
                else:
                    raise
    except Exception as exc:
        # Falha silenciosa: nÃ£o derruba o heartbeat
        logger.exception("Erro ao atualizar lead_profile (session_id=%s)", beat.session_id)
        # DIAGNÃ“STICO TEMPORÃRIO: expÃµe a exceÃ§Ã£o real via /api/live/debug/last-error
        from datetime import datetime, timezone
        _last_insert_error["error"] = f"{type(exc).__name__}: {exc}"
        _last_insert_error["at"] = datetime.now(timezone.utc).isoformat()
        _last_insert_error["where"] = "lead_profile"


def _get_workspace_id(supabase: Client, funnel_id: str) -> str | None:
    """Resolve workspace_id do funil, com fallback para o primeiro workspace do dono.

    Funis criados antes da migration 009 nÃ£o tÃªm workspace_id. Sem fallback,
    o lead_profile ficava com workspace_id=NULL e attributed_ad_id nunca era
    resolvido (a query de ad_campaigns filtra por workspace_id). O fallback
    pega o primeiro workspace do dono do funil â€” todo usuÃ¡rio pÃ³s-009 tem
    pelo menos um workspace criado automaticamente no cadastro.
    """
    try:
        result = supabase.table("funnels").select("workspace_id, user_id").eq(
            "id", funnel_id
        ).execute()
        if not result.data:
            return None
        ws_id = result.data[0].get("workspace_id")
        if ws_id:
            return ws_id
        # Fallback: primeiro workspace do dono do funil
        user_id = result.data[0].get("user_id")
        if not user_id:
            return None
        member = supabase.table("workspace_members").select("workspace_id").eq(
            "user_id", user_id
        ).order("created_at").limit(1).execute()
        if member.data:
            return member.data[0].get("workspace_id")
        # Ãšltimo fallback: o workspace pessoal mais antigo do dono (migration 009
        # garante que todo usuÃ¡rio tem pelo menos um). Sem isso, funis criados
        # antes do backfill de workspace_members ficavam com workspace_id=NULL e
        # as linhas de parsed_campaigns/lead_profiles nunca apareciam nas abas
        # (Campanhas/Quiz filtram por .eq("workspace_id", ws_id) â€” NULL nÃ£o casa).
        own_ws = supabase.table("workspaces").select("id").eq(
            "owner_id", user_id
        ).order("created_at").limit(1).execute()
        if own_ws.data:
            return own_ws.data[0].get("id")
    except Exception:
        pass
    return None


# DIAGNÃ“STICO TEMPORÃRIO: endpoint pÃºblico (sem auth) que devolve a Ãºltima
# exceÃ§Ã£o capturada nos inserts de parsed_campaigns / lead_profiles / quiz_answers.
# Usado pra achar a causa raiz de "track retorna 204 mas nenhuma linha aparece
# nas abas Campanhas/Quiz". REMOVER depois de corrigir a causa.
@router.get("/debug/last-error")
def debug_last_insert_error():
    return _last_insert_error


# DIAGNÃ“STICO TEMPORÃRIO: endpoint pÃºblico (sem auth) que devolve uma amostra
# crua dos dados reais no banco â€” parsed_campaigns (pra ver se campaign_name/
# raw_campaign/creative_code estÃ£o preenchidos ou NULL) e contagem de
# quiz_answers (pra ver se o tracker estÃ¡ de fato gravando respostas).
# Usado pra achar a causa raiz dos 3 sintomas: (1) Quiz & Ads nÃ£o trackeia,
# (2) Campanhas nÃ£o separa por criativo, (3) mostra nome da conta na campanha.
# REMOVER depois de corrigir a causa.
@router.get("/debug/data-sample")
def debug_data_sample(supabase: Client = Depends(get_supabase_admin)):
    # SENTINEL de versao: prova qual commit do backend esta realmente rodando
    # no Railway. Usado pra confirmar se o fix de resolucao de prefixo uuid
    # (7a09dc2) subiu â€” os re-testes continuavam mostrando 22P02 com o slug
    # cru, levantando suspeita de deploy stale. Bumpar este valor a cada fix
    # permite verificar via GET sem auth.
    out: dict = {
        "backend_version": "7a09dc2-format-gated-v3",
        "parsed_campaigns": [],
        "quiz_answers_count": None,
        "error": None,
    }
    # DIAGNOSTICO do resolver: roda a mesma logica que o track usa contra o
    # prefixo "2b23f46d" e expoe cada passo, pra provar por que o fix de
    # prefixo uuid nao reescreve beat.funnel_id em producao (re-teste com o
    # sentinel vivo ainda mostrou 22P02 com o slug cru).
    try:
        probe = "2b23f46d"
        ids = _get_funnel_ids(supabase)
        matched = [fid for fid in ids if fid.lower().startswith(probe)]
        resolved = _resolve_funnel_uuid(supabase, probe)
        out["resolver_diag"] = {
            "probe": probe,
            "funnel_ids_count": len(ids),
            "funnel_ids_sample": ids[:5],
            "prefix_matches": matched,
            "resolved": resolved,
            "changed": resolved != probe,
        }
    except Exception as diag_exc:
        out["resolver_diag"] = {"error": f"{type(diag_exc).__name__}: {diag_exc}"}
    try:
        pcs = (
            supabase.table("parsed_campaigns")
            .select(
                "slug_key, creative_code, campaign_code, campaign_name, "
                "raw_campaign, placement, session_count, raw_source"
            )
            .order("session_count", desc=True)
            .limit(15)
            .execute()
        )
        out["parsed_campaigns"] = pcs.data or []
    except Exception as exc:
        out["error"] = f"parsed_campaigns: {type(exc).__name__}: {exc}"
    try:
        cnt = supabase.table("quiz_answers").select("id", count="exact").execute()
        out["quiz_answers_count"] = cnt.count
    except Exception as exc:
        out["error"] = (out.get("error") or "") + f" | quiz_answers: {type(exc).__name__}: {exc}"
    return out


@router.post("/track", status_code=status.HTTP_204_NO_CONTENT)
async def track_heartbeat(
    request: Request,
    supabase: Client = Depends(get_supabase_admin)
):
    """
    Endpoint pÃºblico para heartbeat do rastreador (snippet nas pÃ¡ginas).
    Aceita requisiÃ§Ãµes anÃ´nimas (CORS aberto).

    O corpo Ã© lido cru em vez de declarado como modelo no parÃ¢metro porque o
    rastreador manda `Content-Type: text/plain` de propÃ³sito: Ã© o que faz o
    navegador tratar o POST como requisiÃ§Ã£o simples e PULAR o preflight
    (`OPTIONS`) â€” que vinha sendo barrado pelo CORS no domÃ­nio do cliente. Com
    o modelo no parÃ¢metro, o FastAPI sÃ³ faz o parse quando o tipo Ã©
    `application/json` e devolveria 422 nesse corpo.
    """
    try:
        corpo = await request.body()
        beat = LiveBeatRequest.model_validate_json(corpo)
    except Exception:
        # Corpo malformado â€” o snippet manda o que consegue, nÃ£o vale a pena
        # devolver erro pra ele (sendBeacon ignora a resposta mesmo). Mas o
        # erro precisa ficar visÃ­vel no log do servidor, nÃ£o sÃ³ engolido: foi
        # exatamente esse silÃªncio que escondeu a migration 002 nÃ£o rodada.
        logger.warning("Erro no track: corpo invÃ¡lido")
        return None

    # RESOLVE SLUG -> UUID: o tracker embute FUNNEL_ID como o slug curto
    # (ex: "2b23f46d"), mas lead_profiles/quiz_answers.funnel_id sao colunas
    # UUID. Sem isso o insert de lead_profile estoura "invalid input syntax
    # for type uuid (22P02)" e a aba Quiz & Ads fica zerada mesmo com
    # milhares de respostas gravadas em quiz_answers. Resolve uma vez aqui
    # pra todos os caminhos (quiz_answer + heartbeat) usarem o UUID real.
    try:
        resolved_fid = _resolve_funnel_uuid(supabase, beat.funnel_id)
        if resolved_fid != beat.funnel_id:
            beat.funnel_id = resolved_fid
    except Exception:
        pass

    # Quiz answer: processa e retorna (nÃ£o faz heartbeat de pÃ¡gina)
    if beat.event_type == "quiz_answer":
        try:
            _salvar_quiz_answer(supabase, beat)
        except Exception:
            logger.exception(
                "Erro no track: falha ao gravar quiz answer (session_id=%s, funnel_id=%s)",
                beat.session_id,
                beat.funnel_id,
            )
        return None

    try:
        # PÃ¡gina mudou (ou Ã© a primeira)? Registra no log de entradas ANTES do
        # upsert â€” depois do upsert a URL anterior jÃ¡ foi sobrescrita e nÃ£o dÃ¡
        # mais para saber se houve troca de pÃ¡gina.
        previous = supabase.table("live_beats").select("url").eq(
            "session_id", beat.session_id
        ).execute()
        previous_url = previous.data[0]["url"] if previous.data else None
        first_beat = not previous.data

        if previous_url != beat.url:
            entry = {
                "funnel_id": beat.funnel_id,
                "session_id": beat.session_id,
                "url": beat.url,
                "referrer": beat.referrer,
                "utm": beat.utm,
                "event_id": beat.event_id,
            }

            if beat.event_id:
                # Upsert em vez de insert: dois heartbeats da mesma pÃ¡gina podem
                # chegar juntos (retry de rede, sendBeacon do fechamento da aba
                # correndo com o beat do intervalo). Os dois passam pelo teste de
                # URL acima antes de qualquer um gravar, e o insert simples criava
                # duas entradas para uma visita sÃ³.
                #
                # O Ã­ndice de event_id Ã© TOTAL, nÃ£o parcial â€” Ã­ndice parcial nÃ£o
                # serve de alvo para ON CONFLICT (42P10, o mesmo tropeÃ§o do
                # webhook de vendas). NÃ£o precisa ser parcial porque NULLs nunca
                # colidem entre si: os beats de snippets antigos, sem event_id,
                # continuam entrando normalmente.
                supabase.table("live_page_entries").upsert(
                    entry, on_conflict="event_id"
                ).execute()
            else:
                supabase.table("live_page_entries").insert(entry).execute()

        # GeolocalizaÃ§Ã£o: resolve o IP â†’ cidade/UF/lat/lon UMA vez por sessÃ£o (no
        # primeiro heartbeat). O IP nunca Ã© gravado â€” sÃ³ a praÃ§a. Falha Ã©
        # silenciosa: sem geo, o visitante sÃ³ nÃ£o entra no mapa.
        # Usa asyncio.to_thread para nÃ£o bloquear o event loop com o httpx sÃ­ncrono
        # do geo_service.resolve (timeout 4s).
        payload = {
            "session_id": beat.session_id,
            "funnel_id": beat.funnel_id,
            "device_id": beat.device_id,
            "url": beat.url,
            "referrer": beat.referrer,
            "utm": beat.utm,
            "last_seen": "now()",
        }
        if first_beat and _geo_columns_ok:
            ip = geo_service.client_ip(
                dict(request.headers),
                request.client.host if request.client else None,
            )
            place = await asyncio.to_thread(geo_service.resolve, ip)
            if place:
                payload.update({
                    "geo_city": place["city"],
                    "geo_uf": place["uf"],
                    "geo_lat": place["lat"],
                    "geo_lon": place["lon"],
                })

        _upsert_beat(supabase, payload)
        return None

    except Exception:
        # NÃ£o expÃµe erros internos para o snippet (sempre 204 pra ele), mas
        # loga com traceback: um `print` sozinho pode nÃ£o aparecer em nenhum
        # lugar monitorado em produÃ§Ã£o, e uma falha de gravaÃ§Ã£o aqui significa
        # visitante que "sumiu" sem ninguÃ©m saber por quÃª.
        logger.exception(
            "Erro no track: falha ao gravar heartbeat (session_id=%s, funnel_id=%s)",
            beat.session_id,
            beat.funnel_id,
        )
        return None


@router.get("")
def get_live_data(
    funnel_id: str,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Busca pessoas online no funil agora (Ãºltimos 90s).

    Returns:
        [
            {
                "stepId": str,
                "online": int,
                "unmapped": int  # URLs nÃ£o mapeadas
            }
        ]
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # Busca beats ativos (Ãºltimos 90s)
        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()

        beats = supabase.table("live_beats").select(
            "step_id, url"
        ).eq("funnel_id", funnel_id).gte("last_seen", cutoff).execute()

        # Agrupa por step_id
        by_step = {}
        unmapped_count = 0

        for beat in beats.data:
            step_id = beat.get("step_id")

            if step_id:
                if step_id not in by_step:
                    by_step[step_id] = 0
                by_step[step_id] += 1
            else:
                unmapped_count += 1

        result = [
            {"stepId": step_id, "online": count}
            for step_id, count in by_step.items()
        ]

        if unmapped_count > 0:
            result.append({"stepId": None, "online": unmapped_count})

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar dados ao vivo: {str(e)}"
        )


@router.get("/geo")
def get_live_geo(
    funnel_id: Optional[str] = None,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db),
):
    """PraÃ§as (cidades) com gente no funil agora â€” alimenta o mapa do Brasil.

    Sem `funnel_id`: agrega os funis do workspace ativo. Cada ponto Ã© uma cidade
    com a contagem de sessÃµes ativas (Ãºltimos 90s) que tinham geolocalizaÃ§Ã£o.
    """
    try:
        # Funis do workspace ativo â€” e valida a posse quando um id Ã© pedido.
        owned = scope(
            supabase.table("funnels").select("id"), ws_id, current_user.id
        ).execute()
        owned_ids = {f["id"] for f in (owned.data or [])}
        if funnel_id:
            if funnel_id not in owned_ids:
                raise HTTPException(status_code=404, detail="Funil nÃ£o encontrado")
            target_ids = [funnel_id]
        else:
            target_ids = list(owned_ids)

        if not target_ids:
            return {"total": 0, "places": 0, "points": []}

        cutoff = (datetime.now(timezone.utc) - timedelta(seconds=90)).isoformat()
        try:
            beats = (
                supabase.table("live_beats")
                .select("geo_city, geo_uf, geo_lat, geo_lon")
                .in_("funnel_id", target_ids)
                .gte("last_seen", cutoff)
                .not_.is_("geo_lat", "null")
                .execute()
            )
        except Exception as exc:  # noqa: BLE001
            # migration 008 ainda nÃ£o rodou â†’ sem colunas geo, mapa vazio.
            if "geo_" in str(exc).lower():
                return {"total": 0, "places": 0, "points": []}
            raise

        # Agrupa por (cidade, uf) somando sessÃµes; guarda o primeiro lat/lon.
        buckets: dict[tuple, dict] = {}
        for b in beats.data or []:
            key = (b.get("geo_city") or "â€”", b.get("geo_uf") or "")
            slot = buckets.setdefault(
                key,
                {"city": key[0], "uf": key[1], "lat": b["geo_lat"], "lon": b["geo_lon"], "online": 0},
            )
            slot["online"] += 1

        points = sorted(buckets.values(), key=lambda p: p["online"], reverse=True)
        return {
            "total": sum(p["online"] for p in points),
            "places": len(points),
            "points": points,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar geolocalizaÃ§Ã£o ao vivo: {str(e)}",
        )


@router.get("/entries")
def get_page_entries(
    funnel_id: str,
    window: int = 30,
    limit: int = 40,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Log de entradas em pÃ¡gina: quem entrou, em qual etapa, quando.
    Mais recente primeiro.

    Returns:
        [
            {
                "id": str,
                "funnelId": str,
                "stepId": str | None,
                "timestamp": str,   # ISO
                "visitor": str,     # hash curto da sessÃ£o (anÃ´nimo)
                "device": "mobile" | "desktop" | None,
                "source": str,      # utm_source, domÃ­nio do referrer ou "direto"
                "url": str
            }
        ]
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # UTC explÃ­cito. `datetime.now()` devolve hora local ingÃªnua e o
        # Postgres a interpreta no fuso da sessÃ£o (UTC): numa mÃ¡quina em
        # UTC-3 a janela de 30 min virava uma de 3h30.
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=window)).isoformat()

        # Leitura com a service_role, e nÃ£o com a chave anon: a tabela tem RLS
        # e o cliente anÃ´nimo nÃ£o carrega o JWT do usuÃ¡rio â€” a consulta voltava
        # vazia em silÃªncio, como se ninguÃ©m tivesse entrado em pÃ¡gina nenhuma.
        # A permissÃ£o jÃ¡ foi checada acima (o funil Ã© deste usuÃ¡rio).
        rows = get_supabase_admin().table("live_page_entries").select(
            "id, step_id, url, referrer, utm, device, entered_at, session_id"
        ).eq("funnel_id", funnel_id).gte(
            "entered_at", cutoff
        ).order("entered_at", desc=True).limit(limit).execute()

        result = []

        for row in rows.data:
            utm = row.get("utm") or {}
            referrer = row.get("referrer") or ""

            # Origem: utm_source manda; senÃ£o o domÃ­nio do referrer; senÃ£o direto.
            if utm.get("source"):
                source = utm["source"]
            elif referrer:
                source = referrer.split("/")[2] if "//" in referrer else referrer
            else:
                source = "direto"

            result.append({
                "id": row["id"],
                "funnelId": funnel_id,
                "stepId": row.get("step_id"),
                "timestamp": row["entered_at"],
                # Nunca expÃµe o session_id inteiro: o log Ã© para reconhecer
                # "Ã© a mesma pessoa de novo", nÃ£o para identificar alguÃ©m.
                "visitor": row["session_id"][-5:],
                "source": source,
                "url": row["url"],
            })

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar entradas de pÃ¡gina: {str(e)}"
        )


@router.get("/vsl")
async def get_live_vsl_data(
    funnel_id: str,
    minutes: int = 5,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Busca usuÃ¡rios que entraram nas VSLs nos Ãºltimos N minutos (via VTurb).

    Returns:
        [
            {
                "stepId": str,
                "playerId": str,
                "label": str,
                "liveUsers": int,
                "domain": str,
                "windowMinutes": int
            }
        ]
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # Busca steps do tipo VSL
        steps = supabase.table("funnel_steps").select("*").eq(
            "funnel_id", funnel_id
        ).eq("type", "vsl").execute()

        if not steps.data:
            return []

        # Para cada VSL com player_id configurado, busca live_users do VTurb.
        # Etapas sem player_id ficam de fora do retorno: mostrar "0 pessoas"
        # pra uma VSL que nunca foi ligada ao VTurb seria inventar um dado,
        # nÃ£o reportar ausÃªncia dele.
        configured = [s for s in steps.data if s.get("player_id")]

        # Verifica se tem credenciais VTurb ANTES de chamar a API.
        # Sem token nÃ£o hÃ¡ o que consultar â€” evita queimar rate limit do VTurb
        # com chamadas que vÃ£o falhar em _make_request (401/403).
        creds = await vturb_service.get_credentials(current_user.id, ws_id)
        if not creds:
            return []

        # Em paralelo, nÃ£o uma de cada vez: as chamadas ao VTurb nÃ£o dependem
        # entre si, e um funil com vÃ¡rias VSLs esperava a soma das latÃªncias
        # de cada uma antes de responder.
        vturb_results = await asyncio.gather(
            *(
                vturb_service.get_live_users(
                    current_user.id, step["player_id"], minutes
                )
                for step in configured
            )
        )

        result = []
        for step, vturb_result in zip(configured, vturb_results):
            # Erro (sem credenciais, rate limit, etc.) tambÃ©m nÃ£o vira zero â€”
            # a etapa simplesmente nÃ£o aparece nesta chamada.
            if not isinstance(vturb_result, list):
                continue

            live_users = sum(int(d.get("live_users", 0)) for d in vturb_result)
            domain = vturb_result[0].get("domain", "") if vturb_result else ""

            result.append({
                "stepId": step["id"],
                "playerId": step["player_id"],
                "label": step["label"],
                "liveUsers": live_users,
                "domain": domain,
                "windowMinutes": minutes
            })

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar VSL live data: {str(e)}"
        )


@router.get("/active-funnels")
def get_active_funnels(
    minutes: int = 5,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    IDs dos funis que tiveram trÃ¡fego (heartbeat) nos Ãºltimos N minutos.
    Usado para montar as abas "Geral + por funil" da pÃ¡gina Ao Vivo.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()

        beats = supabase.table("live_beats").select(
            "funnel_id"
        ).gte("last_seen", cutoff).execute()

        # MantÃ©m sÃ³ os funis do workspace ativo.
        funnel_ids = {b["funnel_id"] for b in beats.data if b.get("funnel_id")}

        if not funnel_ids:
            return []

        funnels = scope(
            supabase.table("funnels").select("id").in_("id", list(funnel_ids)),
            ws_id, current_user.id,
        ).execute()

        return [f["id"] for f in funnels.data]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar funis ativos: {str(e)}"
        )


@router.get("/sales")
def get_live_sales(
    funnel_id: str,
    window: int = 60,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Vendas notificadas por webhook (PerfectPay/Hotmart/Kiwify) numa janela.
    Janelas suportadas: 5, 30, 60 (minutos). Status: pending | paid.
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # Normaliza a janela para os baldes conhecidos.
        if window <= 5:
            bucket = "5m"
        elif window <= 30:
            bucket = "30m"
        else:
            bucket = "60m"

        since = (datetime.now(timezone.utc) - timedelta(minutes=window)).isoformat()

        sales = supabase.table("live_sales").select("*").eq(
            "funnel_id", funnel_id
        ).gte("created_at", since).order("created_at", desc=True).execute()

        result = [
            {
                "id": s["id"],
                "funnelId": s["funnel_id"],
                "stepId": s.get("step_id"),
                "status": s["status"],
                "amount": float(s["amount"]),
                "timestamp": s["created_at"],
                "customer": s.get("customer"),
            }
            for s in sales.data
        ]

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar vendas: {str(e)}"
        )


@router.get("/conversion")
def get_live_conversion(
    funnel_id: str,
    window: int = 30,
    scope: str = "window",
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    ConversÃ£o de compra do funil (entrada -> pÃ¡gina-meta), derivada dos
    heartbeats + vendas. Retorna total e conversÃ£o de funil por etapa.

    `scope=today` ignora `window` e mede desde a meia-noite: a janela curta diz
    como estÃ¡ agora, o dia diz se isso Ã© normal.
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        now = datetime.now(timezone.utc)

        if scope == "today":
            # "Hoje" Ã© meia-noite UTC. NÃ£o Ã© o "hoje" do relÃ³gio do usuÃ¡rio â€”
            # para isso o frontend precisaria mandar o fuso dele, e a conta
            # passaria a mudar conforme quem olha. Fica registrado como
            # limitaÃ§Ã£o conhecida, nÃ£o como detalhe esquecido.
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            effective_window = max(1, int((now - start).total_seconds() // 60))
        else:
            start = now - timedelta(minutes=window)
            effective_window = window

        since = start.isoformat()

        # Etapas do funil (na ordem do desenho).
        steps = supabase.table("funnel_steps").select(
            "*"
        ).eq("funnel_id", funnel_id).order("order_index").execute()

        # Visitantes Ãºnicos por etapa = quem ENTROU em cada pÃ¡gina na janela,
        # lido do log de entradas (`live_page_entries`), nÃ£o de `live_beats`.
        # `live_beats` guarda uma linha sÃ³ por sessÃ£o com o step_id ATUAL â€” uma
        # sessÃ£o que passou por 3 pÃ¡ginas e estÃ¡ na 4Âª some das 3 primeiras
        # assim que anda, e o grÃ¡fico de funil desmoronava para 0% em etapas
        # que tiveram trÃ¡fego real, sÃ³ porque ninguÃ©m estÃ¡ mais parado nelas.
        # Admin, nÃ£o o cliente do usuÃ¡rio: mesma pegadinha jÃ¡ corrigida em
        # `/entries` â€” a consulta a `live_page_entries` com o client comum
        # voltava vazia em silÃªncio. A permissÃ£o jÃ¡ foi checada acima (o funil
        # Ã© deste usuÃ¡rio).
        entries = get_supabase_admin().table("live_page_entries").select(
            "step_id, session_id"
        ).eq("funnel_id", funnel_id).gte("entered_at", since).execute()

        # Conta sessÃµes distintas por etapa.
        by_step: dict = {}
        for e in entries.data:
            sid = e.get("session_id")
            st = e.get("step_id")
            if not st or not sid:
                continue
            by_step.setdefault(st, set()).add(sid)

        step_visitors = {st: len(s) for st, s in by_step.items()}

        # Vendas pagas na janela = conversÃµes de compra.
        sales = supabase.table("live_sales").select("*").eq(
            "funnel_id", funnel_id
        ).eq("status", "paid").gte("created_at", since).execute()

        conversions = len(sales.data)

        # "Entraram" = quem chegou na PRIMEIRA etapa, nÃ£o a soma de todas.
        # Somar as etapas conta a mesma pessoa uma vez por pÃ¡gina visitada e
        # infla o denominador â€” a conversÃ£o de compra sairia sempre menor do
        # que Ã©, e pioraria justamente nos funis com mais pÃ¡ginas.
        entry_step = steps.data[0] if steps.data else None
        total_visitors = step_visitors.get(entry_step["id"], 0) if entry_step else 0

        # Taxa por etapa (entrada relativa Ã  etapa anterior, sempre â€” nunca Ã 
        # Ãºltima etapa que teve gente). SÃ³ a primeira etapa Ã© 100% por
        # definiÃ§Ã£o (Ã© a prÃ³pria base). Uma etapa sem visitante nenhum tem
        # 0%, nÃ£o 100%: o `prev in (None, 0)` antigo tratava "nÃ£o sei" e
        # "ninguÃ©m passou por aqui" como a mesma coisa, e o funil aparecia com
        # vÃ¡rias etapas seguidas em 100% mesmo sem trÃ¡fego real nelas.
        step_rates = []
        prev = None
        for i, s in enumerate(steps.data):
            v = step_visitors.get(s["id"], 0)
            if i == 0:
                # 100% sÃ³ faz sentido como "base de si mesma" quando hÃ¡
                # alguÃ©m pra ser base â€” sem isso a etapa de entrada mostrava
                # "0 visitantes, 100%" numa janela sem trÃ¡fego nenhum.
                rate = 100.0 if v > 0 else 0.0
            elif not prev:
                rate = 0.0
            else:
                rate = round((v / prev) * 100, 1)
            step_rates.append({
                "stepId": s["id"],
                "label": s["label"],
                "visitors": v,
                "rate": rate,
            })
            prev = v

        rate = round((conversions / total_visitors) * 100, 1) if total_visitors else 0.0

        return {
            "funnelId": funnel_id,
            "windowMinutes": effective_window,
            "scope": scope,
            "visitors": total_visitors,
            "conversions": conversions,
            "rate": rate,
            "stepRates": step_rates,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar conversÃ£o: {str(e)}"
        )


@router.post("/webhook", status_code=status.HTTP_202_ACCEPTED)
def receive_sale_webhook(
    payload: dict,
    request: Request,
    secret: Optional[str] = Depends(WEBHOOK_HEADER)
):
    """
    Webhook de venda (PerfectPay, Hotmart, Kiwify...).
    Espera um corpo com: funnel_id, step_id?, status (pending|paid),
    amount, customer?, external_id?. Se WEBHOOK_SECRET estiver configurado,
    valida o header X-Webhook-Secret.

    Salva na tabela live_sales (nÃ£o requer autenticaÃ§Ã£o â€” Ã© chamado pelo
    gateway de pagamento, nÃ£o pelo frontend).
    """
    try:
        settings = get_settings()

        # Segredo esperado: global (env) OU o configurado pelo dono do funil
        # em ConfiguraÃ§Ãµes -> Webhook. Se NENHUM estiver definido, REJEITA
        # o webhook â€” nunca aceitar webhook sem segredo configurado.
        expected = settings.webhook_secret or ""
        if not expected and payload.get("funnel_id"):
            owner = (
                get_supabase_admin()
                .table("funnels")
                .select("user_id")
                .eq("id", payload["funnel_id"])
                .execute()
            )
            if owner.data:
                cred = (
                    get_supabase_admin()
                    .table("api_credentials")
                    .select("api_token")
                    .eq("user_id", owner.data[0]["user_id"])
                    .eq("provider", "webhook")
                    .execute()
                )
                if cred.data and cred.data[0].get("api_token"):
                    expected = cred.data[0]["api_token"]

        if not expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Segredo de webhook nÃ£o configurado. Defina WEBHOOK_SECRET no ambiente ou configure o token nas integraÃ§Ãµes do funil."
            )
        if secret != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Segredo de webhook invÃ¡lido"
            )

        funnel_id = payload.get("funnel_id")
        if not funnel_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="funnel_id Ã© obrigatÃ³rio"
            )

        status_value = str(payload.get("status", "pending")).lower()
        if status_value not in ("pending", "paid"):
            status_value = "pending"

        amount = float(payload.get("amount") or 0)
        external_id = payload.get("external_id") or payload.get("id")

        row = {
            "funnel_id": funnel_id,
            "step_id": payload.get("step_id"),
            "status": status_value,
            "amount": amount,
            "customer": payload.get("customer"),
            "external_id": external_id,
        }

        supabase = get_supabase_admin()

        # DeduplicaÃ§Ã£o feita Ã  mÃ£o, e nÃ£o com `upsert(on_conflict=...)`: o
        # Ã­ndice Ãºnico de `external_id` Ã© PARCIAL (`where external_id is not
        # null`), e o Postgres nÃ£o aceita Ã­ndice parcial como alvo de ON
        # CONFLICT â€” dava 42P10 e o webhook inteiro respondia 500.
        #
        # Gateway reenvia webhook (retentativa, mudanÃ§a de status pendente â†’
        # pago), entÃ£o dedupe nÃ£o Ã© luxo: sem ele a mesma venda entraria duas
        # vezes e o faturamento do dia sairia inflado.
        existing = None
        if external_id:
            found = supabase.table("live_sales").select("id, status").eq(
                "external_id", external_id
            ).execute()
            existing = found.data[0] if found.data else None

        if existing:
            result = supabase.table("live_sales").update(row).eq(
                "id", existing["id"]
            ).execute()
        else:
            result = supabase.table("live_sales").insert(row).execute()

        # SÃ³ notifica em venda nova ou mudanÃ§a de status (pending â†’ paid) â€”
        # o gateway reenvia o mesmo webhook por retentativa, e sem essa
        # checagem a mesma venda tocaria "PIX gerado" vÃ¡rias vezes.
        if not existing or existing.get("status") != status_value:
            notify_sale(funnel_id, status_value, amount, payload.get("customer"))

        return {"ok": True, "saved": len(result.data) > 0}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao processar webhook: {str(e)}"
        )


# `sale_status_enum` oficial da PerfectPay (documentaÃ§Ã£o de postback). A
# tabela `live_sales` sÃ³ distingue pending/paid hoje â€” Ã© tudo que "PIX gerado"
# x "PIX pago" precisa. Os demais status (rejeitado, cancelado, reembolsado,
# chargeback, em anÃ¡lise...) nÃ£o tÃªm onde cair sem inventar um terceiro estado
# que ninguÃ©m pediu ainda, entÃ£o ficam de fora por enquanto: melhor nÃ£o gravar
# do que gravar como se fosse uma venda paga ou pendente.
PERFECTPAY_PAID_STATUSES = {2, 8, 10}  # approved, authorized, completed
PERFECTPAY_PENDING_STATUSES = {1}      # pending (aguardando pagamento: boleto OU pix)


@router.post("/webhook/perfectpay/{funnel_id}", status_code=status.HTTP_202_ACCEPTED)
def receive_perfectpay_webhook(
    funnel_id: str,
    payload: dict,
    click_id: Optional[str] = None,
):
    """
    Webhook NATIVO da PerfectPay â€” uma URL por funil, porque o payload dela
    nÃ£o tem noÃ§Ã£o de "funil": o `funnel_id` vem da prÃ³pria URL, nÃ£o do corpo.

    Formato oficial (support.perfectpay.com.br/doc/perfectpay/postback):
    `token`, `code`, `sale_amount`, `sale_status_enum`, `customer.full_name`,
    entre outros. O `token` Ã© o segredo do postback â€” a PerfectPay nÃ£o
    oferece header customizado nessa integraÃ§Ã£o, entÃ£o a autenticaÃ§Ã£o Ã© por
    esse campo do corpo, e nÃ£o por `X-Webhook-Secret` (isso Ã© do webhook
    genÃ©rico em `/webhook`, usado por integraÃ§Ãµes manuais/Zapier).

    `click_id`: nÃ£o vem no corpo, vem na QUERY STRING. Ã‰ o placeholder
    `{click_id}` que o dono do funil configura na URL de postback dentro da
    PerfectPay (".../webhook/perfectpay/<funnel_id>?click_id={click_id}") â€”
    a PerfectPay substitui esse placeholder pelo valor do parÃ¢metro
    `click_id` que estava na URL do checkout no momento da compra. Esse valor
    Ã© o `session_id` que o tracker.js gera por visitante e propaga entre as
    pÃ¡ginas do funil, entÃ£o dÃ¡ para saber exatamente qual sessÃ£o comprou e
    em qual step ela estava (resolvido abaixo via `live_beats`).
    """
    try:
        supabase = get_supabase_admin()

        funnel = supabase.table("funnels").select("id, user_id").eq(
            "id", funnel_id
        ).execute()
        if not funnel.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil nÃ£o encontrado"
            )

        cred = supabase.table("api_credentials").select("api_token").eq(
            "user_id", funnel.data[0]["user_id"]
        ).eq("provider", "webhook").execute()
        expected = (
            cred.data[0]["api_token"]
            if cred.data and cred.data[0].get("api_token")
            else None
        )
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token do webhook nÃ£o configurado. Configure o token nas integraÃ§Ãµes para receber webhooks."
            )
        if payload.get("token") != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token do webhook invÃ¡lido"
            )

        status_enum = payload.get("sale_status_enum")
        if status_enum in PERFECTPAY_PAID_STATUSES:
            status_value = "paid"
        elif status_enum in PERFECTPAY_PENDING_STATUSES:
            status_value = "pending"
        else:
            logger.info(
                "Webhook PerfectPay ignorado (funnel_id=%s): sale_status_enum=%s (%s) sem mapeamento pending/paid",
                funnel_id,
                status_enum,
                payload.get("sale_status_detail"),
            )
            return {"ok": True, "saved": False, "reason": "status sem mapeamento pending/paid"}

        code = payload.get("code")
        customer = (payload.get("customer") or {}).get("full_name")
        amount = float(payload.get("sale_amount") or 0)

        # Resolve o step pela sessÃ£o que fez a compra, e nÃ£o pelo payload â€”
        # a PerfectPay nunca manda step_id. `click_id` sÃ³ existe se o dono do
        # funil configurou o placeholder na URL de postback; sem ele a venda
        # continua sendo salva, sÃ³ sem etapa (comportamento de antes).
        step_id = None
        if click_id:
            beat = supabase.table("live_beats").select("step_id").eq(
                "session_id", click_id
            ).execute()
            if beat.data:
                step_id = beat.data[0].get("step_id")

        row = {
            "funnel_id": funnel_id,
            "step_id": step_id,
            "status": status_value,
            "amount": amount,
            "customer": customer,
            "external_id": code,
            "session_id": click_id,
        }

        # Mesma dedupe manual do webhook genÃ©rico: o Ã­ndice de external_id Ã©
        # PARCIAL e nÃ£o serve de alvo pra ON CONFLICT (42P10). A PerfectPay
        # reenvia o mesmo `code` quando o status muda (pendente â†’ aprovado),
        # e sem isso a mesma venda entraria duas vezes.
        existing = None
        if code:
            found = supabase.table("live_sales").select("id, status").eq(
                "external_id", code
            ).execute()
            existing = found.data[0] if found.data else None

        if existing:
            result = supabase.table("live_sales").update(row).eq(
                "id", existing["id"]
            ).execute()
        else:
            result = supabase.table("live_sales").insert(row).execute()

        if not existing or existing.get("status") != status_value:
            notify_sale(funnel_id, status_value, amount, customer)

        return {"ok": True, "saved": len(result.data) > 0}

    except HTTPException:
        raise
    except Exception:
        logger.exception("Erro no webhook da PerfectPay (funnel_id=%s)", funnel_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erro ao processar webhook da PerfectPay"
        )
