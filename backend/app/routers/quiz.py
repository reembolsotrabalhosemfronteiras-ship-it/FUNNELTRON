"""Router de análise de Quiz & Ads — endpoints para a aba QuizAdsTab do frontend."""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from supabase import Client

from ..core.auth import get_current_user
from ..core.supabase_client import get_supabase_admin
from ..core.workspace import get_active_workspace
from ..services.ad_sync import sync_ads
# Resolver slug/prefixo-hex -> uuid do funil. O tracker grava quiz_answers com
# o UUID completo (depois do fix de resolucao no track), mas o frontend manda
# o prefixo/slug curto (ex: "2b23f46d") nos filtros da aba Quiz & Ads. Sem
# resolver aqui, .eq("funnel_id", funnel_id) nao casa nada e a aba inteira
# volta zerada mesmo com milhares de respostas no banco.
from .live import _resolve_funnel_uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quiz", tags=["quiz"])


def _period_to_interval(period: str) -> str:
    """Converte shorthand de período (7d, 30d, 90d) para intervalo SQL."""
    mapping = {"7d": "7 days", "30d": "30 days", "90d": "90 days", "180d": "180 days"}
    return mapping.get(period, "30 days")


# ---------------------------------------------------------------------------
# Analise automatica do HTML do funil: extrai botoes por screen
# ---------------------------------------------------------------------------
def _extract_screens_from_html(html: str) -> dict:
    """Extrai os botoes e o texto da pergunta de cada <div class="screen" id="s-xxx">.

    Retorna: {screen_id: {"buttons": [text...], "questionText": "..."}}
    """
    screens: dict = {}
    # Match each screen div and its content until the next screen or end
    pattern = r'<div[^>]*class="screen[^"]*"[^>]*id="([^"]*)"[^>]*>(.*?)(?=<div[^>]*class="screen|$)'
    for match in re.finditer(pattern, html, re.DOTALL):
        screen_id = match.group(1)
        content = match.group(2)
        # Extract button/link texts
        btn_pattern = r'<(?:button|a)[^>]*>(.*?)</(?:button|a)>'
        buttons = []
        for btn_match in re.finditer(btn_pattern, content, re.DOTALL):
            text = re.sub(r'<[^>]+>', '', btn_match.group(1))
            text = re.sub(r'\s+', ' ', text).strip()
            if text and len(text) < 200:
                buttons.append(text)
        # Extract question text: visible text excluding buttons/scripts
        text_content = re.sub(r'<(?:button|a|script|style)[^>]*>.*?</(?:button|a|script|style)>', '', content, flags=re.DOTALL)
        text_content = re.sub(r'<[^>]+>', ' ', text_content)
        text_content = re.sub(r'\s+', ' ', text_content).strip()
        # Try to find question pattern (e.g., "Pergunta 1 de 5 Qual a sua idade?")
        question_text = ""
        q_match = re.search(r'(Pergunta\s+\d+\s+de\s+\d+[^\n]*?(?:\?|!|$))', text_content, re.IGNORECASE)
        if q_match:
            question_text = q_match.group(1).strip()
        elif text_content:
            # Fallback: use first 100 chars of visible text as context
            question_text = text_content[:100].strip()

        if buttons or question_text:
            screens[screen_id] = {"buttons": buttons, "questionText": question_text}
    return screens


def _build_answer_to_screen_map(screens: dict) -> dict:
    """Constroi mapa answer_value -> screen_id para mapeamento automatico.

    Quando um answer_value aparece em multiplos screens, usa o primeiro
    (mais especifico). Screens com mais botoes tem prioridade menor
    (paginas de navegacao vs paginas de quiz).
    """
    answer_map: dict = {}
    # Ordena screens por numero de botoes (ascendente) — screens com
    # poucos botoes sao mais especificos (Home = 1 botao, Pergunta = 4)
    sorted_screens = sorted(screens.items(), key=lambda x: len(x[1].get("buttons", [])))
    for screen_id, data in sorted_screens:
        for btn_text in data.get("buttons", []):
            if btn_text not in answer_map:
                answer_map[btn_text] = screen_id
    return answer_map


def _screen_id_to_label(screen_id: str, step_map: dict) -> str:
    """Converte screen_id (ex: s-q1) para label legivel usando step_map.

    Tenta casar o screen_id com os labels dos steps. Se nao casar,
    gera um label limpo a partir do screen_id.
    """
    # Mapeamento direto screen_id -> label baseado no padrao
    label_map = {
        "s-land": "Home",
        "s-t1": "Tarefa 1",
        "s-t2": "Tarefa 2",
        "s-t3": "Tarefa 3",
        "s-q1": "Pergunta 1",
        "s-q2": "Pergunta 2",
        "s-q3": "Pergunta 3",
        "s-q4": "Pergunta 4",
        "s-q5": "Pergunta 5",
        "s-q6": "Pergunta 6",
        "s-q7": "Pergunta 7",
        "s-q8": "Pergunta 8",
        "s-q9": "Pergunta 9",
        "s-q10": "Pergunta 10",
        "s-q11": "Pergunta 11",
        "s-q12": "Pergunta 12",
        "s-vt1": "Verificacao 1",
        "s-vt2": "Verificacao 2",
        "s-pix": "Metodo de Pagamento",
        "s-pix-load": "Carregando Pagamento",
        "s-vsl": "Apresentacao",
        "s-final": "Saque Final",
    }
    if screen_id in label_map:
        return label_map[screen_id]
    # Fallback: limpa o screen_id
    clean = screen_id.replace("s-", "").replace("-", " ").strip()
    if clean.startswith("q") and clean[1:].isdigit():
        return f"Pergunta {clean[1:]}"
    if clean.startswith("t") and clean[1:].isdigit():
        return f"Tarefa {clean[1:]}"
    return clean.title() if clean else screen_id


def _get_ws_id(supabase: Client, funnel_id: str) -> str:
    """Resolve workspace_id a partir de um funnel_id."""
    r = supabase.table("funnels").select("workspace_id").eq("id", funnel_id).execute()
    if r.data and r.data[0].get("workspace_id"):
        return r.data[0]["workspace_id"]
    # Fallback: busca o primeiro workspace do usuário
    raise HTTPException(404, "Workspace não encontrado para este funil")


def _assert_ws_member(supabase: Client, workspace_id: str, user_id: str) -> None:
    """Valida que o usuário é membro do workspace (BUG-10: previne vazamento cross-workspace)."""
    m = (
        supabase.table("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not m:
        raise HTTPException(status_code=403, detail="Você não é membro deste workspace.")


# ---------------------------------------------------------------------------
# GET /api/quiz/heatmap
# ---------------------------------------------------------------------------
@router.get("/heatmap")
def get_quiz_heatmap(
    funnel_id: str = Query(...),
    period: str = Query("30d"),
    source: str = Query("tracker"),
    current_user=Depends(get_current_user),
):
    """Heatmap de respostas por pergunta × campanha parseada.

    Agrupa por creative_code, campaign_code e placement vindos da tabela
    parsed_campaigns via JOIN com lead_profiles.parsed_campaign_id.
    Se o lead não tiver parsed_campaign_id, cai no utm_campaign original.
    """
    supabase = get_supabase_admin()
    interval_days = int(_period_to_interval(period).split()[0])
    from_ts = (datetime.now(timezone.utc) - timedelta(days=interval_days)).isoformat()

    # RESOLVE slug/prefixo-hex -> uuid. O tracker grava quiz_answers.funnel_id
    # com o UUID completo (fix de resolucao no track), mas o frontend manda o
    # prefixo/slug curto (ex: "2b23f46d"). Sem resolver, .eq("funnel_id", ...)
    # nao casa nada e a aba Quiz & Ads volta inteira zerada mesmo com milhares
    # de respostas no banco (BUG confirmado: 9k respostas, aba mostrava 0).
    resolved_funnel_id = _resolve_funnel_uuid(supabase, funnel_id)

    # Busca quiz_answers + parsed_campaign data via lead_profiles
    rows = (
        supabase.table("quiz_answers")
        .select("question_id, answer_value, session_id")
        .eq("funnel_id", resolved_funnel_id)
        .gte("timestamp", from_ts)
        .execute()
    )

    if not rows.data:
        return []

    # Coleta session_ids para buscar parsed_campaign info
    session_ids = list({r["session_id"] for r in rows.data})

    # Busca lead_profiles com parsed_campaign_id para estas sessões
    profiles = (
        supabase.table("lead_profiles")
        .select("session_id, parsed_campaign_id, first_utm_json")
        .in_("session_id", session_ids)
        .execute()
    )

    # Mapeia session_id → parsed_campaign_id
    session_to_pc: dict[str, str | None] = {}
    pc_ids: set[str] = set()
    for p in (profiles.data or []):
        pc_id = p.get("parsed_campaign_id")
        session_to_pc[p["session_id"]] = pc_id
        if pc_id:
            pc_ids.add(pc_id)

    # Busca parsed_campaigns em batch
    pc_map: dict[str, dict] = {}
    if pc_ids:
        pcs = (
            supabase.table("parsed_campaigns")
            .select("id, creative_code, campaign_code, placement")
            .in_("id", list(pc_ids))
            .execute()
        )
        for pc in (pcs.data or []):
            pc_map[pc["id"]] = pc

    # Agrupa por question_id → answer_value → campaign_key
    questions: dict = {}
    for row in rows.data:
        qid = row["question_id"]
        aval = row.get("answer_value") or row.get("answer_id") or "unknown"
        sid = row["session_id"]

        # Resolve campaign key: parsed_campaign > utm_campaign > direct
        pc_id = session_to_pc.get(sid)
        pc = pc_map.get(pc_id) if pc_id else None
        if pc:
            camp_key = "|".join([
                pc.get("creative_code") or "_",
                pc.get("campaign_code") or "_",
                pc.get("placement") or "_",
            ])
        else:
            # Fallback: tenta achar utm_campaign no profile
            prof = next((p for p in (profiles.data or []) if p["session_id"] == sid), None)
            utm = prof.get("first_utm_json") or {} if prof else {}
            camp_key = utm.get("utm_campaign") or "direct"

        if qid not in questions:
            questions[qid] = {"answers": {}, "total": 0, "sessions": set()}

        questions[qid]["total"] += 1
        questions[qid]["sessions"].add(sid)

        if camp_key not in questions[qid]["answers"]:
            questions[qid]["answers"][camp_key] = {}
        if aval not in questions[qid]["answers"][camp_key]:
            questions[qid]["answers"][camp_key][aval] = 0
        questions[qid]["answers"][camp_key][aval] += 1

    # Monta resposta
    result = []
    for qid, data in questions.items():
        total_responses = data["total"]
        unique_answers = set()
        for camp_answers in data["answers"].values():
            unique_answers.update(camp_answers.keys())
        q_type = "multiple" if len(unique_answers) > 3 else "single"

        by_campaign: dict = {}
        campaign_totals: dict = {}
        for camp, answers in data["answers"].items():
            camp_count = sum(answers.values())
            campaign_totals[camp] = campaign_totals.get(camp, 0) + camp_count

        for camp, camp_total in campaign_totals.items():
            pct = (camp_total / total_responses * 100) if total_responses > 0 else 0
            by_campaign[camp] = {"count": camp_total, "percentage": round(pct, 1)}

        result.append({
            "questionId": qid,
            "questionLabel": qid.replace("_", " ").title(),
            "questionType": q_type,
            "totalResponses": total_responses,
            "byCampaign": by_campaign,
        })

    result.sort(key=lambda x: x["totalResponses"], reverse=True)
    return result


# ---------------------------------------------------------------------------
# GET /api/quiz/dropoff-by-source
# ---------------------------------------------------------------------------
@router.get("/dropoff-by-source")
def get_dropoff_by_source(
    funnel_id: str = Query(...),
    period: str = Query("30d"),
    source: str = Query("tracker"),
    current_user=Depends(get_current_user),
):
    """Drop-off por source/medium/campaign — funil segmentado por UTM."""
    supabase = get_supabase_admin()
    interval_days = int(_period_to_interval(period).split()[0])
    from_ts = (datetime.now(timezone.utc) - timedelta(days=interval_days)).isoformat()

    # Resolve slug/prefixo-hex -> uuid (mesma razao do heatmap: o tracker grava
    # o UUID completo, o frontend manda o prefixo curto).
    resolved_funnel_id = _resolve_funnel_uuid(supabase, funnel_id)

    profiles = (
        supabase.table("lead_profiles")
        .select("session_id, first_utm_json, last_utm_json, converted, funnel_id")
        .eq("funnel_id", resolved_funnel_id)
        .gte("last_seen", from_ts)
        .execute()
    )

    if not profiles.data:
        return []

    session_ids = [p["session_id"] for p in profiles.data[:500]]
    entries = (
        supabase.table("live_page_entries")
        .select("session_id, step_id, url, entered_at")
        .in_("session_id", session_ids)
        .gte("entered_at", from_ts)
        .order("entered_at")
        .execute()
    )

    entries_by_session: dict = {}
    for e in (entries.data or []):
        sid = e["session_id"]
        if sid not in entries_by_session:
            entries_by_session[sid] = []
        entries_by_session[sid].append(e)

    groups: dict = {}
    for profile in profiles.data:
        utm = profile.get("first_utm_json") or profile.get("last_utm_json") or {}
        src = utm.get("utm_source") or "direct"
        med = utm.get("utm_medium") or "none"
        camp = utm.get("utm_campaign") or "organic"
        key = f"{src}|{med}|{camp}"

        if key not in groups:
            groups[key] = {
                "source": src,
                "medium": med,
                "campaign": camp,
                "campaignName": camp.replace("_", " ").title(),
                "sessions": [],
                "converted": 0,
            }

        groups[key]["sessions"].append(profile["session_id"])
        if profile.get("converted"):
            groups[key]["converted"] += 1

    result = []
    for key, group in groups.items():
        sessions = group["sessions"]
        entry_count = len(sessions)

        step_counts = [0, 0, 0, 0, 0]
        step_counts[0] = entry_count

        for sid in sessions:
            pages = entries_by_session.get(sid, [])
            unique_steps = len(set(e.get("step_id") for e in pages if e.get("step_id")))
            if unique_steps >= 2:
                step_counts[1] += 1
            if unique_steps >= 3:
                step_counts[2] += 1
            if unique_steps >= 4:
                step_counts[3] += 1

        step_counts[4] = group["converted"]

        def rate(num, denom):
            return round(num / denom * 100, 1) if denom > 0 else 0

        result.append({
            "source": group["source"],
            "medium": group["medium"],
            "campaign": group["campaign"],
            "campaignName": group["campaignName"],
            "entryCount": entry_count,
            "step1To2": {"count": step_counts[1], "rate": rate(step_counts[1], entry_count)},
            "step2To3": {"count": step_counts[2], "rate": rate(step_counts[2], entry_count)},
            "step3ToOffer": {"count": step_counts[3], "rate": rate(step_counts[3], entry_count)},
            "offerToPurchase": {"count": step_counts[4], "rate": rate(step_counts[4], entry_count)},
            "overallRate": rate(step_counts[4], entry_count),
        })

    result.sort(key=lambda x: x["entryCount"], reverse=True)
    return result[:20]


# ---------------------------------------------------------------------------
# GET /api/quiz/audience
# ---------------------------------------------------------------------------
@router.get("/audience")
def get_audience_breakdown(
    funnel_id: str = Query(...),
    ad_id: Optional[str] = Query(None),
    period: str = Query("30d"),
    current_user=Depends(get_current_user),
):
    """Audience breakdown por Ad ID — dados de ad_campaigns.audience_json."""
    supabase = get_supabase_admin()
    ws_id = _get_ws_id(supabase, funnel_id)

    query = supabase.table("ad_campaigns").select("*").eq("workspace_id", ws_id)
    if ad_id:
        query = query.eq("ad_id", ad_id)

    ads = query.execute()

    if not ads.data:
        return []

    result = []
    for ad in ads.data:
        audience = ad.get("audience_json") or {}
        result.append({
            "adId": ad.get("ad_id") or ad.get("platform_ad_id") or str(ad["id"]),
            "adName": ad.get("ad_name") or "Sem nome",
            "campaignId": ad.get("campaign_id") or "unknown",
            "age": audience.get("age", [
                {"range": "18-24", "percentage": 0},
                {"range": "25-34", "percentage": 0},
                {"range": "35-44", "percentage": 0},
                {"range": "45-54", "percentage": 0},
                {"range": "55+", "percentage": 0},
            ]),
            "gender": audience.get("gender", [
                {"label": "Feminino", "percentage": 0},
                {"label": "Masculino", "percentage": 0},
            ]),
            "location": audience.get("location", []),
            "device": audience.get("device", [
                {"label": "Mobile", "percentage": 0},
                {"label": "Desktop", "percentage": 0},
            ]),
            "peakHours": audience.get("peakHours", []),
            "interests": audience.get("interests", []),
        })

    return result


# ---------------------------------------------------------------------------
# GET /api/quiz/creative-performance (renomeado de ad-performance)
# ---------------------------------------------------------------------------
@router.get("/creative-performance")
def get_creative_performance(
    funnel_id: str = Query(...),
    period: str = Query("30d"),
    source: str = Query("tracker"),
    current_user=Depends(get_current_user),
):
    """Performance agrupada por creative_code + placement da tabela parsed_campaigns.

    Métricas: session_count, quiz_response_count, conversions, revenue,
    CPA e ROAS calculados a partir de lead_profiles vinculados.
    """
    supabase = get_supabase_admin()
    # Resolve slug/prefixo-hex -> uuid ANTES de tudo: _get_ws_id e os filtros
    # .eq("funnel_id", ...) precisam do UUID completo (o tracker grava assim,
    # o frontend manda o prefixo curto). Sem isso, ws_id falha e a aba zera.
    resolved_funnel_id = _resolve_funnel_uuid(supabase, funnel_id)
    ws_id = _get_ws_id(supabase, resolved_funnel_id)
    interval_days = int(_period_to_interval(period).split()[0])
    from_ts = (datetime.now(timezone.utc) - timedelta(days=interval_days)).isoformat()

    # Busca parsed_campaigns do workspace
    pcs = (
        supabase.table("parsed_campaigns")
        .select("id, creative_code, campaign_code, placement, session_count, quiz_response_count, last_seen_at")
        .eq("workspace_id", ws_id)
        .gte("last_seen_at", from_ts)
        .order("last_seen_at", desc=True)
        .execute()
    )

    if not pcs.data:
        return []

    # Busca métricas de conversão por parsed_campaign via lead_profiles
    pc_ids = [pc["id"] for pc in pcs.data]
    leads = (
        supabase.table("lead_profiles")
        .select("parsed_campaign_id, converted, conversion_value")
        .eq("funnel_id", resolved_funnel_id)
        .in_("parsed_campaign_id", pc_ids)
        .gte("last_seen", from_ts)
        .execute()
    )

    # Agrega stats por parsed_campaign_id
    stats_by_pc: dict = {}
    for lead in (leads.data or []):
        pc_id = lead.get("parsed_campaign_id")
        if not pc_id:
            continue
        if pc_id not in stats_by_pc:
            stats_by_pc[pc_id] = {"conversions": 0, "revenue": 0}
        if lead.get("converted"):
            stats_by_pc[pc_id]["conversions"] += 1
            stats_by_pc[pc_id]["revenue"] += float(lead.get("conversion_value") or 0)

    # SESSOES UNICAS QUE RESPONDERAM AO QUIZ por parsed_campaign (mesma logica
    # do endpoint parsed-campaigns: quiz_response_count conta cada resposta
    # individual, inflando ~9x; a metrica correta eh sessoes distintas).
    quiz_sessions_by_pc_cp: dict = {}
    if pc_ids:
        try:
            lp_sess_cp = (
                supabase.table("lead_profiles")
                .select("session_id, parsed_campaign_id")
                .eq("workspace_id", ws_id)
                .in_("parsed_campaign_id", pc_ids)
                .execute()
            )
            sid_to_pc_cp: dict = {}
            all_sids_cp: list = []
            for lp in (lp_sess_cp.data or []):
                sid = lp.get("session_id")
                pcid = lp.get("parsed_campaign_id")
                if sid and pcid:
                    sid_to_pc_cp[sid] = pcid
                    all_sids_cp.append(sid)
            if all_sids_cp:
                qa_cp = (
                    supabase.table("quiz_answers")
                    .select("session_id")
                    .in_("session_id", all_sids_cp)
                    .execute()
                )
                quiz_sids_cp: dict = {}
                for qa in (qa_cp.data or []):
                    sid = qa.get("session_id")
                    pcid = sid_to_pc_cp.get(sid)
                    if pcid:
                        quiz_sids_cp.setdefault(pcid, set()).add(sid)
                quiz_sessions_by_pc_cp = {k: len(v) for k, v in quiz_sids_cp.items()}
        except Exception:
            pass

    # Monta resposta agrupada por creative_code + placement
    result = []
    for pc in pcs.data:
        pc_id = pc["id"]
        stats = stats_by_pc.get(pc_id, {})
        conversions = stats.get("conversions", 0)
        revenue = stats.get("revenue", 0)
        sessions = pc.get("session_count") or 0
        quiz_sessions_cp = quiz_sessions_by_pc_cp.get(pc_id, 0)
        quiz_responses_raw = pc.get("quiz_response_count") or 0
        quiz_responses = quiz_sessions_cp if quiz_sessions_cp > 0 else min(quiz_responses_raw, sessions)

        # Estimativa de spend baseada em ad_campaigns se houver link
        # (parsed_campaigns não tem spend direto — vem do sync Meta)
        spend = 0.0
        try:
            ad_match = (
                supabase.table("ad_campaigns")
                .select("spend")
                .eq("workspace_id", ws_id)
                .eq("platform_ad_id", pc.get("platform_ad_id") or "")
                .limit(1)
                .execute()
            )
            if ad_match.data:
                spend = float(ad_match.data[0].get("spend") or 0)
        except Exception:
            pass

        cpa = spend / conversions if conversions > 0 else None
        roas = revenue / spend if spend > 0 else None
        quiz_rate = (quiz_responses / sessions * 100) if sessions > 0 else 0
        conv_rate = (conversions / sessions * 100) if sessions > 0 else 0

        result.append({
            "creativeCode": pc.get("creative_code") or "unknown",
            "campaignCode": pc.get("campaign_code") or "unknown",
            "placement": pc.get("placement") or "unknown",
            "sessions": sessions,
            "quizResponses": quiz_responses,
            "quizRate": round(quiz_rate, 1),
            "conversions": conversions,
            "convRate": round(conv_rate, 1),
            "revenue": round(revenue, 2),
            "spend": round(spend, 2),
            "cpa": round(cpa, 2) if cpa else None,
            "roas": round(roas, 1) if roas else None,
            "lastSeenAt": pc.get("last_seen_at"),
        })

    # Ordena por sessions decrescente
    result.sort(key=lambda x: x["sessions"], reverse=True)
    return result


# Alias backward-compatible: frontend antigo pode chamar /ad-performance
@router.get("/ad-performance")
def get_ad_performance_compat(
    funnel_id: str = Query(...),
    period: str = Query("30d"),
    source: str = Query("tracker"),
    current_user=Depends(get_current_user),
):
    """Alias backward-compatible → redireciona para creative-performance."""
    return get_creative_performance(funnel_id, period, source, current_user)


# ---------------------------------------------------------------------------
# GET /api/quiz/by-campaign — drill-down por campaign_code
# ---------------------------------------------------------------------------
@router.get("/by-campaign")
def get_quiz_by_campaign(
    funnel_id: str = Query(...),
    campaign_code: str = Query(...),
    period: str = Query("30d"),
    current_user=Depends(get_current_user),
):
    """Drill-down de respostas de quiz filtradas por campaign_code específico.

    BUG-10 fix: valida que o usuário é membro do workspace antes de retornar dados.
    BUG-09 fix: busca todas as sessões de uma vez com JOIN ao invés de loop N+1.
    """
    supabase = get_supabase_admin()
    # Resolve slug/prefixo-hex -> uuid ANTES de tudo (mesma razao dos outros
    # endpoints: tracker grava UUID completo, frontend manda prefixo curto).
    resolved_funnel_id = _resolve_funnel_uuid(supabase, funnel_id)
    ws_id = _get_ws_id(supabase, resolved_funnel_id)
    _assert_ws_member(supabase, ws_id, current_user.id)  # BUG-10: previne vazamento cross-workspace

    interval_days = int(_period_to_interval(period).split()[0])
    from_ts = (datetime.now(timezone.utc) - timedelta(days=interval_days)).isoformat()

    # Busca parsed_campaigns com este campaign_code
    pcs = (
        supabase.table("parsed_campaigns")
        .select("id, creative_code, placement, session_count")
        .eq("workspace_id", ws_id)
        .eq("campaign_code", campaign_code)
        .execute()
    )

    if not pcs.data:
        return {"campaignCode": campaign_code, "creatives": []}

    pc_ids = [pc["id"] for pc in pcs.data]

    # BUG-09 fix: busca todas as sessões + mapeamento session→creative_code de uma vez
    # ao invés de fazer N queries separadas (uma por parsed_campaign).
    profiles = (
        supabase.table("lead_profiles")
        .select("session_id, parsed_campaign_id")
        .in_("parsed_campaign_id", pc_ids)
        .eq("funnel_id", resolved_funnel_id)
        .execute()
    )

    # Mapeia session_id → creative_code em memória (sem query extra)
    pc_id_to_cc = {pc["id"]: (pc.get("creative_code") or "unknown") for pc in pcs.data}
    session_to_cc: dict[str, str] = {}
    for p in (profiles.data or []):
        pc_id = p.get("parsed_campaign_id")
        if pc_id and pc_id in pc_id_to_cc:
            session_to_cc[p["session_id"]] = pc_id_to_cc[pc_id]

    session_ids = list(session_to_cc.keys())

    if not session_ids:
        return {"campaignCode": campaign_code, "creatives": []}

    # Busca quiz_answers destas sessões
    quiz_rows = (
        supabase.table("quiz_answers")
        .select("question_id, answer_value, session_id")
        .eq("funnel_id", resolved_funnel_id)
        .in_("session_id", session_ids)
        .gte("timestamp", from_ts)
        .execute()
    )

    # Agrupa por creative_code → question → answer
    pc_session_counts = {pc["id"]: pc.get("session_count", 0) for pc in pcs.data}
    creatives: dict = {}
    for pc in pcs.data:
        cc = pc.get("creative_code") or "unknown"
        if cc not in creatives:
            creatives[cc] = {"questions": {}, "totalSessions": pc.get("session_count", 0)}

    for row in (quiz_rows.data or []):
        sid = row["session_id"]
        cc = session_to_cc.get(sid, "unknown")
        qid = row["question_id"]
        aval = row.get("answer_value") or row.get("answer_id") or "unknown"

        if cc not in creatives:
            creatives[cc] = {"questions": {}, "totalSessions": 0}

        if qid not in creatives[cc]["questions"]:
            creatives[cc]["questions"][qid] = {}
        if aval not in creatives[cc]["questions"][qid]:
            creatives[cc]["questions"][qid][aval] = 0
        creatives[cc]["questions"][qid][aval] += 1

    # Formata saída
    result_creatives = []
    for cc, data in creatives.items():
        questions_list = []
        for qid, answers in data["questions"].items():
            total = sum(answers.values())
            questions_list.append({
                "questionId": qid,
                "questionLabel": qid.replace("_", " ").title(),
                "answers": [{"value": k, "count": v, "pct": round(v / total * 100, 1) if total > 0 else 0} for k, v in sorted(answers.items(), key=lambda x: x[1], reverse=True)],
                "total": total,
            })
        questions_list.sort(key=lambda x: x["total"], reverse=True)

        result_creatives.append({
            "creativeCode": cc,
            "totalSessions": data["totalSessions"],
            "questions": questions_list,
        })

    result_creatives.sort(key=lambda x: x["totalSessions"], reverse=True)

    return {
        "campaignCode": campaign_code,
        "creatives": result_creatives,
    }


# ---------------------------------------------------------------------------
# GET /api/quiz/responses — respostas do quiz agrupadas por pagina do funil
# ---------------------------------------------------------------------------
@router.get("/responses")
def get_quiz_responses(
    funnel_id: str = Query(...),
    period: str = Query("30d"),
    current_user=Depends(get_current_user),
):
    """Respostas do quiz agrupadas por pagina (screen) do funil.

    Analisa automaticamente o HTML do funil para extrair os botoes de cada
    screen (<div class="screen" id="s-xxx">), e usa o answer_value para
    mapear cada resposta a pagina correta — ignorando o step_id do tracker
    que pode estar errado em SPAs.
    """
    supabase = get_supabase_admin()
    interval_days = int(_period_to_interval(period).split()[0])
    from_ts = (datetime.now(timezone.utc) - timedelta(days=interval_days)).isoformat()

    resolved_funnel_id = _resolve_funnel_uuid(supabase, funnel_id)

    # 1) Busca os steps do funil para pegar a URL da landing page
    steps_rows = (
        supabase.table("funnel_steps")
        .select("id, label, url, order_index")
        .eq("funnel_id", resolved_funnel_id)
        .order("order_index")
        .execute()
    )

    if not steps_rows.data:
        return {"pages": [], "totalSessions": 0, "totalResponses": 0}

    # Pega a URL do primeiro step (landing page) para buscar o HTML
    landing_url = None
    step_labels: dict = {}  # order_index -> label
    for s in steps_rows.data:
        step_labels[s["order_index"]] = s["label"]
        if not landing_url and s.get("url"):
            landing_url = s["url"]

    if not landing_url:
        return {"pages": [], "totalSessions": 0, "totalResponses": 0}

    # 2) Busca o HTML do funil e extrai os screens
    try:
        resp = httpx.get(landing_url, timeout=10, follow_redirects=True)
        html = resp.text
    except Exception as e:
        logger.warning("Falha ao buscar HTML do funil %s: %s", landing_url, e)
        # Fallback: usa o step_id do tracker se nao conseguir buscar HTML
        html = ""

    screens = _extract_screens_from_html(html) if html else {}
    answer_to_screen = _build_answer_to_screen_map(screens) if screens else {}

    # 3) Busca todas as respostas do quiz no periodo
    rows = (
        supabase.table("quiz_answers")
        .select("question_id, answer_value, answer_id, session_id, step_id, timestamp")
        .eq("funnel_id", resolved_funnel_id)
        .gte("timestamp", from_ts)
        .order("timestamp")
        .execute()
    )

    if not rows.data:
        return {"pages": [], "totalSessions": 0, "totalResponses": 0}

    # 4) Agrupa por screen_id (via answer_value mapping) ou step_id (fallback)
    #    Estrutura: pages[screen_key] = {answers: {val: count}, sessions: set, total: int}
    pages: dict = {}
    all_sessions: set = set()

    # Ordem dos screens baseada na ordem natural do HTML
    screen_order = list(screens.keys()) if screens else []

    for row in rows.data:
        aval = (row.get("answer_value") or "unknown").strip()
        sid = row["session_id"]
        all_sessions.add(sid)

        # Tenta mapear pelo answer_value -> screen_id (analise HTML)
        if answer_to_screen and aval in answer_to_screen:
            page_key = answer_to_screen[aval]
        else:
            # Fallback: usa o step_id do tracker
            page_key = row.get("step_id") or "__no_step__"

        if page_key not in pages:
            pages[page_key] = {"answers": {}, "sessions": set(), "total": 0}

        pages[page_key]["total"] += 1
        pages[page_key]["sessions"].add(sid)

        if aval not in pages[page_key]["answers"]:
            pages[page_key]["answers"][aval] = 0
        pages[page_key]["answers"][aval] += 1

    # 5) Monta resposta ordenada
    result_pages = []

    # Ordena: primeiro os screens conhecidos (na ordem do HTML), depois os desconhecidos
    def sort_key(page_key):
        if page_key in screen_order:
            return (0, screen_order.index(page_key))
        return (1, page_key)

    sorted_keys = sorted(pages.keys(), key=sort_key)

    page_number = 0
    for page_key in sorted_keys:
        data = pages[page_key]
        if not data["answers"]:
            continue

        page_number += 1

        # Label da pagina
        if page_key in screens or page_key.startswith("s-"):
            page_label = _screen_id_to_label(page_key, {})
        elif page_key == "__no_step__":
            page_label = "Sem pagina"
        else:
            # Tenta resolver via step_map dos funnel_steps
            page_label = f"Pagina {page_number}"

        # Ordena respostas por contagem decrescente
        answers_list = []
        for aval, count in sorted(data["answers"].items(), key=lambda x: x[1], reverse=True):
            pct = round(count / data["total"] * 100, 1) if data["total"] > 0 else 0
            answers_list.append({
                "value": aval,
                "count": count,
                "percentage": pct,
            })

        # Extrai o texto da pergunta do HTML do screen
        question_text = ""
        if page_key in screens:
            question_text = screens[page_key].get("questionText", "")

        result_pages.append({
            "stepId": page_key,
            "pageLabel": page_label,
            "pageNumber": page_number,
            "orderIndex": screen_order.index(page_key) if page_key in screen_order else 9999,
            "totalSessions": len(data["sessions"]),
            "totalResponses": data["total"],
            "questions": [{
                "questionLabel": question_text if question_text else page_label,
                "answers": answers_list,
            }],
        })

    return {
        "pages": result_pages,
        "totalSessions": len(all_sessions),
        "totalResponses": len(rows.data),
    }


# ---------------------------------------------------------------------------
# POST /api/quiz/sync-utmfy
# ---------------------------------------------------------------------------
@router.post("/sync-utmfy")
async def sync_utmfy_endpoint(
    body: dict,
    current_user=Depends(get_current_user),
):
    """Dispara sincronização de campanhas/anúncios da Meta Marketing API."""
    supabase = get_supabase_admin()
    funnel_id = body.get("funnel_id")

    if not funnel_id:
        raise HTTPException(422, "funnel_id é obrigatório")

    ws_id = _get_ws_id(supabase, funnel_id)

    try:
        stats = await sync_ads(supabase, ws_id)
        return {
            "ok": len(stats.get("errors", [])) == 0,
            "message": f"Sincronizados: {stats['synced']} (novos: {stats['new']}, atualizados: {stats['updated']})",
            "stats": stats,
        }
    except Exception as e:
        logger.exception("sync-utmfy falhou")
        return {"ok": False, "message": f"Erro na sincronização: {str(e)}"}


# ---------------------------------------------------------------------------
# GET /api/parsed-campaigns — lista todas as campanhas detectadas
# ---------------------------------------------------------------------------
# Nota: este endpoint está no router /quiz por proximidade temática,
# mas responde em /api/quiz/parsed-campaigns. O plano pede /api/parsed-campaigns
# mas manter sob /quiz evita criar um novo router só para isso.
# Se o frontend precisar de /api/parsed-campaigns, adicionar alias no main.py.
@router.get("/parsed-campaigns")
def list_parsed_campaigns(
    workspace_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    current_user=Depends(get_current_user),
):
    """Lista todas as campanhas detectadas pelo parser UTM.

    Retorna creative_code, campaign_code, placement, session_count,
    quiz_response_count e last_seen_at, ordenado por last_seen_at DESC.
    """
    supabase = get_supabase_admin()

    # Se workspace_id não fornecido, busca o primeiro workspace do usuário
    ws_id = workspace_id
    if not ws_id:
        try:
            member_rows = (
                supabase.table("workspace_members")
                .select("workspace_id, workspaces(created_at)")
                .eq("user_id", current_user.id)
                .execute()
                .data
            )
            if member_rows:
                # Pega o workspace mais antigo (created_at ASC)
                sorted_rows = sorted(member_rows, key=lambda r: r.get("workspaces", {}).get("created_at", ""))
                ws_id = sorted_rows[0]["workspace_id"]
        except Exception:
            pass

    if not ws_id:
        raise HTTPException(422, "workspace_id é obrigatório (usuário sem workspace encontrado)")

    # BUG-10 fix: valida que o usuário é membro do workspace antes de retornar dados
    _assert_ws_member(supabase, ws_id, current_user.id)

    rows = (
        supabase.table("parsed_campaigns")
        .select("id, slug_key, creative_code, campaign_code, page_code, platform_ad_id, placement, sequence, version_date, raw_source, session_count, quiz_response_count, first_seen_at, last_seen_at")
        .eq("workspace_id", ws_id)
        .order("last_seen_at", desc=True)
        .limit(limit)
        .execute()
    )

    # USUARIOS UNICOS por campanha: conta device_id distintos em lead_profiles
    # vinculados a cada parsed_campaign_id. O frontend pediu "Usuarios" em vez
    # de "Sessoes" — sessao != usuario. Busca unica por workspace (nao N+1).
    pc_ids = [r["id"] for r in (rows.data or []) if r.get("id")]
    users_by_pc: dict = {}
    if pc_ids:
        try:
            lp_rows = (
                supabase.table("lead_profiles")
                .select("parsed_campaign_id, device_id")
                .eq("workspace_id", ws_id)
                .in_("parsed_campaign_id", pc_ids)
                .execute()
            )
            buckets: dict = {}
            for lp in (lp_rows.data or []):
                pcid = lp.get("parsed_campaign_id")
                did = lp.get("device_id")
                if not pcid:
                    continue
                buckets.setdefault(pcid, set())
                if did:
                    buckets[pcid].add(did)
            users_by_pc = {k: len(v) for k, v in buckets.items()}
        except Exception:
            # Falha na contagem (ex: timeout 504) -> cai em session_count como
            # proxy para nao zerar a coluna.
            pass

    # SESSOES UNICAS QUE RESPONDERAM AO QUIZ por parsed_campaign.
    # BUG ANTERIOR: quiz_response_count contava CADA resposta individual
    # (uma pessoa com 9 perguntas = 9 contagens), enquanto sessions/users
    # contava visitantes unicos. Resultado: conversao de 900%+ e numeros
    # absurdos na aba Campanhas. A metrica correta eh "quantas sessoes
    # distintas tiveram pelo menos uma resposta de quiz" — mesma unidade
    # dos visitors/sessions, dando taxa <= 100%.
    quiz_sessions_by_pc: dict = {}
    if pc_ids:
        try:
            # Query unica: busca session_id + parsed_campaign_id de uma vez
            # (reusa os dados ja buscados acima para users_by_pc se possivel,
            # mas como precisa de session_id alem de device_id, faz query separada)
            lp_session_rows = (
                supabase.table("lead_profiles")
                .select("session_id, parsed_campaign_id")
                .eq("workspace_id", ws_id)
                .in_("parsed_campaign_id", pc_ids)
                .execute()
            )
            sid_to_pc: dict = {}
            all_sids: list = []
            for lp in (lp_session_rows.data or []):
                sid = lp.get("session_id")
                pcid = lp.get("parsed_campaign_id")
                if sid and pcid:
                    sid_to_pc[sid] = pcid
                    all_sids.append(sid)

            if all_sids:
                # Busca quiz_answers soh das sessoes relevantes (batch unico)
                qa_rows = (
                    supabase.table("quiz_answers")
                    .select("session_id")
                    .in_("session_id", all_sids)
                    .execute()
                )
                quiz_sids_by_pc: dict = {}
                for qa in (qa_rows.data or []):
                    sid = qa.get("session_id")
                    pcid = sid_to_pc.get(sid)
                    if pcid:
                        quiz_sids_by_pc.setdefault(pcid, set()).add(sid)
                quiz_sessions_by_pc = {k: len(v) for k, v in quiz_sids_by_pc.items()}
        except Exception:
            # Fallback: usa quiz_response_count cru (imperfeito mas melhor que nada)
            pass

    # Conversao correta: usa tracker_snapshots (mesma fonte do "Geral" 51.2%)
    # em vez de live_beats que pode ter dados incompletos ou inflados.
    # tracker_snapshots tem byStep com contagens agregadas por dia — mais
    # confiavel que live_beats que sao heartbeats individuais.
    funnel_conversion_by_pc: dict = {}
    if pc_ids:
        try:
            # Pega o funnel_id do primeiro parsed_campaign para buscar os steps
            first_pc_id = pc_ids[0] if pc_ids else None
            if first_pc_id:
                pc_row = (
                    supabase.table("parsed_campaigns")
                    .select("funnel_id")
                    .eq("id", first_pc_id)
                    .execute()
                )
                if pc_row.data:
                    funnel_id_for_steps = pc_row.data[0].get("funnel_id")
                    if funnel_id_for_steps:
                        steps_data = (
                            supabase.table("funnel_steps")
                            .select("id, order_index")
                            .eq("funnel_id", funnel_id_for_steps)
                            .order("order_index")
                            .execute()
                        )
                        if steps_data.data and len(steps_data.data) >= 2:
                            first_step_id = steps_data.data[0]["id"]
                            last_step_id = steps_data.data[-1]["id"]
                            # Usa tracker_snapshots (mesma fonte do Geral)
                            snaps = (
                                supabase.table("tracker_snapshots")
                                .select("payload")
                                .eq("funnel_id", funnel_id_for_steps)
                                .eq("bucket", "day")
                                .execute()
                            )
                            # Agrega byStep de todos os snapshots
                            by_step_total: dict = {}
                            for row in (snaps.data or []):
                                payload = row.get("payload") or {}
                                by_step = payload.get("byStep") or {}
                                for step_id, count in by_step.items():
                                    if step_id == "unmapped":
                                        continue
                                    by_step_total[step_id] = by_step_total.get(step_id, 0) + int(count)
                            # Conversao global do funil (ultima pagina / Home)
                            entry_total = by_step_total.get(first_step_id, 0)
                            exit_total = by_step_total.get(last_step_id, 0)
                            if entry_total > 0:
                                global_conv_rate = round((exit_total / entry_total) * 100, 1)
                                # Aplica a mesma taxa para todas as campanhas
                                # (nao temos como separar por campanha no tracker_snapshots)
                                for pcid in pc_ids:
                                    funnel_conversion_by_pc[pcid] = global_conv_rate
        except Exception:
            pass

    # Mapeia os campos do banco (snake_case) para o formato que o frontend
    # espera (camelCase).
    result = []
    for row in (rows.data or []):
        sessions = row.get("session_count") or 0
        users = users_by_pc.get(row.get("id"), sessions)
        quiz_sessions = quiz_sessions_by_pc.get(row.get("id"), 0)
        quiz_responses_raw = row.get("quiz_response_count") or 0
        quiz_responses = quiz_sessions if quiz_sessions > 0 else min(quiz_responses_raw, sessions)
        # Conversao correta: funil ponta a ponta (ultima pagina / Home)
        conversion_rate = funnel_conversion_by_pc.get(row.get("id"))
        # Fallback: se nao conseguiu calcular funil, usa quiz_sessions/sessions
        # mas capado em 100% para nao mostrar numeros absurdos
        if conversion_rate is None and sessions > 0:
            conversion_rate = min(round(quiz_responses / sessions * 100, 1), 100.0)
        result.append({
            "creativeCode": row.get("creative_code"),
            "campaignCode": row.get("campaign_code"),
            "campaignName": row.get("campaign_name"),
            "rawCampaign": row.get("raw_campaign"),
            "placement": row.get("placement"),
            "sessions": sessions,
            "users": users,
            "quizResponses": quiz_responses,
            "conversionRate": conversion_rate,
            "lastSeen": row.get("last_seen_at"),
        })

    return result