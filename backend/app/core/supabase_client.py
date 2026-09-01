"""Cliente de dados: Supabase em produção, SQLite local em desenvolvimento.

## Por que os clientes são por-thread (`threading.local`)

O supabase-py fala com o PostgREST/GoTrue/Storage por `httpx.Client`
**síncrono**, e `httpx.Client` **não é thread-safe**: duas threads mandando
requisição pela mesma conexão TLS ao mesmo tempo corrompem o estado do SSL.
O erro aparece longe da causa — ``Server disconnected``,
``violation of protocol (_ssl.c:2426)``, ``record layer failure``.

O FastAPI roda os handlers ``def`` (bloqueantes) num pool de threads, e uma
única tela do app dispara ~15 requisições ao mesmo tempo. Com um cliente só,
cacheado e compartilhado, as 15 caíam em cima do MESMO `httpx.Client`.

A solução: cada thread do pool guarda o(s) SEU(S) cliente(s). O pool é limitado
(~40 threads), então a memória também é; e cada `httpx.Client` é tocado por no
máximo uma thread de cada vez. O custo de construir um cliente (~860ms, medido)
some depois do aquecimento, igual ao cache antigo — só que sem o bug.
"""
import threading
from functools import lru_cache
from pathlib import Path

import httpx
from supabase import create_client, Client

from .config import get_settings
from .local_db import LocalClient


class _RetryTransport(httpx.BaseTransport):
    """Repete requisições idempotentes (GET/HEAD) quando o servidor derruba
    uma conexão keep-alive que o pool do httpx ainda achava boa.

    É o outro lado do bug de concorrência: mesmo com um cliente por thread, o
    Supabase fecha conexões ociosas do seu lado, e o httpx só descobre ao tentar
    reusar — vira ``RemoteProtocolError: Server disconnected``. Uma segunda
    tentativa pega uma conexão nova e passa. GET de métrica é seguro repetir.
    """

    _RETRYABLE = (
        httpx.RemoteProtocolError,
        httpx.ConnectError,
        httpx.ReadError,
        httpx.WriteError,
        httpx.PoolTimeout,
    )

    def __init__(self, inner: httpx.BaseTransport, attempts: int = 3):
        self._inner = inner
        self._attempts = attempts

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        last: Exception | None = None
        for i in range(self._attempts):
            try:
                return self._inner.handle_request(request)
            except self._RETRYABLE as exc:
                last = exc
                if request.method not in ("GET", "HEAD", "OPTIONS"):
                    raise
        assert last is not None
        raise last

    def close(self) -> None:
        self._inner.close()


def _harden(client: Client) -> Client:
    """Envolve os transportes httpx do supabase-py com retry idempotente."""
    for holder, attr in (
        (getattr(client, "postgrest", None), "session"),
        (getattr(client, "storage", None), "session"),
        (getattr(client, "auth", None), "_http_client"),
    ):
        session = getattr(holder, attr, None)
        transport = getattr(session, "_transport", None)
        if transport is not None and not isinstance(transport, _RetryTransport):
            session._transport = _RetryTransport(transport)
    return client

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


# Armazém por-thread. Cada thread do pool do FastAPI enxerga só o que ela
# mesma guardou aqui — nunca o cliente de outra thread.
_tl = threading.local()

# Teto de clientes de usuário por thread: JWTs rodam de hora em hora, e uma
# thread de vida longa juntaria uma entrada por token sem esse limite.
_MAX_USER_CLIENTS_PER_THREAD = 8


def get_supabase_client():
    """
    Cliente anônimo (por thread). Use APENAS para operações sem usuário:
    login, cadastro, verificação de token.

    ⚠️ Não use para ler/gravar dados de um usuário. O cliente do supabase-py
    guarda sessão internamente; para dados de usuário existe `make_user_client()`,
    amarrado ao JWT de quem chamou.
    """
    if is_local_mode():
        return get_local_client()
    client = getattr(_tl, "anon", None)
    if client is None:
        settings = get_settings()
        client = _harden(create_client(settings.supabase_url, settings.supabase_key))
        _tl.anon = client
    return client


def make_user_client(access_token: str):
    """
    Cliente amarrado ao token de quem fez a requisição (por thread).

    A chave é o próprio JWT: dois usuários têm tokens diferentes, logo clientes
    diferentes, logo nunca compartilham a sessão do supabase-py (correção do S1).
    """
    if is_local_mode():
        return get_local_client()

    store = getattr(_tl, "user_clients", None)
    if store is None:
        store = {}
        _tl.user_clients = store

    client = store.get(access_token)
    if client is None:
        if len(store) >= _MAX_USER_CLIENTS_PER_THREAD:
            store.clear()
        settings = get_settings()
        client = _harden(create_client(settings.supabase_url, settings.supabase_key))
        # Manda o JWT do usuário nas chamadas ao PostgREST, para o `auth.uid()`
        # das políticas de RLS resolver para ele.
        client.postgrest.auth(access_token)
        store[access_token] = client

    return client


def get_supabase_admin():
    """Cliente administrativo (por thread) — service_role, ignora RLS.

    No modo local é o MESMO cliente do outro: sem RLS não existe o que ignorar.
    A proteção que vale aqui é a checagem de dono feita nos routers.
    """
    if is_local_mode():
        return get_local_client()
    client = getattr(_tl, "admin", None)
    if client is None:
        settings = get_settings()
        client = _harden(create_client(settings.supabase_url, settings.supabase_service_key))
        _tl.admin = client
    return client


@lru_cache()
def get_local_client() -> LocalClient:
    return LocalClient(LOCAL_DATA_DIR)


# Reexportado para os routers continuarem anotando `supabase: Client`.
__all__ = ["get_supabase_client", "get_supabase_admin", "is_local_mode", "Client"]
