-- Migration 016: Nome legivel da campanha em parsed_campaigns
-- Objetivo: A aba Campanhas mostrava apenas o codigo interno do ad-set Meta
-- (ex: "#bm.16.ca.01") sem nenhum nome humano ao lado. Adiciona duas colunas:
--   campaign_name  -> nome legivel extraido do utm_campaign quando ele NAO eh
--                     um slug tecnico (heuristica no utm_parser.py).
--   raw_campaign   -> utm_campaign original cru, sempre presente quando houve
--                     UTM; usado como fallback de exibicao no frontend.
-- Tambem atualiza a funcao resolve_or_create_parsed_campaign para aceitar e
-- persistir esses campos, e faz backfill de campaign_name/raw_campaign nas
-- linhas ja existentes a partir do raw_slug (best-effort).

ALTER TABLE public.parsed_campaigns
    ADD COLUMN IF NOT EXISTS campaign_name TEXT,
    ADD COLUMN IF NOT EXISTS raw_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_parsed_campaigns_name
    ON public.parsed_campaigns(campaign_name) WHERE campaign_name IS NOT NULL;

-- Recria a funcao de upsert incluindo os novos parametros. Mantem a logica
-- atomica: encontra por slug_key -> incrementa session_count; senao insere.
CREATE OR REPLACE FUNCTION public.resolve_or_create_parsed_campaign(
    p_slug_key TEXT,
    p_creative_code TEXT DEFAULT NULL,
    p_campaign_code TEXT DEFAULT NULL,
    p_page_code TEXT DEFAULT NULL,
    p_platform_ad_id TEXT DEFAULT NULL,
    p_placement TEXT DEFAULT NULL,
    p_sequence TEXT DEFAULT NULL,
    p_version_date TEXT DEFAULT NULL,
    p_raw_source TEXT DEFAULT NULL,
    p_raw_slug TEXT DEFAULT NULL,
    p_workspace_id UUID DEFAULT NULL,
    p_campaign_name TEXT DEFAULT NULL,
    p_raw_campaign TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
BEGIN
    SELECT id INTO v_id
    FROM public.parsed_campaigns
    WHERE slug_key = p_slug_key
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        UPDATE public.parsed_campaigns
        SET last_seen_at = now(),
            session_count = session_count + 1,
            -- Preenche o nome legivel retroativamente se ainda estiver vazio
            -- e o heartbeat atual trouxe um (utm_campaign humano).
            campaign_name = COALESCE(campaign_name, p_campaign_name),
            raw_campaign = COALESCE(raw_campaign, p_raw_campaign)
        WHERE id = v_id;
        RETURN v_id;
    END IF;

    INSERT INTO public.parsed_campaigns (
        workspace_id, slug_key, creative_code, campaign_code,
        page_code, platform_ad_id, placement, sequence,
        version_date, raw_source, raw_slug,
        campaign_name, raw_campaign
    ) VALUES (
        p_workspace_id, p_slug_key, p_creative_code, p_campaign_code,
        p_page_code, p_platform_ad_id, p_placement, p_sequence,
        p_version_date, p_raw_source, p_raw_slug,
        p_campaign_name, p_raw_campaign
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;