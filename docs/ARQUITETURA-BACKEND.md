# Arquitetura do backend — FUNNELTRON

Status: **planejado, nada implementado.**
Última atualização: 2026-08-16

**Decidido com o usuário:**
- Frontend na **Vercel**, banco na **Supabase**.
- Até **300 pessoas simultâneas**.
- Rastreamento próprio ao vivo de cada funil até o checkout.
- O snippet **pode** ser instalado nas páginas.

---

## 1. A ideia que faz Vercel + Supabase funcionar

O problema com serverless era o heartbeat: 300 pessoas batendo a cada 15s dão
**1.200 req/min ≈ 20 req/s**, ou ~17 milhões de invocações por mês. Pagar
17 milhões de invocações para gravar "fulano ainda está aqui" é absurdo.

**A saída é não invocar função nenhuma no caminho quente.**

A Supabase expõe o Postgres direto por HTTP (PostgREST). O snippet grava **na
Supabase, sem passar por backend**. A cobrança da Supabase é por tamanho de
banco, egress e computação — **não por requisição**. O caminho de maior volume
some da conta.

```
     CAMINHO QUENTE (20 req/s)              CAMINHO FRIO (algumas/min)
     ─────────────────────────              ─────────────────────────
  página do funil                          aba do FUNNELTRON
       │                                          │
       │ POST direto (anon key + RLS)             │ chamadas normais
       ▼                                          ▼
  ┌─────────────────┐                    ┌──────────────────┐
  │    Supabase     │◄───Realtime───────►│ Vercel Functions │
  │    Postgres     │                    │  (FastAPI ASGI)  │
  │  + pg_cron      │◄───────────────────│  proxies, import │
  └─────────────────┘                    └────────┬─────────┘
                                                  │
                                          VTurb · Clarity · UTMify
```

**Zero função no heartbeat. Função só onde há token secreto ou lógica.**

---

## 2. O caminho quente: rastreamento ao vivo

### 2.1 O snippet

Uma linha no `<head>` de cada página:

```html
<script defer src="https://funneltron.vercel.app/t.js" data-funnel="f1"></script>
```

O arquivo é estático, servido pela CDN da Vercel. Não é função — não custa
invocação.

```js
// ~2 KB, sem dependências
const s = document.currentScript;
const sessionId = sessionStorage.ft_s ??= crypto.randomUUID();  // por aba
const deviceId  = localStorage.ft_d   ??= crypto.randomUUID();  // por navegador

const beat = () => navigator.sendBeacon(
  `${SUPABASE_URL}/rest/v1/live_beats`,
  new Blob([JSON.stringify({
    funnel_id: s.dataset.funnel,
    session_id: sessionId,
    device_id: deviceId,
    url: location.href,
    referrer: document.referrer,
    utm: Object.fromEntries(new URLSearchParams(location.search)),
  })], { type: 'application/json' })
);

beat();
// Só bate com a aba visível: aba de fundo não é gente olhando o funil.
setInterval(() => document.visibilityState === 'visible' && beat(), 30000);
```

**Heartbeat de 30s** (você autorizou afrouxar). Corta a carga pela metade e a
janela de "ao vivo" fica em 90s — precisão mais que suficiente.

**Por que `sendBeacon`:** sobrevive à navegação. O navegador entrega mesmo com
a página fechando; `fetch` seria cancelado.

**Por que só com aba visível:** corta ~40% do tráfego e é mais honesto.

**Sem evento de saída.** Mobile mata aba sem avisar — quem manda é o tempo sem
batida. Simplifica e não perde nada.

### 2.2 A tabela

```sql
create table live_beats (
  session_id  text primary key,
  funnel_id   text not null,
  device_id   text,
  url         text not null,
  step_id     text,              -- resolvido por trigger, ver 2.3
  referrer    text,
  utm         jsonb,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index on live_beats (funnel_id, last_seen desc);
```

Chave primária no `session_id` → cada batida é um **upsert**, não uma linha
nova. **A tabela nunca passa de ~300 linhas.** Sem isso seriam 1,7 milhão de
linhas por dia para responder uma pergunta que cabe em 300.

### 2.3 Da URL para a etapa

O snippet não sabe o que é "checkout" — manda a URL. Um trigger resolve:

```sql
create or replace function resolve_step() returns trigger as $$
begin
  -- normaliza: sem query, sem hash, sem barra final
  new.step_id := (
    select id from steps
     where funnel_id = new.funnel_id
       and regexp_replace(split_part(url, '?', 1), '/$', '')
         = regexp_replace(split_part(new.url, '?', 1), '/$', '')
     limit 1
  );
  return new;
end $$ language plpgsql;
```

`step_id` nulo = **página não mapeada**. Isso aparece na tela como um card
próprio, com a URL e um botão "adicionar ao funil". Mesma regra das vendas não
atribuídas: **nada some em silêncio**.

### 2.4 Segurança (RLS)

A `anon key` fica exposta nas páginas do funil — é o uso normal dela, e a
proteção é a RLS:

```sql
alter table live_beats enable row level security;

-- anônimo só insere/atualiza a própria batida. Não lê nada.
create policy "anon pode bater" on live_beats
  for insert to anon with check (true);
create policy "anon pode renovar" on live_beats
  for update to anon using (true) with check (true);

-- leitura só para o dono do painel
create policy "dono lê" on live_beats
  for select to authenticated using (true);
```

**O anônimo escreve mas não lê.** Ninguém extrai seus dados com a chave que
está na página.

Risco residual: alguém pode inflar o contador. É alvo de baixo valor e a
`session_id` como PK limita o estrago. Se virar problema: `pg_net` com rate
limit, ou mover só o `/collect` para uma função.

### 2.5 Limpeza e histórico — `pg_cron`

Roda dentro da própria Supabase, sem servidor:

```sql
-- some quem parou de bater
select cron.schedule('limpar-vivos', '* * * * *', $$
  delete from live_beats where last_seen < now() - interval '90 seconds'
$$);

-- foto de minuto em minuto: alimenta o gráfico das últimas 24h
select cron.schedule('snapshot-vivos', '* * * * *', $$
  insert into live_snapshots (funnel_id, step_id, online, captured_at)
  select funnel_id, step_id, count(*), now()
    from live_beats
   where last_seen > now() - interval '90 seconds'
   group by funnel_id, step_id
$$);
```

O Redis some da arquitetura. Nessa escala o Postgres dá conta — e um serviço a
menos para pagar e cuidar.

### 2.6 O painel lê por Realtime

A aba "Ao Vivo" assina as mudanças da `live_beats`. Sem polling, sem função:

```ts
supabase.channel('ao-vivo')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'live_beats' },
      recalcular)
  .subscribe();
```

**Só o seu painel abre WebSocket** — 1 ou 2 conexões. Os 300 visitantes fazem
POST e vão embora, sem conexão persistente. É por isso que os limites de
conexão simultânea da Supabase não são problema aqui.

Fallback simples: se o Realtime der trabalho, polling de 5s numa view agregada
resolve igual.

---

## 3. O caminho frio: a API

Aqui entra a Vercel Function com FastAPI. Volume baixo, e é onde há **token
secreto** — que nunca pode tocar o navegador.

| Rota | Por que precisa de servidor |
|---|---|
| `/api/live/vsl` | proxy do VTurb — token secreto, cache de 20s |
| `/api/clarity/*` | proxy do Clarity — OAuth Azure AD |
| `/api/imports` | processa CSV da UTMify |
| `/api/screenshots` | ver seção 4 |

Os CRUDs de funil, etapas e setas **não precisam de função**: o frontend fala
direto com a Supabase via SDK, com RLS. Menos código, menos latência.

FastAPI na Vercel roda como ASGI (`api/index.py` + `vercel.json`). Se o outro
agente preferir manter tudo em FastAPI, também funciona — só perde um pouco de
simplicidade.

---

## 4. ⚠️ O ponto que não fecha: Playwright

**Playwright não roda bem em serverless.** O Chromium estoura o limite de
tamanho da função e o cold start fica proibitivo.

Três saídas, em ordem de recomendação:

1. **API de screenshot pronta** (ScreenshotOne, Urlbox, ApiFlash). Você captura
   cada página **uma vez**, não continuamente — o volume é ridículo e o custo
   fica em centavos. Zero infraestrutura. **É a que mantém o projeto redondo em
   Vercel + Supabase.**
2. **Worker separado** num container pequeno (Fly.io ~$2/mês) só para prints.
   Quebra a promessa de "só dois serviços", mas dá controle total.
3. **Print manual** — colar Ctrl+V, que já funciona hoje. Sem custo, sem
   automação.

A imagem vai para o **Supabase Storage**, que já está incluído.

---

## 5. O que fica onde

| Peça | Onde | Custo |
|---|---|---|
| Frontend | Vercel (estático) | $0 |
| `t.js` | Vercel CDN | $0 |
| Batidas ao vivo | Supabase PostgREST direto | incluso |
| Banco + Storage + Realtime + cron | Supabase | $0 free / $25 Pro |
| Proxies e importação | Vercel Functions | baixo volume, dentro do incluído |
| Prints | API de screenshot | ~centavos por lote |

**Estimativa: $0 a $25/mês.** Provável começar no free e subir para Pro quando
o histórico crescer.

⚠️ **Confira as cotas atuais do plano free da Supabase** antes de assumir que
cabe — elas mudam, e o gargalo costuma ser tamanho de banco e egress, não
requisição.

---

## 6. ⚠️ O buraco no checkout

Você pediu "até o checkout". **Aí mora o único risco real do plano.**

Checkout costuma ser página da plataforma (Kiwify, Hotmart, Braip) e nem toda
deixa injetar script.

Antes de eu prometer isso na tela, confirme:

- [ ] Sua plataforma de checkout tem campo de "scripts personalizados" ou
      "pixels"? Kiwify e Hotmart têm, mas com restrições.
- [ ] Se **não** tiver: o rastreamento vai até a última página sua. Dá para
      medir "clicou para o checkout" — e a venda em si vem da UTMify.

**Vale investigar se a UTMify tem webhook.** Se tiver, a venda chega em tempo
real e a aba "Ao Vivo" mostra conversão acontecendo sem depender de script no
checkout. Isso fecharia o funil inteiro. Precisa ser confirmado na doc deles.

---

## 7. Ordem de construção

Cada fase entrega algo utilizável sozinha.

**Fase 0 — Infra.** Projeto Supabase criado, schema aplicado, RLS ligada,
frontend na Vercel falando com o banco.

**Fase 1 — CRUD via SDK.** Funis, etapas, setas e layout saem do `localStorage`
e vão para a Supabase. O ateliê passa a salvar de verdade, em banco. Sem
backend nenhum ainda.

**Fase 2 — Ao vivo.** `t.js`, tabela `live_beats`, trigger de URL→etapa,
`pg_cron`, aba "Ao Vivo" com o funil desenhado e contador em cada card.
**É o que você mais quer, e não depende de FastAPI.**

**Fase 3 — Proxies.** VTurb (inclusive `live_users`) e Clarity viram função na
Vercel. **Token do Clarity revogado e trocado.**

**Fase 4 — Prints.** API de screenshot + Supabase Storage.

**Fase 5 — UTMify.** Adaptador para `Sale`, regras de atribuição, balde de não
atribuídas. Só quando o doc chegar.

**Fase 6 — Financeiro.** Congelado por decisão sua. Não construir sem pedido.

---

## 8. O que ainda depende de você

1. **Criar o projeto na Supabase** e me passar a URL + anon key (a `service_role`
   **não** — essa fica só nas variáveis de ambiente da Vercel).
2. **Confirmar se dá para colar script no checkout** (seção 6).
3. **Revogar o token do Clarity** que está no fonte, se for de produção.
4. **Doc da UTMify** — trava só a fase 5.
