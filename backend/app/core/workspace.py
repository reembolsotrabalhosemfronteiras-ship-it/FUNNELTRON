"""Workspace ativo da requisição.

Um usuário pode ser membro de vários workspaces (trocador de conta) e um
workspace pode ter vários membros (compartilhamento). O front manda o workspace
escolhido no header `X-Workspace-Id`; aqui a gente confere que o usuário é
membro dele e devolve o id pros routers filtrarem os dados.

Enquanto a migration 009 não rodou (`workspaces_ready()` é False), tudo cai no
comportamento antigo: filtro por `user_id`. É a mesma degradação silenciosa do
`geo` — o app não quebra na janela entre deploy e run da migration.
"""
from __future__ import annotations

import threading
from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from .auth import get_current_user
from .supabase_client import get_supabase_admin

_ready_lock = threading.Lock()
_ready: Optional[bool] = None


def workspaces_ready() -> bool:
    """True se a migration 009 já criou a infra de workspaces."""
    global _ready
    if _ready is not None:
        return _ready
    with _ready_lock:
        if _ready is None:
            try:
                get_supabase_admin().table("workspaces").select("id").limit(1).execute()
                _ready = True
            except Exception:  # noqa: BLE001 — coluna/tabela ainda não existe
                _ready = False
    return _ready


def get_active_workspace(
    x_workspace_id: Optional[str] = Header(default=None, alias="X-Workspace-Id"),
    current_user=Depends(get_current_user),
) -> Optional[str]:
    """Id do workspace da requisição, ou None (modo legado por `user_id`).

    - Sem a migration 009: sempre None.
    - Com header: 403 se o usuário não for membro; senão devolve o id pedido.
    - Sem header: o workspace mais antigo do qual o usuário é membro.
    """
    if not workspaces_ready():
        return None

    admin = get_supabase_admin()
    rows = (
        admin.table("workspace_members")
        .select("workspace_id, workspaces(created_at, owner_id)")
        .eq("user_id", current_user.id)
        .execute()
        .data
        or []
    )
    if not rows:
        # Usuário sem workspace nenhum (conta antiga sem backfill, ou recém-criada
        # antes do signup terminar). Cai no legado.
        return None

    member_ids = {r["workspace_id"] for r in rows}

    if x_workspace_id:
        if x_workspace_id not in member_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Você não é membro deste workspace.",
            )
        return x_workspace_id

    # Sem header: prefere um workspace do qual o usuário é DONO (o pessoal dele),
    # do mais antigo pro mais novo; só cai num workspace de outra pessoa se ele
    # não for dono de nenhum. Assim, quem é convidado continua caindo no próprio.
    def _key(r):
        w = r.get("workspaces") or {}
        owned = (w.get("owner_id") == current_user.id)
        return (0 if owned else 1, w.get("created_at") or "")

    rows.sort(key=_key)
    return rows[0]["workspace_id"]


def scope(query, ws_id: Optional[str], user_id: str):
    """Aplica o filtro de posse: por workspace se disponível, senão por user_id.

    No modo workspace ainda casa linhas legadas (`workspace_id` nulo) do próprio
    usuário — espelha o OR de transição das políticas RLS da 009, pra nada que o
    backfill não alcançou sumir da tela.
    """
    if not ws_id:
        return query.eq("user_id", user_id)
    return query.or_(
        f"workspace_id.eq.{ws_id},and(workspace_id.is.null,user_id.eq.{user_id})"
    )


def funnel_guard(supabase, funnel_id: str, ws_id: Optional[str], user_id: str):
    """404 se o funil não existe OU não pertence ao workspace ativo (ou, no modo
    legado, ao usuário). Devolve a linha do funil quando ok."""
    rows = scope(
        supabase.table("funnels").select("id").eq("id", funnel_id),
        ws_id, user_id,
    ).execute().data
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funil não encontrado")
    return rows[0]
