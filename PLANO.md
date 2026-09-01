# PLANO — FUNNELTRON

Arquivo de contexto vivo do projeto. **Atualizado ao fim de cada tarefa.**
Última atualização: 2026-08-31 (redesign pixel-match em andamento)

---

## 1. O que é o projeto

Ferramenta local para **construir funis de vendas visualmente e analisar as
métricas reais de cada etapa**.

Duas metades, igualmente importantes:

1. **Construir** — o *ateliê*: canvas infinito tipo mapa mental / Typebot,
   cards de página, setas ligando página a página.
2. **Analisar** — cada seta mostra a conversão real de uma página para a
   próxima, vinda de Microsoft Clarity (páginas), VTurb (VSL) e UTMify
   (vendas e gasto em anúncio).

O usuário desenha o funil, aponta a URL de cada página, e o sistema mostra
onde o dinheiro está vazando.

---

## 2. Decisões que valem para o projeto inteiro

Já decididas — não relitigar sem motivo novo.

### 2.1 Conversão de funil × conversão de compra

**Regra de nomenclatura, obrigatória em toda a interface:**

| Fala de | Escrever |
|---|---|
| avanço entre páginas | **conversão de funil** |
| venda concluída | **conversão de compra** |

Nunca usar "taxa" sozinho — não diz de qual das duas se trata.
Fonte única dos rótulos: `frontend/src/lib/metricGlossary.ts`.

### 2.2 Conversão página → página

```
taxa = visitantes_da_página_destino ÷ visitantes_da_página_origem
```

"De 100 que chegaram na página A, 50 chegaram na B" = **50%**.

**Não** usar `conversões_da_origem` no denominador: converter na página A *é,
por definição*, virar visitante da página B, então a conta dá 100% sempre.
Foi o bug original. Implementado em `lib/conversion.ts → pageToPageRate()`.

### 2.3 Escala de cor da conversão

| Faixa | Cor |
|---|---|
| ≥ 80% | verde `hsl(142 71% 45%)` |
| ≥ 50% | amarelo `hsl(38 92% 50%)` |
| < 50% | vermelho `hsl(0 72% 51%)` |

Escala única — canvas, cards e página de Métricas. Fonte: `lib/conversion.ts`.

### 2.4 Ausência de dado nunca vira zero

Métrica sem fonte mostra **"—"** em cinza, nunca `0,0%` em vermelho.
Um funil sem página de obrigado não tem conversão de compra *ruim*; ele não
tem conversão de compra *medida*. Na ordenação, esses funis vão para o fim em
qualquer direção. Tipo: `purchaseRate: number | null`.

### 2.5 Página-meta da conversão de compra

Cada funil pode marcar **qual página encerra a medição**
(`Funnel.conversionGoalStepId`). Sem marcação, cai na primeira etapa do tipo
"obrigado".

Importa em funil com upsell: o fim do *front* raramente é a última página do
fluxo. Resolvido em `lib/funnelStats.ts → resolveGoalStep()`.

### 2.6 Ofertas paralelas ≠ etapas do fluxo

Order bump, upsell e downsell acontecem **dentro** de outra página. Ninguém
"abandona o funil" por não pegar o bump. Então não entram no cálculo de queda
do fluxo principal, e o número que importa nelas é a **conversão de compra da
própria oferta**.

### 2.7 Tipos de seta e suas cores

`lib/edgeStyle.ts`

| Tipo | Cor | Traço |
|---|---|---|
| Direto | cinza | sólido |
| Ao aceitar | verde | tracejado |
| Ao recusar | vermelho | tracejado |
| Com bump | âmbar | tracejado |
| Sem bump | cinza claro | tracejado |
| **Back redirect** | roxo | pontilhado |

Precedência: **com métrica, a cor é a da conversão**; sem métrica, a do tipo.

### 2.8 Uma geometria só para o funil

O card do ateliê e o card dos previews são **o mesmo componente**
(`AtelierNode`, com `variant: "dark" | "light"`). Mesma largura, mesmas
alturas internas.

Motivo: as posições são salvas em coordenadas absolutas. Cards de alturas
diferentes nas mesmas coordenadas produzem espaçamentos visuais diferentes —
o funil desenhado no ateliê tem que aparecer idêntico na página do funil e na
página de métricas.

### 2.9 Funil de upsell é um funil reaproveitável

`Funnel.kind: "front" | "upsell"`.

Um funil de upsell é desenhado no mesmo ateliê, mas pode ser **invocado dentro
de outro funil como um bloco único** (etapa do tipo `sub_funnel`, apontando
para o funil pelo `subFunnelId`). Assim o mesmo upsell serve vários fronts sem
ser redesenhado.

### 2.10 Um funil tem VÁRIAS VSLs

VSL principal, VSL de upsell, VSL de downsell — todas no mesmo funil.

Por isso `VslInsight` é amarrado a **`stepId`**, não ao funil. Casar por nome
de funil (como era antes) torna impossível representar mais de um vídeo.

Onde se fala do funil em geral → **média ponderada pelas views**
(`summarizeVsl()`). Uma VSL de 400 views não pode pesar igual a uma de 8.000.
Onde se olha o funil de perto → **cada VSL individualmente**, com a melhor
delas destacada.

### 2.11 Comparação sempre elege um vencedor

Ao comparar funis, o placar conta em quantas métricas **de desempenho** cada
um vence; métricas informativas (quantidade de etapas, quantidade de VSLs) não
contam. Empate no placar mostra "empate técnico" — dizer que um é melhor sem
diferença real seria inventar conclusão.

### 2.12 Relatório de vendas vem da UTMify

Fonte única dos dados financeiros: **UTMify**. O gasto em anúncio **vem junto**
no mesmo relatório — não é digitado à mão.

Documentação do formato: o usuário vai passar. Até lá, **não escrever parser**.

**Regra de arquitetura:** normalizar na entrada. Tudo que a UTMify manda vira
um `Sale` interno logo no adaptador; nenhuma tela conhece o schema dela.

```ts
interface Sale {
  id: string;
  funnelId: string | null;   // null = não atribuída
  date: string;
  status: "approved" | "pending" | "refunded" | "chargeback";
  grossValue: number;
  netValue: number;
  fees: { checkout: number; gateway: number; tax: number };
  adSpend: number;
  utm: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  productName?: string;
  checkoutUrl?: string;
}
```

### 2.13 Atribuição: de qual funil veio cada venda

A UTMify não conhece "funil" — esse conceito é nosso. A ligação é feita por
uma **camada de regras** avaliadas em ordem: `campo + operador + valor → funil`.

| Chave | Confiabilidade | Observação |
|---|---|---|
| URL de checkout / id da oferta | alta | casa exato com as URLs já cadastradas no ateliê |
| `utm_campaign` / `utm_content` | média | o usuário já usa nomenclatura padrão (`A1.1-H-AP12-S1-V1-…`) |
| Nome do produto | média | mapa manual, uma vez |

**Não negociável:** venda que não bate em regra nenhuma vai para um balde de
**"não atribuídas"** visível na tela, com ação "criar regra a partir desta
venda". Descartar em silêncio falsearia o ROAS global.

### 2.15 Aba "Ao Vivo" — duas fontes, duas janelas

Estudo completo em `docs/AO-VIVO.md`. As decisões que valem:

**VTurb entrega live users, mas só das VSLs.**
`GET /sessions/live_users?player_id=&minutes=` devolve `[{domain, live_users}]`.
Limitações que mudam o desenho da tela:

- É **"entrou nos últimos N minutos"**, não "está na página agora" — a própria
  doc avisa. O rótulo na tela tem que dizer a janela.
- Cache de 30s com revalidação a cada 15s: polling abaixo de ~20s só queima
  cota, não traz dado novo.
- Agrupa por **domínio**, não por página. Sem granularidade de etapa.
- **Só enxerga páginas com player VTurb.** Landing, checkout e obrigado ficam
  invisíveis. Num funil de 21 páginas com 2 VSLs, cobre 2.
- Uma chamada por player. 10 VSLs a cada 20s = 30 req/min, metade do plano
  Basic (60/min). Usar `GET /quota/usage` para se auto-limitar.

**Para o funil inteiro é preciso rastreador próprio.** VTurb complementa, não
substitui.

**Na Vercel o tempo real não pode morar na função.** Sem memória entre
invocações; WebSocket nativo entrou em beta em jun/2026 mas prende a conexão a
uma instância e não faz broadcast entre instâncias. O desenho que funciona é
snippet com heartbeat → Redis com TTL de 45s → frontend faz polling de 5s.

**⚠️ SQLite não sobrevive na Vercel** (disco efêmero). Isso conflita com o
`PROMPT_CLAUDE_CODE.md` e precisa ser decidido antes do backend andar.

### 2.14 Screenshot da página

O navegador **não consegue** printar site de terceiro (canvas tainted, iframe
bloqueado). Captura real exige backend com Playwright.

Enquanto não existe: `captureScreenshot()` devolve placeholder no mock; a UI
sempre aceita **colar (Ctrl+V), arrastar ou escolher** print manual; erro do
backend vira mensagem explícita, nunca falha muda.

### 2.15 Duas fontes de dados, nunca somadas

O nosso rastreador e o Microsoft Clarity **não medem a mesma coisa**. O Clarity
entrega agregado por dia, com atraso de publicação; o rastreador entrega evento
por sessão, agora. Cada um define "sessão" à sua maneira.

Por isso:

- **Tabelas separadas** (`tracker_snapshots`, `clarity_snapshots`). Nunca uma
  tabela comum de eventos — ela convidaria a somar, e a soma conta a mesma
  pessoa duas vezes.
- **Uma fonte de verdade por métrica.** Clique, rage click, heatmap → Clarity.
  Presença ao vivo, entrada em etapa, conversão do funil → nosso.
- **A interface mostra uma fonte de cada vez** (seletor em Ao Vivo, Métricas e
  Funil). "Comparar" empilha as duas rotuladas, lado a lado — nunca agregadas.
- **Junção entre as duas**: só por URL normalizada + dia
  (`snapshots.normalize_url`). Não se tenta casar sessão do Clarity com o nosso
  `session_id` — os IDs dele não são expostos por evento.

### 2.16 Todo número do Clarity vem carimbado

Numa página chamada "Ao Vivo", um dado de ontem sem rótulo passa por "agora" —
e a pessoa decide em cima disso. Então nenhum valor do Clarity aparece na tela
sem `AsOfBadge` ao lado: badge no topo do painel, carimbo em cada card, e a
palavra "agora" some dos rótulos quando a fonte é Clarity. Os seletores de
janela (5m/30m/1h) somem também: são recorte que essa fonte não sabe entregar.

Snapshot com mais de 24h é marcado como **defasado**; sem nenhum snapshot, a
tela diz "nenhuma importação ainda" em vez de mostrar zero — zero e
"não importei" são coisas diferentes.

### 2.17 Dedupe é por chave de evento, com índice total

O navegador reenvia o mesmo heartbeat sozinho (retry de rede, `sendBeacon` no
fechamento da aba). O `tracker.js` gera um `event_id` por visualização de
página — igual em todos os beats da mesma página, novo quando a URL muda — e o
backend faz `upsert(on_conflict="event_id")`.

O índice é **total, não parcial**: índice parcial não serve de alvo para
`ON CONFLICT` (erro 42P10, o tropeço que já derrubou o webhook de vendas). Não
precisa ser parcial porque NULLs nunca colidem entre si — beats de snippets
antigos, sem `event_id`, continuam entrando.

No Clarity o dedupe é por **snapshot**, não por evento: chave
`(project_id, page_url, period, date)` e reimportar **substitui** a linha. Sem
isso, rodar o import duas vezes no mesmo dia dobra o número.

---

## 3. Estado atual

> **O sistema está no ar e ligado no banco.** Backend FastAPI + Supabase
> (Postgres, Auth, Storage), frontend com `VITE_USE_MOCK=false`. Para subir:
> `README.md` → "Como rodar". Para conferir que continua inteiro:
> `cd backend && .venv\Scripts\python smoke_test.py` (45 verificações).

### ✅ Feito

| # | Tarefa | Onde |
|---|---|---|
| 1 | Mocks voltaram a funcionar (`USE_MOCK` estava `false` apontando p/ backend inexistente → tudo 500) | `api/client.ts` |
| 2 | Métricas por etapa para os 4 funis de exemplo | `api/mockData.ts` |
| 3 | Métricas acessível pela sidebar (`/metrics`) | `Sidebar.tsx`, `App.tsx` |
| 4 | Conversão página→página corrigida (era tautológica: 100% sempre, 500% no bump) | `lib/conversion.ts`, `MetricsPage.tsx` |
| 5 | Bloco "Ofertas paralelas" separado do fluxo principal | `MetricsPage.tsx` |
| 6 | Escala de cor 80/50 unificada | `lib/conversion.ts` |
| 7 | `StepEdge` reescrito — **não desenhava seta nenhuma**, só um `<div>` sem `path` | `StepEdge.tsx` |
| 8 | `StepNode` corrigido — `translate` duplicado deslocava os cards; métricas nunca chegavam (prop que o React Flow não repassa) | `StepNode.tsx` |
| 9 | Tipo `back_redirect` + paleta de setas | `types/`, `lib/edgeStyle.ts` |
| 10 | **Ateliê** — tela cheia, canvas infinito, painéis flutuantes, arrow-first | `FunnelEditorPage.tsx`, `AtelierNode.tsx`, `AtelierEdge.tsx` |
| 11 | Rota do ateliê fora do layout com sidebar | `App.tsx` |
| 12 | **Salvar** — botão + Ctrl+S + aviso ao sair; persistência em `localStorage` | `FunnelEditorPage.tsx`, `api/client.ts` |
| 13 | **Bug:** soltar seta em cima de outro card criava páginas fantasma | `FunnelEditorPage.tsx` |
| 14 | Status do funil selecionável no ateliê, salvo junto | `FunnelEditorPage.tsx`, `api/client.ts` |
| 15 | Período com **intervalo de datas livre** (não só 7/30/90/tudo) | `PeriodPicker.tsx`, `api/client.ts`, `types/` |
| 16 | Métricas: **barra de funis clicável** abaixo do título; 2+ selecionados = comparação métrica a métrica | `MetricsPage.tsx` |
| 17 | Métricas: **visão global** (todos os funis somados) como padrão | `MetricsPage.tsx` |
| 18 | Lista de funis: período, ordenação por métrica, melhores/piores, ranking `#n` | `FunnelListPage.tsx` |
| 19 | **Balõezinhos** explicando cada métrica ao passar o mouse | `MetricLabel.tsx`, `lib/metricGlossary.ts` |
| 20 | Nomenclatura conversão de funil × conversão de compra aplicada | todas as telas |
| 21 | "—" em vez de 0,0% quando não há dado | `funnelStats.ts`, `FunnelListPage.tsx`, `MetricsPage.tsx` |
| 22 | Página-meta da conversão de compra, marcável no ateliê | `funnelStats.ts`, `FunnelEditorPage.tsx` |
| 23 | Métricas: seção "Conversão de Página para Página" virou **o funil desenhado**, com zoom e centralização | `MetricsPage.tsx` |
| 24 | Métricas: **seção dedicada das VSLs** (abriram → chegaram no botão → clicaram) | `MetricsPage.tsx` |
| 25 | **Modelo de múltiplas VSLs por funil** — `VslInsight` passou a ser amarrado a `stepId`; média ponderada por views | `types/`, `api/mockData.ts`, `lib/funnelStats.ts` |
| 26 | Home: seção de VSL agrupada por funil, com média do funil e abertura para cada VSL | `DashboardPage.tsx` |
| 27 | Comparação: **veredito de melhor funil** por placar de métricas vencidas, troféu em cada linha, empate técnico explícito | `MetricsPage.tsx` |
| 28 | Comparação ganhou conversão de VSL, engajamento, views, pior passagem e pessoas perdidas | `MetricsPage.tsx` |
| 29 | Atalho **"Hoje"** no período + bloco movido para a linha dos filtros | `PeriodPicker.tsx`, `FunnelListPage.tsx` |
| 30 | **Geometria única** — `FunnelCanvas` passou a usar `AtelierNode variant="light"`; `StepNode` removido | `FunnelCanvas.tsx`, `AtelierNode.tsx` |
| 31 | **Funil de upsell** — sub-abas front/upsell, funis de exemplo, nó `sub_funnel` no ateliê e seletor de qual upsell embutir | `FunnelListPage.tsx`, `AtelierNode.tsx`, `FunnelEditorPage.tsx`, `api/mockData.ts` |
| 32 | **Popup de novo funil** com 3 opções: do zero, de upsell, ou importar por lista de URLs | `NewFunnelDialog.tsx`, `lib/urlImport.ts`, `FunnelListPage.tsx` |
| 33 | **Importação por lista de URLs** — cria as páginas em ordem, liga em sequência e deduz o tipo pelo slug | `lib/urlImport.ts` |
| 34 | **Página de Importações** — lê CSV/TSV da UTMify, detecta separador, tipa as colunas e guarda o histórico | `ImportsPage.tsx`, `lib/csv.ts`, `api/client.ts` |
| 35 | Captura de print parou de **fingir sucesso** com foto aleatória; agora explica que precisa do backend | `api/client.ts`, `FunnelEditorPage.tsx` |
| 36 | Comparação: volume (visitas, conversões, views, perdidos) virou informativo e **não conta para o placar** | `MetricsPage.tsx` |
| 37 | Conversão média das VSLs entrou na linha de KPIs do funil | `MetricsPage.tsx` |
| 38 | App renomeado para **FUNNELTRON** | `Sidebar.tsx`, `index.html`, `README.md` |
| 39 | Popup de novo funil levantado para um provider — sidebar e página de Funis abrem o mesmo | `NewFunnelProvider.tsx`, `App.tsx`, `Sidebar.tsx` |
| 40 | **Ctrl+Z / Ctrl+Shift+Z** no ateliê para desfazer o arrasto dos cards, com botão na barra | `FunnelEditorPage.tsx` |
| 41 | **Modo "Editar funis"** na lista: trocar status, duplicar (com o desenho inteiro) e apagar | `FunnelListPage.tsx`, `api/client.ts` |
| 42 | **Modo noturno de verdade** — paleta virou CSS variables, tema persiste e segue o SO na 1ª visita | `index.css`, `tailwind.config.js`, `Header.tsx` |
| 43 | Canvas, minimapa, grades de gráfico e ícone do seletor de data passaram a seguir o tema | `FunnelCanvas.tsx`, `MetricsPage.tsx`, `DashboardPage.tsx`, `index.css` |
| 44 | Botões de status no modo de edição ganharam borda e rótulo — antes não pareciam clicáveis | `FunnelListPage.tsx` |
| 45 | Verde/amarelo/vermelho escurecidos no tema claro: como texto ficavam em ~2:1 de contraste | `index.css` |
| 46 | **Backend FastAPI escrito** — routers `auth`, `funnels`, `layout`, `screenshots`, `metrics`, `integrations`, `imports`, `live`; serviços Clarity/VTurb/screenshot; rate limiter; schema Supabase | `backend/app/**`, `backend/supabase/schema.sql` |
| 47 | **Login/cadastro** com sessão persistida e rotas protegidas | `LoginPage.tsx`, `AuthContext.tsx`, `App.tsx` |
| 48 | **Página de Configurações** — VTurb (com tier de rate limit), Clarity (OAuth Azure), webhook PerfectPay e snippet do rastreador | `SettingsPage.tsx`, `TrackerCard.tsx` |
| 49 | **Aba "Ao Vivo"** — canvas do funil com pessoas online por etapa, barra de conversão da janela, feed de vendas do webhook e entradas recentes nas VSLs (VTurb) | `LivePage.tsx`, `LiveFunnelCanvas.tsx`, `LiveNode.tsx`, `live/*.tsx`, `backend/app/routers/live.py` |
| 50 | **Rastreador próprio** — `tracker.js` com heartbeat servido pelo frontend + `POST /api/live/track` no backend | `frontend/public/tracker.js`, `backend/app/routers/live.py` |
| 51 | **App voltou a compilar** — `TrackerCard` tinha `<head>` literal dentro do JSX (3 ocorrências → Vite 500 em tudo); `encodeQuery` inexistente em `getClarityMetrics`; `LivePage` importava tipos de domínio de `api/client`; faltava `vite-env.d.ts` para `import.meta.env`. `npx tsc --noEmit` passa limpo | `TrackerCard.tsx`, `api/client.ts`, `LivePage.tsx`, `vite-env.d.ts` |

| 52 | **Ao Vivo em vermelho** — painel do fluxo, borda e fundo do canvas, partículas de pessoas, badge "N online" e selo "AO VIVO" no canto. Card sem ninguém fica apagado; com gente acende halo vermelho | `LivePage.tsx`, `LiveFunnelCanvas.tsx`, `LiveNode.tsx` |
| 53 | **Seta do ao vivo parou de bugar** — o `filter` de blur gaussiano aplicado ao traço era recortado pela região do filtro (linha partida), e o `<g filter>` em volta da bolinha calculava a região pela bbox estática, então a bolinha sumia ao andar. Brilho virou círculo translúcido; `<defs>` saiu de dentro de cada aresta (id repetido) e foi para o canvas | `StepEdge.tsx`, `LiveFunnelCanvas.tsx` |

| 54 | **Número de pessoas ao vivo fora do card**, grande, acima ou abaixo conforme o vizinho — `resolveBadgeSide()` olha quem ocupa a faixa de baixo e sobe o número se for cobrir alguém | `LiveNode.tsx`, `lib/canvasLayout.ts` |
| 55 | **Espaçamento garantido na visualização** — `spreadSteps()` separa cards encavalados por eixo de menor penetração, preservando a forma desenhada. Vale na página do funil, métricas e ao vivo; o ateliê continua livre | `lib/canvasLayout.ts`, `FunnelCanvas.tsx`, `LiveFunnelCanvas.tsx` |
| 56 | Partículas de pessoas dentro do print **removidas** — com 30 pessoas escondiam o print e não diziam nada que o número não diga | `LiveNode.tsx` |
| 57 | **Log de entradas em página** ("#a3f entrou em Checkout, há 12s"), com dispositivo, origem e as duas linhas mais novas destacadas. Seção de vendas desceu para baixo dele | `PageEntriesFeed.tsx`, `LivePage.tsx`, `api/client.ts`, `backend/app/routers/live.py`, `schema.sql` |
| 58 | **Conversão do dia** ao lado da janela curta na página Ao Vivo — 30 min diz como está agora, o dia diz se isso é normal | `ConversionBar.tsx`, `LivePage.tsx`, `api/client.ts` |
| 59 | Rótulos do bloco de conversão ao vivo corrigidos: "Taxa" sozinho virou **conversão de compra**, com balãozinho e exemplo numérico em cada um | `metricGlossary.ts`, `MetricLabel.tsx`, `ConversionBar.tsx` |
| 60 | **Backend rodando pela primeira vez** — venv, deps reinstaladas (pins de 2024 exigiam compilar Rust/C no Python 3.14), `email-validator` que faltava, `.env` local. `uvicorn` sobe, 30 rotas registradas, `/api/health` responde, protegidas devolvem 401 limpo | `backend/requirements.txt`, `backend/.env`, `backend/.venv` |
| 61 | **Contrato frontend↔backend alinhado** — o frontend mandava `funnelId`/`from`/`to` onde o FastAPI espera `funnel_id`/`from_date`/`to_date`, e chamava `/api/funnels/:id/metrics` e `/:id/sync`, que não existem (são `/api/metrics/funnels/...`). Nada disso teria funcionado ao virar a chave | `api/client.ts` |
| 62 | **`POST /funnels/:id/steps` e `/edges`** criados no backend — o frontend chamava, o backend só tinha GET | `backend/app/routers/layout.py` |
| 63 | `USE_MOCK` virou `VITE_USE_MOCK` (variável de ambiente) — a constante no fonte já derrubou o app uma vez quando foi commitada como `false` sem backend | `api/client.ts`, `frontend/.env.example` |
| 64 | **Conversão de compra ao vivo estava com denominador errado** no backend: somava os visitantes de todas as etapas, contando a mesma pessoa uma vez por página. Passou a usar a etapa de entrada | `backend/app/routers/live.py` |
| 65 | Mock de conversão refeito: cada etapa recebe fatia da **anterior**. Antes elevava a taxa da etapa ao índice dela e o dia inteiro fechava em 0,0% | `api/client.ts` |
| 66 | **🔴 SISTEMA LIGADO NO BANCO** — Supabase conectado, schema aplicado, `VITE_USE_MOCK=false`. Login, funis, ateliê, métricas, importações, ao vivo e configurações gravando e lendo Postgres de verdade | tudo |
| 67 | **Camada de tradução snake_case ↔ camelCase** (`api/mappers.ts`) — o app fala `positionX`/`sourceStepId`, o banco fala `position_x`/`source_step_id`. Sem ela: 422 ao salvar o ateliê, e na leitura as posições chegavam `undefined` (todos os cards em 0,0) | `api/mappers.ts`, `api/client.ts` |
| 68 | **Ids passaram a ser UUID** — o ateliê gerava `s_msxbmveo_0`, e as colunas são `uuid`: o erro só aparecia ao apertar Salvar, com o funil inteiro já desenhado | `FunnelEditorPage.tsx`, `NewFunnelProvider.tsx`, `api/client.ts` |
| 69 | **Captura de print de verdade** (tarefa C) — Playwright headless local por padrão, API externa só se houver `SCREENSHOT_API_KEY`. Print vai para o bucket `screenshots` do Storage | `services/screenshot.py` |
| 70 | **`smoke_test.py`** — 45 verificações que exercitam as 30 rotas na ordem em que o app usa, incluindo isolamento entre contas | `backend/smoke_test.py` |
| 71 | **Modo local sem nuvem** — sem chaves no `.env`, o backend cai num SQLite que implementa a mesma interface do cliente Supabase (`local_db.py`). `/api/health` diz qual está valendo | `core/local_db.py`, `core/supabase_client.py` |
| 72 | Rotas de métricas mapeadas: `/overview` devolvia `averageConversionRate` e o ranking `funnelId`/`funnelName` — a Home quebrava em `r.name.split()` e ficava **em branco** | `api/mappers.ts`, `DashboardPage.tsx` |
| 73 | Tendência (`trend`) virou `number \| null` e mostra "—": o backend não compara com o período anterior, e "▲ 0,0%" afirmaria estabilidade não medida (decisão 2.4) | `types/`, `DashboardPage.tsx` |
| 74 | README reescrito com o passo a passo real de subida (banco, backend, frontend, conta, teste de fumaça) | `README.md` |
| 75 | **Rastreador em produção não batia** (Railway). Três causas somadas: (a) o preflight CORS vinha do domínio do funil e a API respondia `400 Disallowed CORS origin` — agora `/api/live/track` tem CORS aberto por middleware próprio, e só ela; (b) o heartbeat mandava `application/json`, que obriga preflight — virou `text/plain` (requisição simples) e o endpoint lê o corpo cru; (c) o snippet saía sem `endpoint`, então o POST ia para o domínio do funil — o card passa a usar `window.location.origin` e o `tracker.js` deduz a origem da própria tag `<script>`. `Funneltron.lastStatus` no console diz se está batendo | `backend/app/main.py`, `backend/app/routers/live.py`, `frontend/public/tracker.js`, `TrackerCard.tsx`, `SettingsPage.tsx` |

| 76 | **Integração do Clarity estava pedindo credencial que não existe.** O card exigia Client ID, Client Secret e Project ID do Azure AD; a Data Export API do Clarity autentica só com o token do projeto — que já nasce amarrado ao projeto, sem OAuth no meio. Além do formulário, a URL montada no serviço (`clarity.ms/api/v1/export/v1/{id}/sessions`) não era endpoint real: mesmo com o token certo, a chamada falharia. Agora: **um campo só** (Token de API), endpoint `export-data/api/v1/project-live-insights`, parser das métricas que o Clarity de fato devolve, cache de 30 min e mensagem específica para 401/403/429 | `services/clarity.py`, `routers/metrics.py`, `routers/integrations.py`, `api/client.ts`, `SettingsPage.tsx` |
| 77 | **"Testar" testava o banco, não o que estava digitado.** O backend lia a credencial gravada, então quem colava o token e clicava em Testar recebia "credenciais não configuradas" — com o token correto na tela. O botão virou **"Salvar e testar"** e grava antes de chamar. No Clarity, o teste passou a bater na API de verdade (token errado ou expirado antes passava no teste e só falhava na tela de Métricas) | `SettingsPage.tsx`, `routers/integrations.py`, `services/clarity.py` |
| 78 | **Salvar Configurações apagava o token já gravado.** O backend nunca devolve token salvo (só a marca de "configurado"), então o formulário abre em branco toda vez — e cada Salvar reenviava string vazia por cima da credencial boa. Campo vazio deixou de ser enviado | `api/client.ts` |
| 79 | Página Ao Vivo na fonte Clarity **aparece zerada em vez de sumir** quando nunca houve importação: os cards ficam, com 0 e o carimbo de "nenhuma importação", e o aviso de configuração vira uma linha embaixo | `ClarityLiveView.tsx`, `api/client.ts` |
| 80 | "Taxa de rejeição" saiu das telas de Clarity: a Data Export API não publica bounce rate, e o valor exibido vinha de uma conta inventada. No lugar entraram métricas reais — visitantes únicos, páginas por sessão, rolagem média | `ClarityLiveView.tsx`, `MetricsPage.tsx`, `services/clarity.py` |
| 81 | Aba **Importações** movida para baixo de **Ao Vivo** na sidebar | `Sidebar.tsx` |
| 82 | **App travando: o backend reconstruía o cliente do Supabase a cada requisição.** Medido: `create_client` custa ~470 ms, dos quais ~430 ms são CPU pura (mesmo tempo com URL falsa, sem rede possível), e `auth.get_user` somava mais uma ida à rede por requisição. Como as telas fazem várias chamadas por funil, o custo multiplicava. Agora há cache por token (`core/cache.py`), com teto de 64 entradas e validade de 15 min (1 min para a validação do token). **Medido no mesmo processo: 1386 ms → 203 ms por requisição protegida** | `core/cache.py`, `core/supabase_client.py`, `core/auth.py` |
| 83 | `getVslInsights(period)` era chamado **uma vez por funil** com argumento idêntico, em duas telas — a mesma resposta baixada N vezes para ser filtrada no cliente depois. Passou a ser uma chamada por tela | `MetricsPage.tsx`, `FunnelListPage.tsx` |
| 84 | Ao Vivo rebuscava `listSteps` de cada funil **a cada 5 segundos** no polling. As etapas só mudam quando alguém edita o funil no ateliê — saíram do ciclo para um efeito próprio | `LivePage.tsx` |

| 85 | **Requisições simultâneas serializavam.** 38 rotas eram `async def` fazendo I/O bloqueante (todo o `supabase-py` é síncrono): rodando no event loop, cada uma travava as outras enquanto esperava o Supabase. Como o Ao Vivo dispara 3 × N chamadas de uma vez, elas entravam em fila. Declaradas `def`, o FastAPI as executa num pool de threads. Mesma mudança em `get_current_user`/`get_optional_user`. **Medido: 12 requisições simultâneas 4434 ms → 382 ms** (uma sozinha: 193 ms — ou seja, agora andam de verdade em paralelo) | `core/auth.py`, todos os `routers/` |

| 86 | **O painel do Ao Vivo piscava preto a cada atualização.** A aba de UM funil (`useLiveFunnel`) continuava rebuscando `getFunnel`/`listSteps`/`listEdges` dentro do polling — o item 84 só tinha tirado isso da vista Geral. A resposta era sempre igual, mas em objetos novos: o canvas recalculava `spreadSteps`, trocava todos os nós e chamava `fitView` antes do React Flow remedir os cards, enquadrando caixas de tamanho zero — o fundo `bg-slate-950` aparecia sozinho por um instante. Estrutura e números viraram estados separados, e o canvas passou a comparar o desenho por **assinatura** (id/label/tipo/print/posição/lado do badge), não por identidade de objeto: array novo com o mesmo desenho não remonta nem refaz o fit. `onlineMap` também virou memo por valor, para as arestas não reiniciarem as bolinhas de luz a cada ciclo | `LivePage.tsx`, `LiveFunnelCanvas.tsx` |
| 87 | **A página do Ao Vivo inteira ficava preta, do nada.** Não era layout: era um erro sem ninguém para segurar. `apiGet` é um `fetch` cru, e `fetch` só rejeita em falha de rede — um 401 (token expirado depois de um tempo com a aba aberta), 404 ou 500 chegava como resposta normal e `r.json()` devolvia o corpo de erro do FastAPI, `{detail: "..."}`, tipado como se fosse a lista esperada. O `try/catch` do `refresh` não via nada, pois ninguém tinha lançado. Aí o primeiro `for`/`reduce` em cima daquele objeto (`newestEntryTime`, `liveFlow.reduce`) lançava "is not iterable" **de dentro de um efeito** — e sem nenhuma barreira de erro no app, o React 18 desmontava a árvore inteira: sumia cabeçalho, abas, vendas, tudo, sobrando o fundo escuro da página. Corrigido na raiz: `okJson` confere o status antes de ler o corpo (24 chamadas migradas), então a falha vira exceção e cai no `catch` de quem chamou — a tela mantém os últimos dados bons. Somado a isso, `ErrorBoundary` novo em volta das três vistas do Ao Vivo, para que um erro futuro pare na seção e mostre a mensagem em vez de apagar a página, e `GeneralLiveView.refresh` ganhou o `try/catch` que faltava | `api/client.ts`, `common/ErrorBoundary.tsx`, `LivePage.tsx` |
| 88 | **Ao Vivo tinha animação em laço o tempo todo, e isso apagava o único sinal que importa.** Cinco `animate-pulse` infinitos (ponto de cada card com gente, selo do painel, os dois cabeçalhos e as duas primeiras linhas do feed — onde `fresh` era só `i < 2`, isto é, "está no topo", não "acabou de acontecer") mantinham a tela em movimento mesmo com ninguém navegando: parecia tráfego passando sem parar, e o olho deixava de acreditar na bolinha da seta, que é a única que representa uma pessoa de verdade mudando de página. Todos viraram pontos fixos — a cor continua separando "tem gente"/"vazio" e "nova"/"antiga". Os keyframes `float`, `light-travel` e `pulse-soft` do `index.css` já eram código morto (nenhum uso) e foram removidos junto | `LiveNode.tsx`, `LiveFunnelCanvas.tsx`, `LivePage.tsx`, `PageEntriesFeed.tsx`, `index.css` |

| 89 | **Histórico do rastreador não nascia sozinho.** `tracker_snapshots` (o snapshot diário consultável) só era gravado se alguém abrisse a tela e clicasse em "Sincronizar" (`POST /tracker/snapshot`) — um dia sem clique não deixava rastro nenhum ali, mesmo com `live_page_entries` (a fonte, append-only) intacto. Agora um agendador em background (`core/scheduler.py`) fecha o snapshot do dia de **todos os funis** a cada 30 min desde a subida do processo; como é `upsert` por dia, recalcular no mesmo dia atualiza a linha, nunca duplica | `core/scheduler.py`, `services/snapshots.py`, `main.py` |
| 90 | **Auditoria de ponta a ponta do rastreamento pediu 4 correções.** (a) `track_heartbeat` engolia qualquer exceção com `print` — virou `logger.exception`, com traceback visível no log do servidor; ainda devolve 204 pro snippet, que não trataria erro mesmo (`sendBeacon` ignora resposta). (b) Métricas e Funil só reagiam a troca de filtro — ganharam refresh silencioso em segundo plano (Funil: 30s, local; Métricas: 60s, sem spinner), pausado com a aba escondida. (c) `GET /api/live/vsl` respondia sempre `liveUsers: 0` (placeholder, TODO no próprio código) — `funnel_steps` ganhou coluna `player_id` (migration `004`), editável no ateliê quando o tipo é VSL, e o endpoint agora chama o VTurb de verdade; etapa sem player configurado ou com erro na chamada simplesmente não aparece, não vira zero fabricado. (d) **`GET /api/live/conversion` usava `live_beats` (posição ATUAL da sessão) para contar visitante por etapa** — uma sessão que passou por 3 páginas só contava na 4ª, e etapas com tráfego real apareciam zeradas; a taxa também caía em `100%` sempre que a etapa anterior tinha 0 visitante, em vez de refletir que ninguém passou por ali. Passou a ler `live_page_entries` (o log de visitas, não a posição atual — mesma tabela e mesmo motivo do S6) e a taxa só é 100% na primeira etapa por definição; sem dado na anterior, é 0%, não 100% | `routers/live.py`, `routers/layout.py`, `migrations/004_vsl_player_id.sql`, `MetricsPage.tsx`, `FunnelViewPage.tsx`, `FunnelEditorPage.tsx` |
| 91 | **Webhook de venda nunca recebia nada da PerfectPay de verdade.** `POST /api/live/webhook` (o único que existia) espera um corpo já traduzido pro formato interno (`funnel_id`, `status: pending\|paid`...) — não é o que a PerfectPay manda. O payload real dela é outro (`token`, `code`, `sale_amount`, `sale_status_enum`, `customer.full_name`...), e não tem noção nenhuma de "funil". Endpoint novo, `POST /api/live/webhook/perfectpay/{funnel_id}` — uma URL por funil (o `funnel_id` vem do próprio link, colado na tela de integração de cada produto na PerfectPay), autenticado pelo campo `token` do corpo (não um header — a PerfectPay não oferece isso nessa integração) comparado ao "Public token" que o usuário cola em Configurações. Mapeia `sale_status_enum` oficial: 1 (pending) → nosso "pending" (PIX ou boleto aguardando pagamento), 2/8/10 (approved/authorized/completed) → "paid"; os demais (cancelado, reembolsado, chargeback, em análise...) não têm onde cair sem inventar um terceiro estado — ficam de fora por enquanto, registrados em log, não gravados como se fossem pendente/pago. Settings ganhou um seletor de funil pra montar a URL certa por produto. O `/webhook` genérico continua existindo, intacto, para integrações manuais/Zapier que já mandam o formato interno | `routers/live.py`, `SettingsPage.tsx` |
| 92 | **"Nosso rastreador" era só um enfeite no seletor de fonte.** Em Funis, Métricas e Funil, escolher "Nosso rastreador" no seletor de fonte não mudava nenhum número — as três telas liam só `step_metrics` (`getStepMetrics`), que **só** o Clarity/VTurb alimentam via "Sincronizar". O tracker próprio grava em `tracker_snapshots` (fechado sozinho pelo agendador desde o item 89), mas não existia leitor nenhum pra essas telas: o endpoint `GET /api/sources/tracker/history` existia no backend, mas nenhuma página chamava. Endpoint novo, `GET /api/metrics/tracker/{funnel_id}?period=`, no mesmo formato de `step_metrics` (visitors/conversions por etapa) — soma os snapshots diários dentro do período pedido. Sem meta por etapa como o Clarity/VTurb tem, a única conversão real que o rastreador enxerga é a VENDA paga (`live_sales`): vai inteira pra etapa-meta do funil (a marcada em "meta de conversão", ou a primeira "obrigado"), as demais ficam com conversions=0 de verdade. As três telas passaram a chamar esse endpoint quando a fonte é "tracker" — Funis ganhou o seletor de fonte que não tinha. **Achado à parte, não corrigido:** nem Clarity/VTurb filtram de fato pelo período nessas telas — `getStepMetrics` devolve TODAS as linhas históricas do funil, e o período seletor não filtra nada nelas; só o endpoint novo do tracker filtra por período corretamente. Fica registrado como pendência | `routers/metrics.py`, `FunnelListPage.tsx`, `MetricsPage.tsx`, `FunnelViewPage.tsx`, `api/client.ts` |
| 93 | **Corrigido o achado do item 92: `GET /api/metrics/funnels/{funnel_id}` (Clarity/VTurb) passa a aceitar `period`/`from_date`/`to_date` e filtra `step_metrics` pela coluna `date`.** Sem nenhum dos três, continua devolvendo tudo (retrocompatível). Funis, Métricas e Funil agora mandam o período nessa chamada também — antes só o endpoint do rastreador filtrava de verdade | `routers/metrics.py`, `api/client.ts`, `FunnelListPage.tsx`, `MetricsPage.tsx`, `FunnelViewPage.tsx` |
| 94 | **Tipo de página por slug virou regra editável, não `if` fixo no código.** A importação por lista de URLs sempre adivinhou o tipo da página pela palavra no slug (`vsl` → VSL, `checkout` → Checkout...), mas as regras eram fixas no frontend — quem tinha um padrão de nomenclatura diferente (slugs em outro idioma, prefixos próprios) não tinha como ensinar o sistema, só corrigir manualmente toda vez. Novo card em Configurações ("Tipo de página por slug"): lista de `{palavra-chave → tipo}`, editável (adicionar/remover/reordenar por posição), pré-populada com as mesmas regras que já existiam. Checa na ordem — a primeira regra que bater vence, então uma regra do usuário colocada antes de uma padrão a sobrepõe. Salva em `user_preferences.slug_type_rules` (migration `005`); sem personalização (`null`), tudo continua usando os padrões embutidos (`DEFAULT_SLUG_RULES`, `lib/urlImport.ts`) — nada muda pra quem nunca abriu essa tela | `migrations/005_slug_type_rules.sql`, `routers/sources.py`, `lib/urlImport.ts`, `SlugRulesCard.tsx`, `NewFunnelDialog.tsx` |
| 96 | **Notificação nativa do Windows para "PIX gerado"/"PIX pago"** — Web Push (VAPID) de ponta a ponta. Backend: tabela `push_subscriptions` (migration `006`), rotas `GET /api/push/vapid-public-key`, `POST /api/push/subscribe`/`unsubscribe`, serviço `services/push.py` (`notify_sale`) chamado pelos dois webhooks de venda (`/live/webhook` e `/live/webhook/perfectpay/{funnel_id}`) só quando a venda é nova ou muda de status — reenvio do gateway não dispara notificação repetida; assinatura que devolve 404/410 é apagada na hora. Frontend: `public/sw.js` (service worker) mostra notificação nativa quando nenhuma aba está em foco, ou manda `postMessage` pra aba em foco em vez de duplicar; `lib/push.ts` registra/inscreve; `NotificationsProvider` monta o toast arredondado (canto inferior direito) tanto para o `postMessage` do SW quanto para venda nova detectada no próprio polling da tela Ao Vivo (`useSaleAlerts`, compara o resultado de cada ciclo com o anterior); botão "Ativar notificações" (`PushToggle`) no cabeçalho do Ao Vivo, some sozinho sem suporte do navegador ou sem VAPID configurado no backend. **Falta**: gerar o par de chaves VAPID (`pywebpush`/`py-vapid` ou web-push-codelab.glitch.me) e definir `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no `backend/.env`, além de rodar a migration `006` no Supabase e instalar `pywebpush` (`pip install -r requirements.txt`) | `backend/app/services/push.py`, `backend/app/routers/push.py`, `backend/app/routers/live.py`, `backend/app/core/config.py`, `backend/supabase/migrations/006_push_subscriptions.sql`, `frontend/public/sw.js`, `frontend/src/lib/push.ts`, `frontend/src/components/common/NotificationsProvider.tsx`, `frontend/src/components/common/PushToggle.tsx`, `frontend/src/pages/LivePage.tsx`, `frontend/src/App.tsx`, `frontend/src/api/client.ts` |

| 95 | **`/code-review max` nos itens 90-94 achou 6 problemas reais, todos corrigidos.** (a) A busca da etapa-meta de conversão do rastreador confiava cegamente em `conversion_goal_step_id` mesmo quando a etapa apontada não existia mais (funil reeditado no ateliê) — vendas pagas eram calculadas certas e não apareciam em etapa nenhuma. Ganhou a mesma defesa que `resolveGoalStep()` (frontend) já tinha. (b) `getSlugRules()` devolvia `null` tanto pra "nunca personalizou" quanto pra "a busca falhou" — clicar "Salvar" depois de uma falha de rede sobrescrevia regras salvas de verdade com os padrões, sem aviso. Agora lança em vez de engolir; o card mostra erro com botão de tentar de novo e trava o Salvar enquanto isso. (c) O polling em segundo plano de Métricas/Funil parava de tentar COMEÇAR um novo intervalo com a aba escondida, mas nunca parava um intervalo que já tinha começado — ficava atualizando escondido. Passaram a usar o mesmo padrão `isPolling` (estado, reage a `visibilitychange`) que o Ao Vivo já usava certo. (d) A etapa de entrada da conversão ao vivo mostrava "0 visitantes, 100%" numa janela sem tráfego nenhum. (e) As chamadas ao VTurb por VSL rodavam uma de cada vez; viraram `asyncio.gather`, em paralelo. (f) As três telas de métrica repetiam o mesmo `source === "tracker" ? ... : ...` escolhendo entre duas rotas — virou UM endpoint (`GET /api/metrics/funnels/{id}?source=`), decidindo do lado do servidor; a rota `/tracker/{funnel_id}` foi removida e o frontend ganhou uma função só, `getMetrics()` | `routers/metrics.py`, `routers/live.py`, `api/client.ts`, `SlugRulesCard.tsx`, `NewFunnelDialog.tsx`, `MetricsPage.tsx`, `FunnelViewPage.tsx`, `FunnelListPage.tsx`, `FunnelEditorPage.tsx` |
| 96 | **Redesign visual "Nocturne" (pasta `FRONTENDNOVO`) aplicado ao front todo.** Camada de design system em `index.css` (`.btn` contorno / `.card` / `.tag` / `.seg` / `.table` / `.field`, tokens `--color-*` e `--c-*` mapeados nas CSS vars HSL que já existiam — light e dark seguem funcionando). Todos os ícones migrados de `lucide-react` → `@phosphor-icons/react` (lucide removido). Nova página `/overview` ("Visão dos funis") listando o fluxo de cada funil. Dashboard repaginado (KPIs com kicker, ranking em barras coloridas, tabela `.table`). Nenhuma função removida — só troca de casca; `tsc`, `vitest` 8/8 e `vite build` passam, QA visual das 8 telas + ateliê em modo mock. Branch `redesign-nocturne`. | `index.css`, `Sidebar.tsx`, `LoginPage.tsx`, `DashboardPage.tsx`, `FunnelOverviewPage.tsx`, `lib/series.ts`, `components/live/BrazilLiveMap.tsx`, + ~20 arquivos de troca de ícone |
| 97 | **`BrazilLiveMap`** — componente do mapa do Brasil ao vivo (d3-geo + world-atlas, tudo empacotado, sem CDN) portado do mockup. **Ainda não plugado** no Ao Vivo: o rastreador/back não capturam geolocalização (IP → cidade/UF). Fica pronto pra quando esse dado existir. | `components/live/BrazilLiveMap.tsx` |
| 98 | **Deploy do redesign na Railway** — merge `redesign-nocturne` → `main`, push, Railway reconstruiu pelo Dockerfile. Verificado no ar (`funneltron-production.up.railway.app`): login repaginado, `smoke_test.py` 44/44 contra o backend de produção. | — |
| 99 | **Bug de concorrência do backend — RESOLVIDO.** As telas de fan-out (Métricas, Ao Vivo, Visão dos funis) disparavam ~15-20 req em paralelo e o backend devolvia 500 em massa (`Server disconnected`, `_ssl.c:2426`). Causa: `httpx.Client` síncrono do supabase-py não é thread-safe e um cliente cacheado era compartilhado pelo pool de threads do FastAPI. Correção: (a) cliente **por thread** (`threading.local`) — anon/admin/por-token; (b) `_RetryTransport` que repete GET/HEAD 3x quando o Supabase fecha um keep-alive ocioso. Burst de 21 req paralelas × 8 rodadas em produção: **0 falhas** (antes: quase tudo 500). | `backend/app/core/supabase_client.py` |
| 100 | **Token não renovava (app parava depois de ~1h) — RESOLVIDO.** O access token do Supabase expira em ~1h e nada o renovava; passado isso, tudo 401ava em silêncio. `/api/auth/refresh` já existia mas passava um dict pro supabase-py 2.x (quer string) → sempre 401. Corrigido + body via `RefreshRequest`. No front, patch no `window.fetch`: 401 numa chamada `/api` autenticada → `POST /api/auth/refresh` → salva sessão nova → repete 1x; refresh falhou → limpa e vai pro `/login`. | `backend/app/routers/auth.py`, `frontend/src/api/client.ts` |
| 101 | **Mapa do Brasil ao vivo — LIGADO.** `services/geo.py` resolve IP→cidade/UF/lat/lon via `ip-api.com` (grátis, sem chave, cache 12h por IP). O IP nunca é gravado, só a praça. `/api/live/track` resolve no 1º heartbeat da sessão; `_upsert_beat` degrada sozinho se a migration não rodou. `GET /api/live/geo?funnel_id=` agrega sessões ativas por cidade. Front: `getLiveGeo()` + `<LiveGeoCard>` (usa o `BrazilLiveMap` que já existia) plugado nas duas vistas do Ao Vivo. **O snippet `tracker.js` NÃO muda** — geo vem do IP da requisição. ⚠️ **Rodar `migration 008_geo_ao_vivo.sql`** no Supabase (colunas `geo_*` em `live_beats`); até lá o mapa fica vazio mas nada quebra. | `backend/app/services/geo.py`, `backend/app/routers/live.py`, `backend/supabase/migrations/008_geo_ao_vivo.sql`, `frontend/src/api/client.ts`, `frontend/src/pages/LivePage.tsx` |

### ✅ O rastreador ao vivo estava quebrado em silêncio — RESOLVIDO

`POST /api/live/track` respondia **204 como se tivesse gravado**, sem gravar:

```
Could not find the 'event_id' column of 'live_page_entries' in the schema cache
```

Causa: a migration `backend/supabase/migrations/002_fontes_de_dados.sql` nunca
tinha sido rodada. Já constava como pendência, mas o efeito não estava claro —
não era só "as rotas novas respondem erro", era que **nenhum heartbeat entrava
no banco**, e por isso o Ao Vivo não mostrava ninguém.

Rodada no SQL Editor do Supabase em 2026-08-17. Verificado depois: as duas
checagens que falhavam voltaram (`online=1`, `2 entrada(s)`), e o
`smoke_test.py` fechou **44 passaram, 0 falharam**.

Fica registrado como dívida que `track_heartbeat` engole o erro e devolve 204: é
o que escondeu a falha por tanto tempo. Vale decidir se erro de gravação deve
mesmo virar sucesso — o rastreador ficaria quebrado de novo, calado, na próxima
mudança de schema.

### 🔒 Isolamento entre contas continua garantido (item 82)

O cliente por requisição existia para corrigir o **S1** (vazamento de sessão entre
usuários). O cache **não reabre** essa porta: a chave do cache é o próprio JWT,
então dois usuários têm tokens diferentes, logo clientes diferentes. O que foi
eliminado é só a reconstrução repetida do *mesmo* cliente para o *mesmo* usuário.
As três verificações de isolamento do `smoke_test.py` passam (44/44 no total).

### 🔒 Bugs de segurança/correção encontrados ao ligar o banco

| # | Bug | Consequência | Correção |
|---|---|---|---|
| S1 | **Cliente Supabase cacheado guardava a sessão do último login** | Com dois usuários no ar, as consultas de um rodavam com a identidade do outro: a lista de funis voltava vazia e, numa rota sem filtro explícito de dono, voltaria com dado alheio | Cliente por requisição amarrado ao JWT de quem chamou (`make_user_client` + `get_db`). Coberto por 3 verificações de isolamento no `smoke_test.py` |
| S2 | Conversão de compra ao vivo somava visitantes de **todas** as etapas no denominador | Mesma pessoa contada uma vez por página; quanto mais páginas, pior a conversão | Passou a usar a etapa de entrada |
| S3 | `datetime.now()` ingênuo comparado com timestamptz UTC | Numa máquina em UTC-3, "últimos 30 min" varria 3h30 | `datetime.now(timezone.utc)` em todas as janelas |
| S4 | `upsert(on_conflict="external_id")` sobre índice **parcial** | Webhook de venda respondia 500 (42P10) — nenhuma venda entrava | Deduplicação explícita (busca, depois update ou insert) |
| S5 | Upload de print com a chave anon | Storage recusava por RLS | Upload com a chave de serviço |
| S6 | `live_page_entries` com RLS e leitura pela chave anon | Log de entradas voltava vazio em silêncio | Leitura com chave de serviço + políticas de RLS no schema |

### 🔄 Em andamento

| Tarefa | Falta |
|---|---|
| **Seletor de fonte + histórico salvo** | Migration `002` **rodada em 2026-08-17** — `event_id`, `tracker_snapshots`, `clarity_snapshots` e `user_preferences` existem no banco, e o `smoke_test.py` fecha 44/44. Falta só **reinstalar o `tracker.js` atualizado nas páginas reais do funil**, para o `event_id` começar a chegar e o dedupe valer. |
| **Aba "Ao Vivo" em produção** | Funciona ponta a ponta contra o banco (heartbeat → pessoas online → log de entradas → webhook → feed de vendas), verificado com tráfego simulado. Falta **instalar o snippet nas páginas reais** do funil para entrar tráfego de verdade. |
| **Métricas de Clarity e VTurb** | O caminho do Clarity foi reescrito para a credencial e o endpoint corretos (itens 76–78), mas **ainda não foi exercitado com token real** — a verificação parou no typecheck e nas telas em modo de exemplo. Falta colar o token em Configurações, clicar em "Salvar e testar" e abrir Métricas para a primeira importação. O `step_metrics` continua sem ser populado; o botão "Sincronizar" é o gatilho. |
| **Políticas de RLS do `live_page_entries`** | Foram adicionadas ao `schema.sql` **depois** de você já ter rodado o script, então não existem no seu banco. A leitura funciona porque a rota usa a chave de serviço. Para deixar a defesa em profundidade igual às outras tabelas, rode só esse trecho do schema. |
| **`player_id` das VSLs** | Migration `004_vsl_player_id.sql` ainda não foi rodada no Supabase — sem ela, salvar/ler `player_id` em `funnel_steps` dá erro. Rode a migration e depois preencha o Player ID de cada VSL no ateliê para o bloco "Entradas Recentes nas VSLs" do Ao Vivo mostrar gente de verdade. |
| **Regras de slug (item 94)** | Migration `005_slug_type_rules.sql` ainda não foi rodada — sem ela, o card "Tipo de página por slug" em Configurações salva e a chamada dá erro (coluna não existe). Depende da migration `002` já ter rodado (é ela que cria `user_preferences`) — já rodou, conferido no item "Rastreador ao vivo — RESOLVIDO". |
| **Notificação push (item 96)** | Migration `006_push_subscriptions.sql` ainda não foi rodada. Falta também gerar o par de chaves VAPID e colar em `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` no `backend/.env`, e `pip install -r requirements.txt` (adicionou `pywebpush`). Sem isso o botão "Ativar notificações" no Ao Vivo some sozinho (tratado como recurso indisponível) e nenhum push nativo sai — o toast in-app continua funcionando normalmente, porque não depende de VAPID. |

### ⚠️ Não verificado visualmente

As **setas do canvas** só aparecem quando o painel do navegador está visível.
Sem composição de frames, o `ResizeObserver` do React Flow nunca entrega as
medidas dos nós (`handleBounds: null`) e ele descarta todas as arestas — o
`<defs>` do marcador é criado, mas o `<g>` das arestas fica vazio.

Artefato do ambiente de preview, **não do app**: com o painel visível as setas
renderizaram normalmente (conferido em captura de tela), e os dados estão
corretos no banco (4 etapas / 3 setas). Ainda assim, vale um olhar no Chrome
real. `npx tsc --noEmit` passa limpo.

### ❌ Fila

#### Cadastro com chave + Workspaces (pedido 2026-08-31)

**Decisões do usuário:**
- **Chave de cadastro fixa** = `100kdia`. Todo cadastro digita a mesma chave;
  trocar = mudar uma variável no servidor (`SIGNUP_INVITE_CODE`).
- **Workspaces com trocador de conta** (tipo Slack): um login, alterna entre
  vários workspaces sem deslogar. Cada workspace tem seus funis isolados.
- **Compartilhar workspace**: o dono convida outras contas (por email) para um
  workspace — os convidados veem os MESMOS funis.

**Estágios:**

1. **Gate da chave no cadastro** (pequeno, isolado). Campo "Código de acesso" no
   `LoginPage` (aba Criar conta). Backend `signup` valida contra
   `settings.signup_invite_code` ANTES de `supabase.auth.sign_up`. Vazio na env
   = cadastro aberto (comportamento atual). — **fazer primeiro**

2. **Workspaces** (grande). Prompt completo e autocontido pra rodar em outra IA:
   **`PROMPT-WORKSPACES.md`** na raiz. Resumo do que ele cobre:
   - tabelas `workspaces (id, name, owner_id)` e `workspace_members
     (workspace_id, user_id, role)`.
   - `funnels.user_id` → `funnels.workspace_id`. Steps/edges/métricas/beats já
     cascateiam a RLS por `funnels` — trocar `funnels.user_id = auth.uid()` por
     `exists(... workspace_members wm where wm.workspace_id = funnels.workspace_id
     and wm.user_id = auth.uid())`.
   - `api_credentials` e `sales_imports`: mover pra `workspace_id` (workspace
     compartilhado compartilha os tokens de integração).
   - Migration de backfill: 1 workspace pessoal por usuário existente, move os
     funis dele pra lá.
   - Backend: `get_db`/routers passam a filtrar por workspace ativo (header
     `X-Workspace-Id` ou querystring) em vez de `user_id`. Guarda: o backend
     confere que `current_user` é membro do workspace pedido.
   - Frontend: seletor de workspace no topo da Sidebar (estado "workspace
     ativo", persistido); tela de membros (convidar por email, remover); todas
     as chamadas de API levam o workspace ativo.

#### Redesign — pixel-match do mockup (em andamento, branch `redesign-nocturne`)

Pedido do usuário (2026-08-31): as telas devem ficar **100% iguais** ao mockup
`FRONTENDNOVO/Funnel Analytics Redesign.dc.html` (design feito no Claude Design).

| Tela | Estado |
|---|---|
| Login, Sidebar, Dashboard, Visão dos funis | ✅ batendo com o mockup |
| **Configurações** | ✅ cards no estilo do mockup + **todas** as funções reais mantidas (tier VTurb, mostrar/ocultar senha, testar, webhook por funil, Public token, TrackerCard, SlugRulesCard, salvar-tudo) |
| **Importações** | ✅ warning card + dropzone + prévia `.table` + guardadas |
| **Métricas** | 🟡 faixa de seleção (chips), KPIs (card-kicker), tabelas `.table`, VSL no tom accent-2, `<Card>` Nocturne — **visão global pronta**. Falta pixel-match de: single (seg "Período atual / Atual x anterior" — precisa de métrica de período anterior no backend), compare (verdict card com troféu, seg Tabela/Cards/Sobreposto) |
| **Ateliê** | 🟡 toolbar, paleta, legenda, **inspetor e `EdgeTypeMenu`** em token. Falta: wireframe `StepSketch` nos nós do canvas (`AtelierNode`) — hoje mostra "sem print" |
| **Ao Vivo** | ✅ cards de resumo, filtros, ConversionBar, **mapa do Brasil ao vivo** (item 101). Só falta rodar a migration 008 no Supabase pro mapa popular |

**Métricas — visões single/compare:**
- ✅ single: toggle `Período atual / Atual x anterior` (item ~102) — busca o
  período anterior via `getMetrics` com `DateRange`, mostra delta p.p./% nos KPIs.
- 🟡 compare: toggle `Tabela / Cards / Sobreposto`. Hoje a comparação mostra
  tabela métrica-a-métrica + gráficos (fixo). Falta o `.seg` de 3 modos —
  puramente apresentacional, mesmos dados em arranjo diferente.

~~Bug de backend achado no QA (2026-08-31): 500 intermitente em rajada.~~
✅ **RESOLVIDO** — itens 99 e 100 acima (cliente por thread + retry + refresh de token).

#### Página de Métricas — bloco financeiro

**M1 — Três modos de visão** ✅ feito (global / individual / comparação)

**M2 — Importar relatório de vendas (UTMify)**
- **M2a — independe do schema:** tipo `Sale`, motor de regras de atribuição
  (2.13), tela de regras, balde de não atribuídas, cálculos financeiros.
- **M2b — depende do doc:** adaptador `UTMify → Sale[]`. Parser fino.

**M3 — Seção financeira** ⛔ **CONGELADO — NÃO IMPLEMENTAR SEM PEDIDO EXPLÍCITO**

> Decisão do usuário (2026-08-16): manter especificado, **não construir**.
> Sempre listar como pendente quando ele perguntar "o que falta", sempre
> marcando que está congelado por escolha dele. Só sair do congelamento se
> ele pedir esta seção pelo nome.

(referência: print do painel de Ads do usuário)

| Grupo | Métricas |
|---|---|
| Receita & Gasto | Receita Bruta · Receita Líquida · Gasto (Anúncio) · Custos Totais / Taxas |
| Detalhamento de taxas | bloco expansível: checkout, gateway, impostos |
| Retorno & Lucratividade | Lucro Bruto · Lucro Líquido · ROAS · ROI / ROAS Real |
| CPAs | CPA · CPA Real (c/ todas as taxas) · Ticket Médio |
| Exibição | Impressões · Alcance · Frequência |
| Funil de conversão | gráfico afunilando (Cliques → Visita → IC → Venda Iniciada → Venda Aprovada) |
| Tráfego | CPM · CTR (link) · CPC (link) · Cliques no Link · LPV |

Layout: seções colapsáveis, títulos em caixa alta, grid de 4 cards, números
grandes, verde/vermelho no lucro.

**M4 — Gasto em anúncio** ✅ resolvido: vem junto no relatório da UTMify.

#### Resto

| # | Tarefa | Como faria |
|---|---|---|
| A | ~~**Trocar `localStorage` por banco**~~ | ✅ feito: o desenho vai para o Postgres via `PUT /api/funnels/:id/layout`. O `localStorage` só é usado no modo de exemplo. |
| B | ~~**Backend FastAPI**~~ | ✅ feito: 30 rotas de pé, 45 verificações verdes no `smoke_test.py`, ligado ao Supabase. |
| C | ~~**Screenshot real (Playwright)**~~ | ✅ feito: captura local 1280x800 com semáforo 3, guarda no bucket `screenshots`. |
| D | **Clarity por página** | O proxy no backend existe e o token saiu do frontend. Falta configurar as credenciais reais (Azure AD) e conferir o dado que volta. |
| E | **VTurb** | Proxy com rate-limit por plano existe. Falta token real para trazer "assistiu até o botão". |
| F | **Auto-layout** | Página criada pela paleta nasce em (0,0) e empilha. Nas telas de visualização o `spreadSteps()` já separa; no ateliê continua faltando achar posição livre. |
| I | **Print automático na importação de URLs** | A captura já funciona (tarefa C). Falta disparar em lote logo após criar o funil por lista de URLs. |
| J | **Mapear colunas da UTMify → `Sale`** | A tela de Importações já lê o arquivo e mostra os cabeçalhos. Falta o mapeamento e as regras de atribuição (2.13). |
| K | **Suporte a XLSX na importação** | Hoje só CSV/TSV — falta uma biblioteca de planilha. |

---

## 3.1 Como colocar no ar

**Local (funciona hoje):** dois processos — `uvicorn` na 8000 e `npm run dev` na
5173. Serve para usar e desenvolver, mas **não** para o rastreador: o snippet
nas páginas reais do funil precisa alcançar um endereço público.

**Deploy — o que decide é o Chromium.** A captura de print roda um navegador de
verdade, e função serverless não roda navegador.

| Alvo | Serve? | Observação |
|---|---|---|
| **Container** (Railway, Render, Fly.io, VPS) | ✅ recomendado | `Dockerfile` na raiz: constrói o frontend e serve tudo num alvo só. Print funciona. |
| **Vercel** | ⚠️ com ressalva | `vercel.json` corrigido (antes só construía o backend — a interface dava 404). Mas Chromium não roda lá: a captura só funciona com `SCREENSHOT_API_KEY` de um serviço externo. |

Em qualquer alvo, defina `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`
e `ENVIRONMENT=production`. Sem as chaves em produção o app **se recusa a
subir** (de propósito: em servidor efêmero o SQLite local aceitaria cadastro e
perderia tudo no deploy seguinte).

O mesmo servidor entrega a interface quando `frontend/dist` existe — uma porta,
uma origem, sem CORS.

---

## 4. Riscos e dívidas conhecidas

1. ~~**Token do Clarity exposto**~~ — resolvido: o JWT saiu de `api/client.ts` e
   o acesso virou proxy no backend (`CLARITY_EXPORT_TOKEN`). Se o token antigo
   já foi commitado ou compartilhado, ainda vale revogar.
2. ~~**Persistência só no navegador**~~ — resolvido: os dados moram no Postgres.
   O `localStorage` sobrou para o modo de exemplo e para a sessão.
3. **Chave `service_role` no `backend/.env`** — ela ignora todo o RLS. Nunca
   pode ir para o frontend nem para o repositório (o `.env` está no
   `.gitignore`). No deploy, entra como variável de ambiente.
4. **`.react-flow` exige altura explícita** — se um container perder altura, o
   canvas colapsa em silêncio.
5. **Dois componentes de nó** (`AtelierNode` e `LiveNode`) — geometria duplicada;
   se um mudar de altura sem o outro, o espaçamento diverge (decisão 2.8).
6. **Um cliente HTTP novo por requisição** (`make_user_client`) — foi o preço de
   corrigir o vazamento de sessão entre usuários (S1). Funciona, mas cria uma
   conexão por chamada; se virar gargalo, o caminho é um pool por token.
7. **Rotas do ao vivo leem com a chave de serviço** (`live_page_entries`) — a
   permissão é checada no código, não pelo RLS. Vale igualar quando as políticas
   do schema forem aplicadas no banco.
8. ~~**Sem framework de testes**~~ — resolvido: Vitest + Testing Library no
   frontend (`frontend/vitest.config.ts`, `npm test`). 8 testes cobrindo
   `computeStats` e `estimateVslConversionFromTracker` (lib/funnelStats.ts),
   incluindo regressão dos bugs de "visitas = pageview somado" e "conversão de
   compra caindo pra visita de página" corrigidos nesta rodada. Backend segue
   sem testes automatizados — próximo passo natural é pytest pros endpoints de
   `/metrics`.
8. **O Clarity só entrega 3 dias e 10 consultas por dia** — limite do fornecedor,
   não do código. Períodos de 30 ou 90 dias na tela do Clarity cobrem 3 dias; a
   resposta traz `days` com o que realmente veio e um `warning`. Histórico mais
   longo só existe acumulando os snapshots diários em `clarity_snapshots`.
9. ~~**`LivePage` quebra quando a API devolve erro no lugar de lista**~~ —
   **resolvido no item 87.** `okJson` confere o status antes de ler o corpo, e
   as vistas do Ao Vivo estão dentro de `ErrorBoundary`. Vale notar que o mesmo
   `ErrorBoundary` ainda **não** cobre as outras páginas: lá um erro de render
   continua apagando o app inteiro.
10. ~~**~290 ms de overhead do `supabase-py` por consulta**~~ — **estava errado,
    e a conclusão era acionável na direção errada.** O controle da medição era
    ruim: comparei uma consulta real com um `GET /rest/v1/`, que não toca o
    Postgres (29 ms). Na comparação justa, a MESMA consulta leva 180 ms pelo
    `supabase-py` e 176 ms por `httpx` cru — não há overhead de biblioteca. O
    profile confirma: 98% do tempo é o socket esperando resposta. **Não vale
    reescrever rota nenhuma com `httpx`, e não vale trocar a região do projeto.**
    O caminho para ganhar aqui é fazer MENOS consultas, não consultas mais
    rápidas (`get_live_conversion` faz 4 seguidas ≈ 720 ms).
11. **Ao Vivo ainda faz 3 × N requisições a cada 5 s** — melhor que as 4 × N de
    antes, mas continua sendo uma chamada por funil por métrica. O caminho é um
    endpoint que devolva o ao vivo de todos os funis de uma vez.
12. **Contas de teste no banco** — `qa@funneltron-local.app`, `perf.ui@funneltron-smoke.app` e vários
   `smoke.*@funneltron-smoke.app` criados durante a verificação. Podem ser
   apagadas no painel do Supabase → Authentication → Users.
13. **`FunnelListPage` recalculava sozinha** — corrigido: agora usa `computeStats`
   (mesma função da tela de Métricas) em vez de reinventar entrada/saída. Achado
   ao auditar consistência de métrica entre telas: ainda não foi feita uma
   varredura completa de todas as páginas — só as que citam
   `visitors`/`conversions`/taxa foram checadas (`LivePage` e `FunnelEditorPage`
   já usavam fonte comum, `pageToPageRate`/dados agregados do backend).
14. **"Conversão por origem/dispositivo" não foi implementada** — proposta no
   mockup de design aprovado, mas exige agrupar `tracker_snapshots` por
   UTM/dispositivo no backend (endpoint novo); ficou fora desta rodada por
   escopo. Trend diário e valor perdido (R$) na maior queda já estão na tela de
   Métricas, usando `/metrics/funnels/{id}/trend` e `/metrics/funnels/{id}/ticket`.

---

## 5. Como atualizar este arquivo

Ao terminar qualquer tarefa:

1. Mover a linha de **❌ Fila** (ou 🔄) para **✅ Feito**, citando os arquivos.
2. Decisão de produto nova → seção 2.
3. Dívida nova → seção 4.
4. Atualizar a data no topo.
