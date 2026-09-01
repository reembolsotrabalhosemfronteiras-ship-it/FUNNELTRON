"""Router de layout (steps + edges)"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client
from ..core.workspace import get_active_workspace, funnel_guard
from supabase import Client

router = APIRouter(prefix="/funnels", tags=["layout"])


class StepData(BaseModel):
    id: str
    label: str
    url: str
    type: str
    position_x: float
    position_y: float
    parent_step_id: Optional[str] = None
    order_index: int = 0
    screenshot_url: Optional[str] = None
    status: Optional[str] = None
    sub_funnel_id: Optional[str] = None
    player_id: Optional[str] = None


class EdgeData(BaseModel):
    id: str
    source_step_id: str
    target_step_id: str
    condition: str = "default"
    label: Optional[str] = None


class LayoutSaveRequest(BaseModel):
    steps: List[StepData]
    edges: List[EdgeData]
    status: Optional[str] = None
    conversion_goal_step_id: Optional[str] = None


@router.get("/{funnel_id}/steps")
def get_steps(
    funnel_id: str,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Busca todas as etapas de um funil"""
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        result = supabase.table("funnel_steps").select("*").eq(
            "funnel_id", funnel_id
        ).order("order_index").execute()

        return result.data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar etapas: {str(e)}"
        )


@router.get("/{funnel_id}/edges")
def get_edges(
    funnel_id: str,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Busca todas as conexões de um funil"""
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        result = supabase.table("funnel_edges").select("*").eq(
            "funnel_id", funnel_id
        ).execute()

        return result.data

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao buscar conexões: {str(e)}"
        )


def _assert_owner(funnel_id: str, current_user, supabase: Client, ws_id=None):
    """404 se o funil não existe OU não é do workspace ativo — a mesma resposta
    nos dois casos, de propósito: distinguir revelaria a existência do alheio."""
    funnel_guard(supabase, funnel_id, ws_id, current_user.id)


@router.post("/{funnel_id}/steps", status_code=status.HTTP_201_CREATED)
async def create_step(
    funnel_id: str,
    step: StepData,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Cria (ou atualiza, se o id já existir) UMA etapa.

    O `PUT /layout` salva o desenho inteiro de uma vez — é o que o ateliê usa ao
    apertar salvar. Este aqui é para a etapa avulsa, criada pela paleta, sem
    reescrever o funil todo.
    """
    try:
        _assert_owner(funnel_id, current_user, supabase, ws_id)

        payload = step.model_dump(exclude_none=True)
        payload["funnel_id"] = funnel_id

        result = supabase.table("funnel_steps").upsert(
            payload, on_conflict="id"
        ).execute()

        return result.data[0] if result.data else payload

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar etapa: {str(e)}"
        )


@router.post("/{funnel_id}/edges", status_code=status.HTTP_201_CREATED)
async def create_edge(
    funnel_id: str,
    edge: EdgeData,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Cria (ou atualiza) UMA conexão entre duas etapas."""
    try:
        _assert_owner(funnel_id, current_user, supabase, ws_id)

        payload = edge.model_dump(exclude_none=True)
        payload["funnel_id"] = funnel_id

        result = supabase.table("funnel_edges").upsert(
            payload, on_conflict="id"
        ).execute()

        return result.data[0] if result.data else payload

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar conexão: {str(e)}"
        )


@router.put("/{funnel_id}/layout")
def save_layout(
    funnel_id: str,
    layout: LayoutSaveRequest,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """
    Salva o layout completo do funil (substitui tudo).
    Endpoint usado pelo botão Salvar do ateliê.
    """
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # 1. Deleta todas as etapas e edges atuais (cascade vai deletar edges)
        supabase.table("funnel_steps").delete().eq("funnel_id", funnel_id).execute()

        # 2. Insere novas etapas
        if layout.steps:
            steps_to_insert = [
                {
                    "id": step.id,
                    "funnel_id": funnel_id,
                    "label": step.label,
                    "url": step.url,
                    "type": step.type,
                    "position_x": step.position_x,
                    "position_y": step.position_y,
                    "parent_step_id": step.parent_step_id,
                    "order_index": step.order_index,
                    "screenshot_url": step.screenshot_url,
                    "status": step.status,
                    "sub_funnel_id": step.sub_funnel_id,
                    "player_id": step.player_id
                }
                for step in layout.steps
            ]
            supabase.table("funnel_steps").insert(steps_to_insert).execute()

        # 3. Insere novas edges
        if layout.edges:
            edges_to_insert = [
                {
                    "id": edge.id,
                    "funnel_id": funnel_id,
                    "source_step_id": edge.source_step_id,
                    "target_step_id": edge.target_step_id,
                    "condition": edge.condition,
                    "label": edge.label
                }
                for edge in layout.edges
            ]
            supabase.table("funnel_edges").insert(edges_to_insert).execute()

        # 4. Atualiza status e conversion_goal_step_id do funil se fornecidos
        update_data = {}
        if layout.status:
            update_data["status"] = layout.status
        if layout.conversion_goal_step_id:
            update_data["conversion_goal_step_id"] = layout.conversion_goal_step_id

        if update_data:
            supabase.table("funnels").update(update_data).eq("id", funnel_id).execute()

        return {"savedAt": datetime.utcnow().isoformat()}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao salvar layout: {str(e)}"
        )


@router.delete("/{funnel_id}/layout", status_code=status.HTTP_204_NO_CONTENT)
def clear_layout(
    funnel_id: str,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Limpa todo o layout do funil (deleta steps e edges)"""
    try:
        funnel_guard(supabase, funnel_id, ws_id, current_user.id)

        # Deleta todas as etapas (cascade vai deletar edges)
        supabase.table("funnel_steps").delete().eq("funnel_id", funnel_id).execute()

        return None

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao limpar layout: {str(e)}"
        )
