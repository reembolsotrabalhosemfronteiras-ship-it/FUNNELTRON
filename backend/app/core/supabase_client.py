"""Cliente de dados: Supabase em produção, SQLite local em desenvolvimento."""
from functools import lru_cache
from pathlib import Path

from supabase import create_client, Client

from .config import get_settings
from .local_db import LocalClient

# Valores que o `.env.example` deixa como marcador. Tratar como "não
# configurado" evita o pior dos mundos: o app subir apontando para um projeto
# inexistente e todas as telas devolverem 500 sem explicar por quê.
_PLACEHOLDERS = {
    "",
    "your_anon_key_here",
    "your_service_role_key_here",
    "COLE_AQUI_A_ANON_KEY",
    "COLE_AQUI_A_SERVICE_ROLE_KEY",
}

# Onde mora o banco local. Fora de `app/` para não ir junto num deploy.
LOCAL_DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def is_local_mode() -> bool:
    """True quando não há credenciais de Supabase utilizáveis."""
    settings = get_settings()
    return (
        settings.supabase_key.strip() in _PLACEHOLDERS
        or settings.supabase_service_key.strip() in _PLACEHOLDERS
        or not settings.supabase_url.strip()
    )


@lru_cache()
def get_supabase_client():
    """
    Cliente anônimo compartilhado. Use APENAS para operações sem usuário:
    login, cadastro, verificação de token.

    ⚠️ Não use para ler/gravar dados de um usuário. O cliente do supabase-py
    guarda sessão internamente, e como esta instância é cacheada, ela passa a
    carregar o token de **quem autenticou por último**. Com dois usuários no
    ar, as consultas de um rodavam com a identidade do outro: o RLS filtrava
    pelo `auth.uid()` errado e a lista de funis voltava vazia — ou, numa rota
    sem filtro explícito de dono, voltaria com os dados alheios.
    Para dados de usuário existe `make_user_client()`.
    """
    if is_local_mode():
        return get_local_client()
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_key)


def make_user_client(access_token: str):
    """
    Cliente NOVO, amarrado ao token de quem fez a requisição.

    Uma instância por requisição, de propósito: é o que garante que o RLS
    enxergue o usuário certo e que uma requisição não herde a identidade da
    anterior.
    """
    if is_local_mode():
        return get_local_client()

    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_key)
    # Manda o JWT do usuário nas chamadas ao PostgREST, para o `auth.uid()`
    # das políticas de RLS resolver para ele.
    client.postgrest.auth(access_token)
    return client


@lru_cache()
def get_supabase_admin():
    """Cliente administrativo (no Supabase, service_role: ignora RLS).

    No modo local é o MESMO cliente do outro: sem RLS não existe o que ignorar.
    A proteção que vale aqui é a checagem de dono feita nos routers.
    """
    if is_local_mode():
        return get_local_client()
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key)


@lru_cache()
def get_local_client() -> LocalClient:
    return LocalClient(LOCAL_DATA_DIR)


# Reexportado para os routers continuarem anotando `supabase: Client`.
__all__ = ["get_supabase_client", "get_supabase_admin", "is_local_mode", "Client"]
