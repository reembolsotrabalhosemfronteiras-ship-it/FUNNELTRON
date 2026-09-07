-- Migration 013: Tabela parsed_campaigns + função de auto-criação por slug UTM
-- Objetivo: Cada combinação única de slug UTM detectada no tráfego gera
-- automaticamente um registro nesta tabela, sem dependência de API externa.

CREATE TABLE IF NOT EXISTS public.parsed_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
    slug_key TEXT NOT NULL,
    creative_code TEXT,
    campaign_code TEXT,
    page_code TEXT,
    platform_ad_id TEXT,
    placement TEXT,
    sequence TEXT,
    version_date TEXT,
    raw_source TEXT,
    raw_slug TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_count INT NOT NULL DEFAULT 1,
    quiz_response_count INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_parsed_campaigns_slug_key UNIQUE (slug_key)
);

-- Índice para buscas rápidas por workspace e campos filtráveis
CREATE INDEX IF NOT EXISTS idx_parsed_campaigns_workspace ON public.parsed_campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_parsed_campaigns_creative ON public.parsed_campaigns(creative_code) WHERE creative_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parsed_campaigns_campaign ON public.parsed_campaigns(campaign_code) WHERE campaign_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parsed_campaigns_placement ON public.parsed_campaigns(placement) WHERE placement IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parsed_campaigns_last_seen ON public.parsed_campaigns(last_seen_at DESC);

-- Função atômica de upsert: resolve campanha existente ou cria nova
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
    p_workspace_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_id UUID;
BEGIN
    -- Tenta encontrar campanha existente pela slug_key
    SELECT id INTO v_id
    FROM public.parsed_campaigns
    WHERE slug_key = p_slug_key
    LIMIT 1;

    IF v_id IS NOT NULL THEN
        -- Atualiza last_seen_at e incrementa session_count
        UPDATE public.parsed_campaigns
        SET last_seen_at = now(),
            session_count = session_count + 1
        WHERE id = v_id;
        RETURN v_id;
    END IF;

    -- Cria nova campanha
    INSERT INTO public.parsed_campaigns (
        workspace_id, slug_key, creative_code, campaign_code,
        page_code, platform_ad_id, placement, sequence,
        version_date, raw_source, raw_slug
    ) VALUES (
        p_workspace_id, p_slug_key, p_creative_code, p_campaign_code,
        p_page_code, p_platform_ad_id, p_placement, p_sequence,
        p_version_date, p_raw_source, p_raw_slug
    )
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- RLS: membros do workspace podem ler, apenas sistema pode inserir/atualizar
ALTER TABLE public.parsed_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "WS: lê parsed_campaigns"
    ON public.parsed_campaigns FOR SELECT
    USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Sistema: insere parsed_campaigns"
    ON public.parsed_campaigns FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Sistema: atualiza parsed_campaigns"
    ON public.parsed_campaigns FOR UPDATE
    USING (true)
    WITH CHECK (true);