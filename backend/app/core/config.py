"""Configuração centralizada do backend"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Configurações do aplicativo carregadas do .env"""

    # Supabase.
    #
    # Sem valor padrão, a falta de qualquer uma derrubava o app com um
    # traceback de validação do pydantic — três blocos de "Field required" e
    # nenhuma pista do que fazer. Com padrão vazio, quem reclama é a checagem
    # em `main.py`, que diz o nome das variáveis e onde defini-las.
    supabase_url: str = ""
    supabase_key: str = ""  # anon key (frontend também usa)
    supabase_service_key: str = ""  # service_role (só backend)

    # APIs externas (defaults - tokens reais ficam no banco)
    clarity_token: str = ""
    vturb_token: str = ""
    # Token da Data Export API do Clarity, gerado no painel do projeto. Fica NO
    # BACKEND — nunca embutido no frontend. Se vazio, usa o token que o próprio
    # usuário salvou em Configurações. Não há OAuth do Azure envolvido.
    clarity_export_token: str = ""

    # Screenshot
    screenshot_api_key: str = ""
    screenshot_api_url: str = "https://api.screenshotone.com/take"

    # Ambiente
    environment: str = "production"

    # CORS — origens explícitas + regex para subdomínios de plataforma.
    # OBS: Starlette NÃO aceita curingas ("*.vercel.app") em `allow_origins`;
    # por isso o regex existe em separado.
    #
    # Quando frontend e backend estão no MESMO servidor (é o caso do Dockerfile
    # e do vercel.json), nada disso é usado: mesma origem não passa por CORS.
    # Isto serve para quem hospeda a interface num lugar e a API em outro.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    # Domínio próprio ou host não previsto: separe por vírgula em
    # CORS_EXTRA_ORIGINS. Sem isto, subir a interface num domínio novo dava
    # erro de CORS sem nada no log explicando por quê.
    cors_extra_origins: str = ""

    # Cobre os domínios grátis das plataformas mais comuns.
    cors_origin_regex: str = (
        r"^https://([a-zA-Z0-9-]+\.)*"
        r"(vercel\.app|netlify\.app|up\.railway\.app|onrender\.com|fly\.dev)$"
    )

    @property
    def allowed_origins(self) -> list[str]:
        extras = [o.strip() for o in self.cors_extra_origins.split(",") if o.strip()]
        return self.cors_origins + extras

    # Segredo opcional para validar webhooks de venda (PerfectPay, etc.).
    # Se vazio, o endpoint /api/live/webhook aceita qualquer requisição.
    webhook_secret: str = ""

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    """Retorna instância única das configurações"""
    return Settings()
