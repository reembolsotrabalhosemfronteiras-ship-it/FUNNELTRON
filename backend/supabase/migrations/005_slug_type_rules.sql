-- ============================================================================
-- 005 — Regras de tipo de página por slug (editável em Configurações)
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).
--
-- Antes, o palpite de tipo (VSL, checkout, etc.) na importação por lista de
-- URLs era fixo no código do frontend. Agora vira uma lista por usuário,
-- editável — `null` significa "ainda não personalizou", e a tela usa os
-- padrões embutidos (`DEFAULT_SLUG_RULES` no frontend) nesse caso.
alter table public.user_preferences
  add column if not exists slug_type_rules jsonb;
