-- 008 — Geolocalização dos visitantes ao vivo (mapa do Brasil no Ao Vivo).
--
-- A cidade/UF/lat/lon vêm do IP do heartbeat, resolvidos no backend (nunca no
-- snippet) e gravados uma vez por sessão. Sem isso o card "De onde estão
-- acessando agora" não tem o que mostrar.

alter table public.live_beats
  add column if not exists geo_city text,
  add column if not exists geo_uf   text,
  add column if not exists geo_lat  double precision,
  add column if not exists geo_lon  double precision;

-- O mapa agrupa por cidade entre os beats ativos; este índice cobre esse filtro.
create index if not exists live_beats_geo_idx
  on public.live_beats (funnel_id, last_seen desc)
  where geo_lat is not null;
