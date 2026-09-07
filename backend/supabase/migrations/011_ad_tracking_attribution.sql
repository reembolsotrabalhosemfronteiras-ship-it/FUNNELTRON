-- ============================================================================
-- 011 — Ad Tracking + Attribution Model
-- ============================================================================
-- Rode no SQL Editor do Supabase. É idempotente (pode rodar duas vezes).
-- Expande o schema da migration 010 para suportar:
--   1. Campos de plataforma externa em ad_campaigns (Facebook Ads, etc.)
--   2. Atribuição dual (first_touch / last_touch) em lead_profiles
--   3. Modelo de atribuição configurável por workspace

-- ---------------------------------------------------------------------------
-- 1. ad_campaigns: campos de plataforma externa + índice GIN para UTM
-- ---------------------------------------------------------------------------
ALTER TABLE public.ad_campaigns ADD COLUMN IF NOT EXISTS platform_ad_id TEXT;
ALTER TABLE public.ad_campaigns ADD COLUMN IF NOT EXISTS platform_campaign_id TEXT;
ALTER TABLE public.ad_campaigns ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.ad_campaigns ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- Índice GIN para busca eficiente por campos dentro do utm_json
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_utm ON public.ad_campaigns USING GIN (utm_json);

-- Índice para lookup por platform_ad_id (sync upsert)
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_platform ON public.ad_campaigns (workspace_id, platform_ad_id) WHERE platform_ad_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. lead_profiles: atribuição dual + FKs explícitas
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_profiles ADD COLUMN IF NOT EXISTS first_utm_json JSONB;
ALTER TABLE public.lead_profiles ADD COLUMN IF NOT EXISTS last_utm_json JSONB;
ALTER TABLE public.lead_profiles ADD COLUMN IF NOT EXISTS attributed_ad_id UUID REFERENCES public.ad_campaigns(id);
ALTER TABLE public.lead_profiles ADD COLUMN IF NOT EXISTS attributed_campaign_id UUID REFERENCES public.ad_campaigns(id);

-- Índices para filtros no dashboard de análise por criativo
CREATE INDEX IF NOT EXISTS idx_lead_profiles_attributed_ad ON public.lead_profiles (attributed_ad_id) WHERE attributed_ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lead_profiles_attributed_campaign ON public.lead_profiles (attributed_campaign_id) WHERE attributed_campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. workspaces: modelo de atribuição configurável
-- ---------------------------------------------------------------------------
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS attribution_model TEXT DEFAULT 'first_touch'
  CHECK (attribution_model IN ('first_touch', 'last_touch'));

-- Comentário para documentação no schema
COMMENT ON COLUMN public.workspaces.attribution_model IS 'Modelo de atribuição de leads: first_touch (UTM da primeira página) ou last_touch (UTM da última página antes do quiz/conversão)';
COMMENT ON COLUMN public.lead_profiles.first_utm_json IS 'UTMs capturados na primeira página visitada na sessão (first-touch)';
COMMENT ON COLUMN public.lead_profiles.last_utm_json IS 'UTMs capturados na última página visitada antes da conversão/quiz (last-touch)';
COMMENT ON COLUMN public.lead_profiles.attributed_ad_id IS 'FK para ad_campaigns baseado no modelo de atribuição do workspace';
COMMENT ON COLUMN public.lead_profiles.attributed_campaign_id IS 'FK para ad_campaigns (campanha) baseado no modelo de atribuição do workspace';