"""
Parser de Slugs UTM para extração estruturada de campanhas e criativos.

Extrai campos semânticos das slugs UTM que chegam via tracker.js,
sem dependência de API externa (Facebook, UTMify, etc.).

Padrão de slug suportado (exemplo real):
    UTM Source:   FBjLj6a9e0015237bed637147a9db
    UTM Medium:   1/2 | #0005 | 1-1-4 | 06.09 | #bm.16.ca.01 | #pg.04|120258446811650001
    UTM Campaign: 1/2 | #0005 | 1-1-4 | 06.09 | #bm.16.ca.01 | #pg.04|120258446811640001
    UTM Term:     Instagram_Reels
    UTM Content:  2 | 1/2 | #0005 | 1-1-4 | 06.09 | #bm.16.ca.01 | #pg.04|120258446811660001
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class ParsedUtm:
    """Campos extraídos de uma slug UTM."""

    creative_code: Optional[str] = None       # ex: "0005"
    campaign_code: Optional[str] = None       # ex: "#bm.16.ca.01"
    page_code: Optional[str] = None           # ex: "#pg.04"
    platform_ad_id: Optional[str] = None      # ex: "120258446811650001"
    placement: Optional[str] = None           # ex: "Instagram_Reels"
    sequence: Optional[str] = None            # ex: "1/2"
    version_date: Optional[str] = None        # ex: "06.09"
    raw_source: Optional[str] = None          # utm_source original
    raw_slug: str = ""                        # chave normalizada para dedup

    def to_campaign_key(self) -> str:
        """Gera chave única para auto-criação/dedup de campanha."""
        parts = [
            self.creative_code or "_",
            self.campaign_code or "_",
            self.page_code or "_",
            self.platform_ad_id or "_",
            self.placement or "_",
        ]
        return "|".join(parts)

    def is_empty(self) -> bool:
        """Retorna True se nenhum campo significativo foi extraído.

        placement só é considerado significativo se houver pelo menos um
        campo do padrão de slug (creative_code, campaign_code, etc.),
        pois utm_term pode conter qualquer valor genérico.
        """
        slug_fields = [
            self.creative_code,
            self.campaign_code,
            self.page_code,
            self.platform_ad_id,
        ]
        has_slug_pattern = any(slug_fields)

        if not has_slug_pattern:
            # Sem padrão de slug, considera vazio mesmo se placement existir
            return True

        # Com padrão de slug, placement também conta
        return not any(slug_fields + [self.placement])


# --- Regex patterns (compilados uma vez) ---

_RE_CREATIVE_CODE = re.compile(r"#(\d{4,})")
_RE_CAMPAIGN_CODE = re.compile(r"(#bm\.\d+\.\w+\.\d+)")
_RE_PAGE_CODE = re.compile(r"(#pg\.\d+)")
_RE_PLATFORM_AD_ID = re.compile(r"\|(\d{15,})")
_RE_SEQUENCE = re.compile(r"^(\d+/\d+)")
_RE_VERSION_DATE = re.compile(r"(\d{2}\.\d{2})")


def _extract_first(pattern: re.Pattern, *texts: Optional[str]) -> Optional[str]:
    """Retorna o primeiro match encontrado em qualquer dos textos fornecidos."""
    for text in texts:
        if not text:
            continue
        m = pattern.search(text)
        if m:
            return m.group(1)
    return None


def parse_utm_slug(utm_dict: Optional[dict]) -> ParsedUtm:
    """
    Extrai campos estruturados de um dicionário UTM.

    Args:
        utm_dict: Dicionário com chaves utm_source, utm_medium, utm_campaign,
                  utm_term, utm_content. Pode ser None ou vazio.

    Returns:
        ParsedUtm com os campos extraídos. Se utm_dict for None/vazio,
        retorna ParsedUtm vazio.
    """
    if not utm_dict:
        return ParsedUtm()

    source = utm_dict.get("utm_source") or utm_dict.get("source")
    medium = utm_dict.get("utm_medium") or utm_dict.get("medium")
    campaign = utm_dict.get("utm_campaign") or utm_dict.get("campaign")
    term = utm_dict.get("utm_term") or utm_dict.get("term")
    content = utm_dict.get("utm_content") or utm_dict.get("content")

    # Busca em todos os campos onde o padrão pode aparecer
    searchable = (medium, campaign, content)

    creative_code = _extract_first(_RE_CREATIVE_CODE, *searchable)
    campaign_code = _extract_first(_RE_CAMPAIGN_CODE, *searchable)
    page_code = _extract_first(_RE_PAGE_CODE, *searchable)
    platform_ad_id = _extract_first(_RE_PLATFORM_AD_ID, *searchable)
    version_date = _extract_first(_RE_VERSION_DATE, *searchable)

    # Sequence geralmente está no início do medium/campaign/content
    sequence = _extract_first(_RE_SEQUENCE, medium, campaign, content)

    # Placement vem direto do utm_term
    placement = term.strip() if term and term.strip() else None

    # Raw slug normalizada para dedup
    raw_parts = [
        source or "",
        medium or "",
        campaign or "",
        term or "",
        content or "",
    ]
    raw_slug = "|".join(p.strip().lower() for p in raw_parts)

    return ParsedUtm(
        creative_code=creative_code,
        campaign_code=campaign_code,
        page_code=page_code,
        platform_ad_id=platform_ad_id,
        placement=placement,
        sequence=sequence,
        version_date=version_date,
        raw_source=source,
        raw_slug=raw_slug,
    )