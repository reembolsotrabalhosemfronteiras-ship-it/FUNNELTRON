# Contrato do backend — FUNNELTRON

**Para o agente que está escrevendo o backend.** Este arquivo é o combinado
entre frontend e backend. O frontend já está escrito contra ele: cada função em
`frontend/src/api/client.ts` tem o caminho da API pronto atrás de um
`if (!USE_MOCK)`. Quando esses endpoints existirem, vira uma linha:
`USE_MOCK = false`.

Última atualização: 2026-08-16

---

## 0. ⚠️ Três coisas para resolver antes de escrever código

### 0.1 SQLite não funciona na Vercel

O `PROMPT_CLAUDE_CODE.md` especifica FastAPI + SQLite. Se o destino é Vercel,
**o SQLite não sobrevive**: o sistema de arquivos é efêmero e o banco some entre
invocações.

Saídas possíveis (decisão do usuário, não nossa):
1. Postgres gerenciado (Supabase / Neon / Vercel Postgres) — FastAPI segue
   igual, troca só o driver.
2. Backend fora da Vercel (Fly.io / Railway / VPS) — aí SQLite e processos
   persistentes voltam a ser viáveis.
3. Só uso local — funciona, mas não dá para acessar de fora.

**Não comece o schema antes disso estar decidido.**

### 0.2 Dois tokens estão vazados no frontend

`frontend/src/api/client.ts` tem um **JWT real do Microsoft Clarity chumbado no
código-fonte**. Vai para o bundle; qualquer um que abra o app lê. Precisa:
- sair do frontend,
- virar variável de ambiente no backend,
- e, se for de produção, **ser revogado e trocado**.

O mesmo vale para o token do VTurb quando ele entrar. Regra: **nenhum token de
terceiro toca o navegador.** Todos os acessos a Clarity, VTurb e UTMify passam
por proxy no backend.

### 0.3 O frontend hoje salva em `localStorage`

Funis, desenhos, importações e status estão em `localStorage` como solução
provisória. Quando os endpoints existirem, o frontend migra. Os formatos abaixo
são exatamente os que ele já grava — se o backend usar os mesmos, a migração é
trivial.

---

## 1. Endpoints que o frontend já chama

Todos sob `/api`. O frontend espera JSON e trata erro por status.

### Funis

| Método | Rota | Corpo / query | Devolve |
|---|---|---|---|
| GET | `/api/funnels` | `?status=active\|testing\|inactive` (opcional) | `Funnel[]` |
| GET | `/api/funnels/:id` | | `Funnel` |
| POST | `/api/funnels` | `{name, slug, status, baseUrl, kind}` | `Funnel` |
| PUT | `/api/funnels/:id` | `Partial<Funnel>` | `Funnel` |
| PATCH | `/api/funnels/:id` | `{status}` | 204 |
| DELETE | `/api/funnels/:id` | | 204 |

### Desenho do funil

| Método | Rota | Corpo | Devolve |
|---|---|---|---|
| GET | `/api/funnels/:id/steps` | | `FunnelStep[]` |
| GET | `/api/funnels/:id/edges` | | `FunnelEdge[]` |
| PUT | `/api/funnels/:id/layout` | `{steps, edges, status, conversionGoalStepId}` | `{savedAt: ISOString}` |
| DELETE | `/api/funnels/:id/layout` | | 204 |

`PUT /layout` **substitui o desenho inteiro** — é o botão Salvar do ateliê, que
manda tudo de uma vez. Não é patch incremental.

### Métricas

| Método | Rota | Query | Devolve |
|---|---|---|---|
| GET | `/api/funnels/:id/metrics` | | `StepMetric[]` |
| POST | `/api/funnels/:id/sync` | | 204 |
| GET | `/api/metrics/overview` | `?period=30d` **ou** `?from=YYYY-MM-DD&to=YYYY-MM-DD` | `OverviewMetrics` |
| GET | `/api/metrics/funnels/ranking` | idem | `FunnelComparisonRow[]` |
| GET | `/api/metrics/vsl` | idem | `VslInsight[]` |

**Atenção ao período:** o frontend manda `period` (atalho) **ou** `from`+`to`
(intervalo livre, inclusive "hoje" = mesmo dia nos dois). Aceitar as duas
formas.

### Screenshots

| Método | Rota | Corpo | Devolve |
|---|---|---|---|
| POST | `/api/screenshots` | `{url}` | `{ok: true, screenshotUrl}` ou `{ok: false, reason}` |

Playwright, 1280×800, lote com semáforo 3. **Em falha, devolver `ok:false` com
`reason` legível** — o frontend mostra o motivo na tela. Nunca devolver imagem
genérica fingindo sucesso.

### Importações (relatório UTMify)

| Método | Rota | Corpo | Devolve |
|---|---|---|---|
| GET | `/api/imports` | | `SalesImport[]` |
| POST | `/api/imports` | `SalesImport` | `SalesImport` |
| DELETE | `/api/imports/:id` | | 204 |

### Integrações

| Método | Rota | Corpo | Devolve |
|---|---|---|---|
| GET | `/api/integrations/credentials` | | `IntegrationCredentials` |
| POST | `/api/integrations/credentials` | `IntegrationCredentials` | 204 |
| POST | `/api/integrations/test` | `{provider: "vturb"\|"clarity"}` | `{ok, message}` |

**Nunca devolver o segredo em claro** no GET — mandar mascarado
(`sk_live_••••3f2a`) ou só um booleano de "configurado".

---

## 2. Tipos

Fonte da verdade: `frontend/src/types/index.ts`. Resumo dos campos que o backend
precisa persistir:

```ts
Funnel {
  id, name, slug, status: "active"|"inactive"|"testing",
  baseUrl, createdAt, updatedAt,
  kind?: "front" | "upsell",              // ausente = "front"
  conversionGoalStepId?: string | null    // página que fecha a conversão de compra
}

FunnelStep {
  id, funnelId, label, url,
  type: "landing"|"vsl"|"checkout"|"upsell"|"downsell"
      |"order_bump"|"thank_you"|"other"|"sub_funnel",
  positionX, positionY,                   // coordenadas do ateliê — preservar exato
  parentStepId, orderIndex,
  screenshotUrl?, status?,
  subFunnelId?: string | null             // quando type === "sub_funnel"
}

FunnelEdge {
  id, funnelId, sourceStepId, targetStepId,
  condition: "default"|"on_accept"|"on_decline"
           |"on_bump"|"on_no_bump"|"back_redirect",
  label
}

StepMetric {
  id, funnelId, stepId, date,
  visitors, conversions, conversionRate,
  source: "clarity"|"vturb"|"manual"
}

VslInsight {
  id, name, funnelId, funnelName,
  stepId,                                 // ⚠️ um funil tem VÁRIAS VSLs
  engagementRate, conversionRate, views, completions, source: "vturb"
}
```

**Duas regras que o backend não pode quebrar:**

1. **`VslInsight` é por `stepId`, não por funil.** Casar VSL com funil pelo nome
   torna impossível representar um funil com 3 vídeos.
2. **Métrica ausente é `null`, nunca `0`.** Um funil sem página de obrigado não
   tem conversão de compra ruim — não tem conversão de compra *medida*. O
   frontend mostra "—" para `null` e vermelho para `0`. Mandar `0` no lugar de
   `null` faz um funil sadio parecer quebrado.

---

## 3. Proxies de terceiros

### Microsoft Clarity
OAuth2 Azure AD (client_id + client_secret → bearer). Métricas por página/URL.

### VTurb Analytics
Base `https://analytics.vturb.net`. Headers `X-Api-Token` + `X-Api-Version: v1`
(exceto `/sessions/live_users` e `/players/list`, que pedem só o token).

Limite por plano: Basic 60/min · Pro 120 · Scale 300 · Enterprise 800.
Há também cota de ClickHouse (queries + bytes). **Uma requisição pode contar
como mais de uma query.** Existe `GET /quota/usage` — usar para se auto-limitar
antes de disparar lote, em vez de descobrir no 429.

`429` devolve `details.resets_at`. Propagar isso para o frontend: a tela precisa
dizer *"cota estourada, volta às HH:MM"*, não mostrar zero.

### UTMify
Formato ainda **não documentado** — o usuário vai passar. Até lá, **não
escrever parser**. A tela `/imports` já lê o CSV e mostra os cabeçalhos reais;
esses cabeçalhos são a especificação.

Regra de arquitetura acordada: normalizar na entrada. Tudo vira um `Sale`
interno no adaptador; nenhuma tela conhece o schema da UTMify.

---

## 4. Aba "Ao Vivo" — o que o backend precisa oferecer

Ver `docs/AO-VIVO.md` para o estudo completo. Resumo do que cabe ao backend:

### 4.1 Proxy do VTurb (primeiro, entrega valor sozinho)

```
GET /api/live/vsl?funnelId=X&minutes=5
→ [{ stepId, playerId, label, liveUsers, domain, windowMinutes }]
```

Por baixo chama `GET /sessions/live_users?player_id=&minutes=` para cada etapa
do tipo `vsl` do funil.

**Cache obrigatório de ~20s no backend.** O VTurb já cacheia 30s com
revalidação a cada 15s — bater mais rápido não traz dado novo, só queima cota.

**O rótulo importa:** o número é *"entrou nos últimos N minutos"*, não *"está
assistindo agora"*. Devolver `windowMinutes` junto para a tela não mentir.

### 4.2 Rastreador próprio (depois, cobre o funil inteiro)

```
POST /api/track          { funnelId, stepId, sessionId, event: "view"|"heartbeat" }
GET  /api/live?funnelId= → [{ stepId, online }]
```

Implementação: chave `live:{funnelId}:{stepId}:{sessionId}` no Redis com **TTL
de 45s**, renovada pelo heartbeat de 15s. "Online" = chaves não expiradas.

Por que TTL e não "entrou/saiu": ninguém avisa que fechou a aba —
`beforeunload` não é confiável em mobile.

`POST /api/track` precisa aceitar CORS das páginas do funil e responder rápido
(204, sem corpo) — vai receber `navigator.sendBeacon`.

**Não usar WebSocket na Vercel para isso.** O suporte nativo entrou em beta em
jun/2026 mas prende a conexão a uma instância e não tem broadcast entre
instâncias — que é justamente o que um painel compartilhado precisa. Polling de
5s no frontend resolve e é imune a isso.

---

## 5. Como avisar que um endpoint ficou pronto

Anote em `PLANO.md`, seção 3, na tabela de tarefas concluídas. O frontend liga
os endpoints à medida que aparecem — não precisa esperar tudo ficar pronto.
`USE_MOCK` é global hoje, mas dá para ligar por função se for gradual.
