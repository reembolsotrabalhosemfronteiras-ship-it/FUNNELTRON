"""Proxy para VTurb Analytics API"""
import httpx
from typing import Optional, Dict, Any
from datetime import datetime
from ..core.rate_limiter import rate_limiter
from ..core.supabase_client import get_supabase_client


class VTurbService:
    """Serviço proxy para VTurb Analytics"""

    BASE_URL = "https://analytics.vturb.net"

    def __init__(self):
        self._cache: Dict[str, tuple[Any, float]] = {}  # cache_key -> (data, timestamp)
        self.cache_ttl = 20.0  # segundos

    async def get_credentials(self, user_id: str) -> Optional[Dict]:
        """Busca credenciais do VTurb do usuário no banco"""
        supabase = get_supabase_client()

        result = supabase.table("api_credentials").select("*").eq(
            "user_id", user_id
        ).eq("provider", "vturb").execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None

    async def _make_request(
        self,
        endpoint: str,
        token: str,
        tier: str = "basic",
        params: Optional[Dict] = None,
        data: Optional[Dict] = None
    ) -> Dict:
        """Faz requisição à API do VTurb com rate limiting"""

        # Verifica rate limit
        if not rate_limiter.check_and_consume(f"vturb_{token}", tier):
            wait_time = rate_limiter.get_wait_time(f"vturb_{token}", tier)
            return {
                "error": True,
                "status": 429,
                "message": f"Rate limit atingido. Tente novamente em {int(wait_time)}s",
                "resets_in": int(wait_time)
            }

        # Faz a requisição
        headers = {
            "X-Api-Token": token,
            "X-Api-Version": "v1"
        }

        # Exceção: alguns endpoints só pedem o token
        if endpoint in ["/sessions/live_users", "/players/list"]:
            headers.pop("X-Api-Version")

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                if data:
                    response = await client.post(
                        f"{self.BASE_URL}{endpoint}",
                        headers=headers,
                        json=data,
                        params=params
                    )
                else:
                    response = await client.get(
                        f"{self.BASE_URL}{endpoint}",
                        headers=headers,
                        params=params
                    )

                if response.status_code == 429:
                    # VTurb retornou 429
                    error_data = response.json() if response.content else {}
                    return {
                        "error": True,
                        "status": 429,
                        "message": "Cota do VTurb esgotada",
                        "details": error_data
                    }

                response.raise_for_status()
                return response.json()

        except httpx.HTTPStatusError as e:
            return {
                "error": True,
                "status": e.response.status_code,
                "message": f"Erro na API do VTurb: {e.response.status_code}"
            }
        except Exception as e:
            return {
                "error": True,
                "message": f"Erro ao conectar com VTurb: {str(e)}"
            }

    async def get_live_users(
        self,
        user_id: str,
        player_id: str,
        minutes: int = 5
    ) -> Dict:
        """
        Busca usuários assistindo VSL nos últimos N minutos.
        Cache de 20s (API do VTurb já cacheia 30s).
        """
        cache_key = f"live_{player_id}_{minutes}"
        now = datetime.now().timestamp()

        # Verifica cache
        if cache_key in self._cache:
            data, timestamp = self._cache[cache_key]
            if now - timestamp < self.cache_ttl:
                return data

        # Busca credenciais
        creds = await self.get_credentials(user_id)
        if not creds:
            return {"error": True, "message": "Credenciais do VTurb não configuradas"}

        # Faz requisição
        result = await self._make_request(
            "/sessions/live_users",
            creds["api_token"],
            creds.get("rate_limit_tier", "basic"),
            params={"player_id": player_id, "minutes": minutes}
        )

        # Cacheia resultado
        if not result.get("error"):
            self._cache[cache_key] = (result, now)

        return result

    async def get_quota_usage(self, user_id: str) -> Dict:
        """Verifica uso da cota do VTurb"""
        creds = await self.get_credentials(user_id)
        if not creds:
            return {"error": True, "message": "Credenciais do VTurb não configuradas"}

        return await self._make_request(
            "/quota/usage",
            creds["api_token"],
            creds.get("rate_limit_tier", "basic")
        )


# Instância global
vturb_service = VTurbService()
