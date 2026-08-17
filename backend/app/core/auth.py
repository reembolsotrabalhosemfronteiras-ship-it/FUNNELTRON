"""Autenticação e middleware de segurança"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .cache import TTLCache
from .supabase_client import get_supabase_client, make_user_client

security = HTTPBearer()

# Resultado da validação do token, por token.
#
# `auth.get_user()` é uma ida à rede, e ela acontecia em TODA requisição
# protegida — inclusive nas dezenas que uma única tela dispara. Um minuto é
# curto o bastante para que um token revogado pare de valer quase imediatamente,
# e longo o bastante para tirar a rede do caminho comum.
_validated_tokens = TTLCache(maxsize=64, ttl_seconds=60.0)
# Mesma coisa, mas sem erro automático: rotas públicas que aceitam token
# opcional (o snippet do rastreador, o webhook) precisam poder vir sem header.
optional_security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    """
    Valida o token JWT do Supabase Auth e retorna o usuário atual.
    O token vem do frontend no header: Authorization: Bearer <token>

    Declarada `def` e não `async def` de propósito: `auth.get_user()` é uma
    chamada de rede BLOQUEANTE. Numa dependência `async`, ela roda no event
    loop e trava todas as outras requisições enquanto espera. Sendo `def`, o
    FastAPI a executa num pool de threads e as requisições andam junto.
    """
    try:
        token = credentials.credentials

        em_cache = _validated_tokens.get(token)
        if em_cache is not None:
            return em_cache

        # Cliente compartilhado só para VERIFICAR o token. A leitura de dados
        # usa `get_db`, que devolve um cliente amarrado a este usuário.
        user_response = get_supabase_client().auth.get_user(token)

        if not user_response or not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token inválido ou expirado"
            )

        # Só o sucesso é cacheado. Guardar a falha faria um token recém-emitido
        # continuar sendo recusado por um minuto depois de já valer.
        _validated_tokens.get_or_create(token, lambda: user_response.user)
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


def get_optional_user(
    credentials: HTTPAuthorizationCredentials = Depends(optional_security),
):
    """Mesma coisa que get_current_user, mas não falha se não tiver token."""
    if not credentials:
        return None
    try:
        return get_current_user(credentials)
    except Exception:
        return None
