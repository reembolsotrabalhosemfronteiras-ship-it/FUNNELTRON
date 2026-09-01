# Prompt — implementar Workspaces (trocador de conta + compartilhamento) no FUNNELTRON

> Cole tudo abaixo como prompt para a outra IA. Ela vai trabalhar no repositório
> `FUNNELTRON` (FastAPI + React). Nada aqui depende de conversas anteriores.

---

## O QUE VOCÊ VAI CONSTRUIR

Hoje cada usuário do FUNNELTRON tem os **seus próprios funis**, isolados por
`funnels.user_id` + RLS do Supabase. Quero trocar isso por **workspaces**:

1. **Trocador de conta (tipo Slack/Google):** um login só, e a pessoa alterna
   entre vários workspaces **sem deslogar**. Cada workspace tem seus funis,
   métricas, integrações e dados ao vivo — totalmente isolados dos outros.
2. **Compartilhamento:** o dono de um workspace convida **outras contas por
   email** para dentro dele. Os convidados passam a ver e mexer nos **mesmos
   funis** do workspace (papel `member`; o dono é `owner`).
3. **Ao se cadastrar**, todo usuário ganha automaticamente **1 workspace
   pessoal** ("Meu workspace" ou o nome dele), do qual é `owner`.

O cadastro **já é travado por um código de acesso** (`POST /api/auth/signup`
valida `invite_code` contra `settings.signup_invite_code`, default `"100kdia"`).
**NÃO mexa nessa trava** — só garanta que o fluxo de signup continua criando o
workspace pessoal depois de criar o usuário.

---

## STACK / DEPLOY

- **Backend:** FastAPI (`backend/app`), Python 3.12+, `supabase-py==2.31.0`,
  `httpx==0.28.1`. Roda no Railway pelo `Dockerfile` (imagem única: build do
  front + FastAPI servindo `frontend/dist`).
- **Frontend:** React 18 + Vite + TypeScript + Tailwind (`frontend/src`).
  React Router. Design system "Nocturne" (classes `.card`, `.btn`, `.seg`,
  `.tag`, `.field`, `.table` em `frontend/src/index.css`; ícones
  `@phosphor-icons/react`).
- **Banco:** Supabase (Postgres + Auth + RLS + Storage). Projeto `zzqz…`.
- **Deploy:** `git push` para `main` → Railway rebuilda sozinho. Sem CI que
  bloqueie (há um workflow `test` que roda `npm test`, mas não trava o deploy).
- **Migrations do banco são aplicadas À MÃO** pelo dono, colando o SQL no
  **SQL Editor do Supabase**. Você escreve o arquivo `.sql`, deixa numerado em
  `backend/supabase/migrations/00X_nome.sql`, e **avisa claramente no fim que
  ele precisa ser rodado** (com `if not exists`/`if exists` em tudo pra ser
  idempotente). O `backend/supabase/schema.sql` é o retrato completo — atualize
  ele também.

---

## MAPA DO REPOSITÓRIO

```
backend/
  app/
    main.py                 # cria o FastAPI, monta routers com prefixo /api, serve o front
    core/
      config.py             # Settings (pydantic-settings), lê backend/.env + env vars
      auth.py               # get_current_user, get_db, get_optional_user  ← CENTRO DA AUTH
      supabase_client.py    # clientes Supabase POR THREAD + retry  ← LEIA COM ATENÇÃO
      cache.py              # TTLCache (usado só p/ cachear o user validado 60s)
      local_db.py           # SQLite que imita a interface do supabase-py (modo dev sem chaves)
      scheduler.py          # jobs em background (snapshots)
    routers/                # auth, funnels, layout, screenshots, metrics,
                            # integrations, imports, live, sources, push
    services/               # clarity, vturb, screenshot, snapshots, push, geo
  supabase/
    schema.sql              # schema COMPLETO (retrato)
    migrations/00X_*.sql     # migrations incrementais, rodadas à mão no Supabase
  smoke_test.py             # teste ponta-a-ponta de TODAS as rotas (44 checagens)

frontend/
  src/
    App.tsx                 # rotas; <Protected> exige sessão; <AppShell> = Sidebar + conteúdo
    api/
      client.ts             # CAMADA DE DADOS (1800 linhas). Toda chamada /api mora aqui.
                            #   USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false"
                            #   authHeaders() põe "Authorization: Bearer <accessToken>"
                            #   PATCH no window.fetch faz auto-refresh do token em 401
      mockData.ts, mappers.ts
    components/common/
      AuthContext.tsx       # user/login/signup/logout; sessão em localStorage
      Sidebar.tsx           # ← AQUI VAI O SELETOR DE WORKSPACE
      Header.tsx, Card.tsx, Button.tsx, Input.tsx, ...
    pages/                  # Dashboard, FunnelList, FunnelOverview, FunnelView,
                            # FunnelEditor, Metrics, Imports, Settings, Live, Login
    types/index.ts          # tipos compartilhados (Funnel, PeriodInput, DateRange…)
```

---

## COMO A POSSE FUNCIONA HOJE (o que você vai trocar)

### Backend

- **`backend/app/core/auth.py`**
  - `get_current_user(credentials)` → valida o JWT do Supabase
    (`get_supabase_client().auth.get_user(token)`, cacheado 60s) e devolve o
    **objeto user do Supabase** (tem `.id`, `.email`, `.user_metadata`).
  - `get_db(credentials)` → devolve um **cliente Supabase amarrado ao JWT do
    usuário** (`make_user_client(token)`), pra o RLS resolver `auth.uid()`.
  - Os routers fazem `current_user = Depends(get_current_user)` +
    `supabase: Client = Depends(get_db)` e filtram **na mão** por
    `.eq("user_id", current_user.id)` — **47 ocorrências** de `"user_id"` nos
    routers. Além do filtro na aplicação, a **RLS do Postgres** é a segunda
    barreira.

- **`backend/supabase/schema.sql`** — tabelas:
  - `profiles (id=auth.users.id, email, full_name)`
  - **`funnels (id, user_id → auth.users, name, slug, status, base_url, kind,
    conversion_goal_step_id)` — `unique(user_id, slug)`** ← a RAIZ da posse
  - `funnel_steps`, `funnel_edges`, `step_metrics`, `vsl_insights` — herdam a
    posse via `funnel_id` e RLS do tipo
    `exists (select 1 from funnels where funnels.id = X.funnel_id and funnels.user_id = auth.uid())`
  - `live_beats`, `live_page_entries`, `live_snapshots`, `live_sales` — idem
    (posse via `funnel_id`)
  - **`api_credentials (id, user_id, provider, api_token, …)` —
    `unique(user_id, provider)`** ← hoje per-user
  - **`sales_imports (id, user_id, filename, …)`** ← hoje per-user
  - `sales (id, import_id → sales_imports, funnel_id, …)`

- Trigger `resolve_step_from_url()` resolve `step_id` pela URL nos heartbeats —
  **não mexa nele**.

### Frontend

- `AuthContext` guarda `{ user, accessToken, refreshToken }` em `localStorage`
  (chave `funil-analytics:session`).
- Toda chamada real: `client.ts` → `authHeaders()` → `Authorization: Bearer`.
- Não existe conceito de "conta ativa" — o backend deduz tudo do JWT.

---

## O DESIGN QUE VOCÊ VAI IMPLEMENTAR

### 1. Schema — migration nova `backend/supabase/migrations/009_workspaces.sql`

```sql
-- 009 — Workspaces: os funis passam a pertencer a um workspace, não a um usuário.

create table if not exists public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references auth.users on delete cascade not null,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid references public.workspaces on delete cascade not null,
  user_id      uuid references auth.users        on delete cascade not null,
  role text not null check (role in ('owner','member')) default 'member',
  invited_email text,                 -- pra listar convites pendentes por email
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

-- Helper: o auth.uid() atual é membro deste workspace?
create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- funnels: nova coluna workspace_id (nullable no primeiro passo, pro backfill)
alter table public.funnels add column if not exists workspace_id uuid references public.workspaces on delete cascade;

-- api_credentials e sales_imports viram por-workspace
alter table public.api_credentials add column if not exists workspace_id uuid references public.workspaces on delete cascade;
alter table public.sales_imports   add column if not exists workspace_id uuid references public.workspaces on delete cascade;
```

**Backfill (parte do mesmo arquivo, roda uma vez):**

```sql
-- 1 workspace pessoal por usuário que já tem funil/credencial/import.
insert into public.workspaces (name, owner_id)
select coalesce(p.full_name, split_part(p.email,'@',1)) || ' — pessoal', p.id
from public.profiles p
where not exists (select 1 from public.workspaces w where w.owner_id = p.id);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
on conflict do nothing;

update public.funnels f set workspace_id = w.id
from public.workspaces w where w.owner_id = f.user_id and f.workspace_id is null;

update public.api_credentials c set workspace_id = w.id
from public.workspaces w where w.owner_id = c.user_id and c.workspace_id is null;

update public.sales_imports s set workspace_id = w.id
from public.workspaces w where w.owner_id = s.user_id and s.workspace_id is null;
```

**Depois do backfill**, num passo separado (pode ser no fim do mesmo arquivo ou
`009b`), tornar `funnels.workspace_id` `not null`, e trocar `unique(user_id,slug)`
por `unique(workspace_id, slug)`. Manter `funnels.user_id` por enquanto como
"criado por" (informativo) — não remova nessa leva pra não quebrar nada que
ainda leia.

### 2. RLS nova (no mesmo arquivo de migration + refletir no `schema.sql`)

- `workspaces`: SELECT se `is_workspace_member(id)`; INSERT com
  `owner_id = auth.uid()`; UPDATE/DELETE só `owner_id = auth.uid()`.
- `workspace_members`: SELECT se `is_workspace_member(workspace_id)`;
  INSERT/DELETE só se `auth.uid()` for `owner` do workspace (checar via subquery).
- `funnels`: **trocar** todas as políticas de `auth.uid() = user_id` por
  `is_workspace_member(workspace_id)`.
- `funnel_steps/edges/step_metrics/vsl_insights/live_*`: trocar o
  `and funnels.user_id = auth.uid()` das políticas por
  `and public.is_workspace_member(funnels.workspace_id)`.
- `api_credentials`, `sales_imports`: trocar `auth.uid() = user_id` por
  `is_workspace_member(workspace_id)`.
- **Não** mexa nas políticas de INSERT anônimo do rastreador
  (`live_beats`/`live_page_entries` "Anônimos podem bater heartbeat") — o
  heartbeat continua público.

### 3. Backend

- **`config.py`**: nada novo obrigatório.
- **Novo router `backend/app/routers/workspaces.py`** (montar em `main.py` com
  os outros, prefixo `/api`):
  - `GET  /api/workspaces` → lista os workspaces em que o usuário é membro
    `[{ id, name, role, member_count }]`.
  - `POST /api/workspaces` `{ name }` → cria + adiciona o criador como `owner`.
  - `PATCH /api/workspaces/{id}` `{ name }` → renomear (só owner).
  - `DELETE /api/workspaces/{id}` → só owner; **bloquear se for o único
    workspace do usuário** (todo mundo precisa de pelo menos 1).
  - `GET  /api/workspaces/{id}/members` → lista membros (só membro).
  - `POST /api/workspaces/{id}/members` `{ email }` → só owner. Resolve o email
    pra um `auth.users.id` via `get_supabase_admin().auth.admin.list_users()`
    (ou `admin.get_user_by_...` se existir na versão) e insere em
    `workspace_members` com role `member`. Se o email não tem conta ainda,
    guardar em `invited_email` e resolver quando ela se cadastrar (ver signup).
  - `DELETE /api/workspaces/{id}/members/{user_id}` → só owner; não pode remover
    o próprio owner.
- **`auth.py` — `get_active_workspace`:** nova dependência que lê o header
  **`X-Workspace-Id`** (ou querystring `?workspace_id=`), **confere via
  `get_supabase_admin()` que `current_user.id` é membro** desse workspace, e
  devolve o id. Se o header não veio, usa o "primeiro" workspace do usuário
  (o mais antigo). 403 se pediu um workspace do qual não é membro.
- **Todos os routers** (`funnels`, `layout`, `metrics`, `imports`,
  `integrations`, `live`, `sources`, `screenshots`, `push`): trocar
  `.eq("user_id", current_user.id)` por `.eq("workspace_id", ws_id)` (onde
  `ws_id = Depends(get_active_workspace)`), e nas queries que hoje validam posse
  via `funnels.user_id` fazer o mesmo com `funnels.workspace_id`. O `POST
  /api/funnels` grava `workspace_id = ws_id` (e pode manter `user_id =
  current_user.id` como "criado por").
- **`auth.py` `signup`:** depois de criar o usuário no Supabase e inserir o
  `profiles`, **criar o workspace pessoal** (`workspaces` + `workspace_members`
  role `owner`) e **efetivar convites pendentes** (`workspace_members` linhas
  com `invited_email = <email do novo user>` e `user_id` nulo → preencher
  `user_id`). Use `get_supabase_admin()` pra isso (roda antes de o usuário ter
  sessão).

### 4. Frontend

- **`types/index.ts`**: `interface Workspace { id: string; name: string; role: "owner" | "member"; memberCount: number }`.
- **`api/client.ts`**:
  - `authHeaders()` passa a incluir `X-Workspace-Id: <workspace ativo>` quando
    houver um. O workspace ativo mora em `localStorage`
    (`funil-analytics:active-workspace`) — adicione `getActiveWorkspaceId()` /
    `setActiveWorkspaceId(id)` ao lado do `getSessionToken()`.
  - Funções novas: `listWorkspaces()`, `createWorkspace(name)`,
    `renameWorkspace(id, name)`, `deleteWorkspace(id)`, `listMembers(wsId)`,
    `addMember(wsId, email)`, `removeMember(wsId, userId)`. Com mocks
    correspondentes (o app roda com `VITE_USE_MOCK=true` em dev).
- **`AuthContext` (ou um `WorkspaceContext` novo)**: no load e no login, buscar
  `listWorkspaces()`, escolher o ativo (o salvo, ou o primeiro), expor
  `{ workspaces, activeWorkspace, setActiveWorkspace, reloadWorkspaces }`.
  **Ao trocar de workspace ativo, invalidar/recarregar as telas** (o jeito mais
  simples: `setActiveWorkspaceId(id)` + `window.location.reload()` OU um
  `key={activeWorkspace.id}` no `<AppShell>` pra remontar a árvore).
- **`Sidebar.tsx`**: no topo (abaixo do wordmark FUNNELTRON), um seletor de
  workspace — botão que abre uma lista dos workspaces + "＋ Novo workspace" +
  "Gerenciar membros". Estilo Nocturne (`.card`/`.btn`/`.seg`, ícones Phosphor
  tipo `CaretUpDown`, `Users`, `Plus`).
- **Nova página `pages/WorkspacePage.tsx`** (rota `/workspace`, dentro do
  `<AppShell>`): renomear o workspace ativo, listar membros, convidar por email,
  remover membro, sair do workspace (se não for owner), apagar o workspace (se
  for owner e não for o único). Adicionar o link no `App.tsx`.
- Nada de RLS/segurança no front — é conveniência. A barreira real é o backend
  (`get_active_workspace` valida membership) + RLS.

---

## COISAS QUE VOCÊ NÃO PODE QUEBRAR (regressões conhecidas já corrigidas)

1. **Cliente Supabase por thread** (`backend/app/core/supabase_client.py`): o
   `httpx.Client` do supabase-py NÃO é thread-safe. Já foi corrigido pra ter um
   cliente por thread (`threading.local`) + `_RetryTransport` (retry de
   GET/HEAD em `Server disconnected`). **Se você adicionar chamadas ao Supabase,
   use `get_db()` (por token) ou `get_supabase_admin()` (por thread) — nunca
   crie um `create_client` compartilhado novo.**
2. **Auto-refresh de token** (`frontend/src/api/client.ts`, patch no
   `window.fetch`): 401 numa chamada `/api` → `POST /api/auth/refresh` → repete.
   `/api/auth/*` fica de fora do retry. Se você mudar `authHeaders()`, garanta
   que o retry ainda reinjeta o header (hoje ele reinjeta só `Authorization` —
   **adicione o reinjeta do `X-Workspace-Id` também**).
3. **Trava do código de cadastro** (`100kdia`) — mantenha.
4. **Rastreador ao vivo** (`POST /api/live/track`, público, CORS aberto,
   `Content-Type: text/plain`, sem preflight) — não encoste. O `tracker.js`
   colado nas páginas dos clientes não pode exigir mudança.
5. **Mapa do Brasil / geo** (`services/geo.py`, colunas `geo_*` em `live_beats`,
   `_upsert_beat` que degrada sozinho se a migration 008 não rodou) — o padrão
   "degrada em silêncio se a coluna não existe" é intencional; replique-o pras
   colunas `workspace_id` durante a janela entre deploy do código e run da
   migration 009, pra o app não quebrar nesse meio-tempo.
6. **`local_db.py`** (modo dev sem Supabase): ele imita
   `select/insert/upsert/update/delete` + filtros `eq/neq/in_/is_/...` + `auth`.
   Se as suas queries novas usarem algum operador que ele não tem, ou adicione
   ao `local_db.py`, ou só garanta que o `smoke_test`/dev roda com Supabase real.

---

## COMO VERIFICAR

- **`backend/smoke_test.py`** — teste ponta-a-ponta de todas as rotas. Rode:
  `cd backend && .venv/Scripts/python.exe smoke_test.py --base http://127.0.0.1:8000`
  (ele cria usuário via admin, cria funil, salva layout, heartbeat, ao vivo,
  webhook, métricas, importação, credenciais, e **checa isolamento entre contas**
  — "conta B não vê funil da conta A"). Depois das mudanças, **adicione
  checagens de workspace**: usuário A cria WS1, convida B; B enxerga os funis de
  WS1; um C fora de WS1 recebe 403/404. E que trocar o `X-Workspace-Id` troca o
  conjunto de funis retornado.
- **Teste de concorrência** (rajada): dispare ~20 GETs autenticados em paralelo
  contra `/api/funnels`, `/api/metrics/overview`, `/api/live?funnel_id=…` etc. e
  confirme **0 respostas 500** (o bug de thread-safety já foi corrigido; sua
  mudança não pode reintroduzi-lo).
- **Frontend**: `cd frontend && npm run build` (`tsc -b && vite build`) tem que
  passar limpo. Navegue com `VITE_USE_MOCK=true`: trocar de workspace no seletor
  deve trocar a lista de funis; criar workspace, convidar membro (mock), etc.
- **Deploy**: `git push` para `main`. Railway rebuilda. **No fim, diga
  explicitamente que a `migration 009_workspaces.sql` precisa ser rodada no SQL
  Editor do Supabase** e em que ordem (código no ar primeiro com degradação
  silenciosa → roda a migration → o app passa a usar workspaces de verdade).

---

## ORDEM SUGERIDA

1. Migration `009` (schema + helper `is_workspace_member` + colunas nullable +
   backfill + RLS nova). Atualizar `schema.sql`.
2. Backend: router `workspaces.py`, `get_active_workspace`, signup criando WS
   pessoal + efetivando convites, degradação silenciosa nas queries enquanto a
   coluna pode não existir.
3. Trocar `user_id` → `workspace_id` em todos os routers. Rodar `smoke_test`.
4. Frontend: client + context + seletor na Sidebar + `WorkspacePage`. Reinjetar
   `X-Workspace-Id` no retry do `window.fetch`.
5. Testes de workspace no `smoke_test` + rajada. Build do front.
6. Push. Instruir o run da migration.
