"""Router de autenticação"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from ..core.supabase_client import get_supabase_client
from ..core.config import get_settings
from supabase import Client

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""
    invite_code: str = ""


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: dict


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login", response_model=AuthResponse)
def login(
    credentials: LoginRequest,
    supabase: Client = Depends(get_supabase_client)
):
    """Login com email e senha"""
    try:
        response = supabase.auth.sign_in_with_password({
            "email": credentials.email,
            "password": credentials.password
        })

        if not response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Email ou senha inválidos"
            )

        return {
            "access_token": response.session.access_token,
            "refresh_token": response.session.refresh_token,
            "user": response.user.model_dump()
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Erro no login: {str(e)}"
        )


def _bootstrap_workspace(user_id: str, email: str, full_name: str) -> None:
    """No cadastro: cria o workspace pessoal e efetiva convites pendentes.

    Silencioso se a migration 009 ainda não rodou — o `get_active_workspace`
    cai no modo legado (`user_id`) até lá.
    """
    try:
        from ..core.supabase_client import get_supabase_admin

        admin = get_supabase_admin()

        # Já tem workspace? (retry de cadastro, etc.)
        existing = admin.table("workspaces").select("id").eq("owner_id", user_id).execute().data
        if not existing:
            name = (full_name.strip() or email.split("@")[0]) + " — pessoal"
            ws = admin.table("workspaces").insert(
                {"name": name, "owner_id": user_id}
            ).execute().data[0]
            admin.table("workspace_members").insert(
                {"workspace_id": ws["id"], "user_id": user_id, "role": "owner"}
            ).execute()

        # Convites pendentes pra este email → vira membro de verdade.
        pending = (
            admin.table("workspace_members")
            .select("workspace_id")
            .is_("user_id", "null")
            .eq("invited_email", email.strip().lower())
            .execute()
            .data
            or []
        )
        for p in pending:
            admin.table("workspace_members").update(
                {"user_id": user_id, "invited_email": None}
            ).eq("workspace_id", p["workspace_id"]).is_("user_id", "null").eq(
                "invited_email", email.strip().lower()
            ).execute()
    except Exception:  # noqa: BLE001 — migration 009 pendente ou falha não-crítica
        import logging

        logging.getLogger(__name__).warning(
            "bootstrap de workspace pulado no cadastro", exc_info=True
        )


@router.post("/signup", response_model=AuthResponse)
def signup(
    data: SignupRequest,
    supabase: Client = Depends(get_supabase_client)
):
    """Criar nova conta"""
    # Trava de acesso: sem o código certo, ninguém se cadastra. `""` na config
    # libera o cadastro (comportamento antigo).
    required = get_settings().signup_invite_code.strip()
    if required and data.invite_code.strip() != required:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Código de acesso inválido.",
        )
    try:
        response = supabase.auth.sign_up({
            "email": data.email,
            "password": data.password,
            "options": {
                "data": {
                    "full_name": data.full_name
                }
            }
        })

        if not response.session:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Erro ao criar conta. Verifique se o email já existe."
            )

        # Cria perfil do usuário
        supabase.table("profiles").insert({
            "id": response.user.id,
            "email": data.email,
            "full_name": data.full_name
        }).execute()

        _bootstrap_workspace(response.user.id, data.email, data.full_name)

        return {
            "access_token": response.session.access_token,
            "refresh_token": response.session.refresh_token,
            "user": response.user.model_dump()
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao criar conta: {str(e)}"
        )


@router.post("/logout")
def logout(supabase: Client = Depends(get_supabase_client)):
    """Logout"""
    try:
        supabase.auth.sign_out()
        return {"message": "Logout realizado com sucesso"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro no logout: {str(e)}"
        )


@router.post("/refresh")
def refresh_token(
    body: RefreshRequest,
    supabase: Client = Depends(get_supabase_client)
):
    """Renova o access token usando o refresh token (no corpo, nunca na URL)."""
    try:
        # supabase-py 2.x: refresh_session recebe a string direto, não um dict.
        response = supabase.auth.refresh_session(body.refresh_token)

        if not response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Refresh token inválido"
            )

        return {
            "access_token": response.session.access_token,
            "refresh_token": response.session.refresh_token
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Erro ao renovar token: {str(e)}"
        )
