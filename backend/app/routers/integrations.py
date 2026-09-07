"""Router de integrações (VTurb, Clarity, UTMfy)"""
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client, get_supabase_admin
from ..core.workspace import get_active_workspace
from ..services.vturb import vturb_service
from ..services.clarity import clarity_service
from supabase import Client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integrations", tags=["integrations"])


class CredentialsRequest(BaseModel):
    provider: str  # "vturb" ou "clarity"
    api_token: str
    api_version: Optional[str] = None
    account_id: Optional[str] = None
    rate_limit_tier: Optional[str] = "basic"
    extra_config: Optional[dict] = None


class TestConnectionRequest(BaseModel):
    provider: str


@router.get("/credentials")
def get_credentials(
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Busca todas as credenciais do usuário/workspace.
    Tokens são mascarados para não expor no frontend.
    """
    try:
        query = supabase.table("api_credentials").select(
            "id, provider, rate_limit_tier, account_id, created_at, updated_at, workspace_id"
        ).eq("user_id", current_user.id)

        if ws_id:
            query = query.eq("workspace_id", ws_id)
        else:
            query = query.or_(f"workspace_id.is.null,user_id.eq.{current_user.id}")

        result = query.execute()

        # Adiciona flag de "configurado" sem expor o token
        credentials = {}
        for cred in result.data:
            credentials[cred["provider"]] = {
                "configured": True,
                "tier": cred.get("rate_limit_tier", "basic"),
                "account_id": cred.get("account_id"),
                "updated_at": cred.get("updated_at")
            }

        return credentials

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar credenciais: {str(e)}"
        )


@router.post("/credentials")
def save_credentials(
    credentials: CredentialsRequest,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Salva ou atualiza credenciais de integração"""
    try:
        # Verifica se já existe
        query = supabase.table("api_credentials").select("id").eq(
            "user_id", current_user.id
        ).eq("provider", credentials.provider)

        if ws_id:
            query = query.eq("workspace_id", ws_id)
        else:
            query = query.or_(f"workspace_id.is.null,user_id.eq.{current_user.id}")

        existing = query.execute()

        data = {
            "user_id": current_user.id,
            "provider": credentials.provider,
            "api_token": credentials.api_token,
            "api_version": credentials.api_version,
            "account_id": credentials.account_id,
            "rate_limit_tier": credentials.rate_limit_tier,
            "extra_config": credentials.extra_config
        }

        if ws_id:
            data["workspace_id"] = ws_id

        if existing.data:
            # Update
            result = supabase.table("api_credentials").update(data).eq(
                "id", existing.data[0]["id"]
            ).execute()
        else:
            # Insert
            result = supabase.table("api_credentials").insert(data).execute()

        return {"message": "Credenciais salvas com sucesso"}

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar credenciais: {str(e)}"
        )


@router.post("/test")
async def test_connection(
    request: TestConnectionRequest,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace)
):
    """Testa conexão com a API da integração"""
    try:
        if request.provider == "vturb":
            # Testa buscando quota
            result = await vturb_service.get_quota_usage(current_user.id, ws_id)

            if result.get("error"):
                return {
                    "ok": False,
                    "message": result.get("message", "Erro ao conectar com VTurb")
                }

            return {
                "ok": True,
                "message": "Conexão com VTurb estabelecida com sucesso!",
                "quota": result
            }

        elif request.provider == "clarity":
            # Chama a API de verdade. Confirmar que existe uma linha no banco
            # não prova nada: token errado ou expirado passaria no teste e só
            # falharia depois, na tela de Métricas.
            return await clarity_service.test_token(current_user.id, ws_id)

        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Provider '{request.provider}' não suportado"
            )

    except Exception as e:
        return {
            "ok": False,
            "message": f"Erro ao testar conexão: {str(e)}"
        }


# ============================================================================
# UTMfy Sync
# ============================================================================

UTMFY_TOKEN = "pack2TGy7k93DTB0Vq8DNthlZXydS1tztvpq"
UTMFY_API_BASE = "https://api.utmfy.com/v1"


class UTMfySyncRequest(BaseModel):
    workspace_id: Optional[str] = None
    since: Optional[str] = None  # ISO date, ex: "2026-01-01"


@router.post("/utmfy/sync")
async def sync_utmfy(
    request: UTMfySyncRequest,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Sincroniza anúncios/campanhas do UTMfy para ad_campaigns.
    Usa token fixo configurado no backend.
    """
    try:
        target_ws = request.workspace_id or ws_id
        if not target_ws:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workspace não informado. Selecione um workspace ou passe workspace_id."
            )

        # Verifica se o usuário tem acesso ao workspace
        admin = get_supabase_admin()
        ws_check = admin.table("workspace_members").select("workspace_id").eq(
            "user_id", current_user.id
        ).eq("workspace_id", target_ws).execute()
        if not ws_check.data:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Sem acesso a este workspace"
            )

        # Busca ads do UTMfy
        params = {}
        if request.since:
            params["since"] = request.since
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {"Authorization": f"Bearer {UTMFY_TOKEN}"}
            response = await client.get(f"{UTMFY_API_BASE}/ads", headers=headers, params=params)
            
            if response.status_code == 401:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Token UTMfy inválido ou expirado"
                )
            if response.status_code == 429:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Rate limit do UTMfy atingido. Tente novamente mais tarde."
                )
            response.raise_for_status()
            data = response.json()

        ads = data.get("data", data) if isinstance(data, dict) else data
        if not isinstance(ads, list):
            ads = [ads] if ads else []

        saved = 0
        for ad in ads:
            # Extrai campos do UTMfy (ajustar conforme API real)
            ad_id = ad.get("id") or ad.get("ad_id") or ad.get("adId")
            if not ad_id:
                continue
                
            campaign_id = ad.get("campaign_id") or ad.get("campaignId")
            ad_name = ad.get("name") or ad.get("ad_name") or ad.get("adName")
            channel = ad.get("channel") or ad.get("source") or ad.get("platform")
            
            # Audience data
            audience = ad.get("audience") or ad.get("targeting") or {}
            audience_json = {
                "idade": audience.get("age") or audience.get("idade"),
                "genero": audience.get("gender") or audience.get("genero"),
                "localizacao": audience.get("location") or audience.get("localizacao"),
                "interesses": audience.get("interests") or audience.get("interesses"),
                "dispositivo": audience.get("device") or audience.get("dispositivo"),
                "horario_pico": audience.get("peak_hours") or audience.get("horario_pico"),
            }
            # Remove None values
            audience_json = {k: v for k, v in audience_json.items() if v is not None}
            
            # UTM params
            utm_json = {
                "utm_source": ad.get("utm_source") or ad.get("source"),
                "utm_medium": ad.get("utm_medium") or ad.get("medium"),
                "utm_campaign": ad.get("utm_campaign") or ad.get("campaign"),
                "utm_content": ad.get("utm_content") or ad.get("content"),
                "utm_term": ad.get("utm_term") or ad.get("term"),
            }
            utm_json = {k: v for k, v in utm_json.items() if v is not None}

            # Metrics
            spend = float(ad.get("spend") or ad.get("amount_spent") or 0)
            impressions = int(ad.get("impressions") or ad.get("impr") or 0)
            clicks = int(ad.get("clicks") or ad.get("clks") or 0)
            conversions = int(ad.get("conversions") or ad.get("conv") or 0)
            
            ctr = (clicks / impressions * 100) if impressions > 0 else 0
            cpc = (spend / clicks) if clicks > 0 else 0
            cpm = (spend / impressions * 1000) if impressions > 0 else 0
            roas = (conversions / spend) if spend > 0 else 0

            # Upsert
            row = {
                "workspace_id": target_ws,
                "ad_id": str(ad_id),
                "campaign_id": str(campaign_id) if campaign_id else None,
                "ad_name": ad_name,
                "channel": channel,
                "audience_json": audience_json or None,
                "utm_json": utm_json or None,
                "spend": spend,
                "impressions": impressions,
                "clicks": clicks,
                "conversions": conversions,
                "ctr": round(ctr, 4),
                "cpc": round(cpc, 2),
                "cpm": round(cpm, 2),
                "roas": round(roas, 4),
                "raw_data": ad,
                "synced_at": "now()",
            }
            
            admin.table("ad_campaigns").upsert(row, on_conflict="workspace_id,ad_id").execute()
            saved += 1

        return {
            "ok": True,
            "synced": saved,
            "message": f"{saved} anúncios sincronizados do UTMfy"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Erro ao sincronizar UTMfy")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao sincronizar UTMfy: {str(e)}"
        )


@router.get("/utmfy/campaigns")
def list_utmfy_campaigns(
    workspace_id: Optional[str] = None,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Lista campanhas/anúncios sincronizados do UTMfy."""
    try:
        target_ws = workspace_id or ws_id
        if not target_ws:
            return {"campaigns": []}

        admin = get_supabase_admin()
        result = admin.table("ad_campaigns").select("*").eq(
            "workspace_id", target_ws
        ).order("synced_at", desc=True).limit(200).execute()

        return {"campaigns": result.data or []}

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar campanhas UTMfy: {str(e)}"
        )
