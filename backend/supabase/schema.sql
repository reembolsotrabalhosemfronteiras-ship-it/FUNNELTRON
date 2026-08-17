-- FUNNELTRON Database Schema
-- Execute este script no Supabase SQL Editor

-- Extensões necessárias
create extension if not exists "uuid-ossp";

-- pg_cron é OPCIONAL: só a faxina automática do fim do arquivo usa. Em projeto
-- onde ele não está liberado, `create extension` falha e, como o SQL Editor
-- roda tudo numa transação só, levaria junto o schema inteiro. Por isso vai
-- dentro de um bloco que engole o erro.
do $$
begin
  create extension if not exists "pg_cron";
exception when others then
  raise notice 'pg_cron indisponível — a seção de agendamentos será pulada.';
end $$;

-- ============================================================================
-- AUTENTICAÇÃO E USUÁRIOS
-- ============================================================================

-- Tabela de perfis de usuário (complementa auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text unique not null,
  full_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS para profiles
alter table public.profiles enable row level security;

create policy "Usuários podem ver próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Usuários podem atualizar próprio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- ============================================================================
-- FUNIS E ESTRUTURA
-- ============================================================================

-- Tabela principal de funis
create table public.funnels (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  slug text not null,
  status text not null check (status in ('active', 'inactive', 'testing')) default 'active',
  base_url text,
  kind text check (kind in ('front', 'upsell')) default 'front',
  conversion_goal_step_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, slug)
);

-- Etapas do funil
create table public.funnel_steps (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  label text not null,
  url text not null,
  type text not null check (type in (
    'landing', 'vsl', 'checkout', 'upsell', 'downsell',
    'order_bump', 'thank_you', 'other', 'sub_funnel'
  )),
  position_x real not null default 0,
  position_y real not null default 0,
  parent_step_id uuid references public.funnel_steps on delete set null,
  order_index int not null default 0,
  screenshot_url text,
  status text,
  sub_funnel_id uuid references public.funnels on delete set null,
  created_at timestamptz default now()
);

-- Conexões entre etapas (setas)
create table public.funnel_edges (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  source_step_id uuid references public.funnel_steps on delete cascade not null,
  target_step_id uuid references public.funnel_steps on delete cascade not null,
  condition text not null check (condition in (
    'default', 'on_accept', 'on_decline', 'on_bump', 'on_no_bump', 'back_redirect'
  )) default 'default',
  label text
);

-- ============================================================================
-- MÉTRICAS E ANÁLISES
-- ============================================================================

-- Métricas por etapa
create table public.step_metrics (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  step_id uuid references public.funnel_steps on delete cascade not null,
  date date not null,
  visitors int not null default 0,
  conversions int not null default 0,
  conversion_rate real,
  source text not null check (source in ('clarity', 'vturb', 'manual')) default 'manual',
  created_at timestamptz default now(),
  unique(step_id, date, source)
);

-- Insights de VSL
create table public.vsl_insights (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  step_id uuid references public.funnel_steps on delete cascade not null,
  name text not null,
  engagement_rate real,
  conversion_rate real,
  views int default 0,
  completions int default 0,
  source text default 'vturb',
  date date not null,
  created_at timestamptz default now(),
  unique(step_id, date)
);

-- ============================================================================
-- RASTREAMENTO AO VIVO
-- ============================================================================

-- Batidas de heartbeat (rastreador próprio)
create table public.live_beats (
  session_id text primary key,
  funnel_id uuid references public.funnels on delete cascade not null,
  device_id text,
  url text not null,
  step_id uuid references public.funnel_steps on delete set null,
  referrer text,
  utm jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create index on public.live_beats (funnel_id, last_seen desc);
create index on public.live_beats (step_id) where step_id is not null;

-- Trigger para resolver step_id automaticamente pela URL
create or replace function resolve_step_from_url() returns trigger as $$
begin
  -- Normaliza URL: sem query, sem hash, sem barra final
  new.step_id := (
    select id from public.funnel_steps
     where funnel_id = new.funnel_id
       and regexp_replace(split_part(url, '?', 1), '/$', '')
         = regexp_replace(split_part(new.url, '?', 1), '/$', '')
     limit 1
  );
  return new;
end;
$$ language plpgsql;

create trigger resolve_step_trigger
  before insert or update on public.live_beats
  for each row execute function resolve_step_from_url();

-- Log de entradas em página (append-only).
-- Separado de live_beats porque aquela tabela tem UMA linha por sessão (upsert
-- em session_id): quando a pessoa anda para a próxima página, a linha é
-- sobrescrita e a visita anterior desaparece. O log precisa do histórico, então
-- é uma linha por (sessão, página).
create table public.live_page_entries (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  session_id text not null,
  step_id uuid references public.funnel_steps on delete set null,
  url text not null,
  referrer text,
  utm jsonb,
  device text,
  entered_at timestamptz not null default now()
);

create index on public.live_page_entries (funnel_id, entered_at desc);

-- Mesma resolução de step_id pela URL usada em live_beats.
create trigger resolve_step_entry_trigger
  before insert on public.live_page_entries
  for each row execute function resolve_step_from_url();

-- RLS: quem entrou numa página é dado de quem é dono do funil, e de mais
-- ninguém. O snippet grava sem estar logado (por isso a política de insert é
-- aberta), mas a leitura passa pelo dono.
alter table public.live_page_entries enable row level security;

create policy "Rastreador registra entrada"
  on public.live_page_entries for insert
  with check (true);

create policy "Dono lê as entradas do próprio funil"
  on public.live_page_entries for select
  using (exists (
    select 1 from public.funnels
     where funnels.id = live_page_entries.funnel_id
       and funnels.user_id = auth.uid()
  ));

-- Snapshots para histórico (gráfico das últimas 24h)
create table public.live_snapshots (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  step_id uuid references public.funnel_steps on delete set null,
  online int not null default 0,
  captured_at timestamptz not null default now()
);

create index on public.live_snapshots (funnel_id, captured_at desc);

-- Vendas ao vivo (webhook de gateways: PerfectPay, Hotmart, Kiwify...)
create table public.live_sales (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  step_id uuid references public.funnel_steps on delete set null,
  status text not null check (status in ('pending', 'paid')) default 'pending',
  amount decimal(10,2) not null default 0,
  customer text,
  external_id text,
  created_at timestamptz not null default now()
);

create index on public.live_sales (funnel_id, created_at desc);
create unique index on public.live_sales (external_id) where external_id is not null;

alter table public.live_sales enable row level security;

create policy "Sistema insere vendas ao vivo"
  on public.live_sales for insert
  with check (true);

create policy "Usuários veem vendas de próprios funis"
  on public.live_sales for select
  using (exists (
    select 1 from public.funnels
    where funnels.id = live_sales.funnel_id
      and funnels.user_id = auth.uid()
  ));

-- ============================================================================
-- CREDENCIAIS E INTEGRAÇÕES
-- ============================================================================

-- Credenciais de APIs (nunca expostas ao frontend)
create table public.api_credentials (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  provider text not null check (provider in ('vturb', 'clarity', 'webhook')),
  api_token text,
  api_version text,
  account_id text,
  rate_limit_tier text check (rate_limit_tier in ('basic', 'pro', 'scale', 'enterprise')),
  extra_config jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, provider)
);

-- ============================================================================
-- IMPORTAÇÕES E VENDAS
-- ============================================================================

-- Histórico de importações (UTMify)
create table public.sales_imports (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  filename text not null,
  imported_at timestamptz not null,
  row_count int not null,
  date_range_start date,
  date_range_end date,
  detected_columns jsonb not null,
  raw_data jsonb,
  created_at timestamptz default now()
);

-- Vendas normalizadas
create table public.sales (
  id uuid primary key default uuid_generate_v4(),
  import_id uuid references public.sales_imports on delete cascade not null,
  funnel_id uuid references public.funnels on delete set null,
  date date not null,
  status text not null check (status in ('approved', 'pending', 'refunded', 'chargeback')),
  gross_value decimal(10,2) not null,
  net_value decimal(10,2) not null,
  fees jsonb,
  ad_spend decimal(10,2) default 0,
  utm jsonb,
  product_name text,
  checkout_url text,
  created_at timestamptz default now()
);

create index on public.sales (funnel_id, date desc);
create index on public.sales (date desc);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Funnels
alter table public.funnels enable row level security;

create policy "Usuários veem próprios funis"
  on public.funnels for select
  using (auth.uid() = user_id);

create policy "Usuários criam próprios funis"
  on public.funnels for insert
  with check (auth.uid() = user_id);

create policy "Usuários atualizam próprios funis"
  on public.funnels for update
  using (auth.uid() = user_id);

create policy "Usuários deletam próprios funis"
  on public.funnels for delete
  using (auth.uid() = user_id);

-- Funnel Steps
alter table public.funnel_steps enable row level security;

create policy "Usuários veem steps de próprios funis"
  on public.funnel_steps for select
  using (exists (
    select 1 from public.funnels
    where funnels.id = funnel_steps.funnel_id
      and funnels.user_id = auth.uid()
  ));

create policy "Usuários manipulam steps de próprios funis"
  on public.funnel_steps for all
  using (exists (
    select 1 from public.funnels
    where funnels.id = funnel_steps.funnel_id
      and funnels.user_id = auth.uid()
  ));

-- Funnel Edges
alter table public.funnel_edges enable row level security;

create policy "Usuários veem edges de próprios funis"
  on public.funnel_edges for select
  using (exists (
    select 1 from public.funnels
    where funnels.id = funnel_edges.funnel_id
      and funnels.user_id = auth.uid()
  ));

create policy "Usuários manipulam edges de próprios funis"
  on public.funnel_edges for all
  using (exists (
    select 1 from public.funnels
    where funnels.id = funnel_edges.funnel_id
      and funnels.user_id = auth.uid()
  ));

-- Step Metrics
alter table public.step_metrics enable row level security;

create policy "Usuários veem métricas de próprios funis"
  on public.step_metrics for select
  using (exists (
    select 1 from public.funnels
    where funnels.id = step_metrics.funnel_id
      and funnels.user_id = auth.uid()
  ));

create policy "Sistema insere métricas"
  on public.step_metrics for insert
  with check (true);

-- VSL Insights
alter table public.vsl_insights enable row level security;

create policy "Usuários veem VSL insights de próprios funis"
  on public.vsl_insights for select
  using (exists (
    select 1 from public.funnels
    where funnels.id = vsl_insights.funnel_id
      and funnels.user_id = auth.uid()
  ));

create policy "Sistema insere VSL insights"
  on public.vsl_insights for insert
  with check (true);

-- Live Beats (acesso anônimo para escrita, autenticado para leitura)
alter table public.live_beats enable row level security;

create policy "Anônimos podem bater heartbeat"
  on public.live_beats for insert
  to anon
  with check (true);

create policy "Anônimos podem renovar heartbeat"
  on public.live_beats for update
  to anon
  using (true);

create policy "Usuários veem beats de próprios funis"
  on public.live_beats for select
  to authenticated
  using (exists (
    select 1 from public.funnels
    where funnels.id = live_beats.funnel_id
      and funnels.user_id = auth.uid()
  ));

-- Live Snapshots
alter table public.live_snapshots enable row level security;

create policy "Usuários veem snapshots de próprios funis"
  on public.live_snapshots for select
  using (exists (
    select 1 from public.funnels
    where funnels.id = live_snapshots.funnel_id
      and funnels.user_id = auth.uid()
  ));

-- API Credentials (nunca expostas)
alter table public.api_credentials enable row level security;

create policy "Usuários gerenciam próprias credenciais"
  on public.api_credentials for all
  using (auth.uid() = user_id);

-- Sales Imports
alter table public.sales_imports enable row level security;

create policy "Usuários veem próprias importações"
  on public.sales_imports for all
  using (auth.uid() = user_id);

-- Sales
alter table public.sales enable row level security;

create policy "Usuários veem vendas de próprias importações"
  on public.sales for select
  using (exists (
    select 1 from public.sales_imports
    where sales_imports.id = sales.import_id
      and sales_imports.user_id = auth.uid()
  ));

-- ============================================================================
-- JOBS AGENDADOS (pg_cron)
-- ============================================================================

-- Sem pg_cron nada aqui roda — e o app continua funcionando, só sem a faxina
-- automática (os beats velhos ficam na tabela e o gráfico histórico não enche).
-- Por isso o bloco inteiro é condicional em vez de obrigatório.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não instalado — agendamentos pulados.';
    return;
  end if;

  -- Limpar heartbeats antigos (> 90s)
  perform cron.schedule(
    'limpar-beats-antigos',
    '* * * * *',
    $job$delete from public.live_beats where last_seen < now() - interval '90 seconds'$job$
  );

  -- Tirar snapshot das pessoas online (para gráfico histórico)
  perform cron.schedule(
    'snapshot-online',
    '* * * * *',
    $job$
      insert into public.live_snapshots (funnel_id, step_id, online, captured_at)
      select funnel_id, step_id, count(*), now()
        from public.live_beats
       where last_seen > now() - interval '90 seconds'
       group by funnel_id, step_id
    $job$
  );

  -- Limpar snapshots antigos (> 48h)
  perform cron.schedule(
    'limpar-snapshots-antigos',
    '0 * * * *',
    $job$delete from public.live_snapshots where captured_at < now() - interval '48 hours'$job$
  );

  -- Log de entradas: 7 dias bastam para o feed do Ao Vivo.
  perform cron.schedule(
    'limpar-entradas-antigas',
    '0 * * * *',
    $job$delete from public.live_page_entries where entered_at < now() - interval '7 days'$job$
  );
end $$;

-- ============================================================================
-- FUNÇÕES ÚTEIS
-- ============================================================================

-- Trigger para atualizar updated_at automaticamente
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Aplicar aos funnels
create trigger update_funnels_updated_at
  before update on public.funnels
  for each row execute function update_updated_at_column();

-- Aplicar aos profiles
create trigger update_profiles_updated_at
  before update on public.profiles
  for each row execute function update_updated_at_column();

-- Aplicar às credenciais
create trigger update_credentials_updated_at
  before update on public.api_credentials
  for each row execute function update_updated_at_column();

-- ============================================================================
-- MIGRAÇÕES POSTERIORES
-- ============================================================================
-- Instalação nova: rode também os arquivos de `supabase/migrations/` em ordem.
-- Eles são idempotentes e trazem o que veio depois deste schema base:
--   002_fontes_de_dados.sql — histórico salvo do rastreador e do Clarity,
--                             dedupe por event_id, preferência de fonte.

-- ============================================================================
-- STORAGE (executar separadamente no dashboard do Supabase)
-- ============================================================================

-- Bucket para screenshots (público para leitura)
-- Criar manualmente no dashboard: Storage > New Bucket
-- Nome: "screenshots"
-- Public: true

-- Depois, criar política de acesso:
-- create policy "Screenshots são públicos para leitura"
--   on storage.objects for select
--   using (bucket_id = 'screenshots');
--
-- create policy "Usuários autenticados podem fazer upload"
--   on storage.objects for insert
--   to authenticated
--   with check (bucket_id = 'screenshots');
