-- ============================================================================
-- 004 — Player ID do VTurb por etapa VSL
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).
--
-- Sem isso não há como o proxy do VTurb (`GET /api/live/vsl`) saber qual
-- player consultar para cada etapa do tipo 'vsl' — o endpoint vinha
-- devolvendo um placeholder fixo em zero para todas elas.
alter table public.funnel_steps
  add column if not exists player_id text;
