# Rastreamento de Criativos, Campanhas e Respostas de Quiz por Lead

## Status Atual (2026-09-07)

### ✅ O que já foi implementado

| Item | Arquivo | Status |
|------|---------|--------|
| Migration 011 — schema de atribuição | `backend/supabase/migrations/011_ad_tracking_attribution.sql` | ✅ Rodada no Supabase |
| First-touch UTM no sessionStorage | `frontend/public/tracker.js` | ✅ Implementado |
| Auto-detect universal de quiz | `frontend/public/tracker.js` | ✅ Implementado |
| Campo `first_utm` no backend | `backend/app/routers/live.py` | ✅ Implementado |
| Atribuição configurável por workspace | `backend/app/routers/live.py` | ✅ Implementado |
| Serviço de sync de ads (UTMify) | `backend/app/services/ad_sync.py` | ✅ Stub criado |
| Card de configuração de atribuição | `frontend/src/components/settings/AttributionSettingsCard.tsx` | ✅ Implementado |
| Endpoint `updateWorkspaceAttributionModel` | `frontend/src/api/client.ts` | ✅ Implementado |
| Tipo `Workspace.attribution_model` | `frontend/src/types/index.ts` | ✅ Implementado |
| Página de teste do tracker | `test-tracker.html` | ✅ Criada |

### ❌ O que NÃO funciona ainda

| Item | Problema | Prioridade |
|------|----------|------------|
| **Página Quiz & Ads** | Endpoints `/api/quiz/*` não existem no backend — o frontend chama mas não há router | 🔴 Alta |
| **Sync UTMify real** | `_fetch_utmfy_ads()` é um stub — retorna lista vazia. Precisa da API real da UTMify | 🟡 Média |
| **Endpoint PATCH workspace** | Backend não processa `attribution_model` no PATCH `/api/workspaces/:id` | 🟡 Média |
| **Teste E2E completo** | Dados não verificados no banco após testes automatizados | 🟢 Baixa |

---

## Próximos Passos (Ordem de Prioridade)

### 1. 🔴 Criar Router de Quiz/Ads no Backend (CRÍTICO)

A página "Quiz & Ads" chama estes endpoints que **não existem**:

```
GET  /api/quiz/heatmap?funnel_id=X&period=Y&source=Z
GET  /api/quiz/dropoff?funnel_id=X&period=Y&source=Z
GET  /api/quiz/audience?funnel_id=X&ad_id=Y&period=Z
GET  /api/quiz/ad-performance?funnel_id=X&period=Y&source=Z
POST /api/quiz/sync-utmfy
```

**O que fazer:**
- Criar `backend/app/routers/quiz.py` com estas 5 rotas
- Cada rota deve consultar as tabelas `quiz_answers`, `lead_profiles`, `ad_campaigns` e `live_page_entries`
- Registrar o router em `backend/app/main.py`

**Queries necessárias:**

```sql
-- Heatmap: respostas por pergunta × campanha
SELECT question_id, answer_value, utm_campaign, COUNT(*) as count
FROM quiz_answers
WHERE funnel_id = X AND timestamp > now() - interval '30 days'
GROUP BY question_id, answer_value, utm_campaign;

-- Drop-off por source: funil de conversão segmentado por UTM
SELECT utm_source, utm_medium, utm_campaign,
       COUNT(DISTINCT session_id) as entry_count,
       -- calcular retenção por etapa usando live_page_entries
FROM lead_profiles lp
JOIN live_page_entries lpe ON lp.session_id = lpe.session_id
WHERE lp.funnel_id = X
GROUP BY utm_source, utm_medium, utm_campaign;

-- Audience breakdown: dados de ad_campaigns.audience_json
SELECT ad_id, ad_name, campaign_id, audience_json
FROM ad_campaigns
WHERE workspace_id = X;

-- Ad performance: métricas financeiras por ad
SELECT ad_id, ad_name, spend, impressions, clicks, conversions, ctr, cpc, roas
FROM ad_campaigns
WHERE workspace_id = X;
```

### 2. 🟡 Implementar Sync UTMify Real

**Pergunta aberta:** A UTMify tem API pública documentada? Ou precisamos usar Facebook Marketing API diretamente?

**Opções:**
- **A)** Se UTMify tem API → implementar `_fetch_utmfy_ads()` com o endpoint real
- **B)** Se não tem API → usar Facebook Marketing API como fonte primária
- **C)** Importação manual via CSV (já existe para vendas) — adaptar para ads

**O que fazer agora:**
- Pesquisar documentação da UTMify (https://utmfy.com ou https://docs.utmfy.com)
- Se não existir API pública, implementar fallback com Facebook Marketing API
- Criar tela de "Importar Campanhas" similar à de "Importar Vendas"

### 3. 🟡 Endpoint PATCH Workspace com attribution_model

**Arquivo:** `backend/app/routers/workspaces.py` (ou onde estiver o router de workspaces)

**O que fazer:**
- Encontrar o endpoint `PATCH /api/workspaces/:id`
- Adicionar `attribution_model` aos campos aceitos
- Validar que o valor é `'first_touch'` ou `'last_touch'`

```python
class WorkspaceUpdate(BaseModel):
    name: Optional[str] = None
    attribution_model: Optional[str] = None  # ← adicionar

@router.patch("/{workspace_id}")
async def update_workspace(workspace_id: str, data: WorkspaceUpdate, ...):
    updates = data.dict(exclude_unset=True)
    if "attribution_model" in updates:
        if updates["attribution_model"] not in ("first_touch", "last_touch"):
            raise HTTPException(400, "attribution_model inválido")
    supabase.table("workspaces").update(updates).eq("id", workspace_id).execute()
```

### 4. 🟢 Teste E2E Completo

**Passos:**
1. Rodar migration 011 (✅ já feito)
2. Iniciar backend e frontend
3. Abrir `http://localhost:5173/test-tracker.html?utm_source=facebook&utm_campaign=teste1`
4. Clicar em botões de quiz
5. Verificar no Supabase:
   ```sql
   SELECT session_id, first_utm_json, last_utm_json, attributed_ad_id, quiz_answers_json
   FROM lead_profiles ORDER BY last_seen DESC LIMIT 5;
   ```
6. Trocar modelo de atribuição nas Settings
7. Repetir teste e verificar se `attributed_ad_id` muda

---

## Arquitetura Final (Visão Geral)

```
┌─────────────────────────────────────────────────────────────┐
│                     PÁGINA DO FUNIL                         │
│  (Typebot, Elementor, custom)                               │
│                                                             │
│  <script src="tracker.js" data-funnel-id="X"></script>     │
│                                                             │
│  tracker.js:                                                │
│  ├─ Captura UTMs na primeira carga → sessionStorage         │
│  ├─ Envia heartbeats com first_utm + current_utm            │
│  └─ Auto-detect de quiz (button, radio, select, etc.)       │
└──────────────────────┬──────────────────────────────────────┘
                       │ POST /api/live/track
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   BACKEND (FastAPI)                         │
│                                                             │
│  live.py:                                                   │
│  ├─ Salva quiz_answers                                      │
│  ├─ Upsert lead_profiles com first/last UTM                 │
│  └─ Atribuição baseada em workspace.attribution_model       │
│                                                             │
│  quiz.py (NOVO):                                            │
│  ├─ GET /heatmap → quiz_answers agrupado por campanha       │
│  ├─ GET /dropoff → funil por UTM source                     │
│  ├─ GET /audience → ad_campaigns.audience_json              │
│  ├─ GET /ad-performance → métricas financeiras              │
│  └─ POST /sync-utmfy → chama ad_sync.py                     │
│                                                             │
│  ad_sync.py:                                                │
│  └─ Busca campaigns da UTMify/Facebook → upsert ad_campaigns│
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    SUPABASE (Postgres)                      │
│                                                             │
│  quiz_answers      — respostas individuais                  │
│  lead_profiles     — perfil consolidado (first/last UTM)    │
│  ad_campaigns      — campanhas/anúncios sincronizados       │
│  workspaces        — attribution_model configurável         │
│  live_page_entries — histórico de páginas visitadas         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  FRONTEND (React)                           │
│                                                             │
│  MetricsPage → aba "Quiz & Ads" (QuizAdsTab.tsx)            │
│  ├─ Heatmap de respostas por pergunta × campanha            │
│  ├─ Drop-off por source (funil segmentado)                  │
│  ├─ Audience breakdown por ad_id                            │
│  └─ Tabela de performance por criativo                      │
│                                                             │
│  SettingsPage → card "Modelo de Atribuição"                 │
│  └─ Select first_touch / last_touch                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Decisões Pendentes

- [ ] **UTMify tem API pública?** Se sim, qual endpoint? Se não, usar Facebook Marketing API ou importação manual?
- [ ] **Histórico completo de UTMs por sessão?** Hoje só first/last. Queremos array completo?
- [ ] **Capturar formulários de contato além de quiz?** (nome/email) para enriquecer lead_profile
- [ ] **Tela de "Regras de Atribuição Manual"?** Similar à de vendas não atribuídas (decisão 2.13)

---

## Referências no Código

| O quê | Onde |
|-------|------|
| Tracker atual | `frontend/public/tracker.js` (linhas 88-99 UTM, 261-386 quiz) |
| Backend track | `backend/app/routers/live.py` (linhas 66-184) |
| Schema existente | `backend/supabase/schema.sql` + `migrations/010_quiz_utmfy.sql` |
| Migration nova | `backend/supabase/migrations/011_ad_tracking_attribution.sql` |
| Frontend Quiz & Ads | `frontend/src/components/metrics/QuizAdsTab.tsx` |
| API client | `frontend/src/api/client.ts` (linhas 1346-1697) |
| Settings | `frontend/src/pages/SettingsPage.tsx` |
| Decisão 2.13 (atribuição) | `PLANO.md` seção 2.13 |

---

## Checklist de Validação

- [ ] Migration 011 rodada no Supabase ✅
- [ ] Backend aceita `first_utm` no payload ✅
- [ ] Tracker salva first_utm no sessionStorage ✅
- [ ] Tracker envia first_utm em heartbeats e quiz_answers ✅
- [ ] Auto-detect de quiz funciona sem data-attributes ✅
- [ ] Lead profiles gravam first_utm_json e last_utm_json ⏳ (verificar no banco)
- [ ] Atribuição usa modelo do workspace ⏳ (endpoint PATCH falta)
- [ ] Página Quiz & Ads carrega sem erros ❌ (router falta)
- [ ] Sync UTMify popula ad_campaigns ❌ (API real falta)
- [ ] Teste E2E completo ⏳

---

*Última atualização: 2026-09-07*
*Próxima ação: criar `backend/app/routers/quiz.py` com os 5 endpoints que o frontend já chama*