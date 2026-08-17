# 📊 FUNNELTRON — Análise de Funis de Vendas

Ferramenta para **desenhar funis de vendas visualmente e ver a conversão real de
cada passagem entre páginas** — com rastreador próprio de tempo real, captura de
print das páginas e integração com **Microsoft Clarity** e **VTurb Analytics**.

O contexto completo do projeto (decisões, estado, fila) está em
[`PLANO.md`](PLANO.md).

---

## 🚀 Como rodar

### Pré-requisitos

- **Node.js 18+**
- **Python 3.12+**
- Um projeto no **Supabase** (banco + autenticação + storage)

### 1. Banco (uma vez)

No painel do Supabase → **SQL Editor** → cole e execute
[`backend/supabase/schema.sql`](backend/supabase/schema.sql).

Depois, em **Storage**, confirme que existe um bucket público chamado
`screenshots` (o backend cria sozinho na primeira captura, se tiver permissão).

### 2. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\playwright install chromium
```

Copie `.env.example` para `.env` e preencha com as chaves do seu projeto
(painel do Supabase → **Project Settings → API**):

```
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_KEY=<anon / publishable>
SUPABASE_SERVICE_KEY=<service_role / secret>
```

> ⚠️ A `service_role` ignora todas as regras de RLS. Ela só pode existir no
> `backend/.env` e nas variáveis de ambiente do deploy — nunca no frontend,
> nunca commitada.

Suba o servidor:

```bash
cd backend
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
```

Confira em <http://localhost:8000/api/health>. A resposta diz de onde vêm os
dados:

```json
{ "status": "healthy", "storage": "supabase" }
```

Se vier `"storage": "local"`, as chaves do `.env` ainda são placeholders — veja
[Modo local](#-modo-local-sem-supabase).

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Abre em <http://localhost:5173>. O `/api` é encaminhado para a porta 8000 pelo
proxy do Vite, então não há CORS no caminho de desenvolvimento.

Para escolher entre backend real e dados de exemplo, crie
`frontend/.env.local`:

```
VITE_USE_MOCK=false   # backend real
VITE_USE_MOCK=true    # dados de exemplo, sem backend
```

### 4. Conta

Na primeira vez, use **Criar conta** na tela de login. O Supabase exige um email
com domínio real (ele valida o registro MX), e pode pedir confirmação por email
— isso se ajusta em **Authentication → Providers → Email**.

---

## 🧪 Teste de fumaça

Exercita as 30 rotas com dado real, na ordem em que o app usa: cria conta, cria
funil, salva o desenho, manda heartbeat do rastreador, lê o ao vivo, captura
print, importa venda, e confere o isolamento entre contas.

```bash
cd backend
.venv\Scripts\python smoke_test.py
```

---

## 🏠 Modo local (sem Supabase)

Sem chaves no `backend/.env`, o backend cai automaticamente num **SQLite local**
(`backend/data/funneltron.db`) que fala a mesma interface: dá para desenvolver
sem nuvem, e o `/api/health` avisa com `"storage": "local"`.

Não é um Postgres — não há RLS nem triggers. A proteção que vale nesse modo é a
checagem de dono feita nos próprios routers. **Produção usa Supabase.**

---

## 📁 Estrutura

```
.
├── frontend/                    # React + Vite + TypeScript
│   └── src/
│       ├── api/
│       │   ├── client.ts        # camada de dados (real + exemplo)
│       │   ├── mappers.ts       # snake_case do banco ↔ camelCase do app
│       │   └── mockData.ts
│       ├── components/          # comuns, funil (React Flow), ao vivo
│       ├── lib/                 # conversão, glossário, layout do canvas
│       ├── pages/               # Dashboard, Funis, Métricas, Ateliê, Ao Vivo…
│       └── types/
├── backend/                     # FastAPI
│   ├── app/
│   │   ├── core/                # config, auth, cliente de dados, SQLite local
│   │   ├── routers/             # auth, funnels, layout, metrics, live, …
│   │   └── services/            # screenshot (Playwright), vturb, clarity
│   ├── supabase/schema.sql      # schema + RLS + jobs
│   └── smoke_test.py
├── PLANO.md                     # contexto vivo do projeto
├── CONTRATO-BACKEND.md
└── docs/AO-VIVO.md
```

---

## 🌐 Integrações

| Fonte | Para quê | Onde configurar |
|---|---|---|
| **Rastreador próprio** | pessoas online por página, log de entradas | snippet em Configurações |
| **Webhook de venda** (PerfectPay…) | vendas em tempo real | Configurações → segredo do webhook |
| **VTurb Analytics** | conversão de VSL | Configurações → token + tier |
| **Microsoft Clarity** | conversão real por página | Configurações → OAuth Azure |
| **UTMify** | relatório de vendas e gasto em anúncio | Importações (mapeamento pendente) |

O snippet do rastreador vai no `<head>` de cada página do funil. O `step_id` é
resolvido no banco pela URL — não precisa configurar página por página.

---

## 🛠️ Tecnologias

- **Frontend:** React 18, Vite, TypeScript, Tailwind, React Flow, Recharts
- **Backend:** Python 3.14, FastAPI, Supabase (Postgres + Auth + Storage), Playwright
- **Deploy:** Vercel (`vercel.json` roteia `/api` para o FastAPI)

---

## 📄 Licença

MIT
