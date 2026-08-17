"""Router de autenticação"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from ..core.supabase_client import get_supabase_client
from supabase import Client

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""


class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: dict


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


@router.post("/signup", response_model=AuthResponse)
def signup(
    data: SignupRequest,
    supabase: Client = Depends(get_supabase_client)
):
    """Criar nova conta"""
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
    refresh_token: str,
    supabase: Client = Depends(get_supabase_client)
):
    """Renova o access token usando refresh token"""
    try:
        response = supabase.auth.refresh_session({ "refresh_token": refresh_token })

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
