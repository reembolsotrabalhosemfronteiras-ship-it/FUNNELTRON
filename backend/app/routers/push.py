"""Inscrição em notificação push (Web Push/VAPID) do navegador."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..core.auth import get_current_user, get_db
from ..core.config import get_settings
from supabase import Client

router = APIRouter(prefix="/push", tags=["push"])


class PushKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: PushKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str


@router.get("/vapid-public-key")
def vapid_public_key():
    """Chave pública VAPID que o frontend usa para criar a inscrição no
    navegador (`PushManager.subscribe`). Vazia quando o backend não tem o
    par de chaves configurado — o frontend trata isso como "recurso
    indisponível" em vez de tentar inscrever com uma chave vazia."""
    settings = get_settings()
    return {"publicKey": settings.vapid_public_key}


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(
    payload: SubscribeRequest,
    user=Depends(get_current_user),
    supabase: Client = Depends(get_db),
):
    """Salva (ou atualiza) a inscrição deste navegador. `endpoint` é único
    por definição do Push API — reinscrever o mesmo aparelho atualiza a
    linha em vez de duplicar.

    Se o endpoint já pertence a outro usuário (browser compartilhado),
    retorna 409 em vez de takeover silencioso — evita roubo de inscrição.

    Requer VAPID configurado no backend (chaves pública e privada válidas).
    """
    settings = get_settings()
    if not settings.vapid_public_key or not settings.vapid_private_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications não disponíveis: VAPID não configurado no backend."
        )

    # Verifica se o endpoint já pertence a outro usuário
    existing = supabase.table("push_subscriptions").select("user_id").eq(
        "endpoint", payload.endpoint
    ).execute()

    if existing.data:
        existing_user_id = existing.data[0]["user_id"]
        if existing_user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este endpoint já está registrado para outro usuário."
            )

    row = {
        "user_id": user.id,
        "endpoint": payload.endpoint,
        "p256dh": payload.keys.p256dh,
        "auth": payload.keys.auth,
    }
    supabase.table("push_subscriptions").upsert(
        row, on_conflict="endpoint"
    ).execute()


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: UnsubscribeRequest,
    user=Depends(get_current_user),
    supabase: Client = Depends(get_db),
):
    supabase.table("push_subscriptions").delete().eq(
        "endpoint", payload.endpoint
    ).eq("user_id", user.id).execute()
