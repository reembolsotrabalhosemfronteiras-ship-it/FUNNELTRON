"""
Persistência das duas fontes de dados.

Regra central: cada fonte tem a sua tabela e o seu carimbo de tempo. Nada aqui
soma rastreador com Clarity — quem escolhe é a interface, e ela mostra uma
fonte de cada vez (ou as duas lado a lado, rotuladas).
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlsplit

from ..core.supabase_client import get_supabase_admin


def normalize_url(url: Optional[str]) -> str:
    """
    Forma canônica da URL: é a ÚNICA chave de junção entre as duas fontes.

    Sem query, sem fragmento, sem barra final, host minúsculo. O Clarity
    devolve a URL do jeito que o navegador mandou (com utm, com barra, com
    maiúscula no host) — sem normalizar, a mesma página vira três páginas
    diferentes e o histórico nunca casa com o nosso.
    """
    if not url:
        return ""

    parts = urlsplit(url if "//" in url else f"https://{url}")
    host = (parts.netloc or "").lower()
    path = (parts.path or "").rstrip("/")

    return f"{host}{path}"


# ---------------------------------------------------------------------------
# Clarity
# ---------------------------------------------------------------------------

def save_clarity_snapshot(
    user_id: str,
    project_id: str,
    period: str,
    payload: dict,
    funnel_id: Optional[str] = None,
    page_url: Optional[str] = None,
    ref_date: Optional[str] = None,
) -> dict:
    """
    Grava (ou substitui) o snapshot do dia. Reimportar o mesmo dia SUBSTITUI a
    linha em vez de criar outra: o Clarity reentrega o mesmo período a cada
    consulta, e acumular linhas dobraria o número na leitura.
    """
    date = ref_date or datetime.now(timezone.utc).date().isoformat()

    row = {
        "user_id": user_id,
        "project_id": project_id,
        "funnel_id": funnel_id,
        "page_url": normalize_url(page_url),
        "period": period,
        "date": date,
        "payload": payload,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }

    result = (
        get_supabase_admin()
        .table("clarity_snapshots")
        .upsert(row, on_conflict="project_id,page_url,period,date")
        .execute()
    )

    return result.data[0] if result.data else row


def log_clarity_pull(
    user_id: str,
    period: str,
    ok: bool,
    funnel_id: Optional[str] = None,
    days: Optional[int] = None,
    message: Optional[str] = None,
    sessions: Optional[int] = None,
) -> Optional[dict]:
    """
    Anota uma consulta ao Clarity no log append-only.

    Registra sucesso E falha: a tentativa que falhou por token vencido gastou
    uma das 10 chamadas do dia igual, e um contador que só soma acerto mente
    sobre a cota restante.

    Nunca levanta: o log é registro, não o dado. Se a migração 003 ainda não
    rodou, a puxada em si continua valendo.
    """
    row = {
        "user_id": user_id,
        "funnel_id": funnel_id,
        "period": period,
        "days": days,
        "ok": ok,
        "message": message,
        "sessions": sessions,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = get_supabase_admin().table("clarity_pulls").insert(row).execute()
        return result.data[0] if result.data else row
    except Exception:
        return None


def list_clarity_pulls(user_id: str, limit: int = 20) -> list:
    """As últimas puxadas, mais recente primeiro. Lista vazia se a tabela não existe."""
    try:
        result = (
            get_supabase_admin()
            .table("clarity_pulls")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception:
        return []


def count_clarity_pulls_today(user_id: str) -> int:
    """
    Quantas consultas já foram gastas hoje (UTC), para a tela mostrar o que
    sobra das 10 diárias antes de o usuário clicar e levar 429.
    """
    inicio = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    try:
        result = (
            get_supabase_admin()
            .table("clarity_pulls")
            .select("id")
            .eq("user_id", user_id)
            .gte("created_at", inicio.isoformat())
            .execute()
        )
        return len(result.data or [])
    except Exception:
        return 0


def latest_clarity_snapshot(
    user_id: str,
    funnel_id: Optional[str] = None,
    period: Optional[str] = None,
) -> Optional[dict]:
    """O snapshot mais recente que existe — é o que a página Ao Vivo mostra."""
    query = (
        get_supabase_admin()
        .table("clarity_snapshots")
        .select("*")
        .eq("user_id", user_id)
    )

    if funnel_id:
        query = query.eq("funnel_id", funnel_id)
    if period:
        query = query.eq("period", period)

    result = query.order("fetched_at", desc=True).limit(1).execute()
    return result.data[0] if result.data else None


def as_of_envelope(snapshot: Optional[dict]) -> dict:
    """
    Metadados de tempo que acompanham TODO número vindo do Clarity.

    A interface nunca mostra um valor do Clarity sem isso: sem o carimbo, um
    dado de ontem lido na tela "Ao Vivo" passa por "agora".
    """
    if not snapshot:
        return {
            "asOf": None,
            "ageMinutes": None,
            "stale": True,
            "empty": True,
            "refDate": None,
        }

    fetched = snapshot.get("fetched_at")
    age_minutes = None

    if fetched:
        try:
            parsed = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            age_minutes = int((datetime.now(timezone.utc) - parsed).total_seconds() // 60)
        except ValueError:
            age_minutes = None

    return {
        "asOf": fetched,
        "ageMinutes": age_minutes,
        # Mais de 24h sem atualizar: a interface marca como defasado em vez de
        # mostrar o número como se fosse corrente.
        "stale": age_minutes is not None and age_minutes > 24 * 60,
        "empty": False,
        "refDate": snapshot.get("date"),
    }


# ---------------------------------------------------------------------------
# Rastreador próprio
# ---------------------------------------------------------------------------

def save_tracker_snapshot(funnel_id: str, bucket: str = "hour") -> dict:
    """
    Fecha o período corrente do rastreador num snapshot consultável.

    `live_beats` guarda só o agora (uma linha por sessão, sobrescrita, apagada
    aos 90s), então sem isto não existe histórico nosso para consultar depois.
    A fonte é `live_page_entries`, que é append-only.
    """
    now = datetime.now(timezone.utc)

    if bucket == "day":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        period_end = period_start + timedelta(days=1)
    else:
        period_start = now.replace(minute=0, second=0, microsecond=0)
        period_end = period_start + timedelta(hours=1)

    supabase = get_supabase_admin()

    entries = (
        supabase.table("live_page_entries")
        .select("session_id, step_id")
        .eq("funnel_id", funnel_id)
        .gte("entered_at", period_start.isoformat())
        .lt("entered_at", period_end.isoformat())
        .execute()
    )

    sessions = set()
    by_step: dict = {}

    for row in entries.data:
        sid = row.get("session_id")
        if sid:
            sessions.add(sid)

        key = row.get("step_id") or "unmapped"
        by_step.setdefault(key, set()).add(sid)

    payload = {
        "visitors": len(sessions),
        "pageEntries": len(entries.data),
        "byStep": {k: len(v) for k, v in by_step.items()},
    }

    row = {
        "funnel_id": funnel_id,
        "bucket": bucket,
        "period_start": period_start.isoformat(),
        "payload": payload,
        "captured_at": now.isoformat(),
    }

    result = (
        supabase.table("tracker_snapshots")
        .upsert(row, on_conflict="funnel_id,bucket,period_start")
        .execute()
    )

    return result.data[0] if result.data else row


def list_tracker_snapshots(funnel_id: str, bucket: str = "hour", limit: int = 48) -> list:
    result = (
        get_supabase_admin()
        .table("tracker_snapshots")
        .select("*")
        .eq("funnel_id", funnel_id)
        .eq("bucket", bucket)
        .order("period_start", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []
