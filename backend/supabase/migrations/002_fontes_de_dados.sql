-- ============================================================================
-- 002 — Fontes de dados: histórico salvo do rastreador e do Clarity
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).
--
-- As duas fontes ficam em tabelas SEPARADAS de propósito. Elas não medem a
-- mesma coisa: o Clarity entrega agregado por dia, com atraso de publicação;
-- o rastreador entrega evento por sessão, agora. Guardar as duas na mesma
-- tabela convidaria a somá-las, e a soma conta a mesma pessoa duas vezes com
-- duas definições diferentes de "sessão".

-- ---------------------------------------------------------------------------
-- Dedupe do rastreador
-- ---------------------------------------------------------------------------
-- O navegador reenvia o mesmo beat (retry de rede, sendBeacon no fechamento da
-- aba). Sem chave de evento, cada reenvio virava uma entrada em página nova e
-- inflava o funil.
alter table public.live_page_entries
  add column if not exists event_id text;

-- Índice TOTAL, não parcial. Índice parcial não serve de alvo para ON CONFLICT
-- (42P10) — foi o que quebrou o webhook de vendas antes. Aqui não precisa ser
-- parcial: no Postgres NULLs nunca colidem entre si, então as linhas antigas
-- (sem event_id) convivem com o índice sem problema.
create unique index if not exists live_page_entries_event_id_key
  on public.live_page_entries (event_id);

-- ---------------------------------------------------------------------------
-- Histórico do NOSSO rastreador
-- ---------------------------------------------------------------------------
-- live_beats é só o "agora" (uma linha por sessão, sobrescrita, apagada aos
-- 90s). Para consultar depois é preciso fechar o período num snapshot.
create table if not exists public.tracker_snapshots (
  id uuid primary key default uuid_generate_v4(),
  funnel_id uuid references public.funnels on delete cascade not null,
  bucket text not null check (bucket in ('hour', 'day')),
  period_start timestamptz not null,
  payload jsonb not null,
  captured_at timestamptz not null default now(),
  unique (funnel_id, bucket, period_start)
);

create index if not exists tracker_snapshots_funnel_idx
  on public.tracker_snapshots (funnel_id, period_start desc);

alter table public.tracker_snapshots enable row level security;

drop policy if exists "Sistema grava snapshots do rastreador" on public.tracker_snapshots;
create policy "Sistema grava snapshots do rastreador"
  on public.tracker_snapshots for insert
  with check (true);

drop policy if exists "Dono lê snapshots do próprio funil" on public.tracker_snapshots;
create policy "Dono lê snapshots do próprio funil"
  on public.tracker_snapshots for select
  using (exists (
    select 1 from public.funnels
     where funnels.id = tracker_snapshots.funnel_id
       and funnels.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- Histórico do CLARITY
-- ---------------------------------------------------------------------------
-- Uma linha por (projeto, página, período, dia). Reimportar SUBSTITUI a linha
-- em vez de somar: rodar o import duas vezes no mesmo dia dobraria o número.
--
-- page_url é `not null default ''` (e não nullable) para que a chave única
-- seja de colunas simples. Chave com coalesce() vira índice de expressão, e o
-- PostgREST só aceita nome de coluna em on_conflict.
create table if not exists public.clarity_snapshots (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  project_id text not null,
  funnel_id uuid references public.funnels on delete cascade,
  page_url text not null default '',
  period text not null,
  date date not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  unique (project_id, page_url, period, date)
);

create index if not exists clarity_snapshots_lookup_idx
  on public.clarity_snapshots (user_id, funnel_id, fetched_at desc);

alter table public.clarity_snapshots enable row level security;

drop policy if exists "Usuários gerenciam próprios snapshots do Clarity" on public.clarity_snapshots;
create policy "Usuários gerenciam próprios snapshots do Clarity"
  on public.clarity_snapshots for all
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Preferência de fonte por usuário
-- ---------------------------------------------------------------------------
create table if not exists public.user_preferences (
  user_id uuid references auth.users on delete cascade primary key,
  data_source text not null default 'tracker'
    check (data_source in ('tracker', 'clarity', 'compare')),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;

drop policy if exists "Usuários gerenciam próprias preferências" on public.user_preferences;
create policy "Usuários gerenciam próprias preferências"
  on public.user_preferences for all
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Faxina (só roda se pg_cron existir)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron não instalado — agendamentos pulados.';
    return;
  end if;

  -- Fecha a hora corrente dos beats num snapshot consultável.
  perform cron.schedule(
    'snapshot-tracker-hora',
    '5 * * * *',
    $job$
      insert into public.tracker_snapshots (funnel_id, bucket, period_start, payload)
      select
        funnel_id,
        'hour',
        date_trunc('hour', now() - interval '1 hour'),
        jsonb_build_object(
          'visitors', count(distinct session_id),
          'pageEntries', count(*)
        )
      from public.live_page_entries
      where entered_at >= date_trunc('hour', now() - interval '1 hour')
        and entered_at <  date_trunc('hour', now())
      group by funnel_id
      on conflict (funnel_id, bucket, period_start) do update
        set payload = excluded.payload, captured_at = now()
    $job$
  );

  -- Snapshots do rastreador: 90 dias bastam.
  perform cron.schedule(
    'limpar-tracker-snapshots',
    '30 3 * * *',
    $job$delete from public.tracker_snapshots where period_start < now() - interval '90 days'$job$
  );
end $$;
