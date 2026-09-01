-- 009 — Workspaces: os funis (e integrações, e importações) passam a pertencer
-- a um WORKSPACE, não a um usuário. Um usuário pode ser membro de vários
-- workspaces (trocador de conta) e um workspace pode ter vários membros
-- (compartilhamento).
--
-- Esta migration é SEGURA de rodar com o código ANTIGO ainda no ar:
--   - as tabelas e colunas novas são aditivas;
--   - o backfill dá 1 workspace pessoal por usuário e move os funis dele pra lá;
--   - triggers preenchem `workspace_id` sozinhos quando o código antigo insere
--     sem saber da coluna;
--   - as políticas RLS novas têm um OR de transição
--     (`workspace_id is null and user_id = auth.uid()`) pra nada sumir da tela
--     durante a janela entre o run desta migration e o deploy do código novo.
--
-- Depois que o código de workspaces estiver no ar e estável, rode a
-- `009b_workspaces_cleanup.sql` pra tornar `funnels.workspace_id` obrigatório e
-- remover o OR de transição.

-- ============================================================================
-- TABELAS
-- ============================================================================

create table if not exists public.workspaces (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  owner_id uuid references auth.users on delete cascade not null,
  created_at timestamptz not null default now()
);
create index if not exists workspaces_owner_idx on public.workspaces (owner_id, created_at);

create table if not exists public.workspace_members (
  workspace_id uuid references public.workspaces on delete cascade not null,
  -- Nulo enquanto o convite não foi aceito (a pessoa ainda não tem conta).
  -- Preenchido no cadastro dela (ver signup no backend).
  user_id uuid references auth.users on delete cascade,
  invited_email text,
  role text not null check (role in ('owner', 'member')) default 'member',
  created_at timestamptz not null default now()
);
-- Um membro efetivado é único por (workspace, user). Convites pendentes
-- (user_id null) não colidem entre si.
create unique index if not exists workspace_members_ws_user_idx
  on public.workspace_members (workspace_id, user_id)
  where user_id is not null;
create unique index if not exists workspace_members_ws_email_idx
  on public.workspace_members (workspace_id, lower(invited_email))
  where user_id is null and invited_email is not null;
create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id) where user_id is not null;

-- ============================================================================
-- FUNÇÕES DE APOIO
-- ============================================================================

-- O auth.uid() atual é membro deste workspace?
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- O auth.uid() atual é OWNER deste workspace?
create or replace function public.is_workspace_owner(ws uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = ws and w.owner_id = auth.uid()
  );
$$;

-- Workspace pessoal (mais antigo do qual é owner) do auth.uid() atual.
create or replace function public.my_default_workspace()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.workspaces
  where owner_id = auth.uid()
  order by created_at asc
  limit 1;
$$;

-- ============================================================================
-- COLUNAS workspace_id (aditivas, nullable por enquanto)
-- ============================================================================

alter table public.funnels
  add column if not exists workspace_id uuid references public.workspaces on delete cascade;
create index if not exists funnels_workspace_idx on public.funnels (workspace_id);

alter table public.api_credentials
  add column if not exists workspace_id uuid references public.workspaces on delete cascade;

alter table public.sales_imports
  add column if not exists workspace_id uuid references public.workspaces on delete cascade;

-- ============================================================================
-- BACKFILL — 1 workspace pessoal por usuário; move funis/credenciais/imports
-- ============================================================================

insert into public.workspaces (name, owner_id)
select
  coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) || ' — pessoal',
  p.id
from public.profiles p
where not exists (select 1 from public.workspaces w where w.owner_id = p.id);

insert into public.workspace_members (workspace_id, user_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
where not exists (
  select 1 from public.workspace_members m
  where m.workspace_id = w.id and m.user_id = w.owner_id
);

update public.funnels f
set workspace_id = w.id
from public.workspaces w
where w.owner_id = f.user_id and f.workspace_id is null;

update public.api_credentials c
set workspace_id = w.id
from public.workspaces w
where w.owner_id = c.user_id and c.workspace_id is null;

update public.sales_imports s
set workspace_id = w.id
from public.workspaces w
where w.owner_id = s.user_id and s.workspace_id is null;

-- ============================================================================
-- TRIGGERS — código antigo que insere sem workspace_id não fica invisível
-- ============================================================================

create or replace function public.fill_workspace_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.workspace_id is null then
    new.workspace_id := (
      select id from public.workspaces
      where owner_id = coalesce(new.user_id, auth.uid())
      order by created_at asc
      limit 1
    );
  end if;
  return new;
end;
$$;

drop trigger if exists fill_workspace_funnels on public.funnels;
create trigger fill_workspace_funnels
  before insert on public.funnels
  for each row execute function public.fill_workspace_id();

drop trigger if exists fill_workspace_credentials on public.api_credentials;
create trigger fill_workspace_credentials
  before insert on public.api_credentials
  for each row execute function public.fill_workspace_id();

drop trigger if exists fill_workspace_imports on public.sales_imports;
create trigger fill_workspace_imports
  before insert on public.sales_imports
  for each row execute function public.fill_workspace_id();

-- ============================================================================
-- RLS — workspaces e workspace_members
-- ============================================================================

alter table public.workspaces enable row level security;

drop policy if exists "membro vê o workspace" on public.workspaces;
create policy "membro vê o workspace" on public.workspaces for select
  using (public.is_workspace_member(id));

drop policy if exists "qualquer um cria workspace próprio" on public.workspaces;
create policy "qualquer um cria workspace próprio" on public.workspaces for insert
  with check (owner_id = auth.uid());

drop policy if exists "owner edita o workspace" on public.workspaces;
create policy "owner edita o workspace" on public.workspaces for update
  using (owner_id = auth.uid());

drop policy if exists "owner apaga o workspace" on public.workspaces;
create policy "owner apaga o workspace" on public.workspaces for delete
  using (owner_id = auth.uid());

alter table public.workspace_members enable row level security;

drop policy if exists "membro vê os membros" on public.workspace_members;
create policy "membro vê os membros" on public.workspace_members for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "owner gerencia membros" on public.workspace_members;
create policy "owner gerencia membros" on public.workspace_members for all
  using (public.is_workspace_owner(workspace_id))
  with check (public.is_workspace_owner(workspace_id));

-- ============================================================================
-- RLS — troca user_id → workspace_id nas tabelas de dados
-- (com OR de transição: workspace_id null + dono antigo continua valendo)
-- ============================================================================

-- funnels
drop policy if exists "Usuários veem próprios funis" on public.funnels;
drop policy if exists "Usuários criam próprios funis" on public.funnels;
drop policy if exists "Usuários atualizam próprios funis" on public.funnels;
drop policy if exists "Usuários deletam próprios funis" on public.funnels;

create policy "ws: vê funis" on public.funnels for select
  using (public.is_workspace_member(workspace_id)
         or (workspace_id is null and user_id = auth.uid()));
create policy "ws: cria funis" on public.funnels for insert
  with check (public.is_workspace_member(workspace_id)
              or (workspace_id is null and user_id = auth.uid()));
create policy "ws: atualiza funis" on public.funnels for update
  using (public.is_workspace_member(workspace_id)
         or (workspace_id is null and user_id = auth.uid()));
create policy "ws: apaga funis" on public.funnels for delete
  using (public.is_workspace_member(workspace_id)
         or (workspace_id is null and user_id = auth.uid()));

-- helper de cascata: o funil do id X é acessível pelo auth.uid()?
create or replace function public.can_access_funnel(fid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.funnels f
    where f.id = fid
      and (public.is_workspace_member(f.workspace_id)
           or (f.workspace_id is null and f.user_id = auth.uid()))
  );
$$;

-- funnel_steps
drop policy if exists "Usuários veem steps de próprios funis" on public.funnel_steps;
drop policy if exists "Usuários manipulam steps de próprios funis" on public.funnel_steps;
create policy "ws: vê steps" on public.funnel_steps for select
  using (public.can_access_funnel(funnel_id));
create policy "ws: manipula steps" on public.funnel_steps for all
  using (public.can_access_funnel(funnel_id))
  with check (public.can_access_funnel(funnel_id));

-- funnel_edges
drop policy if exists "Usuários veem edges de próprios funis" on public.funnel_edges;
drop policy if exists "Usuários manipulam edges de próprios funis" on public.funnel_edges;
create policy "ws: vê edges" on public.funnel_edges for select
  using (public.can_access_funnel(funnel_id));
create policy "ws: manipula edges" on public.funnel_edges for all
  using (public.can_access_funnel(funnel_id))
  with check (public.can_access_funnel(funnel_id));

-- step_metrics
drop policy if exists "Usuários veem métricas de próprios funis" on public.step_metrics;
create policy "ws: vê métricas" on public.step_metrics for select
  using (public.can_access_funnel(funnel_id));

-- vsl_insights
drop policy if exists "Usuários veem VSL insights de próprios funis" on public.vsl_insights;
create policy "ws: vê vsl insights" on public.vsl_insights for select
  using (public.can_access_funnel(funnel_id));

-- live_beats (só a de LEITURA autenticada; as de heartbeat anônimo ficam)
drop policy if exists "Usuários veem beats de próprios funis" on public.live_beats;
create policy "ws: vê beats" on public.live_beats for select to authenticated
  using (public.can_access_funnel(funnel_id));

-- live_snapshots
drop policy if exists "Usuários veem snapshots de próprios funis" on public.live_snapshots;
create policy "ws: vê snapshots" on public.live_snapshots for select
  using (public.can_access_funnel(funnel_id));

-- live_sales
drop policy if exists "Usuários veem vendas de próprios funis" on public.live_sales;
create policy "ws: vê vendas ao vivo" on public.live_sales for select
  using (public.can_access_funnel(funnel_id));

-- live_page_entries (a política de leitura era "Dono lê as entradas do próprio funil")
drop policy if exists "Dono lê as entradas do próprio funil" on public.live_page_entries;
create policy "ws: vê entradas de página" on public.live_page_entries for select
  using (public.can_access_funnel(funnel_id));

-- api_credentials
drop policy if exists "Usuários gerenciam próprias credenciais" on public.api_credentials;
create policy "ws: gerencia credenciais" on public.api_credentials for all
  using (public.is_workspace_member(workspace_id)
         or (workspace_id is null and user_id = auth.uid()))
  with check (public.is_workspace_member(workspace_id)
              or (workspace_id is null and user_id = auth.uid()));

-- sales_imports
drop policy if exists "Usuários veem próprias importações" on public.sales_imports;
create policy "ws: gerencia importações" on public.sales_imports for all
  using (public.is_workspace_member(workspace_id)
         or (workspace_id is null and user_id = auth.uid()))
  with check (public.is_workspace_member(workspace_id)
              or (workspace_id is null and user_id = auth.uid()));

-- sales
drop policy if exists "Usuários veem vendas de próprias importações" on public.sales;
create policy "ws: vê vendas" on public.sales for select
  using (exists (
    select 1 from public.sales_imports si
    where si.id = sales.import_id
      and (public.is_workspace_member(si.workspace_id)
           or (si.workspace_id is null and si.user_id = auth.uid()))
  ));

-- A unicidade de slug passa a ser por workspace (mantém a antiga também por
-- enquanto — funis com workspace_id null ainda respeitam unique(user_id, slug)).
create unique index if not exists funnels_workspace_slug_idx
  on public.funnels (workspace_id, slug) where workspace_id is not null;
