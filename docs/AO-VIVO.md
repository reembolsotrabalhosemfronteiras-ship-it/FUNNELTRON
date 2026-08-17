# Aba "Ao Vivo" — estudo de viabilidade e plano

Status: **planejado, nada implementado.**
Última atualização: 2026-08-16

Este documento responde duas perguntas antes de escrever qualquer código:

1. Hospedando na Vercel, dá para ter um rastreador próprio de pessoas no funil
   em tempo real?
2. A API do VTurb entrega pessoas assistindo à VSL em tempo real?

---

## 1. Rastreador próprio na Vercel

**Resposta: dá, mas o "tempo real" não pode morar na Vercel.**

### O que trava

A Vercel executa funções sem processo persistente. Três consequências que
definem a arquitetura:

| Restrição | Efeito no projeto |
|---|---|
| **Sem memória entre invocações** | Contador de "quem está online" não pode viver na função. Precisa de um armazenamento externo. |
| **Sistema de arquivos efêmero** | **SQLite não funciona.** O arquivo some entre invocações. Ver seção 4 — isso afeta o plano atual do backend. |
| **WebSocket limitado** | Suporte nativo entrou em beta público em junho/2026, mas com teto de 5 min por conexão (30 min em beta, só Pro/Enterprise), conexão presa a uma instância e **sem broadcast entre instâncias**. Serve para um chat simples, não para um painel confiável. |

### O desenho que funciona

```
página do funil                Vercel                    armazenamento
──────────────                 ──────                    ─────────────
snippet .js
  ├─ ao carregar  ──beacon──►  POST /api/track  ──────►  Redis
  └─ a cada 15s   ──beacon──►                            SET live:{funil}:{step}:{sessão}
                                                          TTL 45s

aba "Ao Vivo"     ──poll 5s──► GET /api/live    ──────►  conta chaves não expiradas
```

**Por que TTL em vez de "entrou/saiu":** ninguém avisa que fechou a aba —
`beforeunload` não é confiável em mobile. Chave com TTL de 45s renovada a cada
15s resolve: parou de bater, sumiu em 45s. É a definição honesta de "ao vivo".

**Por que polling em vez de WebSocket/SSE:** o painel atualiza a cada 5s sem
problema nenhum, e polling é imune a todas as restrições acima. SSE seguraria
uma invocação aberta por espectador — caro e com teto de duração. WebSocket na
Vercel não faz broadcast entre instâncias, que é justamente o que um painel
compartilhado precisa. **Se o tempo real ficar insuficiente**, a saída não é
forçar a Vercel: é um serviço dedicado (Ably, Pusher, Supabase Realtime) ou um
processo sempre ligado fora dela.

### Armazenamento

Precisa ser externo à função. Opções, em ordem de menor atrito:

1. **Upstash Redis** (Vercel Marketplace) — TTL nativo, é literalmente o caso de
   uso. Cobrança por comando.
2. **Supabase / Postgres** — funciona, mas contar linhas vivas com `WHERE
   last_seen > now() - 45s` custa mais que ler chaves com TTL.

### O que isso exige do usuário

**O snippet precisa ser instalado em cada página do funil.** Sem isso não há
rastreamento próprio. Antes de construir, confirmar:

- [ ] As páginas permitem colar um `<script>` no `<head>`? (ClickFunnels,
      Kiwify, página própria — cada um tem sua regra.)
- [ ] Dá para colar em todas, ou só em algumas? Página sem snippet fica
      invisível — e isso precisa aparecer na tela, não sumir em silêncio.

### Custo e limites a dimensionar

- Heartbeat de 15s × N pessoas online = N×4 requisições/minuto. Com 500 pessoas
  online são 2.000 req/min só de batimento. **Isso precisa ser estimado com o
  volume real antes de escolher o plano.**
- Bloqueador de anúncio e modo restrito derrubam parte das sessões. O número
  será sempre um piso, nunca exato.
- Alternativa se o custo pesar: heartbeat de 30s com TTL de 90s. Menos preciso,
  metade do custo.

---

## 2. VTurb: pessoas vendo a VSL ao vivo

**Resposta: dá, e o endpoint existe pronto.**

```
GET https://analytics.vturb.net/sessions/live_users?player_id={id}&minutes={n}
Header: X-Api-Token: <token>
```

Resposta:

```json
[
  { "domain": "example.com", "live_users": 100 },
  { "domain": "test.com",    "live_users": 200 }
]
```

Detalhe de autenticação: este endpoint pede **só** `X-Api-Token`. Os demais da
API exigem também `X-Api-Version: v1`.

### Limitações — todas relevantes, nenhuma contornável

**1. Não é "está na página agora".**
A própria doc avisa: *"this doesn't mean the user is still on the website, it
means the user entered the website in the last X minutes"*. É **entrou nos
últimos N minutos**, com N mínimo de 1.
→ Na tela isso não pode virar "12 pessoas assistindo agora". Tem que ser
**"12 entraram nos últimos 5 min"**, senão o número mente.

**2. Cache de 30s com revalidação a cada 15s.**
Corrigido na versão 1.4.1 (antes era 60 min). Consequência: **polling abaixo de
~15s não traz dado novo**, só gasta cota. O intervalo útil é 20–30s.

**3. Agrupa por domínio, não por página.**
Você recebe `live_users` por player e por domínio. Não dá para saber em qual
etapa do funil a pessoa está. Só existe granularidade de VSL.

**4. Só enxerga páginas com player VTurb.**
Landing, checkout, obrigado, páginas de pergunta — **invisíveis**. Num funil de
21 páginas com 2 VSLs, o VTurb cobre 2.
→ É exatamente por isso que o rastreador próprio (seção 1) não é opcional se a
aba "Ao Vivo" quiser mostrar o funil inteiro. VTurb complementa, não substitui.

**5. Uma chamada por player.**
Um funil com 3 VSLs = 3 chamadas por ciclo. Todos os funis × todas as VSLs ×
(60/intervalo) por minuto. Com 10 VSLs e polling de 20s: 30 req/min — já
consome metade do plano Basic.

**6. Limite de requisições por plano.**
Basic 60/min · Pro 120 · Scale 300 · Enterprise 800.
Além disso há cota de ClickHouse (queries e bytes lidos). **Uma requisição pode
contar como mais de uma query.** Existe `GET /quota/usage` para se
auto-limitar antes de disparar — usar isso, não descobrir o limite no 429.

**7. Só sessões das últimas 12h, sem bots.**
Filtro já aplicado pelo VTurb. Bom para precisão, mas significa que o número
não é comparável com contadores que incluem bot.

**8. `minutes` aceita 1 a 720.** Fora disso, 400.

**9. O token não pode ir para o frontend.**
Precisa ser proxy no backend — mesma regra do Clarity (ver dívida nº 1 do
PLANO.md).

### Tratamento de erro obrigatório

`429` devolve `details` com `limit_kind`, `remaining` e `resets_at`. A tela deve
mostrar *"cota do VTurb estourada, volta às HH:MM"* — não um zero silencioso.
Zero e "não sei" não podem ter a mesma aparência.

---

## 3. O que a aba "Ao Vivo" mostraria

Duas fontes, rotuladas separadamente porque medem coisas diferentes:

| Bloco | Fonte | O que diz |
|---|---|---|
| Pessoas por etapa do funil | rastreador próprio | quantos estão em cada página agora (TTL 45s) |
| Entradas recentes na VSL | VTurb `live_users` | quantos entraram nos últimos N min, por VSL |
| Fluxo ao vivo | rastreador próprio | o desenho do ateliê com um contador em cada card |
| Últimas conversões | UTMify (quando entrar) | vendas dos últimos minutos |

**Regra de honestidade:** cada número na tela carrega o rótulo da sua fonte e da
sua janela. "Agora" (rastreador) e "últimos 5 min" (VTurb) não podem aparecer
como se fossem a mesma coisa.

Enquanto o rastreador não existir, a aba mostra só o bloco do VTurb e diz
claramente que as demais etapas não estão instrumentadas.

---

## 4. ⚠️ Conflito com o plano atual do backend

O `PROMPT_CLAUDE_CODE.md` especifica **FastAPI + SQLite**. Se o destino é
Vercel, **SQLite não sobrevive** — o disco é efêmero e some entre invocações.

Isso precisa ser resolvido antes do backend andar. Três saídas:

1. **Postgres gerenciado** (Supabase, Neon, Vercel Postgres) + Redis para o
   ao vivo. FastAPI continua igual, só troca o driver.
2. **Backend fora da Vercel** (Fly.io, Railway, VPS) com processo persistente —
   aí WebSocket e SQLite voltam a ser viáveis, e a Vercel serve só o frontend.
3. **Só o frontend na Vercel**, backend local — funciona para uso pessoal, não
   para acessar de fora.

Isso é decisão do usuário, não minha. Ver `CONTRATO-BACKEND-AO-VIVO.md` para o
que foi combinado com o agente que está escrevendo o backend.

---

## 5. Ordem de construção proposta

1. **Decidir onde o backend roda** (seção 4). Trava tudo.
2. **Confirmar que dá para instalar o snippet** nas páginas do funil.
3. Proxy do VTurb `live_users` no backend + aba "Ao Vivo" só com esse bloco.
   Entrega valor sem depender do snippet.
4. Rastreador próprio: snippet, `/api/track`, Redis com TTL, `/api/live`.
5. Fluxo ao vivo desenhado sobre o canvas do ateliê.
