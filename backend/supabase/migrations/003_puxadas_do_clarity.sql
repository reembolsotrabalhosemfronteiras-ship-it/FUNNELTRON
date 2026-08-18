-- ============================================================================
-- 003 — Registro das puxadas do Clarity
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).
--
-- Por que uma tabela separada de clarity_snapshots: o snapshot é deduplicado
-- por (project_id, page_url, period, date) — reimportar o mesmo dia SUBSTITUI
-- a linha, de propósito, senão o número dobraria na leitura. Isso significa
-- que os snapshots não contam quantas vezes o Clarity foi consultado, e é
-- justamente isso que importa aqui: são 10 consultas por projeto por DIA.
--
-- Este log é append-only e guarda também as puxadas que FALHARAM. Uma tentativa
-- com token vencido gasta cota igual; se só o sucesso fosse registrado, a conta
-- do dia ficaria menor que a real e o usuário levaria um 429 sem entender.
create table if not exists public.clarity_pulls (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users on delete cascade not null,
  funnel_id uuid references public.funnels on delete set null,
  period text not null,
  -- Dias que a resposta REALMENTE cobriu (teto de 3 do Clarity), não os pedidos.
  days int,
  ok boolean not null,
  message text,
  -- Sessões do resultado, para o registro dizer o que veio sem abrir o payload.
  sessions int,
  created_at timestamptz not null default now()
);

create index if not exists clarity_pulls_lookup_idx
  on public.clarity_pulls (user_id, created_at desc);

alter table public.clarity_pulls enable row level security;

drop policy if exists "Usuários gerenciam próprias puxadas do Clarity" on public.clarity_pulls;
create policy "Usuários gerenciam próprias puxadas do Clarity"
  on public.clarity_pulls for all
  using (auth.uid() = user_id);
