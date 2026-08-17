# PROMPT PARA O CLAUDE CODE — Dashboard Local de Análise de Funil

> Cole este prompt inteiro no Claude Code (rode dentro da pasta `F:\agentes ia\VISUALIZAÇÂO DE FUNIL`). O objetivo é construir, do zero, uma plataforma local leve de visualização e análise de funis de vendas.

---

## 1. O QUE É ESSE SISTEMA

Uma **dashboard web local** (roda no computador, abre no navegador) para **desenhar, organizar e analisar funis de vendas**. O usuário cadastra funis, aponta as URLs de cada etapa, o sistema tira **screenshot automático** de cada página e monta o funil visualmente (estilo mapa mental: containers + setas + métricas de conversão). Tudo é alimentado por dados reais das APIs **Microsoft Clarity** (conversão real por página) e **VTurb Analytics** (conversão de VSLs).

### Funcionalidades centrais
1. **CRUD de funis** — criar, editar, visualizar, excluir. Cada funil tem: nome, slug, status.
2. **Status de funil** (usado para filtros): `ativo` / `desativo` / `em teste`.
3. **Visualização de funil em mind map**: cada etapa é um container (node) com o screenshot da página, label, status e métrica de conversão; as etapas são ligadas por setas (edges) que mostram a conversão de origem→destino.
4. **Estrutura complexa de funil**: suportar `upsell`, `downsell` e `order bump`, com setas condicionais (ex.: "ao recusar → downsell", "ao aceitar → upsell", "com bump → order bump").
5. **Auto-descoberta (SEMI-AUTO)**: o usuário informa as URLs + slugs em lote; o sistema cria as etapas automaticamente, tira o screenshot de cada uma e popula o canvas. O usuário depois ajusta a ordem/relações (parent/child) no editor.
6. **Análise de tráfego e conversão** por funil e por etapa, vindas da Clarity e VTurb, com botão "Sincronizar".
7. **Interface bonita, organizada e leve** — visual moderno, responsivo, tema claro/escuro.
8. **Filtros** na lista de funis por status (ativo / desativo / em teste).

---

## 2. STACK TECNOLÓGICA (decisão fechada)

| Camada | Tecnologia | Motivo |
|---|---|---|
| Backend | **Python 3.14 + FastAPI** (uvicorn) | CRUD, SQLite, proxy das APIs (tokens NUNCA vão pro frontend), rate-limit |
| Storage | **SQLite** local (`data/funnels.db`) | zero-config, portátil |
| Frontend | **React 18 + Vite + TypeScript** | build leve, HMR rápido |
| Canvas / mind-map | **React Flow** | nodes (containers) + edges (setas) com labels de condição |
| Gráficos | **Recharts** | leve, para ranking e KPIs do dashboard |
| UI | **Tailwind CSS + shadcn/ui** | visual moderno e leve |
| Screenshots | **Playwright (Python, headless Chromium)** | captura batch concorrente |
| Estado/Dados | **Zustand + React Query** | cache de fetch no frontend |
| Empacotamento | opcional depois (pywebview) | não obrigatório agora |

**Regra de ouro:** o backend é o ÚNICO que fala com VTurb e Clarity. O frontend nunca recebe tokens. O backend faz proxy + rate-limit.

**Como rodar:** um `launcher.py` sobe o uvicorn (porta 8000) e serve o `dist` do Vite; abre `http://localhost:8000` no navegador. Scripts: `dev` (frontend Vite em :5173 + backend em :8000) e `build`+`launch` (produção local).

---

## 3. ESTRUTURA DE PASTAS

```
F:\agentes ia\VISUALIZAÇÂO DE FUNIL\
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app + CORS + routers
│   │   ├── db.py              # engine SQLAlchemy + init_db
│   │   ├── models.py          # ORM (schema abaixo)
│   │   ├── schemas.py         # Pydantic request/response
│   │   ├── routers/
│   │   │   ├── funnels.py
│   │   │   ├── steps.py
│   │   │   ├── edges.py
│   │   │   ├── screenshots.py
│   │   │   ├── integrations.py
│   │   │   └── metrics.py
│   │   ├── services/
│   │   │   ├── screenshot.py  # Playwright batch + auto-discovery
│   │   │   ├── vturb.py       # proxy VTurb + rate-limit
│   │   │   ├── clarity.py     # proxy Clarity + OAuth
│   │   │   └── metrics.py     # cálculo de conversão
│   │   └── core/
│   │       ├── config.py
│   │       ├── security.py    # protege tokens
│   │       └── rate_limiter.py# token-bucket por provider+tier
│   ├── data/
│   │   ├── funnels.db         # SQLite (gitignored)
│   │   └── screenshots/       # PNGs (gitignored)
│   ├── requirements.txt
│   └── launcher.py            # sobe tudo
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx            # rotas
│   │   ├── pages/
│   │   │   ├── DashboardPage.tsx     # métricas gerais (KPIs + ranking + VSL/VTurb)
│   │   │   ├── FunnelListPage.tsx
│   │   │   ├── FunnelViewPage.tsx
│   │   │   ├── FunnelEditorPage.tsx
│   │   │   └── SettingsPage.tsx
│   │   ├── components/
│   │   │   ├── funnel/  (FunnelCanvas, StepNode, StepEdge, StatusBadge, StepMetricsBadge)
│   │   │   ├── list/    (FunnelCard, FilterBar)
│   │   │   ├── editor/  (StepForm, UrlDiscoveryInput)
│   │   │   └── common/  (Sidebar, Header, Modal, Button, Spinner)
│   │   ├── store/useFunnels.ts
│   │   ├── api/client.ts
│   │   └── types/index.ts
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── .gitignore
├── README.md
└── PROMPT_CLAUDE_CODE.md
```

---

## 4. SCHEMA DO BANCO (SQLite / SQLAlchemy)

```python
# funnels
Funnel(id, name, slug UNIQUE, status ENUM(active,inactive,testing),
       base_url, created_at, updated_at)

# funnel_steps  (etapas do funil)
FunnelStep(id, funnel_id FK, label, url,
           type ENUM(landing, vsl, checkout, upsell, downsell,
                     order_bump, thank_you, other),
           position_x, position_y,       # layout do React Flow
           parent_step_id FK NULLABLE,    # p/ upsell/downsell/bump
           order_index, created_at)

# funnel_edges  (as setas do mind map)
FunnelEdge(id, funnel_id FK, source_step_id FK, target_step_id FK,
           condition ENUM(default, on_accept, on_decline, on_bump, on_no_bump),
           label)

# step_metrics  (conversão por etapa, multi-fonte)
StepMetric(id, funnel_id FK, step_id FK, date,
           visitors, conversions, conversion_rate REAL,
           source ENUM(clarity, vturb, manual))

# api_credentials  (tokens locais, NUNCA expostos ao frontend)
ApiCredential(id, provider ENUM(vturb, clarity),
              api_token, api_version, account_id,
              rate_limit_tier ENUM(basic,pro,scale,enterprise),
              created_at, updated_at)

# screenshots
Screenshot(id, step_id FK, file_path, width, height, captured_at)
```

Relações: `Funnel 1—* FunnelStep`, `Funnel 1—* FunnelEdge`, `FunnelStep 1—* StepMetric`, `FunnelStep 1—1 Screenshot`.

---

## 5. ENDPOINTS DA API (FastAPI, prefixo `/api`)

**Funnels**
- `GET /api/funnels` — lista (suporta `?status=active|inactive|testing`)
- `POST /api/funnels` — cria funil
- `GET /api/funnels/{id}` — detalhe
- `PUT /api/funnels/{id}` — edita (nome, slug, status)
- `DELETE /api/funnels/{id}` — remove

**Steps**
- `GET/POST/PUT/DELETE /api/funnels/{id}/steps` — CRUD de etapas

**Edges**
- `GET/POST/PUT/DELETE /api/funnels/{id}/edges` — CRUD de setas/relações

**Screenshots**
- `POST /api/screenshots/discover` — recebe `[{url, slug}]`, cria steps, tira screenshots em batch (semaphore 3), retorna `{step_id, screenshot_url}`
- `GET /api/screenshots/{step_id}` — serve o PNG

**Integrações / Credenciais**
- `GET/POST/PUT /api/integrations/credentials` — salva token VTurb e Clarity (backend-only)
- `POST /api/integrations/test` — valida conexão

**Métricas**
- `GET /api/funnels/{id}/metrics` — retorna métricas enriquecidas (Clarity + VTurb + manual) por etapa e por seta
- `POST /api/funnels/{id}/sync` — dispara sincronização com as APIs

---

## 6. INTEGRAÇÃO DAS APIs

### Microsoft Clarity (conversão REAL — fonte preferida)
- Autenticação OAuth2 Azure AD: `client_id` + `client_secret` → `access_token` (bearer). O backend guarda o token gerado + `project_id`. Se o usuário fornecer token direto, aceitar e renovar sob demanda.
- Fluxo: `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` → bearer → chamadas à Clarity API filtrando por `project_id` e URL da página → `visitors` e `conversions` por etapa.
- Gravar `StepMetric(source=clarity)`.

### VTurb Analytics (conversão de VSLs — fonte PRINCIPAL para VSL)
- Headers obrigatórios em TODAS as requisições: `X-Api-Token: <token>` e `X-Api-Version: v1`.
- Exemplo de endpoint: `POST https://analytics.vturb.net/conversions/active_platforms` (body JSON com data/account_id).
- **Rate limits por tier** (respeitar via `core/rate_limiter.py` token-bucket + backoff em 429): Basic 60/min · Pro 120/min · Scale 300/min · Enterprise 800/min.
- **Uso no sistema:** obter engajamento e CONVERSÃO das VSLs das etapas do tipo `vsl`. Popular BOTH o `StepMetric(source=vturb)` por etapa E o painel de `VslInsightsPanel` no Dashboard de métricas gerais (top VSLs por conversão/engajamento via `GET /api/metrics/vsl`). Sempre mostrar a conversão de VSL no dashboard geral.

### Cálculo de métricas (`services/metrics.py`)
- `conversion_rate = conversions / visitors` (por etapa)
- `step_to_step = conversions(destino) / conversions(origem)` (rótulo da seta)
- Reconciliação de fontes: prioriza **Clarity**; VTurb para métricas de vídeo; `manual` sobrescreve.

---

## 7. SERVIÇO DE SCREENSHOT (Playwright)

`backend/app/services/screenshot.py`:
- Função `capture_step(url, step_id, viewport="desktop")` que abre Chromium headless, vai até `networkidle`, tira screenshot 1280x800 (ou mobile), salva em `data/screenshots/{step_id}.png`.
- **Batch concorrente** com `asyncio.gather` + `Semaphore(3)` para a auto-descoberta.
- Tratar: timeout, páginas com login/paywall (retry + aviso), seletor de espera opcional.
- Servir via `GET /api/screenshots/{step_id}` (FileResponse) ou static mount.

---

## 8. INTERFACE (FRONTEND)

**Rotas:** `/` (dashboard de métricas gerais), `/funnels` (lista), `/funnel/:id` (visualização mind map), `/funnel/:id/edit` (editor), `/settings` (tokens).

**Páginas e componentes principais:**

### 8.1 DashboardPage — Métricas Gerais (NOVO)
Página inicial com **análise agregada de todos os funis** (visão executiva). Deve conter:
- **KPIs cards** no topo: total de funis (por status), visitantes totais, conversões totais, conversão média geral, receita estimada (se houver).
- **Gráfico de ranking de funis** (melhor → pior por taxa de conversão), usando Recharts (leve).
- **Tabela comparativa** de funis: nome, status, visitantes, conversões, conv. %, tendência, fonte (Clarity/VTurb).
- **Filtros de período** (7d / 30d / 90d / tudo) e filtro por status.
- **Bloco de conversão de VSL (VTurb)**: cards/seção dedicada mostrando as VSLs com maior engajamento e conversão (dados da VTurb), destacando top VSLs.
- Componentes: `KpiCard`, `FunnelRankingChart`, `FunnelComparisonTable`, `VslInsightsPanel`, `PeriodFilter`.

- `FunnelListPage`: grid de `FunnelCard` + `FilterBar` (ativo/inativo/teste) + botão "Novo funil".
- `FunnelViewPage`: `FunnelCanvas` (React Flow) com `StepNode` (screenshot thumbnail + label + `StatusBadge` + `StepMetricsBadge`) e `StepEdge` (seta com label de condição, ex.: "ao recusar → downsell"). Botão "Sincronizar métricas".
- `FunnelEditorPage`: `StepForm` (tipo, url, posição, parent p/ upsell/downsell/bump) + `UrlDiscoveryInput` (cola URLs+slugs em lote → auto-discovery) + gerenciamento de edges com condition.
- `SettingsPage`: cadastro dos tokens VTurb (`X-Api-Token`, tier) e Clarity (`client_id`, `client_secret`, `project_id`), com botão "Testar conexão".

**Visual:** Tailwind + shadcn/ui, tema claro/escuro, responsivo, lazy-load de imagens pra leveza. Paleta moderna, cards com sombra suave, badges coloridos por status.

### 8.2 Endpoints de métricas gerais (adicional em `/api/metrics`)
- `GET /api/metrics/overview?period=30d&status=` — KPIs agregados (total funis, visitantes, conversões, conv. média).
- `GET /api/metrics/funnels/ranking?period=30d` — ranking de funis por conversão.
- `GET /api/metrics/vsl?period=30d` — insights de VSL vinda da **VTurb** (top VSLs por engajamento/conversão).
- `GET /api/funnels/{id}/metrics` — métricas do funil individual (já existente).

---

## 9. PLANO DE IMPLEMENTAÇÃO (por fases — entregue incrementalmente)

- **Fase 0 — Scaffold:** backend FastAPI (db, models, schemas) + frontend Vite React TS + `launcher.py` + `.gitignore` + `requirements.txt`/`package.json`.
- **Fase 1 — Modelo + CRUD + Lista:** routers funnels/steps/edges + `FunnelListPage` + `FilterBar` + `FunnelCard`.
- **Fase 2 — Visualização (Mind Map):** `FunnelCanvas` + `StepNode` + `StepEdge` + `StatusBadge`, layout a partir de `position_x/y`.
- **Fase 3 — Screenshot + Auto-descoberta:** `services/screenshot.py` (Playwright) + router screenshots + `UrlDiscoveryInput` + batch com semaphore + thumbnails nos nodes.
- **Fase 4 — Editor + Estrutura Complexa:** `FunnelEditorPage` + `StepForm` (tipo + parent p/ upsell/downsell/order_bump) + criação de edges com condition.
- **Fase 5 — Integrações (Auth + Proxy):** `SettingsPage` + `api_credentials` + `services/vturb.py` + `services/clarity.py` + `core/rate_limiter.py` + `core/security.py`.
- **Fase 6 — Métricas:** `services/metrics.py` + router metrics + `StepMetricsBadge` + rótulos de conversão nas setas + botão "Sincronizar".
- **Fase 7 — Polimento:** tema claro/escuro, responsividade, performance (lazy de imagens), README com instruções de execução.

**Dependências:** Fase 0 → 1 → 2 → 3 (screenshot depende de steps) → 4 → 5 (credenciais) → 6 (métricas dependem de 5) → 7.

---

## 10. REQUISITOS DE QUALIDADE

- Código limpo, comentado em pontos-chave, seguindo os padrões da stack (PEP8 no Python, ESLint no TS).
- Tokens de API **nunca** aparecem nas respostas de dados nem no frontend; sempre via backend proxy.
- Tratar falhas de rede/screenshot com mensagens amigáveis (retry, fallback).
- `README.md` com: como instalar deps (`pip install -r requirements.txt`, `npm install`), como rodar (`python backend/launcher.py` ou scripts `dev`/`build`), e onde colocar os tokens (Settings).
- Respeitar rate limits das APIs (backoff em 429).
- App **leve**: sem Electron, sem dependências pesadas desnecessárias.

---

## 11. FORA DE ESCOPO (por enquanto)

- Conversão de VSL via VTurb já entra, mas refinamentos avançados de VSL ficam para depois.
- Empacotamento desktop (pywebview/Tauri) é opcional, não obrigatório na primeira entrega.
- Multi-usuário / nuvem: é 100% local, single-user.

---

### Referências das APIs
- VTurb Analytics: `https://analytics.vturb.net` — auth `X-Api-Token` + `X-Api-Version: v1`. Docs: https://vturb.gitbook.io/analytics-api/pt
- Microsoft Clarity API: OAuth2 Azure AD (client_id + client_secret → bearer) + project_id.
