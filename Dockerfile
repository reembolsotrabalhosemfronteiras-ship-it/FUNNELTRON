# FUNNELTRON — imagem única: frontend construído + API FastAPI.
#
# Um container só, uma porta só. Roda em Railway, Render, Fly.io, Coolify, ou
# num VPS com Docker. É o caminho recomendado porque a captura de print usa
# Chromium — que **não roda** em função serverless (Vercel/Netlify).

# --- Etapa 1: build do frontend --------------------------------------------
FROM node:20-slim AS frontend

WORKDIR /app/frontend

# Copia só os manifestos primeiro: enquanto as dependências não mudarem, esta
# camada fica em cache e o build não reinstala tudo a cada alteração de código.
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Sem mock: a imagem existe para falar com o backend de verdade.
ENV VITE_USE_MOCK=false
RUN npm run build


# --- Etapa 2: runtime Python + Chromium -------------------------------------
# A imagem oficial do Playwright já vem com o navegador e as bibliotecas de
# sistema que ele exige (fontes, libnss, libgbm...). Montar isso à mão sobre
# python:slim dá muito mais trabalho e quebra a cada atualização.
FROM mcr.microsoft.com/playwright/python:v1.48.0-jammy

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist

ENV PYTHONUNBUFFERED=1 \
    ENVIRONMENT=production \
    PORT=8000

EXPOSE 8000

WORKDIR /app/backend

# `$PORT` porque Railway/Render/Fly definem a porta por variável de ambiente.
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
