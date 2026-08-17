"""Configuração centralizada do backend"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Configurações do aplicativo carregadas do .env"""

    # Supabase
    supabase_url: str
    supabase_key: str  # anon key (frontend também usa)
    supabase_service_key: str  # service_role (só backend)

    # APIs externas (defaults - tokens reais ficam no banco)
    clarity_token: str = ""
    vturb_token: str = ""
    # Token de exportação da Clarity (Data.Export). Fica NO BACKEND — nunca
    # embutido no frontend. Se vazio, usa o Client Secret do usuário (OAuth).
    clarity_export_token: str = ""

    # Screenshot
    screenshot_api_key: str = ""
    screenshot_api_url: str = "https://api.screenshotone.com/take"

    # Ambiente
    environment: str = "production"

    # CORS — origens explícitas + regex para subdomínios do Vercel.
    # OBS: Starlette NÃO aceita curingas ("*.vercel.app") em `allow_origins`;
    # por isso usamos `cors_origin_regex` para cobrir qualquer *.vercel.app.
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "https://funneltron.vercel.app",
    ]

    cors_origin_regex: str = (
        r"^https://([a-zA-Z0-9-]+\.)*vercel\.app$"
    )

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
