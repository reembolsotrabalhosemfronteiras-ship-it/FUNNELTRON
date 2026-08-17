"""
Backend local, sem nuvem: um SQLite que fala a MESMA interface do cliente
Supabase usada pelos routers.

Por que isso existe
-------------------
Todo router fala com o banco por `supabase.table(...).select().eq().execute()`
e com o login por `supabase.auth.*`. Sem as chaves do projeto Supabase, o
sistema inteiro não sai do lugar: nenhum botão salva, nenhuma tela carrega.

Em vez de reescrever os routers, este módulo implementa o pedaço da interface
que eles realmente usam (medido: select/insert/upsert/update/delete, os filtros
eq/neq/gte/lte/gt/lt/in_/is_, order/limit/single, e o auth). Assim o mesmo
código roda contra o Supabase em produção e contra um arquivo `.db` na máquina
durante o desenvolvimento — sem `if` espalhado pelas rotas.

O que ele NÃO é
---------------
Não é um Postgres. Não há RLS, não há SQL: os registros são documentos JSON e
os filtros rodam em Python. A checagem de dono (`user_id == current_user.id`)
já é feita explicitamente nos routers, que é o que protege os dados aqui.
Guardas de banco (RLS, triggers, constraints) continuam valendo só no Supabase
— por isso este modo é para desenvolvimento, e o de produção é o de verdade.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


# --- Utilidades -------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_url(url: str | None) -> str:
    """Mesma normalização do trigger `resolve_step_from_url` do schema.sql:
    fora query string, fora barra final. Sem isso a mesma página com `?utm=…`
    viraria uma etapa diferente e o rastreador nunca casaria."""
    if not url:
        return ""
    return re.sub(r"/$", "", url.split("?")[0].split("#")[0])


def _coerce(value: Any) -> Any:
    """`"now()"` é literal de SQL que os routers mandam como string. No Postgres
    o banco resolve; aqui tem que virar timestamp na entrada, senão viraria a
    string "now()" gravada no campo e toda comparação de data quebraria."""
    return _now_iso() if value == "now()" else value


# Colunas de tempo que as consultas filtram com gte/lte. No Postgres elas têm
# DEFAULT now(); aqui precisam ser preenchidas na escrita, ou o filtro compara
# contra ausência e o registro some da resposta.
_TIME_DEFAULTS: dict[str, tuple[str, ...]] = {
    "live_beats": ("first_seen", "last_seen"),
    "live_page_entries": ("entered_at",),
    "live_sales": ("created_at",),
    "live_snapshots": ("captured_at",),
}


class LocalRow(dict):
    """Registro. É um dict — os routers acessam por chave (`row["id"]`)."""


class LocalResult:
    """Espelha o retorno do postgrest-py: `.data` e `.count`."""

    def __init__(self, data: list[dict], count: int | None = None):
        self.data = data
        self.count = count if count is not None else len(data)


# --- Armazenamento ----------------------------------------------------------

class LocalStore:
    """Documentos JSON em SQLite, uma linha por registro.

    Sem schema fixo de propósito: os routers gravam colunas variadas (e o
    schema.sql evolui), e um esquema rígido aqui só criaria um segundo lugar
    para manter sincronizado com o Supabase.
    """

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False: o uvicorn atende em várias threads. O lock
        # abaixo é quem serializa de fato.
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.RLock()
        self._conn.execute(
            """
            create table if not exists records (
              table_name text not null,
              id         text not null,
              data       text not null,
              primary key (table_name, id)
            )
            """
        )
        self._conn.commit()

    def all(self, table: str) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "select data from records where table_name = ?", (table,)
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    def put(self, table: str, record: dict) -> None:
        with self._lock:
            self._conn.execute(
                "insert or replace into records (table_name, id, data) values (?, ?, ?)",
                (table, str(record["id"]), json.dumps(record, default=str)),
            )
            self._conn.commit()

    def drop(self, table: str, record_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "delete from records where table_name = ? and id = ?",
                (table, str(record_id)),
            )
            self._conn.commit()


# --- Query builder ----------------------------------------------------------

class LocalQuery:
    """Encadeamento igual ao do postgrest-py, resolvido em memória."""

    def __init__(self, store: LocalStore, table: str):
        self._store = store
        self._table = table
        self._mode = "select"
        self._payload: Any = None
        self._on_conflict: str | None = None
        self._filters: list[tuple[str, str, Any]] = []
        self._order: tuple[str, bool] | None = None
        self._limit: int | None = None
        self._single = False

    # -- verbos --
    def select(self, *_columns, **_kwargs) -> "LocalQuery":
        # A projeção é ignorada: devolver a linha inteira é sempre um superset
        # do que foi pedido, e nenhum router se importa com colunas a mais.
        self._mode = "select"
        return self

    def insert(self, payload, **_kwargs) -> "LocalQuery":
        self._mode = "insert"
        self._payload = payload
        return self

    def upsert(self, payload, on_conflict: str | None = None, **_kwargs) -> "LocalQuery":
        self._mode = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def update(self, payload, **_kwargs) -> "LocalQuery":
        self._mode = "update"
        self._payload = payload
        return self

    def delete(self, **_kwargs) -> "LocalQuery":
        self._mode = "delete"
        return self

    # -- filtros --
    def eq(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "eq", value))
        return self

    def neq(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "neq", value))
        return self

    def gt(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "gt", value))
        return self

    def gte(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "gte", value))
        return self

    def lt(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "lt", value))
        return self

    def lte(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "lte", value))
        return self

    def in_(self, column: str, values: Iterable[Any]) -> "LocalQuery":
        self._filters.append((column, "in", list(values)))
        return self

    def is_(self, column: str, value: Any) -> "LocalQuery":
        self._filters.append((column, "is", value))
        return self

    # -- modificadores --
    def order(self, column: str, desc: bool = False, **_kwargs) -> "LocalQuery":
        self._order = (column, desc)
        return self

    def limit(self, count: int, **_kwargs) -> "LocalQuery":
        self._limit = count
        return self

    def single(self) -> "LocalQuery":
        self._single = True
        return self

    def maybe_single(self) -> "LocalQuery":
        self._single = True
        return self

    # -- execução --
    def _matches(self, row: dict) -> bool:
        for column, op, expected in self._filters:
            actual = row.get(column)
            if op == "eq" and actual != expected:
                return False
            if op == "neq" and actual == expected:
                return False
            if op == "in" and actual not in expected:
                return False
            if op == "is":
                # `.is_("col", "null")` e `.is_("col", None)` significam o mesmo.
                wants_null = expected is None or expected == "null"
                if wants_null != (actual is None):
                    return False
            if op in ("gt", "gte", "lt", "lte"):
                # Ausência nunca satisfaz comparação — em Postgres NULL some do
                # filtro do mesmo jeito.
                if actual is None:
                    return False
                try:
                    if op == "gt" and not actual > expected:
                        return False
                    if op == "gte" and not actual >= expected:
                        return False
                    if op == "lt" and not actual < expected:
                        return False
                    if op == "lte" and not actual <= expected:
                        return False
                except TypeError:
                    return False
        return True

    def _prepare(self, record: dict) -> dict:
        out = {k: _coerce(v) for k, v in record.items()}
        out.setdefault("id", str(uuid.uuid4()))
        out.setdefault("created_at", _now_iso())
        for column in _TIME_DEFAULTS.get(self._table, ()):
            out.setdefault(column, _now_iso())
        # Emula o trigger que descobre a etapa pela URL da página.
        if self._table in ("live_beats", "live_page_entries") and out.get("url"):
            out["step_id"] = out.get("step_id") or self._resolve_step(out)
        return out

    def _resolve_step(self, record: dict) -> str | None:
        target = _normalize_url(record.get("url"))
        for step in self._store.all("funnel_steps"):
            if step.get("funnel_id") != record.get("funnel_id"):
                continue
            if _normalize_url(step.get("url")) == target:
                return step.get("id")
        return None

    def execute(self) -> LocalResult:
        rows = self._store.all(self._table)

        if self._mode == "select":
            found = [r for r in rows if self._matches(r)]
            if self._order:
                column, desc = self._order
                found.sort(key=lambda r: (r.get(column) is None, r.get(column)), reverse=desc)
            if self._limit is not None:
                found = found[: self._limit]
            if self._single:
                found = found[:1]
            return LocalResult(found)

        if self._mode in ("insert", "upsert"):
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            written: list[dict] = []
            for payload in payloads:
                record = self._prepare(dict(payload))
                if self._mode == "upsert":
                    key = self._on_conflict or "id"
                    existing = next(
                        (r for r in rows if r.get(key) == record.get(key)), None
                    )
                    if existing:
                        merged = {**existing, **record, "id": existing["id"]}
                        merged["updated_at"] = _now_iso()
                        self._store.put(self._table, merged)
                        written.append(merged)
                        continue
                self._store.put(self._table, record)
                written.append(record)
            return LocalResult(written)

        if self._mode == "update":
            changed: list[dict] = []
            for row in rows:
                if not self._matches(row):
                    continue
                merged = {**row, **{k: _coerce(v) for k, v in self._payload.items()}}
                merged["updated_at"] = _now_iso()
                self._store.put(self._table, merged)
                changed.append(merged)
            return LocalResult(changed)

        if self._mode == "delete":
            removed: list[dict] = []
            for row in rows:
                if not self._matches(row):
                    continue
                self._store.drop(self._table, row["id"])
                removed.append(row)
            return LocalResult(removed)

        raise RuntimeError(f"modo de consulta desconhecido: {self._mode}")


# --- Autenticação -----------------------------------------------------------

class LocalUser:
    """Usuário com a mesma cara do objeto do Supabase (`.id`, `.model_dump()`)."""

    def __init__(self, record: dict):
        self.id = record["id"]
        self.email = record["email"]
        self.user_metadata = {"full_name": record.get("full_name", "")}
        self.created_at = record.get("created_at")

    def model_dump(self) -> dict:
        return {
            "id": self.id,
            "email": self.email,
            "user_metadata": self.user_metadata,
            "created_at": self.created_at,
        }


class LocalSession:
    def __init__(self, access_token: str, refresh_token: str):
        self.access_token = access_token
        self.refresh_token = refresh_token


class LocalAuthResponse:
    def __init__(self, user: LocalUser | None, session: LocalSession | None):
        self.user = user
        self.session = session


class LocalAuth:
    """Login local. Senha com PBKDF2 (nunca em claro) e token assinado com HMAC.

    O segredo mora em `.local-secret` ao lado do banco: se fosse fixo no código,
    qualquer um que lesse o repositório assinaria um token válido.
    """

    TOKEN_TTL = 60 * 60 * 24 * 7  # 7 dias

    def __init__(self, store: LocalStore, secret: bytes):
        self._store = store
        self._secret = secret

    # -- senha --
    @staticmethod
    def _hash(password: str, salt: str) -> str:
        return hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt.encode(), 120_000
        ).hex()

    # -- token --
    def _sign(self, user_id: str, expires_at: int, kind: str) -> str:
        body = f"{kind}.{user_id}.{expires_at}"
        mac = hmac.new(self._secret, body.encode(), hashlib.sha256).hexdigest()
        return f"{body}.{mac}"

    def _verify(self, token: str, kind: str) -> str | None:
        try:
            token_kind, user_id, expires_at, mac = token.split(".")
        except ValueError:
            return None
        if token_kind != kind:
            return None
        body = f"{token_kind}.{user_id}.{expires_at}"
        expected = hmac.new(self._secret, body.encode(), hashlib.sha256).hexdigest()
        # compare_digest: comparação com tempo constante, para o erro não vazar
        # quantos caracteres do MAC estavam certos.
        if not hmac.compare_digest(expected, mac):
            return None
        if int(expires_at) < int(time.time()):
            return None
        return user_id

    def _issue(self, user_id: str) -> LocalSession:
        now = int(time.time())
        return LocalSession(
            self._sign(user_id, now + self.TOKEN_TTL, "at"),
            self._sign(user_id, now + self.TOKEN_TTL * 4, "rt"),
        )

    # -- interface usada pelos routers --
    def sign_up(self, payload: dict) -> LocalAuthResponse:
        email = payload["email"].lower().strip()
        existing = [u for u in self._store.all("auth_users") if u["email"] == email]
        if existing:
            raise ValueError("Email já cadastrado")

        salt = secrets.token_hex(16)
        record = {
            "id": str(uuid.uuid4()),
            "email": email,
            "salt": salt,
            "password_hash": self._hash(payload["password"], salt),
            "full_name": (payload.get("options") or {}).get("data", {}).get("full_name", ""),
            "created_at": _now_iso(),
        }
        self._store.put("auth_users", record)
        return LocalAuthResponse(LocalUser(record), self._issue(record["id"]))

    def sign_in_with_password(self, payload: dict) -> LocalAuthResponse:
        email = payload["email"].lower().strip()
        user = next(
            (u for u in self._store.all("auth_users") if u["email"] == email), None
        )
        if not user:
            return LocalAuthResponse(None, None)
        if not hmac.compare_digest(
            user["password_hash"], self._hash(payload["password"], user["salt"])
        ):
            return LocalAuthResponse(None, None)
        return LocalAuthResponse(LocalUser(user), self._issue(user["id"]))

    def get_user(self, token: str) -> LocalAuthResponse:
        user_id = self._verify(token, "at")
        if not user_id:
            return LocalAuthResponse(None, None)
        record = next(
            (u for u in self._store.all("auth_users") if u["id"] == user_id), None
        )
        return LocalAuthResponse(LocalUser(record) if record else None, None)

    def refresh_session(self, payload: dict) -> LocalAuthResponse:
        user_id = self._verify(payload["refresh_token"], "rt")
        if not user_id:
            return LocalAuthResponse(None, None)
        record = next(
            (u for u in self._store.all("auth_users") if u["id"] == user_id), None
        )
        if not record:
            return LocalAuthResponse(None, None)
        return LocalAuthResponse(LocalUser(record), self._issue(user_id))

    def sign_out(self) -> None:
        # Sem lista de revogação: o token é curto e o frontend o descarta. Não
        # fingir que revoga é melhor do que uma revogação que não revoga.
        return None


# --- Storage de arquivos ----------------------------------------------------

class LocalBucket:
    """Substituto do Supabase Storage: grava em disco e devolve URL local."""

    def __init__(self, root: Path, name: str):
        self._dir = root / name
        self._dir.mkdir(parents=True, exist_ok=True)
        self._name = name

    def upload(self, path: str, file: bytes, file_options: dict | None = None):
        target = self._dir / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(file)
        return {"path": path}

    def get_public_url(self, path: str) -> str:
        return f"/static/{self._name}/{path}"


class LocalStorage:
    def __init__(self, root: Path):
        self._root = root

    def from_(self, name: str) -> LocalBucket:
        return LocalBucket(self._root, name)


# --- Cliente ----------------------------------------------------------------

class LocalClient:
    """Substituto do `supabase.Client` com a superfície que os routers usam."""

    def __init__(self, root: Path):
        self._store = LocalStore(root / "funneltron.db")
        self.auth = LocalAuth(self._store, _load_secret(root))
        self.storage = LocalStorage(root / "storage")

    def table(self, name: str) -> LocalQuery:
        return LocalQuery(self._store, name)


def _load_secret(root: Path) -> bytes:
    """Segredo de assinatura, gerado na primeira execução e guardado no disco.
    Fixo no código, qualquer cópia do repositório forjaria token válido."""
    path = root / ".local-secret"
    if path.exists():
        return path.read_bytes()
    secret = secrets.token_bytes(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(secret)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass  # Windows ignora o modo; o arquivo fica sob o perfil do usuário.
    return secret
