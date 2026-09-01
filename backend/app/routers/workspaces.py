"""Router de workspaces — trocador de conta + compartilhamento por email."""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from ..core.auth import get_current_user
from ..core.supabase_client import get_supabase_admin
from ..core.workspace import workspaces_ready

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspaces", tags=["workspaces"])


class WorkspaceCreate(BaseModel):
    name: str


class WorkspaceRename(BaseModel):
    name: str


class MemberInvite(BaseModel):
    email: EmailStr


def _require_ready():
    if not workspaces_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspaces ainda não habilitados (migration 009 pendente).",
        )


def _find_user_id_by_email(email: str) -> Optional[str]:
    """Procura um usuário do Supabase Auth pelo email (paginando)."""
    admin = get_supabase_admin()
    email = email.strip().lower()
    page = 1
    while page <= 20:  # teto de segurança
        try:
            resp = admin.auth.admin.list_users(page=page, per_page=200)
        except TypeError:
            resp = admin.auth.admin.list_users()  # versões sem paginação
        users = getattr(resp, "users", resp) or []
        for u in users:
            if (getattr(u, "email", "") or "").lower() == email:
                return getattr(u, "id", None)
        if len(users) < 200:
            break
        page += 1
    return None


@router.get("")
def list_workspaces(current_user=Depends(get_current_user)):
    """Workspaces em que o usuário é membro, com papel e nº de membros."""
    if not workspaces_ready():
        return []
    admin = get_supabase_admin()
    mine = (
        admin.table("workspace_members")
        .select("workspace_id, role, workspaces(id, name, created_at)")
        .eq("user_id", current_user.id)
        .execute()
        .data
        or []
    )
    out = []
    for m in mine:
        ws = m.get("workspaces") or {}
        if not ws:
            continue
        count = (
            admin.table("workspace_members")
            .select("user_id", count="exact")
            .eq("workspace_id", m["workspace_id"])
            .not_.is_("user_id", "null")
            .execute()
        )
        out.append(
            {
                "id": ws["id"],
                "name": ws["name"],
                "role": m["role"],
                "memberCount": count.count or 1,
                "createdAt": ws.get("created_at"),
            }
        )
    out.sort(key=lambda w: w.get("createdAt") or "")
    return out


@router.post("", status_code=status.HTTP_201_CREATED)
def create_workspace(body: WorkspaceCreate, current_user=Depends(get_current_user)):
    _require_ready()
    name = body.name.strip() or "Novo workspace"
    admin = get_supabase_admin()
    ws = admin.table("workspaces").insert(
        {"name": name, "owner_id": current_user.id}
    ).execute().data[0]
    admin.table("workspace_members").insert(
        {"workspace_id": ws["id"], "user_id": current_user.id, "role": "owner"}
    ).execute()
    return {"id": ws["id"], "name": ws["name"], "role": "owner", "memberCount": 1}


def _assert_owner(workspace_id: str, user_id: str):
    admin = get_supabase_admin()
    ws = admin.table("workspaces").select("owner_id").eq("id", workspace_id).execute().data
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace não encontrado.")
    if ws[0]["owner_id"] != user_id:
        raise HTTPException(status_code=403, detail="Só o dono do workspace pode fazer isso.")


def _assert_member(workspace_id: str, user_id: str):
    admin = get_supabase_admin()
    m = (
        admin.table("workspace_members")
        .select("role")
        .eq("workspace_id", workspace_id)
        .eq("user_id", user_id)
        .execute()
        .data
    )
    if not m:
        raise HTTPException(status_code=403, detail="Você não é membro deste workspace.")
    return m[0]["role"]


@router.patch("/{workspace_id}")
def rename_workspace(
    workspace_id: str, body: WorkspaceRename, current_user=Depends(get_current_user)
):
    _require_ready()
    _assert_owner(workspace_id, current_user.id)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Nome não pode ser vazio.")
    get_supabase_admin().table("workspaces").update({"name": name}).eq(
        "id", workspace_id
    ).execute()
    return {"id": workspace_id, "name": name}


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(workspace_id: str, current_user=Depends(get_current_user)):
    _require_ready()
    _assert_owner(workspace_id, current_user.id)
    admin = get_supabase_admin()
    # Todo mundo precisa de pelo menos 1 workspace.
    mine = (
        admin.table("workspace_members")
        .select("workspace_id")
        .eq("user_id", current_user.id)
        .execute()
        .data
        or []
    )
    if len(mine) <= 1:
        raise HTTPException(
            status_code=400,
            detail="Este é seu único workspace — crie outro antes de apagar este.",
        )
    admin.table("workspaces").delete().eq("id", workspace_id).execute()
    return None


@router.get("/{workspace_id}/members")
def list_members(workspace_id: str, current_user=Depends(get_current_user)):
    _require_ready()
    role = _assert_member(workspace_id, current_user.id)
    admin = get_supabase_admin()
    rows = (
        admin.table("workspace_members")
        .select("user_id, invited_email, role, created_at")
        .eq("workspace_id", workspace_id)
        .execute()
        .data
        or []
    )
    # Resolve email de quem já tem conta.
    members = []
    for r in rows:
        email = r.get("invited_email")
        if r.get("user_id"):
            try:
                u = admin.auth.admin.get_user_by_id(r["user_id"])
                email = getattr(getattr(u, "user", u), "email", email)
            except Exception:  # noqa: BLE001
                pass
        members.append(
            {
                "userId": r.get("user_id"),
                "email": email,
                "role": r["role"],
                "pending": r.get("user_id") is None,
            }
        )
    return {"role": role, "members": members}


@router.post("/{workspace_id}/members", status_code=status.HTTP_201_CREATED)
def add_member(
    workspace_id: str, body: MemberInvite, current_user=Depends(get_current_user)
):
    _require_ready()
    _assert_owner(workspace_id, current_user.id)
    admin = get_supabase_admin()
    email = body.email.strip().lower()
    uid = _find_user_id_by_email(email)

    if uid:
        exists = (
            admin.table("workspace_members")
            .select("user_id")
            .eq("workspace_id", workspace_id)
            .eq("user_id", uid)
            .execute()
            .data
        )
        if exists:
            raise HTTPException(status_code=409, detail="Essa pessoa já é membro.")
        admin.table("workspace_members").insert(
            {"workspace_id": workspace_id, "user_id": uid, "role": "member"}
        ).execute()
        return {"email": email, "pending": False}

    # Sem conta ainda — convite pendente, efetivado no cadastro dela.
    admin.table("workspace_members").upsert(
        {"workspace_id": workspace_id, "invited_email": email, "role": "member"},
        on_conflict="workspace_id,invited_email",
    ).execute()
    return {"email": email, "pending": True}


@router.delete(
    "/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_member(
    workspace_id: str, user_id: str, current_user=Depends(get_current_user)
):
    _require_ready()
    admin = get_supabase_admin()
    ws = admin.table("workspaces").select("owner_id").eq("id", workspace_id).execute().data
    if not ws:
        raise HTTPException(status_code=404, detail="Workspace não encontrado.")
    owner_id = ws[0]["owner_id"]

    # Owner pode remover qualquer um (menos ele mesmo). Membro só pode sair.
    if current_user.id != owner_id and current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Sem permissão.")
    if user_id == owner_id:
        raise HTTPException(status_code=400, detail="O dono não pode sair do próprio workspace.")

    admin.table("workspace_members").delete().eq("workspace_id", workspace_id).eq(
        "user_id", user_id
    ).execute()
    return None
