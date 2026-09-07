"""Router de workspaces — trocador de conta + compartilhamento por email."""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr

from ..core.auth import get_current_user
from ..core.supabase_client import get_supabase_admin
from ..core.workspace import workspaces_ready

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/workspaces", tags=["workspaces"])


# Cache simples em memória: email -> (user_id, timestamp)
# TTL de 5 minutos para evitar lookups repetidos em convites rápidos
_email_user_cache: dict[str, tuple[str, float]] = {}
_EMAIL_CACHE_TTL = 300.0  # 5 minutos


def _find_user_id_by_email(email: str) -> Optional[str]:
    """Procura um usuário do Supabase Auth pelo email.

    Otimização: tenta filtro direto via API (Supabase suporta filter por email).
    Fallback: scan paginado se o provider não suportar filtro.
    Cache temporal evita lookups repetidos do mesmo email.
    """
    admin = get_supabase_admin()
    email = email.strip().lower()

    # 1) Cache hit
    cached = _email_user_cache.get(email)
    if cached:
        user_id, ts = cached
        if time.time() - ts < _EMAIL_CACHE_TTL:
            return user_id
        # expirado — remove e continua
        _email_user_cache.pop(email, None)

    # 2) Tenta filtro direto (Supabase Admin API aceita `filters={"email": email}`)
    try:
        resp = admin.auth.admin.list_users(filters={"email": email})
        users = getattr(resp, "users", resp) or []
        if users:
            user_id = getattr(users[0], "id", None)
            if user_id:
                _email_user_cache[email] = (user_id, time.time())
                return user_id
            return None
    except (TypeError, AttributeError):
        # Provider não suporta filtro — cai no fallback
        pass

    # 3) Fallback: scan paginado completo (comportamento original)
    page = 1
    while True:
        try:
            resp = admin.auth.admin.list_users(page=page, per_page=200)
        except TypeError:
            resp = admin.auth.admin.list_users()  # versões sem paginação
        users = getattr(resp, "users", resp) or []
        for u in users:
            if (getattr(u, "email", "") or "").lower() == email:
                user_id = getattr(u, "id", None)
                if user_id:
                    _email_user_cache[email] = (user_id, time.time())
                return user_id
        if len(users) < 200:
            break
        page += 1
    return None


def _require_ready():
    if not workspaces_ready():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Workspaces ainda não habilitados (migration 009 pendente).",
        )


class WorkspaceCreate(BaseModel):
    name: str


class WorkspaceRename(BaseModel):
    name: Optional[str] = None
    attribution_model: Optional[str] = None


class MemberInvite(BaseModel):
    email: EmailStr


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

    updates = {}
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="Nome não pode ser vazio.")
        updates["name"] = name

    if body.attribution_model is not None:
        if body.attribution_model not in ("first_touch", "last_touch"):
            raise HTTPException(status_code=422, detail="attribution_model deve ser 'first_touch' ou 'last_touch'.")
        updates["attribution_model"] = body.attribution_model

    if not updates:
        raise HTTPException(status_code=422, detail="Nenhum campo para atualizar.")

    get_supabase_admin().table("workspaces").update(updates).eq(
        "id", workspace_id
    ).execute()
    return {"id": workspace_id, **updates}


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workspace(
    workspace_id: str,
    current_user=Depends(get_current_user),
    confirm: str = Query(
        "",
        description="Confirmação explícita obrigatória. Use 'DELETE_WORKSPACE' para confirmar se houver outros membros ou funis (de qualquer usuário) no workspace.",
    ),
):
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

    # Verifica se há outros membros (além do dono)
    other_members = (
        admin.table("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspace_id)
        .neq("user_id", current_user.id)
        .execute()
        .data
        or []
    )

    # Verifica se há funis de OUTROS usuários neste workspace
    other_funnels = (
        admin.table("funnels")
        .select("id, user_id")
        .eq("workspace_id", workspace_id)
        .neq("user_id", current_user.id)
        .execute()
        .data
        or []
    )

    # Verifica se há funis do PRÓPRIO usuário neste workspace
    own_funnels = (
        admin.table("funnels")
        .select("id")
        .eq("workspace_id", workspace_id)
        .eq("user_id", current_user.id)
        .execute()
        .data
        or []
    )

    has_third_party_content = len(other_members) > 0 or len(other_funnels) > 0
    has_own_content = len(own_funnels) > 0

    needs_confirm = has_third_party_content or has_own_content
    if needs_confirm and confirm != "DELETE_WORKSPACE":
        detail = "Este workspace tem "
        parts = []
        if len(other_members) > 0:
            parts.append("{} membro(s) adicional(is)".format(len(other_members)))
        if len(other_funnels) > 0:
            parts.append("{} funil(es) de outros usuários".format(len(other_funnels)))
        if len(own_funnels) > 0:
            parts.append("{} funil(es) seus".format(len(own_funnels)))
        detail += ", ".join(parts)
        detail += ". A exclusão em cascata apagará todo esse conteúdo. Para confirmar, adicione ?confirm=DELETE_WORKSPACE à requisição."
        raise HTTPException(status_code=409, detail=detail)

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
        if uid == current_user.id:
            raise HTTPException(status_code=409, detail="Você já é membro (é o dono).")
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
        # Se havia convite pendente por email, vira membro de verdade.
        admin.table("workspace_members").delete().eq(
            "workspace_id", workspace_id
        ).eq("invited_email", email).is_("user_id", "null").execute()
        admin.table("workspace_members").insert(
            {"workspace_id": workspace_id, "user_id": uid, "role": "member"}
        ).execute()
        return {"email": email, "pending": False}

    # Sem conta ainda — convite pendente, efetivado no cadastro dela
    # (ver _bootstrap_workspace no router de auth). Não uso upsert com
    # on_conflict porque o índice único é parcial (expressão lower()), e o
    # PostgREST não consegue mirar nele — então checo e insiro.
    already = (
        admin.table("workspace_members")
        .select("workspace_id")
        .eq("workspace_id", workspace_id)
        .eq("invited_email", email)
        .is_("user_id", "null")
        .execute()
        .data
    )
    if not already:
        admin.table("workspace_members").insert(
            {"workspace_id": workspace_id, "invited_email": email, "role": "member"}
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