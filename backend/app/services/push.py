"""Notificação push (Web Push/VAPID) de vendas — "PIX gerado"/"PIX pago".

Dispara em cima do que já existe no webhook de venda: não há fila nem
worker separado, o próprio request do gateway de pagamento entrega a
notificação (é rápido — HTTPS para o serviço de push do navegador, na ordem
de dezenas de ms por inscrito). Uma inscrição que devolve 404/410 (expirou,
usuário desinstalou) é apagada na hora — mandar de novo nela só ia falhar
para sempre.
"""
import json
import logging

from pywebpush import webpush, WebPushException

from ..core.config import get_settings
from ..core.supabase_client import get_supabase_admin

logger = logging.getLogger(__name__)


def _vapid_configured() -> bool:
    settings = get_settings()
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def notify_sale(funnel_id: str, status_value: str, amount: float, customer: str | None) -> None:
    """Notifica o dono do funil de um PIX gerado (pending) ou pago (paid).

    Falha de push nunca deve derrubar o webhook do gateway de pagamento —
    por isso cada passo é protegido e apenas logado.
    """
    if not _vapid_configured():
        return

    try:
        supabase = get_supabase_admin()
        funnel = supabase.table("funnels").select("user_id, name, workspace_id").eq(
            "id", funnel_id
        ).execute()
        if not funnel.data:
            return
        funnel_name = funnel.data[0].get("name") or "seu funil"

        # Todo mundo que enxerga o funil recebe a notificação: se o funil está
        # num workspace, são todos os membros; senão, cai no dono (legado).
        recipient_ids: set[str] = {funnel.data[0]["user_id"]}
        workspace_id = funnel.data[0].get("workspace_id")
        if workspace_id:
            try:
                members = supabase.table("workspace_members").select("user_id").eq(
                    "workspace_id", workspace_id
                ).execute()
                recipient_ids |= {
                    m["user_id"] for m in (members.data or []) if m.get("user_id")
                }
            except Exception:  # noqa: BLE001 — tabela ainda não existe (pré-009)
                pass

        subs = supabase.table("push_subscriptions").select(
            "id, endpoint, p256dh, auth"
        ).in_("user_id", list(recipient_ids)).execute()
        if not subs.data:
            return

        if status_value == "paid":
            title = "💰 PIX pago"
            valor = f"R$ {amount:.2f}".replace(".", ",")
            body = f"{valor} em {funnel_name}" + (f" · {customer}" if customer else "")
        else:
            title = "🟡 PIX gerado"
            valor = f"R$ {amount:.2f}".replace(".", ",")
            body = f"{valor} aguardando pagamento em {funnel_name}" + (
                f" · {customer}" if customer else ""
            )

        payload = json.dumps({
            "title": title,
            "body": body,
            "tag": f"sale-{funnel_id}",
            "url": f"/funnel/{funnel_id}/live",
        })

        _send_to_all(supabase, subs.data, payload)
    except Exception:
        logger.exception("Erro ao notificar venda (funnel_id=%s)", funnel_id)


def _send_to_all(supabase, subscriptions: list[dict], payload: str) -> None:
    settings = get_settings()
    vapid_claims = {"sub": f"mailto:{settings.vapid_contact_email}"}

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims=dict(vapid_claims),
            )
        except WebPushException as e:
            status_code = getattr(e.response, "status_code", None)
            if status_code in (404, 410):
                supabase.table("push_subscriptions").delete().eq(
                    "id", sub["id"]
                ).execute()
            else:
                logger.warning("Falha ao enviar push (endpoint=%s): %s", sub["endpoint"], e)
        except Exception:
            logger.exception("Erro inesperado ao enviar push (endpoint=%s)", sub["endpoint"])
