# FUNNELTRON (rebuild 20260909191315) â€” imagem Ãºnica: frontend construÃ­do + API FastAPI.
#
# Um container sÃ³, uma porta sÃ³. Roda em Railway, Render, Fly.io, Coolify, ou
# num VPS com Docker. Ã‰ o caminho recomendado porque a captura de print usa
# Chromium â€” que **nÃ£o roda** em funÃ§Ã£o serverless (Vercel/Netlify).

# --- Etapa 1: build do frontend --------------------------------------------
# node:22 (nÃ£o 20): @supabase/* e @testing-library/jest-dom jÃ¡ exigem Node
# >=22 no package.json deles â€” com 20 o `npm ci` sÃ³ emitia um warning
# (EBADENGINE), mas a mudanÃ§a recente no lockfile (gerado com npm 11/Node 24
# local) ficou incompatÃ­vel com o npm 10.8.2 que vem no node:20-slim e o
# build parava em "Missing: esbuild@... from lock file". Alinhar a versÃ£o do
# Node do build com o que gerou o lockfile resolve os dois problemas juntos.
FROM node:22-slim AS frontend

WORKDIR /app/frontend

# Copia sÃ³ os manifestos primeiro: enquanto as dependÃªncias nÃ£o mudarem, esta
# camada fica em cache e o build nÃ£o reinstala tudo a cada alteraÃ§Ã£o de cÃ³digo.
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Sem mock: a imagem existe para falar com o backend de verdade.
ENV VITE_USE_MOCK=false
RUN npm run build


# --- Etapa 2: runtime Python + Chromium -------------------------------------
# A imagem oficial do Playwright jÃ¡ vem com o navegador e as bibliotecas de
# sistema que ele exige (fontes, libnss, libgbm...). Montar isso Ã  mÃ£o sobre
# python:slim dÃ¡ muito mais trabalho e quebra a cada atualizaÃ§Ã£o.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Garante que o Chromium esteja instalado e compatÃ­vel com a versÃ£o do playwright.
# A imagem base jÃ¡ tem, mas Ã s vezes hÃ¡ mismatch de versÃ£o ou o binÃ¡rio nÃ£o estÃ¡ no PATH esperado.
# Rodar isso no build garante que o navegador certo esteja lÃ¡.
RUN playwright install chromium

COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    PORT=8000

EXPOSE 8000

WORKDIR /app/backend

# `$PORT` porque Railway/Render/Fly definem a porta por variÃ¡vel de ambiente.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

