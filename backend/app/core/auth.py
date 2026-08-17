"""Autenticação e middleware de segurança"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .supabase_client import get_supabase_client, make_user_client

security = HTTPBearer()
# Mesma coisa, mas sem erro automático: rotas públicas que aceitam token
# opcional (o snippet do rastreador, o webhook) precisam poder vir sem header.
optional_security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    Valida o token JWT do Supabase Auth e retorna o usuário atual.
    O token vem do frontend no header: Authorization: Bearer <token>
    """
    try:
        token = credentials.credentials

        # Cliente compartilhado só para VERIFICAR o token. A leitura de dados
        # usa `get_db`, que cria um cliente amarrado a este usuário.
        user_response = get_supabase_client().auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido ou expirado"
            )

        return user_response.user

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Erro na autenticação: {str(e)}"
        )


def get_db(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Cliente de banco da requisição, com a identidade de quem chamou.

    Existe porque o cliente compartilhado guardava a sessão do último login e
    fazia uma requisição rodar com a identidade de outro usuário. Uma instância
    por requisição resolve na raiz — ver `make_user_client()`.
    """
    return make_user_client(credentials.credentials)


async def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(optional_security),
):
    """Mesma coisa que get_current_user, mas não falha se não tiver token."""
    if not credentials:
        return None
    try:
        return await get_current_user(credentials)
    except Exception:
        return None
