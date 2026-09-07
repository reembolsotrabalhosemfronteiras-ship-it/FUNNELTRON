-- Migration 014: Adiciona parsed_campaign_id em lead_profiles
-- Vincula cada sessão à campanha detectada automaticamente por parsing de slug UTM

ALTER TABLE public.lead_profiles
ADD COLUMN IF NOT EXISTS parsed_campaign_id UUID REFERENCES public.parsed_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_profiles_parsed_campaign
    ON public.lead_profiles(parsed_campaign_id)
    WHERE parsed_campaign_id IS NOT NULL;