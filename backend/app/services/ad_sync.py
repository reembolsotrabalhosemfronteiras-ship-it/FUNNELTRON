"""
Serviço de sincronização de anúncios/campanhas com fontes externas.

Fonte primária: UTMify (decisão 2.12 do PLANO.md).
Fallback: Facebook Marketing API (stub para implementação futura).

Uso:
    from app.services.ad_sync import sync_ads
    result = await sync_ads(supabase, workspace_id)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)


async def sync_ads(supabase: Client, workspace_id: str) -> dict[str, Any]:
    """
    Sincroniza campanhas/anúncios da UTMify para a tabela ad_campaigns.

    Retorna dict com stats: {"synced": int, "new": int, "updated": int, "errors": list}
    """
    stats = {"synced": 0, "new": 0, "updated": 0, "errors": []}

    try:
        # Busca credenciais da UTMify para este workspace
        creds = supabase.table("api_credentials").select("*").eq(
            "user_id", _get_workspace_owner(supabase, workspace_id)
        ).eq("provider", "utmfy").execute()

        if not creds.data:
            stats["errors"].append("Credenciais UTMify não configuradas")
            logger.warning("sync_ads: sem credenciais UTMify para workspace %s", workspace_id)
            return stats

        api_key = creds.data[0].get("api_key") or creds.data[0].get("token")
        if not api_key:
            stats["errors"].append("API key UTMify vazia")
            return stats

        # Chama endpoint da UTMify para listar campanhas/ads
        ads_data = await _fetch_utmfy_ads(api_key)

        if not ads_data:
            logger.info("sync_ads: nenhum dado retornado pela UTMify para workspace %s", workspace_id)
            return stats

        now = datetime.now(timezone.utc).isoformat()

        for ad in ads_data:
            try:
                platform_ad_id = str(ad.get("ad_id") or ad.get("id") or "")
                if not platform_ad_id:
                    continue

                utm_json = {
                    "utm_source": ad.get("utm_source") or ad.get("source"),
                    "utm_medium": ad.get("utm_medium") or ad.get("medium"),
                    "utm_campaign": ad.get("utm_campaign") or ad.get("campaign"),
                    "utm_content": ad.get("utm_content") or ad.get("content"),
                    "utm_term": ad.get("utm_term") or ad.get("term"),
                }
                # Remove None values
                utm_json = {k: v for k, v in utm_json.items() if v is not None}

                row = {
                    "workspace_id": workspace_id,
                    "platform_ad_id": platform_ad_id,
                    "platform_campaign_id": str(ad.get("campaign_id") or ""),
                    "ad_id": platform_ad_id,
                    "campaign_id": str(ad.get("campaign_id") or ad.get("campaign_name") or ""),
                    "ad_name": ad.get("ad_name") or ad.get("name") or "",
                    "channel": ad.get("channel") or ad.get("source") or "unknown",
                    "utm_json": utm_json if utm_json else None,
                    "audience_json": ad.get("audience") or ad.get("audience_json"),
                    "spend": float(ad.get("spend") or 0),
                    "impressions": int(ad.get("impressions") or 0),
                    "clicks": int(ad.get("clicks") or 0),
                    "conversions": int(ad.get("conversions") or 0),
                    "status": ad.get("status") or "active",
                    "raw_data": ad,
                    "last_synced_at": now,
                    "synced_at": now,
                }

                # Upsert por workspace_id + ad_id (unique constraint)
                existing = supabase.table("ad_campaigns").select("id").eq(
                    "workspace_id", workspace_id
                ).eq("ad_id", platform_ad_id).execute()

                if existing.data:
                    supabase.table("ad_campaigns").update(row).eq(
                        "workspace_id", workspace_id
                    ).eq("ad_id", platform_ad_id).execute()
                    stats["updated"] += 1
                else:
                    supabase.table("ad_campaigns").insert(row).execute()
                    stats["new"] += 1

                stats["synced"] += 1

            except Exception as e:
                error_msg = f"Erro ao processar ad {ad.get('ad_id', '?')}: {str(e)}"
                stats["errors"].append(error_msg)
                logger.exception(error_msg)

    except Exception as e:
        stats["errors"].append(f"Erro geral no sync: {str(e)}")
        logger.exception("sync_ads falhou para workspace %s", workspace_id)

    logger.info(
        "sync_ads completo para workspace %s: synced=%d new=%d updated=%d errors=%d",
        workspace_id, stats["synced"], stats["new"], stats["updated"], len(stats["errors"])
    )
    return stats


async def _fetch_utmfy_ads(api_key: str) -> list[dict]:
    """
    Busca campanhas/anúncios da Meta Marketing API (Facebook Ads).

    CONFIRMADO (2026-09-07): A UTMify NÃO tem API pública para leitura de
    campanhas/criativos — só aceita POST de vendas via webhook. A fonte
    primária de dados de ads é a Meta Marketing API.

    O api_key aqui é o Access Token da Meta (long-lived).
    Para obter: https://developers.facebook.com/tools/explorer/
    ou via Business Manager → System Users → Generate Token.

    Permissões necessárias: ads_read, business_management
    """
    import httpx

    # Meta Marketing API v21.0 — busca campanhas + adsets + ads do account
    # O api_key deve conter o access token da Meta
    # Formato esperado no campo api_key: "ACCESS_TOKEN|AD_ACCOUNT_ID"
    parts = api_key.split("|", 1)
    access_token = parts[0]
    ad_account_id = parts[1] if len(parts) > 1 else None

    if not ad_account_id:
        # Tenta buscar ad accounts do usuário
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(
                    "https://graph.facebook.com/v21.0/me/adaccounts",
                    params={"access_token": access_token, "fields": "id,name"},
                )
                resp.raise_for_status()
                accounts = resp.json().get("data", [])
                if accounts:
                    ad_account_id = accounts[0]["id"]
                else:
                    logger.warning("Nenhum ad account encontrado para este token")
                    return []
        except Exception as e:
            logger.error("Falha ao buscar ad accounts: %s", str(e))
            return []

    # Busca campanhas com seus ads
    url = f"https://graph.facebook.com/v21.0/{ad_account_id}/campaigns"
    params = {
        "access_token": access_token,
        "fields": "id,name,status,objective",
        "limit": 100,
    }

    all_ads = []
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            # 1. Busca campanhas
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            campaigns = resp.json().get("data", [])

            for campaign in campaigns:
                camp_id = campaign["id"]
                camp_name = campaign.get("name", "")

                # 2. Busca ads dentro de cada campanha
                ads_url = f"https://graph.facebook.com/v21.0/{camp_id}/ads"
                ads_params = {
                    "access_token": access_token,
                    "fields": "id,name,status,creative{effective_object_story_id},insights{impressions,clicks,spend,conversions,ctr,cpc,cpm,roas}",
                    "limit": 50,
                }
                try:
                    ads_resp = await client.get(ads_url, params=ads_params)
                    ads_resp.raise_for_status()
                    ads = ads_resp.json().get("data", [])

                    for ad in ads:
                        insights = (ad.get("insights") or {}).get("data", [{}])[0] if ad.get("insights") else {}
                        all_ads.append({
                            "ad_id": ad["id"],
                            "campaign_id": camp_id,
                            "ad_name": ad.get("name", ""),
                            "campaign_name": camp_name,
                            "channel": "meta_ads",
                            "status": ad.get("status", "ACTIVE").lower(),
                            "utm_source": "facebook",
                            "utm_medium": "cpc",
                            "utm_campaign": camp_name,
                            "utm_content": ad.get("name", ""),
                            "spend": float(insights.get("spend", 0)),
                            "impressions": int(insights.get("impressions", 0)),
                            "clicks": int(insights.get("clicks", 0)),
                            "conversions": int(insights.get("conversions", 0) or 0),
                            "ctr": float(insights.get("ctr", 0) or 0),
                            "cpc": float(insights.get("cpc", 0) or 0),
                            "cpm": float(insights.get("cpm", 0) or 0),
                            "roas": float(insights.get("roas", 0) or 0),
                        })
                except Exception as e:
                    logger.warning("Falha ao buscar ads da campanha %s: %s", camp_id, str(e))
                    continue

    except httpx.HTTPStatusError as e:
        logger.error("Meta API retornou erro %d: %s", e.response.status_code, e.response.text)
        raise
    except Exception as e:
        logger.error("Falha na chamada à Meta Marketing API: %s", str(e))
        raise

    logger.info("Meta API: encontradas %d campanhas, %d ads", len(campaigns), len(all_ads))
    return all_ads


def _get_workspace_owner(supabase: Client, workspace_id: str) -> str | None:
    """Retorna o owner_id de um workspace."""
    try:
        result = supabase.table("workspaces").select("owner_id").eq(
            "id", workspace_id
        ).execute()
        if result.data:
            return result.data[0].get("owner_id")
    except Exception:
        pass
    return None