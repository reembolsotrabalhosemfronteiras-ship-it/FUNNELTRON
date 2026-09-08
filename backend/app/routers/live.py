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

# Enquanto a migration 008 (colunas geo_* em live_beats) não rodar no banco, o
# primeiro heartbeat com geo estoura "column ... does not exist". Este flag
# desliga o envio de geo até o próximo restart — o heartbeat NUNCA falha por
# causa disso, só deixa de alimentar o mapa.
_geo_columns_ok = True
_GEO_KEYS = ("geo_city", "geo_uf", "geo_lat", "geo_lon")

# DIAGNÓSTICO TEMPORÁRIO: captura a última exceção dos inserts de
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
    # Identidade da visualização de página: igual em todos os heartbeats da
    # mesma página, diferente quando a pessoa navega. É a chave de dedupe.
    # Opcional para não quebrar snippets antigos já colados em produção.
    event_id: Optional[str] = None
    url: str
    referrer: Optional[str] = None
    utm: Optional[dict] = None
    # UTM da primeira página visitada na sessão (first-touch).
    # O tracker persiste isso no sessionStorage e envia em todo heartbeat/quiz.
    first_utm: Optional[dict] = None
    # Quiz answer (opcional) — se presente, event_type = 'quiz_answer'
    event_type: Optional[str] = None  # 'pageview' | 'quiz_answer' | 'contact_form'
    question_id: Optional[str] = None
    answer_id: Optional[str] = None
    answer_value: Optional[str] = None
    # Campos de contato capturados por auto-detect de formulário no tracker.js.
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

    # Resolve step_id pela URL (mesma lógica do trigger do banco)
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

    # Resolve workspace_id do funil (mesma resolução usada em parsed_campaigns/
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
    try:
        supabase.table("quiz_answers").insert(quiz_row).execute()
    except Exception as exc:
        # DIAGNÓSTICO TEMPORÁRIO: expõe a exceção real via /api/live/debug/last-error
        from datetime import datetime, timezone
        _last_insert_error["error"] = f"{type(exc).__name__}: {exc}"
        _last_insert_error["at"] = datetime.now(timezone.utc).isoformat()
        _last_insert_error["where"] = "quiz_answers"
        logger.exception("Erro ao salvar quiz_answer (session_id=%s)", beat.session_id)

    # Atualiza/cria lead_profile
    _atualizar_lead_profile(supabase, beat, utm, step_id)


def _atualizar_lead_profile(supabase: Client, beat: LiveBeatRequest, utm: dict, step_id: str | None) -> None:
    """Upsert do lead_profile consolidando quiz + UTM com atribuição por parsing de slug."""
    from app.services.utm_parser import parse_utm_slug

    try:
        ws_id = _get_workspace_id(supabase, beat.funnel_id)

        # Busca modelo de atribuição do workspace (first_touch ou last_touch)
        attribution_model = "first_touch"
        try:
            ws_result = supabase.table("workspaces").select("attribution_model").eq(
                "id", ws_id
            ).execute()
            if ws_result.data and ws_result.data[0].get("attribution_model"):
                attribution_model = ws_result.data[0]["attribution_model"]
        except Exception:
            pass

        # Escolhe UTM de atribuição baseado no modelo
        first_utm = beat.first_utm or {}
        attribution_utm = first_utm if attribution_model == "first_touch" else utm

        # --- AUTO-CRIAÇÃO DE CAMPANHA POR PARSING DE SLUG UTM ---
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
                    # (quando mesma slug_key existe em múltiplos workspaces).
                    # Verifica se o workspace_id bate; se não, força fallback manual.
                    rpc_pc_id = rpc_result.data
                    pc_check = supabase.table("parsed_campaigns").select("workspace_id").eq(
                        "id", rpc_pc_id
                    ).execute()
                    if pc_check.data and pc_check.data[0].get("workspace_id") == ws_id:
                        parsed_campaign_id = rpc_pc_id
                    else:
                        logger.warning(
                            "RPC retornou parsed_campaign de outro workspace (session=%s, "
                            "rpc_ws=%s, expected_ws=%s). Forçando fallback manual.",
                            beat.session_id,
                            pc_check.data[0].get("workspace_id") if pc_check.data else "unknown",
                            ws_id,
                        )
                        raise Exception("Workspace mismatch - forcing fallback")
            except Exception as exc:  # noqa: BLE001
                # BUG-11 fix: log explícito + fallback gracioso. O heartbeat NUNCA
                # deve falhar por causa do RPC de parsed_campaign — a venda e o
                # lead_profile continuam sendo salvos, só sem vínculo com campanha
                # parseada. Sem esse try/except amplo, um erro no RPC (ex: coluna
                # nova não migrada ainda) derrubava o heartbeat inteiro.
                logger.warning(
                    "RPC resolve_or_create_parsed_campaign falhou (session=%s): %s. "
                    "Tentando fallback manual.",
                    beat.session_id, str(exc),
                )
                # Fallback manual: faz upsert direto na tabela parsed_campaigns
                # (funciona tanto em modo local quanto Supabase quando o RPC falha).
                # A lógica espelha o RPC do Supabase: busca por slug_key, se não
                # existe insere, senão retorna o ID existente.
                try:
                    slug_key = parsed.to_campaign_key()
                    # Busca primeiro com workspace_id correto
                    existing_correct = supabase.table("parsed_campaigns").select("id").eq(
                        "slug_key", slug_key
                    ).eq("workspace_id", ws_id).execute()
                    if existing_correct.data:
                        parsed_campaign_id = existing_correct.data[0]["id"]
                        # BUG FIX: incrementa session_count e atualiza last_seen_at
                        # quando a campanha já existe. Sem isso, o contador fica
                        # zerado para sempre após a primeira inserção — era exatamente
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
                            # do heartbeat atual quando o campo ainda esta vazio —
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
                            # Não existe em nenhum workspace - cria novo
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
                        "Fallback manual de parsed_campaign também falhou (session=%s): %s",
                        beat.session_id, str(fallback_exc),
                    )
                    parsed_campaign_id = None

        # Busca profile existente
        existing = supabase.table("lead_profiles").select("*").eq(
            "session_id", beat.session_id
        ).execute()

        # Busca ad_campaign pelo UTM de atribuição para preencher FKs explícitas
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
                    attributed_campaign_id = result.data[0].get("id")  # mesma tabela, campanha é outro campo
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
            # (perfis criados antes da correção tinham workspace_id=NULL)
            if ws_id and not profile.get("workspace_id"):
                update_data["workspace_id"] = ws_id
            # Só sobrescreve first_utm se ainda não existe (preserva primeira visita)
            if not profile.get("first_utm_json") and first_utm:
                update_data["first_utm_json"] = first_utm
            # Campos de contato capturados por auto-detect de formulário.
            # Só sobrescreve se o tracker enviou valor novo (evita apagar
            # nome/email já preenchidos com dados vazios de heartbeat).
            if beat.contact_name:
                update_data["contact_name"] = beat.contact_name
            if beat.contact_email:
                update_data["contact_email"] = beat.contact_email
            # Atribuição só muda se encontrou ad_campaign correspondente
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
            # Vincula à campanha detectada por parsing de slug UTM
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
            # Vincula à campanha detectada por parsing de slug UTM
            if parsed_campaign_id:
                insert_data["parsed_campaign_id"] = parsed_campaign_id

            # Tenta insert com todos os campos; se falhar por coluna ausente
            # (migration 012 não aplicada), remove campos problemáticos e tenta novamente
            try:
                supabase.table("lead_profiles").insert(insert_data).execute()
            except Exception as insert_exc:
                error_msg = str(insert_exc)
                if "contact_email" in error_msg or "contact_name" in error_msg:
                    # Remove campos que não existem no schema
                    insert_data.pop("contact_name", None)
                    insert_data.pop("contact_email", None)
                    logger.warning(
                        "Removendo campos contact_name/contact_email do insert (migration 012 pendente) - session=%s",
                        beat.session_id,
                    )
                    try:
                        supabase.table("lead_profiles").insert(insert_data).execute()
                    except Exception:
                        raise
                else:
                    raise
    except Exception as exc:
        # Falha silenciosa: não derruba o heartbeat
        logger.exception("Erro ao atualizar lead_profile (session_id=%s)", beat.session_id)
        # DIAGNÓSTICO TEMPORÁRIO: expõe a exceção real via /api/live/debug/last-error
        from datetime import datetime, timezone
        _last_insert_error["error"] = f"{type(exc).__name__}: {exc}"
        _last_insert_error["at"] = datetime.now(timezone.utc).isoformat()
        _last_insert_error["where"] = "lead_profile"


def _get_workspace_id(supabase: Client, funnel_id: str) -> str | None:
    """Resolve workspace_id do funil, com fallback para o primeiro workspace do dono.

    Funis criados antes da migration 009 não têm workspace_id. Sem fallback,
    o lead_profile ficava com workspace_id=NULL e attributed_ad_id nunca era
    resolvido (a query de ad_campaigns filtra por workspace_id). O fallback
    pega o primeiro workspace do dono do funil — todo usuário pós-009 tem
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
        # Último fallback: o workspace pessoal mais antigo do dono (migration 009
        # garante que todo usuário tem pelo menos um). Sem isso, funis criados
        # antes do backfill de workspace_members ficavam com workspace_id=NULL e
        # as linhas de parsed_campaigns/lead_profiles nunca apareciam nas abas
        # (Campanhas/Quiz filtram por .eq("workspace_id", ws_id) — NULL não casa).
        own_ws = supabase.table("workspaces").select("id").eq(
            "owner_id", user_id
        ).order("created_at").limit(1).execute()
        if own_ws.data:
            return own_ws.data[0].get("id")
    except Exception:
        pass
    return None


# DIAGNÓSTICO TEMPORÁRIO: endpoint público (sem auth) que devolve a última
# exceção capturada nos inserts de parsed_campaigns / lead_profiles / quiz_answers.
# Usado pra achar a causa raiz de "track retorna 204 mas nenhuma linha aparece
# nas abas Campanhas/Quiz". REMOVER depois de corrigir a causa.
@router.get("/debug/last-error")
def debug_last_insert_error():
    return _last_insert_error


# DIAGNÓSTICO TEMPORÁRIO: endpoint público (sem auth) que devolve uma amostra
# crua dos dados reais no banco — parsed_campaigns (pra ver se campaign_name/
# raw_campaign/creative_code estão preenchidos ou NULL) e contagem de
# quiz_answers (pra ver se o tracker está de fato gravando respostas).
# Usado pra achar a causa raiz dos 3 sintomas: (1) Quiz & Ads não trackeia,
# (2) Campanhas não separa por criativo, (3) mostra nome da conta na campanha.
# REMOVER depois de corrigir a causa.
@router.get("/debug/data-sample")
def debug_data_sample(supabase: Client = Depends(get_supabase_admin)):
    out: dict = {"parsed_campaigns": [], "quiz_answers_count": None, "error": None}
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
    Endpoint público para heartbeat do rastreador (snippet nas páginas).
    Aceita requisições anônimas (CORS aberto).

    O corpo é lido cru em vez de declarado como modelo no parâmetro porque o
    rastreador manda `Content-Type: text/plain` de propósito: é o que faz o
    navegador tratar o POST como requisição simples e PULAR o preflight
    (`OPTIONS`) — que vinha sendo barrado pelo CORS no domínio do cliente. Com
    o modelo no parâmetro, o FastAPI só faz o parse quando o tipo é
    `application/json` e devolveria 422 nesse corpo.
    """
    try:
        corpo = await request.body()
        beat = LiveBeatRequest.model_validate_json(corpo)
    except Exception:
        # Corpo malformado — o snippet manda o que consegue, não vale a pena
        # devolver erro pra ele (sendBeacon ignora a resposta mesmo). Mas o
        # erro precisa ficar visível no log do servidor, não só engolido: foi
        # exatamente esse silêncio que escondeu a migration 002 não rodada.
        logger.warning("Erro no track: corpo inválido")
        return None

    # Quiz answer: processa e retorna (não faz heartbeat de página)
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
        # Página mudou (ou é a primeira)? Registra no log de entradas ANTES do
        # upsert — depois do upsert a URL anterior já foi sobrescrita e não dá
        # mais para saber se houve troca de página.
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
                # Upsert em vez de insert: dois heartbeats da mesma página podem
                # chegar juntos (retry de rede, sendBeacon do fechamento da aba
                # correndo com o beat do intervalo). Os dois passam pelo teste de
                # URL acima antes de qualquer um gravar, e o insert simples criava
                # duas entradas para uma visita só.
                #
                # O índice de event_id é TOTAL, não parcial — índice parcial não
                # serve de alvo para ON CONFLICT (42P10, o mesmo tropeço do
                # webhook de vendas). Não precisa ser parcial porque NULLs nunca
                # colidem entre si: os beats de snippets antigos, sem event_id,
                # continuam entrando normalmente.
                supabase.table("live_page_entries").upsert(
                    entry, on_conflict="event_id"
                ).execute()
            else:
                supabase.table("live_page_entries").insert(entry).execute()

        # Geolocalização: resolve o IP → cidade/UF/lat/lon UMA vez por sessão (no
        # primeiro heartbeat). O IP nunca é gravado — só a praça. Falha é
        # silenciosa: sem geo, o visitante só não entra no mapa.
        # Usa asyncio.to_thread para não bloquear o event loop com o httpx síncrono
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
        # Não expõe erros internos para o snippet (sempre 204 pra ele), mas
        # loga com traceback: um `print` sozinho pode não aparecer em nenhum
        # lugar monitorado em produção, e uma falha de gravação aqui significa
        # visitante que "sumiu" sem ninguém saber por quê.
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
    Busca pessoas online no funil agora (últimos 90s).

    Returns:
        [
            {
                "stepId": str,
                "online": int,
                "unmapped": int  # URLs não mapeadas
            }
        ]
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # Busca beats ativos (últimos 90s)
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
    """Praças (cidades) com gente no funil agora — alimenta o mapa do Brasil.

    Sem `funnel_id`: agrega os funis do workspace ativo. Cada ponto é uma cidade
    com a contagem de sessões ativas (últimos 90s) que tinham geolocalização.
    """
    try:
        # Funis do workspace ativo — e valida a posse quando um id é pedido.
        owned = scope(
            supabase.table("funnels").select("id"), ws_id, current_user.id
        ).execute()
        owned_ids = {f["id"] for f in (owned.data or [])}
        if funnel_id:
            if funnel_id not in owned_ids:
                raise HTTPException(status_code=404, detail="Funil não encontrado")
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
            # migration 008 ainda não rodou → sem colunas geo, mapa vazio.
            if "geo_" in str(exc).lower():
                return {"total": 0, "places": 0, "points": []}
            raise

        # Agrupa por (cidade, uf) somando sessões; guarda o primeiro lat/lon.
        buckets: dict[tuple, dict] = {}
        for b in beats.data or []:
            key = (b.get("geo_city") or "—", b.get("geo_uf") or "")
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
            detail=f"Erro ao buscar geolocalização ao vivo: {str(e)}",
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
    Log de entradas em página: quem entrou, em qual etapa, quando.
    Mais recente primeiro.

    Returns:
        [
            {
                "id": str,
                "funnelId": str,
                "stepId": str | None,
                "timestamp": str,   # ISO
                "visitor": str,     # hash curto da sessão (anônimo)
                "device": "mobile" | "desktop" | None,
                "source": str,      # utm_source, domínio do referrer ou "direto"
                "url": str
            }
        ]
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # UTC explícito. `datetime.now()` devolve hora local ingênua e o
        # Postgres a interpreta no fuso da sessão (UTC): numa máquina em
        # UTC-3 a janela de 30 min virava uma de 3h30.
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=window)).isoformat()

        # Leitura com a service_role, e não com a chave anon: a tabela tem RLS
        # e o cliente anônimo não carrega o JWT do usuário — a consulta voltava
        # vazia em silêncio, como se ninguém tivesse entrado em página nenhuma.
        # A permissão já foi checada acima (o funil é deste usuário).
        rows = get_supabase_admin().table("live_page_entries").select(
            "id, step_id, url, referrer, utm, device, entered_at, session_id"
        ).eq("funnel_id", funnel_id).gte(
            "entered_at", cutoff
        ).order("entered_at", desc=True).limit(limit).execute()

        result = []

        for row in rows.data:
            utm = row.get("utm") or {}
            referrer = row.get("referrer") or ""

            # Origem: utm_source manda; senão o domínio do referrer; senão direto.
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
                # Nunca expõe o session_id inteiro: o log é para reconhecer
                # "é a mesma pessoa de novo", não para identificar alguém.
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
            detail=f"Erro ao buscar entradas de página: {str(e)}"
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
    Busca usuários que entraram nas VSLs nos últimos N minutos (via VTurb).

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
        # não reportar ausência dele.
        configured = [s for s in steps.data if s.get("player_id")]

        # Verifica se tem credenciais VTurb ANTES de chamar a API.
        # Sem token não há o que consultar — evita queimar rate limit do VTurb
        # com chamadas que vão falhar em _make_request (401/403).
        creds = await vturb_service.get_credentials(current_user.id, ws_id)
        if not creds:
            return []

        # Em paralelo, não uma de cada vez: as chamadas ao VTurb não dependem
        # entre si, e um funil com várias VSLs esperava a soma das latências
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
            # Erro (sem credenciais, rate limit, etc.) também não vira zero —
            # a etapa simplesmente não aparece nesta chamada.
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
    IDs dos funis que tiveram tráfego (heartbeat) nos últimos N minutos.
    Usado para montar as abas "Geral + por funil" da página Ao Vivo.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()

        beats = supabase.table("live_beats").select(
            "funnel_id"
        ).gte("last_seen", cutoff).execute()

        # Mantém só os funis do workspace ativo.
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
    Conversão de compra do funil (entrada -> página-meta), derivada dos
    heartbeats + vendas. Retorna total e conversão de funil por etapa.

    `scope=today` ignora `window` e mede desde a meia-noite: a janela curta diz
    como está agora, o dia diz se isso é normal.
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        now = datetime.now(timezone.utc)

        if scope == "today":
            # "Hoje" é meia-noite UTC. Não é o "hoje" do relógio do usuário —
            # para isso o frontend precisaria mandar o fuso dele, e a conta
            # passaria a mudar conforme quem olha. Fica registrado como
            # limitação conhecida, não como detalhe esquecido.
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

        # Visitantes únicos por etapa = quem ENTROU em cada página na janela,
        # lido do log de entradas (`live_page_entries`), não de `live_beats`.
        # `live_beats` guarda uma linha só por sessão com o step_id ATUAL — uma
        # sessão que passou por 3 páginas e está na 4ª some das 3 primeiras
        # assim que anda, e o gráfico de funil desmoronava para 0% em etapas
        # que tiveram tráfego real, só porque ninguém está mais parado nelas.
        # Admin, não o cliente do usuário: mesma pegadinha já corrigida em
        # `/entries` — a consulta a `live_page_entries` com o client comum
        # voltava vazia em silêncio. A permissão já foi checada acima (o funil
        # é deste usuário).
        entries = get_supabase_admin().table("live_page_entries").select(
            "step_id, session_id"
        ).eq("funnel_id", funnel_id).gte("entered_at", since).execute()

        # Conta sessões distintas por etapa.
        by_step: dict = {}
        for e in entries.data:
            sid = e.get("session_id")
            st = e.get("step_id")
            if not st or not sid:
                continue
            by_step.setdefault(st, set()).add(sid)

        step_visitors = {st: len(s) for st, s in by_step.items()}

        # Vendas pagas na janela = conversões de compra.
        sales = supabase.table("live_sales").select("*").eq(
            "funnel_id", funnel_id
        ).eq("status", "paid").gte("created_at", since).execute()

        conversions = len(sales.data)

        # "Entraram" = quem chegou na PRIMEIRA etapa, não a soma de todas.
        # Somar as etapas conta a mesma pessoa uma vez por página visitada e
        # infla o denominador — a conversão de compra sairia sempre menor do
        # que é, e pioraria justamente nos funis com mais páginas.
        entry_step = steps.data[0] if steps.data else None
        total_visitors = step_visitors.get(entry_step["id"], 0) if entry_step else 0

        # Taxa por etapa (entrada relativa à etapa anterior, sempre — nunca à
        # última etapa que teve gente). Só a primeira etapa é 100% por
        # definição (é a própria base). Uma etapa sem visitante nenhum tem
        # 0%, não 100%: o `prev in (None, 0)` antigo tratava "não sei" e
        # "ninguém passou por aqui" como a mesma coisa, e o funil aparecia com
        # várias etapas seguidas em 100% mesmo sem tráfego real nelas.
        step_rates = []
        prev = None
        for i, s in enumerate(steps.data):
            v = step_visitors.get(s["id"], 0)
            if i == 0:
                # 100% só faz sentido como "base de si mesma" quando há
                # alguém pra ser base — sem isso a etapa de entrada mostrava
                # "0 visitantes, 100%" numa janela sem tráfego nenhum.
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
            detail=f"Erro ao buscar conversão: {str(e)}"
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

    Salva na tabela live_sales (não requer autenticação — é chamado pelo
    gateway de pagamento, não pelo frontend).
    """
    try:
        settings = get_settings()

        # Segredo esperado: global (env) OU o configurado pelo dono do funil
        # em Configurações -> Webhook. Se NENHUM estiver definido, REJEITA
        # o webhook — nunca aceitar webhook sem segredo configurado.
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
                detail="Segredo de webhook não configurado. Defina WEBHOOK_SECRET no ambiente ou configure o token nas integrações do funil."
            )
        if secret != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Segredo de webhook inválido"
            )

        funnel_id = payload.get("funnel_id")
        if not funnel_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="funnel_id é obrigatório"
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

        # Deduplicação feita à mão, e não com `upsert(on_conflict=...)`: o
        # índice único de `external_id` é PARCIAL (`where external_id is not
        # null`), e o Postgres não aceita índice parcial como alvo de ON
        # CONFLICT — dava 42P10 e o webhook inteiro respondia 500.
        #
        # Gateway reenvia webhook (retentativa, mudança de status pendente →
        # pago), então dedupe não é luxo: sem ele a mesma venda entraria duas
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

        # Só notifica em venda nova ou mudança de status (pending → paid) —
        # o gateway reenvia o mesmo webhook por retentativa, e sem essa
        # checagem a mesma venda tocaria "PIX gerado" várias vezes.
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


# `sale_status_enum` oficial da PerfectPay (documentação de postback). A
# tabela `live_sales` só distingue pending/paid hoje — é tudo que "PIX gerado"
# x "PIX pago" precisa. Os demais status (rejeitado, cancelado, reembolsado,
# chargeback, em análise...) não têm onde cair sem inventar um terceiro estado
# que ninguém pediu ainda, então ficam de fora por enquanto: melhor não gravar
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
    Webhook NATIVO da PerfectPay — uma URL por funil, porque o payload dela
    não tem noção de "funil": o `funnel_id` vem da própria URL, não do corpo.

    Formato oficial (support.perfectpay.com.br/doc/perfectpay/postback):
    `token`, `code`, `sale_amount`, `sale_status_enum`, `customer.full_name`,
    entre outros. O `token` é o segredo do postback — a PerfectPay não
    oferece header customizado nessa integração, então a autenticação é por
    esse campo do corpo, e não por `X-Webhook-Secret` (isso é do webhook
    genérico em `/webhook`, usado por integrações manuais/Zapier).

    `click_id`: não vem no corpo, vem na QUERY STRING. É o placeholder
    `{click_id}` que o dono do funil configura na URL de postback dentro da
    PerfectPay (".../webhook/perfectpay/<funnel_id>?click_id={click_id}") —
    a PerfectPay substitui esse placeholder pelo valor do parâmetro
    `click_id` que estava na URL do checkout no momento da compra. Esse valor
    é o `session_id` que o tracker.js gera por visitante e propaga entre as
    páginas do funil, então dá para saber exatamente qual sessão comprou e
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
                detail="Funil não encontrado"
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
                detail="Token do webhook não configurado. Configure o token nas integrações para receber webhooks."
            )
        if payload.get("token") != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token do webhook inválido"
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

        # Resolve o step pela sessão que fez a compra, e não pelo payload —
        # a PerfectPay nunca manda step_id. `click_id` só existe se o dono do
        # funil configurou o placeholder na URL de postback; sem ele a venda
        # continua sendo salva, só sem etapa (comportamento de antes).
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

        # Mesma dedupe manual do webhook genérico: o índice de external_id é
        # PARCIAL e não serve de alvo pra ON CONFLICT (42P10). A PerfectPay
        # reenvia o mesmo `code` quando o status muda (pendente → aprovado),
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
