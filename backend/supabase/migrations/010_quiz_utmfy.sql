-- ============================================================================
-- 010 — Quiz Answers + UTMfy Integration
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).

-- ---------------------------------------------------------------------------
-- 1. Quiz Answers — respostas individuais de quiz
-- ---------------------------------------------------------------------------
create table if not exists public.quiz_answers (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  workspace_id uuid references public.workspaces on delete cascade,
  session_id text not null,
  device_id text,
  step_id uuid references public.funnel_steps on delete set null,
  question_id text not null,
  answer_id text not null,
  answer_value text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists quiz_answers_funnel_idx
  on public.quiz_answers (funnel_id, timestamp desc);
create index if not exists quiz_answers_session_idx
  on public.quiz_answers (session_id);
create index if not exists quiz_answers_question_idx
  on public.quiz_answers (funnel_id, question_id, answer_id);

alter table public.quiz_answers enable row level security;

drop policy if exists "Sistema grava quiz answers" on public.quiz_answers;
create policy "Sistema grava quiz answers"
  on public.quiz_answers for insert
  with check (true);

drop policy if exists "WS: vê quiz answers" on public.quiz_answers;
create policy "WS: vê quiz answers"
  on public.quiz_answers for select
  using (public.can_access_funnel(funnel_id));

-- ---------------------------------------------------------------------------
-- 2. Ad Campaigns — anúncios/campanhas do UTMfy
-- ---------------------------------------------------------------------------
create table if not exists public.ad_campaigns (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid references public.workspaces on delete cascade not null,
  ad_id text not null,
  campaign_id text,
  ad_name text,
  channel text,
  audience_json jsonb,
  utm_json jsonb,
  spend numeric(12,2) default 0,
  impressions int default 0,
  clicks int default 0,
  conversions int default 0,
  ctr numeric(5,4) default 0,
  cpc numeric(10,2) default 0,
  cpm numeric(10,2) default 0,
  roas numeric(5,4) default 0,
  raw_data jsonb,
  synced_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, ad_id)
);

create index if not exists ad_campaigns_workspace_idx
  on public.ad_campaigns (workspace_id, synced_at desc);

alter table public.ad_campaigns enable row level security;

drop policy if exists "WS: vê ad_campaigns" on public.ad_campaigns;
create policy "WS: vê ad_campaigns"
  on public.ad_campaigns for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "WS: gerencia ad_campaigns" on public.ad_campaigns;
create policy "WS: gerencia ad_campaigns"
  on public.ad_campaigns for all
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

-- Trigger para updated_at
create trigger update_ad_campaigns_updated_at
  before update on public.ad_campaigns
  for each row execute function update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 3. Lead Profiles — perfil consolidado do lead (quiz + UTM + ad)
-- ---------------------------------------------------------------------------
create table if not exists public.lead_profiles (
  id uuid primary key default uuid_generate_v4(),
  workspace_id uuid references public.workspaces on delete cascade not null,
  funnel_id uuid references public.funnels on delete cascade,
  session_id text not null,
  device_id text,
  quiz_answers_json jsonb not null default '[]'::jsonb,
  utm_json jsonb,
  ad_id text,
  campaign_id text,
  audience_json jsonb,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  converted boolean default false,
  conversion_value numeric(12,2) default 0,
  conversion_step_id uuid references public.funnel_steps on delete set null,
  unique (workspace_id, session_id)
);

create index if not exists lead_profiles_workspace_idx
  on public.lead_profiles (workspace_id, last_seen desc);
create index if not exists lead_profiles_funnel_idx
  on public.lead_profiles (funnel_id, last_seen desc);
create index if not exists lead_profiles_converted_idx
  on public.lead_profiles (converted, last_seen desc) where converted = true;

alter table public.lead_profiles enable row level security;

drop policy if exists "WS: vê lead_profiles" on public.lead_profiles;
create policy "WS: vê lead_profiles"
  on public.lead_profiles for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "Sistema gerencia lead_profiles" on public.lead_profiles;
create policy "Sistema gerencia lead_profiles"
  on public.lead_profiles for all
  with check (true);

-- Trigger para updated_at (last_seen)
create or replace function public.update_lead_profile_timestamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.last_seen = now();
  return new;
end;
$$;
create trigger update_lead_profile_timestamp
  before update on public.lead_profiles
  for each row execute function public.update_lead_profile_timestamp();

-- ---------------------------------------------------------------------------
-- 4. Colunas workspace_id nas tabelas existentes que precisam (trigger já existe)
-- ---------------------------------------------------------------------------
alter table public.quiz_answers
  add column if not exists workspace_id uuid references public.workspaces on delete cascade;

create index if not exists quiz_answers_workspace_idx
  on public.quiz_answers (workspace_id);

-- ---------------------------------------------------------------------------
-- 5. Faxina automática (pg_cron)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não instalado — agendamentos pulados.';
    return;
  end if;

  -- Quiz answers: 180 dias
  perform cron.schedule(
    'limpar-quiz-answers',
    '30 4 * * *',
    $job$delete from public.quiz_answers where created_at < now() - interval '180 days'$job$
  );

  -- Lead profiles: 365 dias (mantém histórico de leads)
  perform cron.schedule(
    'limpar-lead-profiles',
    '30 5 * * *',
    $job$delete from public.lead_profiles where last_seen < now() - interval '365 days'$job$
  );

  -- Ad campaigns: 90 dias sem sync remove (pode ter sido pausado)
  perform cron.schedule(
    'limpar-ad-campaigns-antigos',
    '0 6 * * *',
    $job$delete from public.ad_campaigns where synced_at < now() - interval '90 days'$job$
  );
end $$;