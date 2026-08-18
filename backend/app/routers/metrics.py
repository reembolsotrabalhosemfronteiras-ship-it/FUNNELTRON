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

        # Busca funis do usuário
        funnels_query = supabase.table("funnels").select("id, status").eq(
            "user_id", current_user.id
        )

        if status_filter:
            funnels_query = funnels_query.eq("status", status_filter)

        funnels = funnels_query.execute()
        funnel_ids = [f["id"] for f in funnels.data]

        if not funnel_ids:
            return {
                "totalFunnels": 0,
                "activeFunnels": 0,
                "totalVisitors": 0,
                "totalConversions": 0,
                "averageConversionRate": None
            }

        # Busca métricas agregadas
        metrics = supabase.table("step_metrics").select(
            "visitors, conversions"
        ).in_("funnel_id", funnel_ids).gte(
            "date", start_date
        ).lte("date", end_date).execute()

        total_visitors = sum(m["visitors"] for m in metrics.data)
        total_conversions = sum(m["conversions"] for m in metrics.data)

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


@router.get("/tracker/{funnel_id}")
def get_tracker_metrics(
    funnel_id: str,
    period: Optional[str] = "30d",
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Mesmo formato de `GET /funnels/{funnel_id}` (visitors/conversions por
    etapa), mas do NOSSO rastreador — para as telas mostrarem algo de
    verdade quando a fonte selecionada é "Nosso rastreador" (antes, essa
    escolha não mudava nenhum número: todas liam só `step_metrics`, que só
    o Clarity/VTurb alimentam).

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

        steps = supabase.table("funnel_steps").select("id, type").eq(
            "funnel_id", funnel_id
        ).execute().data or []

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
        # primeira do tipo "obrigado". Sem nenhuma das duas, não tem onde
        # colocar a venda — fica tudo em conversions=0 mesmo.
        goal_step_id = funnel.get("conversion_goal_step_id")
        if not goal_step_id:
            goal_step = next((s for s in steps if s.get("type") == "thank_you"), None)
            goal_step_id = goal_step["id"] if goal_step else None

        conversions_total = 0
        if goal_step_id:
            sales = admin.table("live_sales").select("id").eq(
                "funnel_id", funnel_id
            ).eq("status", "paid").gte(
                "created_at", start_ts
            ).lt("created_at", end_ts).execute()
            conversions_total = len(sales.data or [])

        result = []
        for step in steps:
            visitors = by_step.get(step["id"], 0)
            conversions = conversions_total if step["id"] == goal_step_id else 0
            rate = round((conversions / visitors) * 100, 1) if visitors else 0.0
            result.append({
                "id": f"{step['id']}:{start_date}:{end_date}",
                "funnel_id": funnel_id,
                "step_id": step["id"],
                "date": end_date,
                "visitors": visitors,
                "conversions": conversions,
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

        # Busca funis
        funnels = supabase.table("funnels").select("*").eq(
            "user_id", current_user.id
        ).execute()

        result = []

        for funnel in funnels.data:
            # Busca métricas do funil
            metrics = supabase.table("step_metrics").select(
                "visitors, conversions"
            ).eq("funnel_id", funnel["id"]).gte(
                "date", start_date
            ).lte("date", end_date).execute()

            total_visitors = sum(m["visitors"] for m in metrics.data)
            total_conversions = sum(m["conversions"] for m in metrics.data)

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
    period: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Busca as métricas (Clarity/VTurb) de um funil específico.

    `period`/`from_date`/`to_date` são opcionais: sem nenhum dos três, devolve
    tudo, para não quebrar quem já chamava sem período. Com um deles, filtra
    pela coluna `date` — antes essa rota devolvia TODO o histórico sempre, e o
    seletor de período nas telas não filtrava nada aqui (só o endpoint do
    rastreador, `/tracker/{funnel_id}`, filtrava de verdade).
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
