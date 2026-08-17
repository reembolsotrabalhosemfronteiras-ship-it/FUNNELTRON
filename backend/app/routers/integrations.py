"""Router de integrações (VTurb, Clarity)"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client
from ..services.vturb import vturb_service
from ..services.clarity import clarity_service
from supabase import Client

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
    supabase: Client = Depends(get_db)
):
    """
    Busca todas as credenciais do usuário.
    Tokens são mascarados para não expor no frontend.
    """
    try:
        result = supabase.table("api_credentials").select(
            "id, provider, rate_limit_tier, account_id, created_at, updated_at"
        ).eq("user_id", current_user.id).execute()

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
    supabase: Client = Depends(get_db)
):
    """Salva ou atualiza credenciais de integração"""
    try:
        # Verifica se já existe
        existing = supabase.table("api_credentials").select("id").eq(
            "user_id", current_user.id
        ).eq("provider", credentials.provider).execute()

        data = {
            "user_id": current_user.id,
            "provider": credentials.provider,
            "api_token": credentials.api_token,
            "api_version": credentials.api_version,
            "account_id": credentials.account_id,
            "rate_limit_tier": credentials.rate_limit_tier,
            "extra_config": credentials.extra_config
        }

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
    current_user = Depends(get_current_user)
):
    """Testa conexão com a API da integração"""
    try:
        if request.provider == "vturb":
            # Testa buscando quota
            result = await vturb_service.get_quota_usage(current_user.id)

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
            return await clarity_service.test_token(current_user.id)

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
