"""Router de funis"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client
from supabase import Client

router = APIRouter(prefix="/funnels", tags=["funnels"])


class FunnelCreate(BaseModel):
    name: str
    slug: str
    status: str = "active"
    base_url: Optional[str] = None
    kind: str = "front"


class FunnelUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    status: Optional[str] = None
    base_url: Optional[str] = None
    kind: Optional[str] = None
    conversion_goal_step_id: Optional[str] = None


@router.get("")
def list_funnels(
    status: Optional[str] = None,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Lista todos os funis do usuário, com filtro opcional por status"""
    try:
        query = supabase.table("funnels").select("*").eq("user_id", current_user.id)

        if status:
            query = query.eq("status", status)

        result = query.order("created_at", desc=True).execute()

        return result.data

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar funis: {str(e)}"
        )


@router.get("/{funnel_id}")
def get_funnel(
    funnel_id: str,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Busca um funil específico"""
    try:
        result = supabase.table("funnels").select("*").eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar funil: {str(e)}"
        )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_funnel(
    funnel: FunnelCreate,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Cria um novo funil"""
    try:
        result = supabase.table("funnels").insert({
            "user_id": current_user.id,
            "name": funnel.name,
            "slug": funnel.slug,
            "status": funnel.status,
            "base_url": funnel.base_url,
            "kind": funnel.kind
        }).execute()

        return result.data[0]

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao criar funil: {str(e)}"
        )


@router.put("/{funnel_id}")
def update_funnel(
    funnel_id: str,
    funnel: FunnelUpdate,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Atualiza um funil"""
    try:
        # Verifica se o funil existe e pertence ao usuário
        existing = supabase.table("funnels").select("id").eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()

        if not existing.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        # Atualiza apenas campos enviados
        update_data = {k: v for k, v in funnel.model_dump().items() if v is not None}

        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Nenhum campo para atualizar"
            )

        result = supabase.table("funnels").update(update_data).eq("id", funnel_id).execute()

        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao atualizar funil: {str(e)}"
        )


@router.patch("/{funnel_id}")
def patch_funnel_status(
    funnel_id: str,
    status_update: dict,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Atualiza apenas o status do funil"""
    try:
        if "status" not in status_update:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Campo 'status' é obrigatório"
            )

        result = supabase.table("funnels").update({
            "status": status_update["status"]
        }).eq("id", funnel_id).eq("user_id", current_user.id).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        return {"message": "Status atualizado com sucesso"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao atualizar status: {str(e)}"
        )


@router.delete("/{funnel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_funnel(
    funnel_id: str,
    current_user = Depends(get_current_user),
    supabase: Client = Depends(get_db)
):
    """Deleta um funil"""
    try:
        result = supabase.table("funnels").delete().eq("id", funnel_id).eq(
            "user_id", current_user.id
        ).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Funil não encontrado"
            )

        return None

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao deletar funil: {str(e)}"
        )
