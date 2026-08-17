"""
Cliente da Data Export API do Microsoft Clarity.

Uma credencial só: o token gerado no painel do Clarity em Configurações →
Configurações do projeto → API. Ele já nasce amarrado a um projeto, então não
existe Client ID, Client Secret nem project_id para mandar junto — quem envia o
token já disse, com isso, de qual projeto está falando. Não há OAuth no caminho.

Dois limites do fornecedor moldam o código daqui:

  - 10 chamadas por projeto por DIA. Por isso o cache é longo (30 min) e todo
    resultado bom vira snapshot no banco: a tela lê o snapshot, não a API.
  - No máximo os últimos 3 dias por chamada. Não existe consulta de 30 ou 90
    dias — pedir "90d" e receber 3 dias calado seria mentir sobre o número, então
    o serviço devolve quantos dias realmente vieram e quem chama rotula a tela.
"""
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime
from ..core.supabase_client import get_supabase_client


class ClarityService:
    """Proxy para a Data Export API do Clarity."""

    BASE_URL = "https://www.clarity.ms/export-data/api/v1"
    LIVE_INSIGHTS = "/project-live-insights"

    # O Clarity não serve mais que 3 dias por chamada.
    MAX_DAYS = 3

    def __init__(self):
        self._cache: Dict[str, tuple[Any, float]] = {}
        # 30 min, e não 1 min: com 10 chamadas por dia, um cache curto queima a
        # cota inteira numa tarde de uso normal.
        self.cache_ttl = 1800.0

    async def get_credentials(self, user_id: str) -> Optional[Dict]:
        """Credenciais do Clarity do usuário no banco."""
        supabase = get_supabase_client()

        result = supabase.table("api_credentials").select("*").eq(
            "user_id", user_id
        ).eq("provider", "clarity").execute()

        if result.data and len(result.data) > 0:
            return result.data[0]
        return None

    async def resolve_token(self, user_id: str) -> Optional[str]:
        """
        O token a usar: o do ambiente, se houver, senão o que o usuário salvou.

        Nos dois casos o valor fica no backend — o frontend nunca recebe token
        do Clarity de volta, só o aviso de que existe um configurado.
        """
        from ..core.config import get_settings

        token = get_settings().clarity_export_token
        if token:
            return token

        creds = await self.get_credentials(user_id)
        return (creds or {}).get("api_token") or None

    async def _get(self, endpoint: str, token: str, params: Optional[Dict] = None) -> Dict:
        """Uma chamada à API. Sempre devolve dict — erro vira `{"error": True}`."""
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(
                    f"{self.BASE_URL}{endpoint}",
                    headers=headers,
                    params=params,
                )
                response.raise_for_status()
                return {"data": response.json()}

        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            # As três falhas que realmente acontecem merecem texto próprio: o
            # usuário precisa saber se refaz o token, se espera até amanhã ou se
            # o problema é do outro lado.
            if code == 401:
                mensagem = "Token do Clarity inválido ou expirado. Gere um novo no painel."
            elif code == 403:
                mensagem = "Token sem permissão de exportação neste projeto do Clarity."
            elif code == 429:
                mensagem = (
                    "Limite do Clarity atingido (10 consultas por dia). "
                    "A cota volta amanhã."
                )
            else:
                mensagem = f"Clarity respondeu {code}."

            return {"error": True, "status": code, "message": mensagem}

        except Exception as e:
            return {"error": True, "message": f"Erro ao conectar com Clarity: {str(e)}"}

    async def get_live_insights(self, user_id: str, num_days: int = 3) -> Dict:
        """
        Métricas agregadas dos últimos `num_days` dias (teto de 3, do Clarity).

        Devolve `{"metrics": {...}, "days": N}` ou `{"error": True, "message": ...}`.
        `days` é quantos dias o número REALMENTE cobre — quem chama usa isso para
        rotular a tela quando o pedido foi maior que o teto.
        """
        days = max(1, min(int(num_days or self.MAX_DAYS), self.MAX_DAYS))

        token = await self.resolve_token(user_id)
        if not token:
            return {"error": True, "message": "Token do Clarity não configurado"}

        cache_key = f"clarity_{hash(token)}_{days}"
        now = datetime.now().timestamp()

        if cache_key in self._cache:
            data, timestamp = self._cache[cache_key]
            if now - timestamp < self.cache_ttl:
                return data

        resposta = await self._get(
            self.LIVE_INSIGHTS, token, params={"numOfDays": days}
        )

        if resposta.get("error"):
            return resposta

        resultado = {
            "metrics": summarize_live_insights(resposta.get("data")),
            "days": days,
        }

        self._cache[cache_key] = (resultado, now)
        return resultado

    async def test_token(self, user_id: str) -> Dict:
        """
        Confere o token gastando a menor consulta possível (1 dia).

        Vale 1 das 10 chamadas diárias — por isso "Testar" não é automático em
        lugar nenhum da interface, só no clique explícito.
        """
        token = await self.resolve_token(user_id)
        if not token:
            return {"ok": False, "message": "Token do Clarity não configurado"}

        resposta = await self._get(self.LIVE_INSIGHTS, token, params={"numOfDays": 1})

        if resposta.get("error"):
            return {"ok": False, "message": resposta["message"]}

        metricas = summarize_live_insights(resposta.get("data"))
        return {
            "ok": True,
            "message": (
                f"Clarity conectado. Ontem: "
                f"{metricas['sessions']:,} sessões.".replace(",", ".")
            ),
        }


def _num(valor: Any) -> float:
    """O Clarity manda número como texto em vários campos. Aqui vira float."""
    if valor is None:
        return 0.0
    try:
        return float(valor)
    except (TypeError, ValueError):
        return 0.0


def summarize_live_insights(bruto: Any) -> Dict:
    """
    Achata a resposta do Clarity nas métricas que as telas usam.

    A API devolve uma lista de blocos `{"metricName": ..., "information": [...]}`.
    Só o que dá para afirmar com o que vem de lá entra aqui — `bounceRate` fica
    `None` de propósito: a Data Export API não publica taxa de rejeição, e
    inventar um número a partir da média de páginas por sessão daria um valor
    plausível e errado. A tela mostra "—" e ninguém decide em cima de ficção.
    """
    por_nome: Dict[str, Dict] = {}

    for bloco in (bruto if isinstance(bruto, list) else []):
        if not isinstance(bloco, dict):
            continue
        nome = (bloco.get("metricName") or "").strip()
        info = bloco.get("information") or []
        if nome and isinstance(info, list) and info and isinstance(info[0], dict):
            por_nome[nome] = info[0]

    trafego = por_nome.get("Traffic", {})
    engajamento = por_nome.get("EngagementTime", {})
    scroll = por_nome.get("ScrollDepth", {})

    sessoes = _num(trafego.get("totalSessionCount"))
    paginas_por_sessao = _num(trafego.get("PagesPerSessionPercentage"))

    # O tempo vem somado entre as sessões, em milissegundos.
    sessoes_engajamento = _num(engajamento.get("totalSessionCount")) or sessoes
    tempo_total_ms = _num(engajamento.get("totalTime"))

    return {
        "sessions": int(sessoes),
        "botSessions": int(_num(trafego.get("totalBotSessionCount"))),
        "distinctUsers": int(_num(trafego.get("distinctUserCount"))),
        "pageViews": int(round(sessoes * paginas_por_sessao)),
        "pagesPerSession": round(paginas_por_sessao, 2),
        "avgTime": (
            round(tempo_total_ms / sessoes_engajamento / 1000, 2)
            if sessoes_engajamento else 0.0
        ),
        "avgScrollDepth": round(_num(scroll.get("averageScrollDepth")), 2),
        "bounceRate": None,
    }


# Instância global
clarity_service = ClarityService()
