"""Proxy para Microsoft Clarity API"""
import httpx
from typing import Optional, Dict, Any
from datetime import datetime
from ..core.supabase_client import get_supabase_client


class ClarityService:
    """Serviço proxy para Microsoft Clarity"""

    BASE_URL = "https://www.clarity.ms/api/v1"

    def __init__(self):
        self._cache: Dict[str, tuple[Any, float]] = {}
        self.cache_ttl = 60.0  # 1 minuto

    async def get_credentials(self, user_id: str) -> Optional[Dict]:
        """Busca credenciais do Clarity do usuário no banco"""
        supabase = get_supabase_client()

        result = supabase.table("api_credentials").select("*").eq(
            "user_id", user_id
        ).eq("provider", "clarity").execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None

    async def _make_request(
        self,
        endpoint: str,
        token: str,
        params: Optional[Dict] = None
    ) -> Dict:
        """Faz requisição à API do Clarity"""

        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}{endpoint}",
                    headers=headers,
                    params=params
                )

                response.raise_for_status()
                return response.json()

        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "status": e.response.status_code,
                "message": f"Erro na API do Clarity: {e.response.status_code}"
            }
        except Exception as e:
            return {
                "error": True,
                "message": f"Erro ao conectar com Clarity: {str(e)}"
            }

    async def get_page_metrics(
        self,
        user_id: str,
        project_id: str,
        page_url: str,
        start_date: str,
        end_date: str
    ) -> Dict:
        """
        Busca métricas de uma página específica.

        Returns:
            {
                "visitors": int,
                "conversions": int,
                "conversionRate": float
            }
        """
        cache_key = f"clarity_{project_id}_{page_url}_{start_date}_{end_date}"
        now = datetime.now().timestamp()

        # Verifica cache
        if cache_key in self._cache:
            data, timestamp = self._cache[cache_key]
            if now - timestamp < self.cache_ttl:
                return data

        # Busca credenciais
        creds = await self.get_credentials(user_id)
        if not creds:
            return {"error": True, "message": "Credenciais do Clarity não configuradas"}

        # Faz requisição
        result = await self._make_request(
            f"/projects/{project_id}/metrics",
            creds["api_token"],
            params={
                "url": page_url,
                "startDate": start_date,
                "endDate": end_date
            }
        )

        # Cacheia resultado
        if not result.get("error"):
            self._cache[cache_key] = (result, now)

        return result

    async def get_sessions_export(
        self,
        user_id: str,
        project_id: str,
        from_date: str,
        to_date: str
    ) -> Dict:
        """
        Busca sessões exportadas da Clarity (endpoint /export/v1).
        Usa o token de exportação (Data.Export), que fica NO BACKEND:
        vem do env CLARITY_EXPORT_TOKEN ou, se ausente, do Client Secret
        OAuth armazenado nas credenciais do usuário. Nunca exposto ao frontend.
        """
        from ..core.config import get_settings
        token = get_settings().clarity_export_token

        if not token:
            creds = await self.get_credentials(user_id)
            if not creds:
                return {"error": True, "message": "Credenciais do Clarity não configuradas"}
            token = creds["api_token"]

        return await self._make_request(
            f"/export/v1/{project_id}/sessions",
            token,
            params={"from": from_date, "to": to_date},
        )


# Instância global
clarity_service = ClarityService()
