"""Router de importações (UTMify)"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from ..core.auth import get_current_user, get_db
from ..core.supabase_client import get_supabase_client
from ..core.workspace import get_active_workspace, scope
from supabase import Client

router = APIRouter(prefix="/imports", tags=["imports"])


class SalesImportRequest(BaseModel):
    filename: str
    imported_at: str
    row_count: int
    date_range_start: Optional[str] = None
    date_range_end: Optional[str] = None
    detected_columns: dict
    raw_data: Optional[dict] = None


@router.get("")
def list_imports(
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Lista as importações do workspace ativo"""
    try:
        result = scope(
            supabase.table("sales_imports").select("*"), ws_id, current_user.id
        ).order("created_at", desc=True).execute()

        return result.data

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao listar importações: {str(e)}"
        )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_import(
    import_data: SalesImportRequest,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Cria um novo registro de importação no workspace ativo"""
    try:
        row = {
            "user_id": current_user.id,
            "filename": import_data.filename,
            "imported_at": import_data.imported_at,
            "row_count": import_data.row_count,
            "date_range_start": import_data.date_range_start,
            "date_range_end": import_data.date_range_end,
            "detected_columns": import_data.detected_columns,
            "raw_data": import_data.raw_data,
        }
        if ws_id:
            row["workspace_id"] = ws_id
        result = supabase.table("sales_imports").insert(row).execute()

        return result.data[0]

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao criar importação: {str(e)}"
        )


@router.delete("/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_import(
    import_id: str,
    current_user = Depends(get_current_user),
    ws_id: Optional[str] = Depends(get_active_workspace),
    supabase: Client = Depends(get_db)
):
    """Deleta uma importação"""
    try:
        result = scope(
            supabase.table("sales_imports").delete().eq("id", import_id),
            ws_id, current_user.id,
        ).execute()

        if not result.data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Importação não encontrada"
            )

        return None

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erro ao deletar importação: {str(e)}"
        )
