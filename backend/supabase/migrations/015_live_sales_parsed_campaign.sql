-- Migration 015: Adiciona parsed_campaign_id em live_sales
-- Vincula cada venda à campanha detectada por parsing de slug UTM,
-- permitindo atribuição de receita por creative_code/campaign_code/placement.

ALTER TABLE public.live_sales
ADD COLUMN IF NOT EXISTS parsed_campaign_id UUID REFERENCES public.parsed_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_live_sales_parsed_campaign
    ON public.live_sales(parsed_campaign_id)
    WHERE parsed_campaign_id IS NOT NULL;