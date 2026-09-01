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
        logger.exception("Erro no track: corpo inválido")
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
            place = geo_service.resolve(ip)
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
                "device": row.get("device"),
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
        # em Configurações -> Webhook. Se algum estiver definido e não bater,
        # rejeita.
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

        if expected and secret != expected:
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
            else ""
        )
        if expected and payload.get("token") != expected:
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
