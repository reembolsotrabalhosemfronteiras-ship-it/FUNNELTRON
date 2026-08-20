"""Router de métricas"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import Optional
from datetime import datetime, timedelta, timezone
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client, get_supabase_admin
from ..services.clarity import clarity_service
from ..services import snapshots
from supabase import Client

router = APIRouter(prefix="/metrics", tags=["metrics"])


def parse_period(period: Optional[str], from_date: Optional[str], to_date: Optional[str]):
    """Converte period ou from/to para datas"""
    if from_date and to_date:
        return from_date, to_date

    end_date = datetime.now().date()

    if period == "7d":
        start_date = end_date - timedelta(days=7)
    elif period == "30d":
        start_date = end_date - timedelta(days=30)
    elif period == "90d":
        start_date = end_date - timedelta(days=90)
    else:
        # "all" ou não especificado
        start_date = datetime(2020, 1, 1).date()

    return str(start_date), str(end_date)


def period_to_days(period: Optional[str]) -> int:
    """
    Quantos dias o período pedido representa, para a janela do Clarity.

    A Data Export API só serve os últimos 3 dias por chamada, então "30d" e
    "90d" viram 3. O corte não é escondido: o endpoint devolve `days` com o que
    de fato veio, e a tela rotula o número com esse valor em vez de com o
    período que o usuário pediu.
    """
    if not period:
        return clarity_service.MAX_DAYS

    digitos = "".join(c for c in period if c.isdigit())
    if not digitos:
        # "all" e afins: o máximo que o Clarity entrega.
        return clarity_service.MAX_DAYS

    return max(1, int(digitos))


@router.get("/clarity")
async def get_clarity_metrics(
    period: str = "30d",
    funnel_id: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Proxy para a Data Export API do Microsoft Clarity.

    Credencial única: o token de API do projeto, salvo pelo usuário ou vindo do
    env CLARITY_EXPORT_TOKEN. Fica no backend — o frontend nunca o recebe.

    Toda consulta bem-sucedida vira snapshot salvo, e a resposta sempre carrega
    quando o dado é (`asOf`). Se a API do Clarity falhar, devolve o último
    snapshot em vez de erro: um dado de ontem rotulado como de ontem serve; uma
    tela vazia não.
    """
    def _falha(mensagem: str, http_status: int):
        """Último snapshot salvo como plano B — ou o erro, se não houver nenhum."""
        snap = snapshots.latest_clarity_snapshot(current_user.id, funnel_id, period)
        if not snap:
            raise HTTPException(status_code=http_status, detail=mensagem)

        return {
            **snap["payload"],
            **snapshots.as_of_envelope(snap),
            "fromCache": True,
            "warning": mensagem,
        }

    try:
        dias_pedidos = period_to_days(period)
        resultado = await clarity_service.get_live_insights(
            current_user.id, dias_pedidos
        )

        if resultado.get("error"):
            return _falha(
                resultado.get("message", "Erro na API do Clarity"),
                status.HTTP_502_BAD_GATEWAY,
            )

        metricas = resultado["metrics"]
        dias_cobertos = resultado["days"]

        # O project_id não vai mais na chamada (o token já é do projeto), mas
        # continua sendo a chave de deduplicação do snapshot. Quem informou um
        # no cadastro mantém o dele; quem não informou usa o próprio id de
        # usuário, que é igualmente estável e único.
        creds = supabase.table("api_credentials").select("extra_config").eq(
            "user_id", current_user.id
        ).eq("provider", "clarity").execute()

        extra = (creds.data[0].get("extra_config") if creds.data else None) or {}
        project_id = extra.get("project_id") or current_user.id

        _, end_date = parse_period(period, None, None)

        # Salva o snapshot do dia. Reimportar o mesmo dia substitui a linha —
        # o Clarity reentrega o mesmo período a cada consulta, e acumular
        # linhas dobraria o número na leitura.
        salvo = snapshots.save_clarity_snapshot(
            user_id=current_user.id,
            project_id=project_id,
            period=period,
            payload=metricas,
            funnel_id=funnel_id,
            ref_date=end_date,
        )

        resposta = {
            **metricas,
            **snapshots.as_of_envelope(salvo),
            "fromCache": False,
            "days": dias_cobertos,
        }

        if dias_pedidos > dias_cobertos:
            resposta["warning"] = (
                f"O Clarity só exporta os últimos {dias_cobertos} dias. "
                f"Este número cobre {dias_cobertos} dias, não o período pedido."
            )

        return resposta

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar métricas Clarity: {str(e)}"
        )


@router.get("/overview")
def get_overview_metrics(
    period: Optional[str] = "30d",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    status_filter: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Métricas agregadas de todos os funis (visão executiva).

    `totalVisitors` é gente DIFERENTE que entrou (soma dos visitantes da
    primeira etapa de cada funil, pelo rastreador) — não pageview somado de
    toda etapa, que conta a mesma pessoa várias vezes.

    Returns:
        {
            "totalFunnels": int,
            "activeFunnels": int,
            "totalVisitors": int,
            "totalConversions": int,
            "averageConversionRate": float
        }
    """
    try:
        start_date, end_date = parse_period(period, from_date, to_date)
        start_ts = datetime.fromisoformat(start_date).replace(
            tzinfo=timezone.utc
        ).isoformat()
        end_ts = (
            datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
            + timedelta(days=1)
        ).isoformat()

        # Busca funis do usuário
        funnels_query = supabase.table("funnels").select("id, status").eq(
            "user_id", current_user.id
        )

        if status_filter:
            funnels_query = funnels_query.eq("status", status_filter)

        funnels = funnels_query.execute()

        if not funnels.data:
            return {
                "totalFunnels": 0,
                "activeFunnels": 0,
                "totalVisitors": 0,
                "totalConversions": 0,
                "averageConversionRate": None
            }

        admin = get_supabase_admin()
        total_visitors = 0
        total_conversions = 0
        for f in funnels.data:
            totals = _tracker_funnel_totals(f["id"], start_ts, end_ts, admin)
            total_visitors += totals["entry"]
            total_conversions += totals["exit"]

        avg_rate = None
        if total_visitors > 0:
            avg_rate = round((total_conversions / total_visitors) * 100, 2)

        active_count = len([f for f in funnels.data if f["status"] == "active"])

        return {
            "totalFunnels": len(funnels.data),
            "activeFunnels": active_count,
            "totalVisitors": total_visitors,
            "totalConversions": total_conversions,
            "averageConversionRate": avg_rate
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar métricas: {str(e)}"
        )


def _tracker_funnel_totals(funnel_id: str, start_ts: str, end_ts: str, admin) -> dict:
    """
    "Visitas" de um funil pelo rastreador = pessoas DIFERENTES que entraram
    (visitantes da primeira etapa, por sessão), não a soma de toda página
    vista em toda etapa — isso é volume de acesso, não gente. Também devolve
    quantos chegaram na última etapa, pra conversão de funil ponta a ponta.

    Mesma fonte (`tracker_snapshots`) e mesma regra de ordenação
    (`order_index`) que `_tracker_step_metrics` usa por etapa — aqui só
    resume pro funil inteiro.
    """
    steps = admin.table("funnel_steps").select("id, order_index").eq(
        "funnel_id", funnel_id
    ).order("order_index").execute().data or []

    if not steps:
        return {"entry": 0, "exit": 0}

    snaps = admin.table("tracker_snapshots").select("payload").eq(
        "funnel_id", funnel_id
    ).eq("bucket", "day").gte("period_start", start_ts).lt(
        "period_start", end_ts
    ).execute()

    by_step: dict = {}
    for row in snaps.data or []:
        for step_id, count in ((row.get("payload") or {}).get("byStep") or {}).items():
            if step_id == "unmapped":
                continue
            by_step[step_id] = by_step.get(step_id, 0) + int(count)

    return {
        "entry": by_step.get(steps[0]["id"], 0),
        "exit": by_step.get(steps[-1]["id"], 0),
    }


def _tracker_step_metrics(
    funnel_id: str,
    period: Optional[str],
    from_date: Optional[str],
    to_date: Optional[str],
    current_user,
    supabase: Client,
):
    """
    Mesmo formato do resultado de `GET /funnels/{funnel_id}` (visitors/
    conversions por etapa), mas do NOSSO rastreador — chamada por
    `get_funnel_metrics` quando `source=tracker` (antes, essa escolha não
    mudava nenhum número: todas liam só `step_metrics`, que só o
    Clarity/VTurb alimentam).

    Fonte: `tracker_snapshots` (bucket "day", fechado sozinho pelo
    agendador — ver `core/scheduler.py`), filtrado pelo período pedido.

    O rastreador não mede "conversão" por etapa como o Clarity/VTurb (eles
    têm meta configurada por página); a única conversão real que ele
    enxerga é a VENDA paga (`live_sales`). Por isso ela inteira vai para a
    etapa-meta do funil (a marcada em "meta de conversão", ou a primeira do
    tipo "obrigado"), e as demais etapas ficam com conversions=0 — zero de
    verdade (ninguém comprou "nessa etapa"), não ausência de dado.
    """
    try:
        funnel_result = supabase.table("funnels").select("*").eq(
            "id", funnel_id
        ).eq("user_id", current_user.id).execute()

        if not funnel_result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )
        funnel = funnel_result.data[0]

        steps = supabase.table("funnel_steps").select(
            "id, type, order_index"
        ).eq("funnel_id", funnel_id).order("order_index").execute().data or []

        edges = supabase.table("funnel_edges").select(
            "source_step_id, target_step_id, condition"
        ).eq("funnel_id", funnel_id).eq("condition", "default").execute().data or []
        default_target_by_source = {
            e["source_step_id"]: e["target_step_id"] for e in edges
        }

        start_date, end_date = parse_period(period, from_date, to_date)
        start_ts = datetime.fromisoformat(start_date).replace(
            tzinfo=timezone.utc
        ).isoformat()
        end_ts = (
            datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
            + timedelta(days=1)
        ).isoformat()

        admin = get_supabase_admin()

        snaps = admin.table("tracker_snapshots").select(
            "payload"
        ).eq("funnel_id", funnel_id).eq("bucket", "day").gte(
            "period_start", start_ts
        ).lt("period_start", end_ts).execute()

        by_step: dict = {}
        for row in snaps.data or []:
            for step_id, count in ((row.get("payload") or {}).get("byStep") or {}).items():
                if step_id == "unmapped":
                    continue
                by_step[step_id] = by_step.get(step_id, 0) + int(count)

        # Etapa-meta da conversão de compra: a marcada pelo dono, senão a
        # primeira do tipo "obrigado". Mesma regra do `resolveGoalStep()` do
        # frontend (lib/funnelStats.ts) — inclusive a defesa contra id
        # pendurado: se a etapa marcada foi apagada/recriada num reedição do
        # funil (novo id), `conversion_goal_step_id` continua preenchido mas
        # não bate com etapa nenhuma. Sem essa defesa, as vendas pagas eram
        # calculadas certas mas não apareciam em NENHUMA etapa — sumiam.
        step_ids = {s["id"] for s in steps}
        goal_step_id = funnel.get("conversion_goal_step_id")
        if not goal_step_id or goal_step_id not in step_ids:
            goal_step = next((s for s in steps if s.get("type") == "thank_you"), None)
            goal_step_id = goal_step["id"] if goal_step else None

        # Quem manda pra quem, no sentido inverso (destino -> origem): dá pra
        # achar de qual etapa anterior cada etapa recebeu gente, sem
        # depender da ordem em `steps` (um funil com ramificação não é uma
        # linha reta).
        source_by_target = {
            target: source for source, target in default_target_by_source.items()
        }

        result = []
        for i, step in enumerate(steps):
            visitors = by_step.get(step["id"], 0)
            prev_step_id = source_by_target.get(step["id"])
            prev_visitors = by_step.get(prev_step_id, 0) if prev_step_id else None

            if prev_visitors is None:
                # Sem etapa anterior conhecida (primeira do funil, ou órfã por
                # causa de uma edição do desenho): conversão de página não se
                # aplica, só "chegou" ou não.
                rate = 100.0 if visitors > 0 else 0.0
            elif prev_visitors == 0:
                rate = 0.0
            else:
                rate = round((visitors / prev_visitors) * 100, 1)

            result.append({
                "id": f"{step['id']}:{start_date}:{end_date}",
                "funnel_id": funnel_id,
                "step_id": step["id"],
                "date": end_date,
                "visitors": visitors,
                # "Conversões" = quantos chegaram nesta etapa vindos da
                # anterior (página → página), não venda — a conversão de
                # compra é medida à parte, por `conversion_goal_step_id` +
                # `live_sales`, e não depende deste campo.
                "conversions": visitors,
                "conversion_rate": rate,
                "source": "tracker",
            })

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar métricas do rastreador: {str(e)}"
        )


@router.get("/funnels/ranking")
def get_funnels_ranking(
    period: Optional[str] = "30d",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Ranking de funis por taxa de conversão.

    `visitors` = gente diferente que entrou (primeira etapa); `conversions` =
    quantos chegaram na última — a mesma conversão ponta a ponta que o resto
    do app usa (`computeStats` no frontend), não uma média de conversões por
    etapa somadas.

    Returns:
        [
            {
                "funnelId": str,
                "funnelName": str,
                "status": str,
                "visitors": int,
                "conversions": int,
                "conversionRate": float
            }
        ]
    """
    try:
        start_date, end_date = parse_period(period, from_date, to_date)
        start_ts = datetime.fromisoformat(start_date).replace(
            tzinfo=timezone.utc
        ).isoformat()
        end_ts = (
            datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
            + timedelta(days=1)
        ).isoformat()

        # Busca funis
        funnels = supabase.table("funnels").select("*").eq(
            "user_id", current_user.id
        ).execute()

        admin = get_supabase_admin()
        result = []

        for funnel in funnels.data:
            totals = _tracker_funnel_totals(funnel["id"], start_ts, end_ts, admin)
            total_visitors = totals["entry"]
            total_conversions = totals["exit"]

            conv_rate = None
            if total_visitors > 0:
                conv_rate = round((total_conversions / total_visitors) * 100, 2)

            result.append({
                "funnelId": funnel["id"],
                "funnelName": funnel["name"],
                "status": funnel["status"],
                "visitors": total_visitors,
                "conversions": total_conversions,
                "conversionRate": conv_rate
            })

        # Ordena por conversionRate (None vai pro fim)
        result.sort(key=lambda x: x["conversionRate"] or -1, reverse=True)

        return result

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar ranking: {str(e)}"
        )


@router.get("/vsl")
def get_vsl_metrics(
    period: Optional[str] = "30d",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Insights de VSL (top VSLs por engajamento e conversão).

    Returns:
        [
            {
                "id": str,
                "name": str,
                "funnelId": str,
                "funnelName": str,
                "stepId": str,
                "engagementRate": float,
                "conversionRate": float,
                "views": int,
                "completions": int,
                "source": "vturb"
            }
        ]
    """
    try:
        start_date, end_date = parse_period(period, from_date, to_date)

        # Busca funis do usuário
        funnels = supabase.table("funnels").select("id, name").eq(
            "user_id", current_user.id
        ).execute()

        funnel_ids = [f["id"] for f in funnels.data]

        if not funnel_ids:
            return []

        # Busca VSL insights
        vsl_data = supabase.table("vsl_insights").select("*").in_(
            "funnel_id", funnel_ids
        ).gte("date", start_date).lte("date", end_date).execute()

        # Agrupa por step_id (soma views e completions)
        vsl_by_step = {}

        for vsl in vsl_data.data:
            step_id = vsl["step_id"]

            if step_id not in vsl_by_step:
                vsl_by_step[step_id] = {
                    "id": vsl["id"],
                    "name": vsl["name"],
                    "funnelId": vsl["funnel_id"],
                    "stepId": step_id,
                    "views": 0,
                    "completions": 0,
                    "source": vsl["source"]
                }

            vsl_by_step[step_id]["views"] += vsl.get("views", 0)
            vsl_by_step[step_id]["completions"] += vsl.get("completions", 0)

        # Calcula rates
        result = []
        for vsl in vsl_by_step.values():
            engagement_rate = None
            conversion_rate = None

            if vsl["views"] > 0:
                engagement_rate = round((vsl["completions"] / vsl["views"]) * 100, 2)
                conversion_rate = engagement_rate  # Simplificado

            # Adiciona nome do funil
            funnel_name = next((f["name"] for f in funnels.data if f["id"] == vsl["funnelId"]), "")

            result.append({
                **vsl,
                "funnelName": funnel_name,
                "engagementRate": engagement_rate,
                "conversionRate": conversion_rate
            })

        # Ordena por views (mais populares primeiro)
        result.sort(key=lambda x: x["views"], reverse=True)

        return result

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar VSL metrics: {str(e)}"
        )


@router.get("/funnels/{funnel_id}")
def get_funnel_metrics(
    funnel_id: str,
    source: Optional[str] = "clarity",
    period: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Busca as métricas de um funil específico.

    `source=tracker` devolve do NOSSO rastreador (`tracker_snapshots`);
    qualquer outro valor (padrão `clarity`) devolve do Clarity/VTurb
    (`step_metrics`). Um endpoint só, que decide server-side — antes eram
    duas rotas (`/funnels/{funnel_id}` e `/tracker/{funnel_id}`) com formas
    de responder ligeiramente diferentes, e cada uma das três telas que
    mostra métricas tinha que repetir o mesmo `if (source === "tracker")`
    na hora de escolher qual chamar.

    `period`/`from_date`/`to_date` são opcionais na fonte Clarity/VTurb: sem
    nenhum dos três, devolve tudo, para não quebrar quem já chamava sem
    período. Com um deles, filtra pela coluna `date`.
    """
    if source == "tracker":
        return _tracker_step_metrics(
            funnel_id, period or "30d", from_date, to_date, current_user, supabase
        )

    try:
        # Verifica se o funil pertence ao usuário
        funnel = supabase.table("funnels").select("id").eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()

        if not funnel.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        # Busca métricas
        query = supabase.table("step_metrics").select("*").eq(
            "funnel_id", funnel_id
        )

        if period or from_date or to_date:
            start_date, end_date = parse_period(period, from_date, to_date)
            query = query.gte("date", start_date).lte("date", end_date)

        metrics = query.order("date", desc=True).execute()

        return metrics.data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar métricas: {str(e)}"
        )


@router.get("/funnels/{funnel_id}/time-on-page")
def get_time_on_page(
    funnel_id: str,
    period: Optional[str] = "30d",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Tempo médio que as pessoas ficam em cada página, do NOSSO rastreador.

    O rastreador não grava um "saiu às Xh" — só "entrou às Xh" (uma linha em
    `live_page_entries` por troca de URL). Mas isso já basta: numa mesma
    sessão, o tempo na página A é a diferença entre "entrou na A" e "entrou
    na B" (a próxima). A ÚLTIMA página de cada sessão fica de fora da conta —
    não tem próxima entrada pra saber quando ela saiu de lá (pode ter fechado
    a aba, pode ter ficado o dia todo lendo).

    Returns:
        [{"stepId": str, "avgSeconds": float, "samples": int}]
    """
    try:
        funnel = supabase.table("funnels").select("id").eq(
            "id", funnel_id
        ).eq("user_id", current_user.id).execute()

        if not funnel.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        start_date, end_date = parse_period(period, from_date, to_date)
        start_ts = datetime.fromisoformat(start_date).replace(
            tzinfo=timezone.utc
        ).isoformat()
        end_ts = (
            datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
            + timedelta(days=1)
        ).isoformat()

        # Admin, mesma pegadinha de sempre: `live_page_entries` tem RLS e o
        # client comum devolve vazio em silêncio. A permissão já foi checada
        # acima (o funil é deste usuário).
        entries = get_supabase_admin().table("live_page_entries").select(
            "session_id, step_id, entered_at"
        ).eq("funnel_id", funnel_id).gte(
            "entered_at", start_ts
        ).lt("entered_at", end_ts).order("session_id").order(
            "entered_at"
        ).execute()

        by_session: dict = {}
        for e in entries.data or []:
            sid = e.get("session_id")
            if not sid:
                continue
            by_session.setdefault(sid, []).append(e)

        sums: dict = {}
        counts: dict = {}
        for rows in by_session.values():
            for i in range(len(rows) - 1):
                current = rows[i]
                step_id = current.get("step_id")
                if not step_id:
                    continue
                started = datetime.fromisoformat(current["entered_at"])
                ended = datetime.fromisoformat(rows[i + 1]["entered_at"])
                seconds = (ended - started).total_seconds()
                # Heartbeat fora de ordem ou dado sujo não vira "tempo
                # negativo" nem infla a média com uma sessão esquecida aberta
                # por horas — descarta em vez de distorcer o resto.
                if seconds <= 0 or seconds > 3600:
                    continue
                sums[step_id] = sums.get(step_id, 0.0) + seconds
                counts[step_id] = counts.get(step_id, 0) + 1

        return [
            {
                "stepId": step_id,
                "avgSeconds": round(sums[step_id] / counts[step_id], 1),
                "samples": counts[step_id],
            }
            for step_id in sums
        ]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar tempo por página: {str(e)}"
        )


@router.get("/funnels/{funnel_id}/trend")
def get_funnel_trend(
    funnel_id: str,
    source: Optional[str] = "clarity",
    period: Optional[str] = "30d",
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Conversão de funil dia a dia (primeira etapa até a última), não só o
    total acumulado do período — para ver se uma mudança na página melhorou
    ou piorou algo, e não confundir isso com uma variação normal de tráfego.

    Returns:
        [{ "date": "2026-08-01", "visitors": int, "conversions": int, "rate": float|None }]
    """
    try:
        funnel = supabase.table("funnels").select("id").eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()
        if not funnel.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Funil não encontrado"
            )

        steps = supabase.table("funnel_steps").select("id, order_index").eq(
            "funnel_id", funnel_id
        ).order("order_index").execute().data or []
        if len(steps) < 2:
            return []

        first_step_id = steps[0]["id"]
        last_step_id = steps[-1]["id"]
        start_date, end_date = parse_period(period, None, None)

        if source == "tracker":
            start_ts = datetime.fromisoformat(start_date).replace(
                tzinfo=timezone.utc
            ).isoformat()
            end_ts = (
                datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
                + timedelta(days=1)
            ).isoformat()

            admin = get_supabase_admin()
            snaps = admin.table("tracker_snapshots").select(
                "period_start, payload"
            ).eq("funnel_id", funnel_id).eq("bucket", "day").gte(
                "period_start", start_ts
            ).lt("period_start", end_ts).order("period_start").execute()

            by_date: dict = {}
            for row in snaps.data or []:
                dia = str(row["period_start"])[:10]
                by_step = (row.get("payload") or {}).get("byStep") or {}
                bucket = by_date.setdefault(dia, {"first": 0, "last": 0})
                bucket["first"] += int(by_step.get(first_step_id, 0))
                bucket["last"] += int(by_step.get(last_step_id, 0))

            return [
                {
                    "date": dia,
                    "visitors": v["first"],
                    "conversions": v["last"],
                    "rate": round((v["last"] / v["first"]) * 100, 1) if v["first"] else None,
                }
                for dia, v in sorted(by_date.items())
            ]

        # Clarity/VTurb: já vem com uma linha por (step, date, source).
        rows = supabase.table("step_metrics").select(
            "step_id, date, visitors"
        ).eq("funnel_id", funnel_id).in_(
            "step_id", [first_step_id, last_step_id]
        ).gte("date", start_date).lte("date", end_date).execute().data or []

        by_date: dict = {}
        for r in rows:
            bucket = by_date.setdefault(str(r["date"]), {"first": 0, "last": 0})
            key = "first" if r["step_id"] == first_step_id else "last"
            bucket[key] += r["visitors"] or 0

        return [
            {
                "date": dia,
                "visitors": v["first"],
                "conversions": v["last"],
                "rate": round((v["last"] / v["first"]) * 100, 1) if v["first"] else None,
            }
            for dia, v in sorted(by_date.items())
        ]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar tendência do funil: {str(e)}"
        )


@router.get("/funnels/{funnel_id}/ticket")
def get_funnel_ticket(
    funnel_id: str,
    period: Optional[str] = "30d",
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Ticket médio real do funil, das vendas importadas (UTMify) ou recebidas
    por webhook (`live_sales`, status pago). Sem isso, "quanto essa queda
    custou" seria número inventado — aqui é a média do que o funil de fato
    vendeu no período. `avgTicket` vem `None` quando não há venda registrada:
    a tela mostra "—", nunca assume um valor.

    Returns: { "avgTicket": float|None, "salesCount": int }
    """
    try:
        funnel = supabase.table("funnels").select("id").eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()
        if not funnel.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Funil não encontrado"
            )

        start_date, end_date = parse_period(period, None, None)

        imported = supabase.table("sales").select("gross_value").eq(
            "funnel_id", funnel_id
        ).eq("status", "approved").gte("date", start_date).lte(
            "date", end_date
        ).execute().data or []

        values = [float(s["gross_value"]) for s in imported if s.get("gross_value") is not None]

        if not values:
            start_ts = datetime.fromisoformat(start_date).replace(
                tzinfo=timezone.utc
            ).isoformat()
            end_ts = (
                datetime.fromisoformat(end_date).replace(tzinfo=timezone.utc)
                + timedelta(days=1)
            ).isoformat()
            admin = get_supabase_admin()
            paid = admin.table("live_sales").select("amount").eq(
                "funnel_id", funnel_id
            ).eq("status", "paid").gte("created_at", start_ts).lt(
                "created_at", end_ts
            ).execute().data or []
            values = [float(s["amount"]) for s in paid if s.get("amount") is not None]

        if not values:
            return {"avgTicket": None, "salesCount": 0}

        return {
            "avgTicket": round(sum(values) / len(values), 2),
            "salesCount": len(values),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar ticket médio: {str(e)}"
        )


@router.post("/funnels/{funnel_id}/sync", status_code=status.HTTP_204_NO_CONTENT)
def sync_funnel_metrics(
    funnel_id: str,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Sincroniza métricas do funil com VTurb e Clarity.
    TODO: Implementar lógica real de sincronização.
    """
    try:
        # Verifica se o funil pertence ao usuário
        funnel = supabase.table("funnels").select("id").eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()

        if not funnel.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        # TODO: Implementar sincronização real
        # 1. Buscar steps do funil
        # 2. Para cada step do tipo VSL, buscar dados do VTurb
        # 3. Para outros steps, buscar do Clarity
        # 4. Inserir/atualizar step_metrics e vsl_insights

        return None

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao sincronizar métricas: {str(e)}"
        )
