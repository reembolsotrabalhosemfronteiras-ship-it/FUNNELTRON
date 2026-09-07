"""Router de funis"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client
from ..core.workspace import get_active_workspace, scope

# Trechos que o PostgREST devolve quando o insert bate na unique constraint
# de (workspace_id, slug) — traduzidos para 409 em vez de 500/400 genérico.
_UNIQUE_VIOLATION_MARKERS = ("23505", "duplicate key", "already exists", "unique constraint")
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
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Lista os funis do workspace ativo, com filtro opcional por status"""
    try:
        query = scope(supabase.table("funnels").select("*"), ws_id, current_user.id)

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
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Busca um funil específico"""
    try:
        result = scope(
            supabase.table("funnels").select("*").eq("id", funnel_id),
            ws_id, current_user.id,
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
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Cria um novo funil no workspace ativo"""
    try:
        # Slug único por escopo: é ele que resolve GET /funnel/{slug}. Sem esta
        # checagem, um slug repetido ou estoura 500 genérico (se o DB tem a
        # unique constraint) ou cria um duplicado que quebra a busca por slug.
        existing = scope(
            supabase.table("funnels").select("id").eq("slug", funnel.slug),
            ws_id, current_user.id,
        ).execute()
        if existing.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Já existe um funil com o slug '{funnel.slug}' neste workspace.",
            )

        row = {
            "user_id": current_user.id,
            "name": funnel.name,
            "slug": funnel.slug,
            "status": funnel.status,
            "base_url": funnel.base_url,
            "kind": funnel.kind,
        }
        if ws_id:
            row["workspace_id"] = ws_id
        result = supabase.table("funnels").insert(row).execute()

        return result.data[0]

    except HTTPException:
        raise
    except Exception as e:
        message = str(e)
        # Corrida: outra requisição criou o mesmo slug entre a checagem e o
        # insert, e o DB barrou na unique constraint. Também é 409.
        if any(marker in message.lower() for marker in _UNIQUE_VIOLATION_MARKERS):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Já existe um funil com o slug '{funnel.slug}' neste workspace.",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Erro ao criar funil: {message}"
        )


@router.put("/{funnel_id}")
def update_funnel(
    funnel_id: str,
    funnel: FunnelUpdate,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Atualiza um funil"""
    try:
        # Verifica se o funil existe e é do workspace ativo
        existing = scope(
            supabase.table("funnels").select("id").eq("id", funnel_id),
            ws_id, current_user.id,
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
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Atualiza apenas o status do funil"""
    try:
        if "status" not in status_update:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Campo 'status' é obrigatório"
            )

        result = scope(
            supabase.table("funnels").update({"status": status_update["status"]}).eq("id", funnel_id),
            ws_id, current_user.id,
        ).execute()

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
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Deleta um funil"""
    try:
        result = scope(
            supabase.table("funnels").delete().eq("id", funnel_id),
            ws_id, current_user.id,
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
