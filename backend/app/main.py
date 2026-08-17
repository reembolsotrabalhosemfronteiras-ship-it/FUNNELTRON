"""Core FastAPI application"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .core.config import get_settings
from .core.supabase_client import is_local_mode, LOCAL_DATA_DIR
from .routers import auth, funnels, layout, screenshots, metrics, integrations, imports, live

# Configurações
settings = get_settings()

# Em produção o banco local (SQLite em disco) é uma armadilha: em servidor
# efêmero ele "funciona", aceita cadastro, salva funil — e some no próximo
# deploy. Melhor não subir do que subir perdendo dado em silêncio.
if settings.environment == "production" and is_local_mode():
    raise RuntimeError(
        "ENVIRONMENT=production sem credenciais do Supabase. "
        "Defina SUPABASE_URL, SUPABASE_KEY e SUPABASE_SERVICE_KEY nas "
        "variáveis de ambiente do servidor."
    )

# Criar app
app = FastAPI(
    title="FUNNELTRON API",
    description="Backend para análise de funis de vendas",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(funnels.router, prefix="/api")
app.include_router(layout.router, prefix="/api")
app.include_router(screenshots.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(live.router, prefix="/api")


# Prints capturados no modo local são servidos daqui. No Supabase o Storage
# devolve URL própria e este mount fica sem uso.
if is_local_mode():
    _static_dir = LOCAL_DATA_DIR / "storage"
    _static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


@app.get("/api/health")
async def health():
    """Health check da API.

    `storage` diz de onde vêm os dados. Sem isso, um sistema rodando no banco
    local parece idêntico a um ligado no Supabase — e a diferença importa.
    """
    return {
        "status": "healthy",
        "storage": "local" if is_local_mode() else "supabase",
    }


# --- Frontend --------------------------------------------------------------
# Se `frontend/dist` existir (build feito), o MESMO servidor entrega a
# interface. Assim o deploy é um alvo só: uma porta, uma origem, sem CORS e
# sem precisar hospedar frontend e backend em serviços separados.
# Sem o build, só a API responde — que é o caso do desenvolvimento, onde o
# Vite serve a interface na 5173 e encaminha /api para cá.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@app.get("/")
async def root():
    if (FRONTEND_DIST / "index.html").exists():
        return FileResponse(FRONTEND_DIST / "index.html")
    return {"status": "ok", "service": "FUNNELTRON API", "version": "1.0.0"}


if FRONTEND_DIST.exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST / "assets")),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        """
        Rotas do app (ex.: /funnels, /funnel/:id/edit) são resolvidas no
        navegador pelo React Router. Se o usuário recarregar a página nelas, o
        servidor precisa devolver o index.html — senão dá 404 numa rota que
        existe.
        """
        # `/api/...` que não casou com nenhuma rota é erro de API, e erro de API
        # tem que responder 404 em JSON. Devolver a interface aqui faria o
        # frontend receber HTML onde esperava dado — e o erro apareceria bem
        # longe da causa, como "unexpected token < in JSON".
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Rota não encontrada")

        arquivo = FRONTEND_DIST / full_path
        if full_path and arquivo.is_file():
            return FileResponse(arquivo)
        return FileResponse(FRONTEND_DIST / "index.html")
