"""Router de screenshots"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl
from ..core.auth import get_current_user
from ..services.screenshot import screenshot_service

router = APIRouter(prefix="/screenshots", tags=["screenshots"])


class ScreenshotRequest(BaseModel):
    url: HttpUrl
    step_id: str


@router.post("")
async def capture_screenshot(
    request: ScreenshotRequest,
    current_user = Depends(get_current_user)
):
    """
    Captura screenshot de uma URL e salva no Supabase Storage.

    Returns:
        {
            "ok": True,
            "screenshotUrl": "https://...supabase.co/storage/..."
        }
        ou
        {
            "ok": False,
            "reason": "Mensagem de erro"
        }
    """
    try:
        result = await screenshot_service.capture_screenshot(
            str(request.url),
            request.step_id
        )

        return result

    except Exception as e:
        return {
            "ok": False,
            "reason": f"Erro inesperado: {str(e)}"
        }
