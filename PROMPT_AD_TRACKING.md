# PROMPT: Rastreamento de Criativos, Campanhas e Respostas de Quiz por Lead

> **Objetivo:** Implementar no FUNNELTRON a capacidade de rastrear, por sessão/lead individual, de qual anúncio (criativo) e campanha ele veio, cruzando esses dados com as respostas do quiz em cada etapa do funil. Isso permite analisar a qualidade do público de cada criativo (ex: "80% dos leads do Ad X têm 20-25 anos") e identificar gargalos específicos por origem de tráfego.

---

## 1. CONTEXTO E MOTIVAÇÃO

Atualmente o FUNNELTRON já possui:
- Rastreador próprio (`tracker.js`) que captura heartbeats, UTM params e respostas de quiz (`event_type: quiz_answer`).
- Backend (`live.py`) que salva `quiz_answers` e faz upsert em `lead_profiles`, tentando casar UTMs com `ad_campaigns`.
- Integração planejada com UTMify para dados financeiros.

**O que falta:**
1. **Conexão real com Facebook Ads / UTMify** para importar automaticamente a estrutura de campanhas, conjuntos de anúncios e criativos (ad_id, ad_name, campaign_id, creative_id).
2. **Snippet universal de captura de respostas** que funcione em qualquer funil (Typebot, Elementor, páginas customizadas) sem depender apenas de data-attributes específicos.
3. **Dashboard de análise cruzada**: visualizar a distribuição de respostas do quiz segmentada por ad_id/campaign_id, e a taxa de abandono por etapa segmentada por origem.
4. **Atribuição robusta**: garantir que o lead_profile mantenha a atribuição mesmo que o UTM mude entre páginas (first-touch vs last-touch configurável).

---

## 2. ARQUITETURA PROPOSTA

### 2.1. Ingestão de Dados de Anúncios (Fonte: UTMify ou Facebook API)

Como a UTMify já é a fonte única de vendas (decisão 2.12 do PLANO.md), ela deve ser também a fonte primária de metadados de anúncios para manter consistência.

- **Tabela `ad_campaigns` (já existe, mas precisa ser populada):**
  - `id` (uuid)
  - `workspace_id` (fk)
  - `platform_ad_id` (string, ex: "fb_123456789")
  - `platform_campaign_id` (string)
  - `name` (nome do criativo/anúncio)
  - `campaign_name`
  - `utm_json` (jsonb: {utm_source, utm_medium, utm_campaign, utm_content, utm_term})
  - `audience_json` (jsonb: idade, gênero, interesses — se disponível via API)
  - `status` (active, paused, archived)
  - `last_synced_at`

- **Sincronização:**
  - Criar serviço `services/ad_sync.py` que puxa a lista de campanhas/ads da UTMify (ou Facebook Marketing API como fallback).
  - Rodar via scheduler (`core/scheduler.py`) a cada 6h ou manualmente via botão "Sincronizar Anúncios" em Configurações.
  - O sync deve fazer upsert por `platform_ad_id` + `workspace_id`.

### 2.2. Snippet Universal de Captura de Respostas

O `tracker.js` atual já captura cliques em elementos com `data-funneltron-answer`. Para torná-lo universal:

- **Modo "Auto-Detect" (padrão):** O script escuta todos os cliques em `button`, `input[type=radio]`, `input[type=checkbox]`, `select`, e `[role=button]`. Se o elemento estiver dentro de um container que pareça ser uma pergunta (heurística: contém `<h2>`, `<h3>`, `.question`, `.pergunta`, ou texto com "?"), extrai:
  - `question_id`: id do container, ou hash do texto da pergunta.
  - `answer_value`: value do input, textContent do button, ou selected option.
  - `answer_id`: hash determinístico de `question_id + answer_value`.

- **Modo "Explícito" (override):** Mantém suporte a `data-funneltron-question` e `data-funneltron-answer` para casos onde a heurística falha.

- **Envio:** Usa o mesmo endpoint `/api/live/track` com `event_type: 'quiz_answer'`. O payload inclui `utm` capturado na primeira carga da página (first-touch) + `current_utm` (last-touch) para permitir ambos os modelos de atribuição.

- **Persistência de UTM no SessionStorage:** O tracker deve salvar os UTMs da *primeira* página visitada na sessão em `sessionStorage.setItem('funneltron:first_utm', ...)`. Nos heartbeats subsequentes, envia tanto `first_utm` quanto `current_utm`. O backend decide qual usar baseado na configuração do workspace.

### 2.3. Backend: Atribuição e Consolidação

Em `routers/live.py`, função `_atualizar_lead_profile`:

- **Regra de atribuição configurável:** Adicionar campo `attribution_model` na tabela `workspaces` ('first_touch' | 'last_touch' | 'multi_touch'). Default: 'first_touch'.
- **Casamento com ad_campaigns:** Ao receber um heartbeat/quiz_answer com UTMs:
  1. Buscar em `ad_campaigns` onde `utm_json` bate com os UTMs recebidos (prioridade: utm_content > utm_campaign > utm_source).
  2. Se encontrar, preencher `lead_profiles.ad_id` e `lead_profiles.campaign_id`.
  3. Se não encontrar, deixar null (mas gravar os UTMs crus para posterior criação de regra manual, similar à decisão 2.13 de vendas não atribuídas).
- **Lead Profile Schema Update:**
  - `first_utm_json` (jsonb)
  - `last_utm_json` (jsonb)
  - `attributed_ad_id` (uuid, fk ad_campaigns)
  - `attributed_campaign_id` (uuid, fk ad_campaigns)
  - `quiz_answers_json` (já existe, mas garantir que inclua timestamp e step_id)

### 2.4. Frontend: Dashboard de Análise Cruzada

Nova aba ou seção dentro de "Métricas" chamada **"Análise por Criativo"**:

- **Filtros:** Período, Funil, Campanha, Criativo.
- **Tabela Principal:** Linhas = Criativos (ad_name). Colunas:
  - Leads Totais
  - Taxa de Conclusão do Funil (%)
  - Abandono na Etapa X (%)
  - Distribuição de Resposta Y (ex: barra empilhada mostrando % de "20-25", "26-30", etc.)
- **Gráfico de Sankey ou Fluxo:** Mostrando o caminho dos leads de um criativo específico pelas etapas, com espessura proporcional ao volume.
- **Alertas Visuais:** Se >70% dos leads de um criativo abandonam na mesma etapa, destacar em vermelho.

---

## 3. MIGRATIONS NECESSÁRIAS

```sql
-- Migration 010_ad_tracking.sql

-- 1. Expandir ad_campaigns
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS platform_ad_id TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS platform_campaign_id TEXT;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS audience_json JSONB;
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE ad_campaigns ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_utm ON ad_campaigns USING GIN (utm_json);

-- 2. Expandir lead_profiles
ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS first_utm_json JSONB;
ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS last_utm_json JSONB;
ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS attributed_ad_id UUID REFERENCES ad_campaigns(id);
ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS attributed_campaign_id UUID REFERENCES ad_campaigns(id);
ALTER TABLE lead_profiles ADD COLUMN IF NOT EXISTS attribution_model TEXT DEFAULT 'first_touch';

-- 3. Workspace config
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS attribution_model TEXT DEFAULT 'first_touch';
```

---

## 4. TAREFAS DE IMPLEMENTAÇÃO (ORDEM SUGERIDA)

1. **Backend:** Criar `services/ad_sync.py` com adapter para UTMify (e stub para Facebook API). Testar com dados mock.
2. **Migration:** Rodar `010_ad_tracking.sql` no Supabase.
3. **Tracker.js:** Implementar persistência de `first_utm` no sessionStorage e envio duplo (first/current). Melhorar heurística de auto-detect de quiz.
4. **Backend:** Atualizar `_atualizar_lead_profile` para usar `first_utm`/`last_utm` e casar com `ad_campaigns`.
5. **Frontend Settings:** Adicionar seletor de modelo de atribuição na página de Configurações do Workspace.
6. **Frontend Metrics:** Criar componente `AdPerformanceTable` e integrar na página de Métricas.
7. **Testes E2E:** Simular tráfego com UTMs diferentes, verificar se lead_profiles são atribuídos corretamente e se o dashboard reflete a distribuição de respostas.

---

## 5. PERGUNTAS ABERTAS PARA DECISÃO

- [ ] A UTMify expõe endpoint para listar criativos/campanhas com seus UTMs? Ou precisaremos usar a Facebook Marketing API diretamente?
- [ ] Queremos armazenar o histórico completo de UTMs por sessão (array) ou só first/last?
- [ ] O snippet universal deve tentar capturar respostas de formulários de contato (nome/email) além de quiz? (Isso ajudaria a enriquecer o lead_profile mesmo sem quiz.)
- [ ] Devemos criar uma tela de "Regras de Atribuição Manual" similar à de vendas não atribuídas, para quando o casamento automático falhar?

---

## 6. REFERÊNCIAS NO CÓDIGO EXISTENTE

- Tracker atual: `frontend/public/tracker.js` (linhas 88-99 para UTM, 261-386 para quiz)
- Backend track: `backend/app/routers/live.py` (linhas 66-184 para quiz e lead_profile)
- Decisões de atribuição de vendas: `PLANO.md` seção 2.13
- Schema existente: `backend/supabase/schema.sql` (tabelas `ad_campaigns`, `lead_profiles`, `quiz_answers`)

---

*Este prompt é autocontido e pode ser entregue a outra IA ou usado como especificação para desenvolvimento. Todas as referências a arquivos e decisões estão alinhadas com o estado atual do projeto documentado em PLANO.md.*