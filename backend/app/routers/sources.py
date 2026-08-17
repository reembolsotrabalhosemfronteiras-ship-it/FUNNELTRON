"""
Fontes de dados: preferência do usuário e histórico salvo de cada fonte.

O seletor da interface (Rastreador | Clarity | Comparar) lê e escreve aqui.
Cada fonte responde no seu próprio formato e com o seu próprio carimbo de
tempo — não existe endpoint que devolva as duas somadas, de propósito.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, Literal

from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_admin
from ..services import snapshots
from supabase import Client

router = APIRouter(prefix="/sources", tags=["sources"])

DataSource = Literal["tracker", "clarity", "compare"]


class PreferenceRequest(BaseModel):
    data_source: DataSource


def _assert_owns_funnel(funnel_id: str, user_id: str, supabase: Client) -> None:
    funnel = (
        supabase.table("funnels")
        .select("id")
        .eq("id", funnel_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not funnel.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Funil não encontrado"
        )


# ---------------------------------------------------------------------------
# Preferência de fonte
# ---------------------------------------------------------------------------

@router.get("/preference")
async def get_preference(
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Fonte escolhida pelo usuário. Padrão: nosso rastreador."""
    try:
        result = (
            supabase.table("user_preferences")
            .select("data_source, updated_at")
            .eq("user_id", current_user.id)
            .execute()
        )

        if not result.data:
            return {"dataSource": "tracker", "updatedAt": None}

        return {
            "dataSource": result.data[0]["data_source"],
            "updatedAt": result.data[0].get("updated_at"),
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar preferência: {str(e)}"
        )


@router.put("/preference")
async def set_preference(
    body: PreferenceRequest,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Salva a fonte escolhida (vale para Ao Vivo, Métricas e Funil)."""
    try:
        supabase.table("user_preferences").upsert(
            {
                "user_id": current_user.id,
                "data_source": body.data_source,
                "updated_at": "now()",
            },
            on_conflict="user_id",
        ).execute()

        return {"dataSource": body.data_source}

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar preferência: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Histórico do rastreador próprio
# ---------------------------------------------------------------------------

@router.get("/tracker/history")
async def get_tracker_history(
    funnel_id: str,
    bucket: str = "hour",
    limit: int = 48,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Períodos já fechados do nosso rastreador, mais recente primeiro.
    É o que dá para consultar depois — `live_beats` só guarda o agora.
    """
    if bucket not in ("hour", "day"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bucket deve ser 'hour' ou 'day'"
        )

    _assert_owns_funnel(funnel_id, current_user.id, supabase)

    rows = snapshots.list_tracker_snapshots(funnel_id, bucket, limit)

    return [
        {
            "funnelId": r["funnel_id"],
            "bucket": r["bucket"],
            "periodStart": r["period_start"],
            "capturedAt": r["captured_at"],
            **(r.get("payload") or {}),
        }
        for r in rows
    ]


@router.post("/tracker/snapshot", status_code=status.HTTP_201_CREATED)
async def capture_tracker_snapshot(
    funnel_id: str,
    bucket: str = "hour",
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    Fecha o período corrente num snapshot agora, sem esperar o cron.
    Reexecutar no mesmo período substitui a linha (não duplica).
    """
    if bucket not in ("hour", "day"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="bucket deve ser 'hour' ou 'day'"
        )

    _assert_owns_funnel(funnel_id, current_user.id, supabase)

    try:
        row = snapshots.save_tracker_snapshot(funnel_id, bucket)
        return {
            "periodStart": row["period_start"],
            "capturedAt": row["captured_at"],
            **(row.get("payload") or {}),
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar snapshot: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Último dado do Clarity
# ---------------------------------------------------------------------------

@router.get("/clarity/latest")
async def get_latest_clarity(
    funnel_id: Optional[str] = None,
    period: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """
    O snapshot mais recente do Clarity que existe no banco.

    É o que a página Ao Vivo mostra quando a fonte escolhida é Clarity: a API
    dele agrega por dia e publica com atraso, então não existe "agora" — existe
    o último dado disponível, e ele vem com o carimbo de quando é.
    """
    if funnel_id:
        _assert_owns_funnel(funnel_id, current_user.id, supabase)

    try:
        snap = snapshots.latest_clarity_snapshot(current_user.id, funnel_id, period)
        envelope = snapshots.as_of_envelope(snap)

        return {
            "source": "clarity",
            "funnelId": funnel_id,
            "metrics": (snap or {}).get("payload"),
            "period": (snap or {}).get("period"),
            **envelope,
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar último dado do Clarity: {str(e)}"
        )


@router.get("/clarity/history")
async def get_clarity_history(
    funnel_id: Optional[str] = None,
    limit: int = 30,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Snapshots do Clarity já salvos, mais recente primeiro."""
    if funnel_id:
        _assert_owns_funnel(funnel_id, current_user.id, supabase)

    try:
        query = (
            get_supabase_admin()
            .table("clarity_snapshots")
            .select("*")
            .eq("user_id", current_user.id)
        )

        if funnel_id:
            query = query.eq("funnel_id", funnel_id)

        rows = query.order("fetched_at", desc=True).limit(limit).execute()

        return [
            {
                "date": r["date"],
                "period": r["period"],
                "pageUrl": r["page_url"] or None,
                "fetchedAt": r["fetched_at"],
                "metrics": r["payload"],
            }
            for r in (rows.data or [])
        ]

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar histórico do Clarity: {str(e)}"
        )
