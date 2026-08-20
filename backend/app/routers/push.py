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
    linha em vez de duplicar."""
    row = {
        "user_id": user.id,
        "endpoint": payload.endpoint,
        "p256dh": payload.keys.p256dh,
        "auth": payload.keys.auth,
    }
    existing = supabase.table("push_subscriptions").select("id").eq(
        "endpoint", payload.endpoint
    ).execute()
    if existing.data:
        supabase.table("push_subscriptions").update(row).eq(
            "endpoint", payload.endpoint
        ).execute()
    else:
        supabase.table("push_subscriptions").insert(row).execute()


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(
    payload: UnsubscribeRequest,
    user=Depends(get_current_user),
    supabase: Client = Depends(get_db),
):
    supabase.table("push_subscriptions").delete().eq(
        "endpoint", payload.endpoint
    ).eq("user_id", user.id).execute()
