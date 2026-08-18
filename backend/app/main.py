"""Core FastAPI application"""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .core import scheduler
from .core.config import get_settings
from .core.supabase_client import is_local_mode, LOCAL_DATA_DIR
from .routers import (
    auth, funnels, layout, screenshots, metrics, integrations, imports, live, sources
)

# Configurações
settings = get_settings()

# Em produção o banco local (SQLite em disco) é uma armadilha: em servidor
# efêmero ele "funciona", aceita cadastro, salva funil — e some no próximo
# deploy. Melhor não subir do que subir perdendo dado em silêncio.
if settings.environment == "production" and is_local_mode():
    faltando = [
        nome
        for nome, valor in (
            ("SUPABASE_URL", settings.supabase_url),
            ("SUPABASE_KEY", settings.supabase_key),
            ("SUPABASE_SERVICE_KEY", settings.supabase_service_key),
        )
        if not valor.strip() or valor.strip().startswith(("COLE_AQUI", "your_"))
    ]

    # Impresso além de levantado: no painel de log do servidor, o texto legível
    # aparece antes da pilha de chamadas e é o que a pessoa lê primeiro.
    print("\n" + "=" * 68)
    print("FUNNELTRON NÃO SUBIU — falta configuração")
    print("=" * 68)
    print("\nVariáveis de ambiente faltando:\n")
    for nome in faltando:
        print(f"   • {nome}")
    print(
        "\nPegue os valores no painel do Supabase:"
        "\n   Project Settings → API"
        "\n      SUPABASE_URL          = Project URL"
        "\n      SUPABASE_KEY          = chave anon / publishable"
        "\n      SUPABASE_SERVICE_KEY  = chave service_role / secret"
        "\n\nE defina nas variáveis de ambiente do servidor"
        " (Railway: aba Variables).\n"
    )
    print("=" * 68 + "\n", flush=True)

    raise RuntimeError(
        "Faltam variáveis de ambiente: " + ", ".join(faltando)
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
    allow_origins=settings.allowed_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- CORS do rastreador ----------------------------------------------------
# A lista de origens acima existe para proteger a API autenticada, e por isso
# não pode conter "*". Mas o heartbeat é colado no <head> de sites de terceiros:
# a origem é o domínio de vendas do cliente, que ninguém tem como cadastrar de
# antemão. Sem esta exceção o navegador recebia "400 Disallowed CORS origin" no
# preflight e o rastreador ficava mudo — sem erro visível, porque o snippet
# engole a falha de rede.
#
# Registrado DEPOIS do CORSMiddleware de propósito: em Starlette o último
# middleware adicionado é o mais externo, então este responde ao preflight
# antes de o outro ter chance de rejeitá-lo.
#
# Abrir só esta rota é seguro: ela não lê nada, não aceita credencial
# (`allow-credentials` fica de fora) e só grava heartbeat de um funnel_id.
TRACK_PATH = "/api/live/track"

_TRACK_CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
}


@app.middleware("http")
async def cors_aberto_no_rastreador(request, call_next):
    if request.url.path.rstrip("/") != TRACK_PATH:
        return await call_next(request)

    if request.method == "OPTIONS":
        return Response(status_code=204, headers=_TRACK_CORS)

    response = await call_next(request)
    for chave, valor in _TRACK_CORS.items():
        response.headers[chave] = valor
    return response


# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(funnels.router, prefix="/api")
app.include_router(layout.router, prefix="/api")
app.include_router(screenshots.router, prefix="/api")
app.include_router(metrics.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(imports.router, prefix="/api")
app.include_router(live.router, prefix="/api")
app.include_router(sources.router, prefix="/api")


# Prints capturados no modo local são servidos daqui. No Supabase o Storage
# devolve URL própria e este mount fica sem uso.
if is_local_mode():
    _static_dir = LOCAL_DATA_DIR / "storage"
    _static_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")


@app.on_event("startup")
async def _iniciar_agendador():
    """
    Sem isto, o histórico do rastreador (`tracker_snapshots`) só nascia se
    alguém abrisse a tela e clicasse em "Sincronizar" — um dia sem clique não
    deixava snapshot nenhum, mesmo com os eventos brutos intactos em
    `live_page_entries`. Ver `core/scheduler.py`.
    """
    scheduler.start()


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
