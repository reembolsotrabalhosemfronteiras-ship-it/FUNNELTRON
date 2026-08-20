import type {
  Funnel,
  FunnelStep,
  FunnelEdge,
  StepMetric,
  VslInsight,
  FunnelComparisonRow,
  OverviewMetrics,
  PeriodInput,
  FunnelStatus,
  FunnelTrendPoint,
  FunnelTicket,
} from "@/types";
import { isDateRange } from "@/types";
import type { SlugTypeRule } from "@/lib/urlImport";
import {
  MOCK_FUNNELS,
  MOCK_STEPS,
  MOCK_EDGES,
  MOCK_STEP_METRICS,
  MOCK_VSL,
  MOCK_OVERVIEW,
  MOCK_COMPARISON,
} from "./mockData";
import {
  fromApiFunnel,
  toApiFunnel,
  fromApiStep,
  toApiStep,
  fromApiEdge,
  toApiEdge,
  fromApiMetric,
  fromApiOverview,
  fromApiComparisonRow,
  fromApiVslInsight,
} from "./mappers";

// ---------------------------------------------------------------------------
// CAMADA DE DADOS. Hoje lê dos mocks. Quando o backend (FastAPI) estiver
// pronto, basta substituir o corpo de cada função por um `fetch('/api/...')`.
// As assinaturas ficam idênticas — nenhuma página precisará mudar.
// ---------------------------------------------------------------------------

/**
 * Liga/desliga os dados de exemplo.
 *
 * Vem do ambiente (`VITE_USE_MOCK=false` em `frontend/.env.local`) e não de uma
 * constante editada à mão: trocar isso era mexer no código-fonte, e o valor
 * errado commitado derruba o app inteiro — foi o que aconteceu antes, com o
 * `false` apontando para um backend que não existia e tudo virando 500.
 *
 * Padrão é `true`. Só desliga quando o backend estiver realmente de pé, com as
 * chaves do Supabase no `backend/.env`.
 *
 * Em dev as chamadas são relativas (`/api/...`): o proxy do Vite manda para
 * http://localhost:8000. Na Vercel, o `vercel.json` roteia /api para o mesmo
 * app FastAPI. Nos dois casos, mesma origem — sem CORS no caminho feliz.
 */
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== "false";
const LATENCY = 280; // ms — simula rede p/ exibir loaders/spinners

// O token de exportação da Clarity (Data.Export) fica no BACKEND (env CLARITY_EXPORT_TOKEN).
// NUNCA hardcoded no frontend — violação de segurança.

const delay = <T>(value: T, ms = LATENCY): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), ms));

// --- Sessão (token de auth) ---
// Guardada em localStorage para sobreviver ao reload; o App só libera as rotas
// quando há sessão válida. Quando USE_MOCK, é um token fake de demonstração.
const SESSION_KEY = "funil-analytics:session";

export function getSessionToken(): string | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession).accessToken : null;
  } catch {
    return null;
  }
}

export function saveSession(s: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  } catch {
    return null;
  }
}

/** Acrescenta o Bearer token nas chamadas reais (quando USE_MOCK=false). */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getSessionToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra ?? {};
}

function apiGet(path: string): Promise<Response> {
  if (USE_MOCK) return fetch(path);
  return fetch(path, { headers: authHeaders() });
}

/**
 * Lê o corpo JSON **depois** de conferir o status.
 *
 * `fetch` só rejeita em falha de rede: um 401 (token expirado), 404 ou 500
 * chega aqui como resposta normal, e `r.json()` devolve o corpo de erro do
 * FastAPI — `{ detail: "..." }`. Esse objeto seguia adiante tipado como se
 * fosse a lista esperada, e o primeiro `for`/`reduce`/`.map` em cima dele
 * lançava "is not iterable". Vindo de dentro de um efeito ou de um render, o
 * React 18 desmonta a árvore inteira: a tela inteira ficava preta, sem
 * mensagem e sem jeito de saber o porquê.
 *
 * Lançando aqui, o erro cai no `try/catch` de quem chamou — a tela mantém os
 * últimos dados bons e o console diz o que aconteceu.
 */
async function okJson(r: Response) {
  if (!r.ok) {
    const corpo = await r.text().catch(() => "");
    throw new Error(
      `Backend respondeu ${r.status}${corpo ? `: ${corpo.slice(0, 200)}` : ""}`
    );
  }
  return r.json();
}

function apiSend(
  path: string,
  method: string,
  body: unknown,
  isForm = false
): Promise<Response> {
  if (USE_MOCK) {
    return fetch(path, {
      method,
      headers: isForm
        ? { "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return fetch(path, {
    method,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
}

// --- Funnels ---
export async function listFunnels(status?: FunnelStatus): Promise<Funnel[]> {
  if (!USE_MOCK)
    return apiGet(`/api/funnels${status ? `?status=${status}` : ""}`)
      .then(okJson)
      .then((rows: Record<string, any>[]) => rows.map(fromApiFunnel));
  // Exemplos + criados pelo usuário, sem os apagados, com o status salvo.
  const deleted = new Set(readDeleted());
  const all = [...MOCK_FUNNELS, ...readCreated()]
    .filter((f) => !deleted.has(f.id))
    .map((f) => {
      const stored = readLayout(f.id);
      return stored?.status ? { ...f, status: stored.status } : f;
    });
  return delay(status ? all.filter((f) => f.status === status) : all);
}

export async function getFunnel(id: string): Promise<Funnel> {
  if (!USE_MOCK)
    return apiGet(`/api/funnels/${id}`)
      .then(okJson)
      .then(fromApiFunnel);
  const f =
    MOCK_FUNNELS.find((x) => x.id === id) ??
    readCreated().find((x) => x.id === id)!;
  // Status e página-meta podem ter sido trocados no ateliê e salvos junto.
  const stored = readLayout(id);
  if (!stored) return delay(f);
  return delay({
    ...f,
    status: stored.status ?? f.status,
    conversionGoalStepId: stored.conversionGoalStepId ?? f.conversionGoalStepId,
  });
}

const CREATED_KEY = "funil-analytics:funnels";

function readCreated(): Funnel[] {
  try {
    const raw = localStorage.getItem(CREATED_KEY);
    return raw ? (JSON.parse(raw) as Funnel[]) : [];
  } catch {
    return [];
  }
}

export async function createFunnel(
  payload: Pick<Funnel, "name" | "slug" | "status" | "baseUrl"> &
    Partial<Pick<Funnel, "kind">>
): Promise<Funnel> {
  if (!USE_MOCK)
    return apiSend(`/api/funnels`, "POST", toApiFunnel(payload))
      .then(okJson)
      .then(fromApiFunnel);

  const now = new Date().toISOString();
  const funnel: Funnel = {
    id: `fn_${Date.now().toString(36)}`,
    kind: "front",
    ...payload,
    createdAt: now,
    updatedAt: now,
  };
  // Sem backend, funis criados moram no localStorage junto com os de exemplo.
  localStorage.setItem(CREATED_KEY, JSON.stringify([...readCreated(), funnel]));
  return delay(funnel, 200);
}

export async function updateFunnel(
  id: string,
  payload: Partial<Funnel>
): Promise<Funnel> {
  if (!USE_MOCK)
    return apiSend(`/api/funnels/${id}`, "PUT", toApiFunnel(payload))
      .then(okJson)
      .then(fromApiFunnel);
  const f = MOCK_FUNNELS.find((x) => x.id === id)!;
  return delay({ ...f, ...payload, updatedAt: new Date().toISOString() });
}

// Funis de exemplo vivem numa constante e não podem ser removidos dela, então
// guardamos os apagados por id e filtramos na listagem.
const DELETED_KEY = "funil-analytics:deleted";

function readDeleted(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function deleteFunnel(id: string): Promise<void> {
  if (!USE_MOCK) {
    await apiSend(`/api/funnels/${id}`, "DELETE", undefined);
    return;
  }
  localStorage.setItem(
    CREATED_KEY,
    JSON.stringify(readCreated().filter((f) => f.id !== id))
  );
  localStorage.setItem(DELETED_KEY, JSON.stringify([...readDeleted(), id]));
  localStorage.removeItem(layoutKey(id));
  return delay(undefined, 150);
}

/** Copia o funil com o desenho inteiro — páginas, setas e página-meta. */
export async function duplicateFunnel(id: string): Promise<Funnel> {
  const [original, steps, edges] = await Promise.all([
    getFunnel(id),
    listSteps(id),
    listEdges(id),
  ]);

  const copy = await createFunnel({
    name: `${original.name} (cópia)`,
    slug: `${original.slug}-copia-${Date.now().toString(36)}`,
    // Cópia nasce em teste: publicar é decisão consciente, não herança.
    status: "testing",
    baseUrl: original.baseUrl,
    kind: original.kind,
  });

  // Ids novos (UUID — é o tipo das colunas no banco), mas as ligações precisam
  // apontar para os ids novos, senão a cópia herda as setas do original.
  const idMap = new Map(steps.map((s) => [s.id, crypto.randomUUID()]));
  const newSteps: FunnelStep[] = steps.map((s) => ({
    ...s,
    id: idMap.get(s.id)!,
    funnelId: copy.id,
    parentStepId: s.parentStepId ? idMap.get(s.parentStepId) ?? null : null,
  }));
  const newEdges: FunnelEdge[] = edges.map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    funnelId: copy.id,
    sourceStepId: idMap.get(e.sourceStepId)!,
    targetStepId: idMap.get(e.targetStepId)!,
  }));

  await saveFunnelLayout(
    copy.id,
    newSteps,
    newEdges,
    "testing",
    original.conversionGoalStepId
      ? idMap.get(original.conversionGoalStepId) ?? null
      : null
  );

  return copy;
}

/** Troca o status sem abrir o ateliê. */
export async function setFunnelStatus(
  id: string,
  status: FunnelStatus
): Promise<void> {
  if (!USE_MOCK) {
    await apiSend(`/api/funnels/${id}`, "PATCH", { status });
    return;
  }
  const [steps, edges] = await Promise.all([listSteps(id), listEdges(id)]);
  const stored = readLayout(id);
  await saveFunnelLayout(id, steps, edges, status, stored?.conversionGoalStepId);
}

// --- Steps & edges ---
// Com `VITE_USE_MOCK=false` o desenho vai para o Postgres. O caminho do
// localStorage abaixo é o modo de exemplo, para navegar sem o backend de pé.
const layoutKey = (funnelId: string) => `funil-analytics:layout:${funnelId}`;

interface StoredLayout {
  steps: FunnelStep[];
  edges: FunnelEdge[];
  status?: FunnelStatus;
  conversionGoalStepId?: string | null;
  savedAt: string;
}

function readLayout(funnelId: string): StoredLayout | null {
  try {
    const raw = localStorage.getItem(layoutKey(funnelId));
    return raw ? (JSON.parse(raw) as StoredLayout) : null;
  } catch {
    return null;
  }
}

export async function listSteps(funnelId: string): Promise<FunnelStep[]> {
  if (!USE_MOCK)
    return apiGet(`/api/funnels/${funnelId}/steps`)
      .then(okJson)
      .then((rows: Record<string, any>[]) => rows.map(fromApiStep));
  return delay(readLayout(funnelId)?.steps ?? MOCK_STEPS[funnelId] ?? []);
}

export async function listEdges(funnelId: string): Promise<FunnelEdge[]> {
  if (!USE_MOCK)
    return apiGet(`/api/funnels/${funnelId}/edges`)
      .then(okJson)
      .then((rows: Record<string, any>[]) => rows.map(fromApiEdge));
  return delay(readLayout(funnelId)?.edges ?? MOCK_EDGES[funnelId] ?? []);
}

/** Salva o desenho inteiro do funil de uma vez (páginas + setas). */
export async function saveFunnelLayout(
  funnelId: string,
  steps: FunnelStep[],
  edges: FunnelEdge[],
  status?: FunnelStatus,
  conversionGoalStepId?: string | null
): Promise<{ savedAt: string }> {
  if (!USE_MOCK) {
    const r = await apiSend(`/api/funnels/${funnelId}/layout`, "PUT", {
      steps: steps.map(toApiStep),
      edges: edges.map(toApiEdge),
      status,
      conversion_goal_step_id: conversionGoalStepId ?? null,
    });
    if (!r.ok) throw new Error(`Backend respondeu ${r.status}`);
    return r.json();
  }

  const payload: StoredLayout = {
    steps,
    edges,
    status,
    conversionGoalStepId,
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(layoutKey(funnelId), JSON.stringify(payload));
  } catch (e) {
    // Prints colados viram data URL e estouram a cota rápido.
    throw new Error(
      "Não coube no armazenamento local. Prints colados ocupam muito espaço — remova algum ou use a captura por URL."
    );
  }
  return delay({ savedAt: payload.savedAt }, 400);
}

/** Descarta o desenho salvo e volta ao funil original de exemplo. */
export async function resetFunnelLayout(funnelId: string): Promise<void> {
  if (!USE_MOCK) {
    await apiSend(`/api/funnels/${funnelId}/layout`, "DELETE", undefined);
    return;
  }
  localStorage.removeItem(layoutKey(funnelId));
  return delay(undefined, 200);
}

export async function saveStep(
  funnelId: string,
  step: Partial<FunnelStep>
): Promise<FunnelStep> {
  if (!USE_MOCK)
    return apiSend(
      `/api/funnels/${funnelId}/steps`,
      "POST",
      toApiStep({ ...step, id: step.id ?? crypto.randomUUID() } as FunnelStep)
    )
      .then(okJson)
      .then(fromApiStep);
  const id = step.id ?? crypto.randomUUID();
  return delay({ ...step, id, funnelId } as FunnelStep);
}

export async function saveEdge(
  funnelId: string,
  edge: Partial<FunnelEdge>
): Promise<FunnelEdge> {
  if (!USE_MOCK)
    return apiSend(
      `/api/funnels/${funnelId}/edges`,
      "POST",
      toApiEdge({ ...edge, id: edge.id ?? crypto.randomUUID() } as FunnelEdge)
    )
      .then(okJson)
      .then(fromApiEdge);
  const id = edge.id ?? crypto.randomUUID();
  return delay({ ...edge, id, funnelId } as FunnelEdge);
}

// --- Métricas ---
/**
 * Métricas por etapa de um funil. `source` decide de onde: "tracker" lê do
 * nosso rastreador (`tracker_snapshots`); qualquer outro valor lê do
 * Clarity/VTurb (`step_metrics`) — o backend decide num endpoint só
 * (`GET /api/metrics/funnels/{id}?source=`), em vez de cada tela repetir o
 * mesmo `source === "tracker" ? ... : ...` escolhendo qual rota chamar (era
 * assim antes, com duas funções `getStepMetrics`/`getTrackerMetrics`
 * separadas e três cópias do mesmo if/else nas páginas).
 *
 * `period` é opcional na fonte Clarity/VTurb: sem ele, devolve todo o
 * histórico (comportamento de sempre, pros chamadores que ainda não passam
 * período). Na fonte "tracker" o backend sempre filtra de verdade.
 */
export async function getMetrics(
  funnelId: string,
  source: DataSource,
  period?: PeriodInput
): Promise<StepMetric[]> {
  if (!USE_MOCK) {
    const parts: string[] = [];
    if (source === "tracker") parts.push("source=tracker");
    if (period) parts.push(periodQuery(period));
    const qs = parts.length ? `?${parts.join("&")}` : "";

    return apiGet(`/api/metrics/funnels/${funnelId}${qs}`)
      .then(okJson)
      .then((rows: Record<string, any>[]) =>
        // A rota pode devolver um envelope ({ metrics: [...] }) ou a lista
        // crua, dependendo de ter ou não métrica sincronizada.
        (Array.isArray(rows) ? rows : (rows as any)?.metrics ?? []).map(
          fromApiMetric
        )
      );
  }
  return delay(MOCK_STEP_METRICS[funnelId] ?? [], 600);
}

export async function syncMetrics(funnelId: string): Promise<void> {
  if (!USE_MOCK)
    return apiSend(
      `/api/metrics/funnels/${funnelId}/sync`,
      "POST",
      undefined
    ).then();
  return delay(undefined, 900);
}

// --- Dashboard / métricas gerais ---
export async function getOverview(
  period: PeriodInput
): Promise<OverviewMetrics> {
  if (!USE_MOCK)
    return apiGet(`/api/metrics/overview?${periodQuery(period)}`)
      .then(okJson)
      .then(fromApiOverview);
  return delay({
    ...MOCK_OVERVIEW,
    totalVisitors: Math.round(periodScale(period, MOCK_OVERVIEW.totalVisitors)),
  });
}

export async function getFunnelRanking(
  period: PeriodInput
): Promise<FunnelComparisonRow[]> {
  if (!USE_MOCK)
    return apiGet(`/api/metrics/funnels/ranking?${periodQuery(period)}`)
      .then(okJson)
      .then((rows: Record<string, any>[]) => rows.map(fromApiComparisonRow));
  return delay(
    MOCK_COMPARISON.map((r) => ({
      ...r,
      visitors: Math.round(periodScale(period, r.visitors)),
    }))
  );
}

export async function getVslInsights(
  period: PeriodInput
): Promise<VslInsight[]> {
  if (!USE_MOCK)
    return apiGet(`/api/metrics/vsl?${periodQuery(period)}`)
      .then(okJson)
      .then((rows: Record<string, any>[]) => rows.map(fromApiVslInsight));
  return delay(
    MOCK_VSL.map((v) => ({
      ...v,
      views: Math.round(periodScale(period, v.views)),
    }))
  );
}

/**
 * Conversão de funil dia a dia (primeira etapa até a última) — para ver se
 * uma mudança na página melhorou ou piorou algo, em vez de só o total
 * acumulado do período.
 */
export async function getFunnelTrend(
  funnelId: string,
  source: DataSource,
  period: PeriodInput
): Promise<FunnelTrendPoint[]> {
  if (!USE_MOCK) {
    const parts = [periodQuery(period)];
    if (source === "tracker") parts.push("source=tracker");
    return apiGet(`/api/metrics/funnels/${funnelId}/trend?${parts.join("&")}`).then(
      okJson
    );
  }
  // Série determinística a partir do id do funil, para o gráfico não pular
  // toda vez que a tela recarrega.
  const days = periodDays(period);
  let seed = 0;
  for (const c of funnelId) seed += c.charCodeAt(0);
  const base = 55 + (seed % 25);
  const points: FunnelTrendPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const wobble = Math.sin((seed + i) * 0.7) * 8;
    const rate = Math.max(20, Math.min(95, base + wobble));
    const visitors = Math.round(80 + ((seed + i * 13) % 140));
    points.push({
      date: d.toISOString().slice(0, 10),
      visitors,
      conversions: Math.round((visitors * rate) / 100),
      rate: Math.round(rate * 10) / 10,
    });
  }
  return delay(points, 400);
}

/** Ticket médio real do funil — `null` sem venda registrada, nunca inventado. */
export async function getFunnelTicket(
  funnelId: string,
  period: PeriodInput
): Promise<FunnelTicket> {
  if (!USE_MOCK)
    return apiGet(
      `/api/metrics/funnels/${funnelId}/ticket?${periodQuery(period)}`
    ).then(okJson);
  let seed = 0;
  for (const c of funnelId) seed += c.charCodeAt(0);
  return delay({
    avgTicket: Math.round((97 + (seed % 300)) * 100) / 100,
    salesCount: Math.round(periodScale(period, 12 + (seed % 20))),
  });
}

export interface StepTimeOnPage {
  stepId: string;
  avgSeconds: number;
  samples: number;
}

/**
 * Tempo médio na página, calculado a partir de QUANDO cada sessão trocou de
 * URL (não existe um dado direto de "ficou N segundos" — ver o comentário no
 * endpoint). Só o rastreador próprio sabe disso; Clarity/VTurb não entram
 * aqui.
 */
export async function getTimeOnPage(
  funnelId: string,
  period: PeriodInput
): Promise<StepTimeOnPage[]> {
  if (!USE_MOCK)
    return apiGet(
      `/api/metrics/funnels/${funnelId}/time-on-page?${periodQuery(period)}`
    ).then(okJson);
  return delay([]);
}

// --- Screenshots ---
export interface ScreenshotResult {
  ok: boolean;
  screenshotUrl?: string;
  /** Motivo da falha, para a UI explicar em vez de só falhar em silêncio. */
  reason?: string;
}

/**
 * Captura o print de uma URL. O navegador não consegue fazer isso sozinho
 * (canvas fica "tainted" e a maioria dos sites bloqueia iframe), então quem
 * captura de verdade é o backend com Playwright.
 *
 * `stepId` não é opcional do lado do backend: o arquivo é guardado com o nome
 * da etapa. Mandar só a URL devolvia 422.
 */
export async function captureScreenshot(
  url: string,
  stepId: string
): Promise<ScreenshotResult> {
  if (USE_MOCK) {
    // Antes isto devolvia uma foto aleatória de placeholder — parecia que a
    // captura tinha funcionado quando não tinha. Fingir sucesso é pior que
    // falhar: o usuário só descobre olhando o print errado no card.
    return delay(
      {
        ok: false,
        reason:
          "A captura automática precisa do backend ligado (VITE_USE_MOCK=false). O navegador não consegue printar um site de terceiro sozinho. Cole (Ctrl+V) ou arraste um print aqui.",
      },
      400
    );
  }

  try {
    const r = await apiSend(`/api/screenshots`, "POST", {
      url,
      step_id: stepId,
    });
    if (!r.ok) {
      return { ok: false, reason: `Backend respondeu ${r.status}` };
    }
    return await r.json();
  } catch {
    return {
      ok: false,
      reason:
        "Não consegui falar com o backend. Confira se ele está de pé (uvicorn na porta 8000) ou cole o print manualmente.",
    };
  }
}

// --- Importações de relatório de vendas ---
export interface SalesImport {
  id: string;
  fileName: string;
  headers: string[];
  rowCount: number;
  delimiter: string;
  /** Amostra: o arquivo inteiro não cabe no localStorage. */
  sampleRows: string[][];
  importedAt: string;
}

const IMPORTS_KEY = "funil-analytics:imports";

/** Linha de `sales_imports` (snake_case) → `SalesImport` do frontend. */
function fromApiImport(row: Record<string, any>): SalesImport {
  const detected = row.detected_columns ?? {};
  return {
    id: row.id,
    fileName: row.filename ?? "",
    headers: detected.headers ?? [],
    rowCount: row.row_count ?? 0,
    delimiter: detected.delimiter ?? ",",
    sampleRows: row.raw_data?.sampleRows ?? [],
    importedAt: row.imported_at ?? row.created_at ?? "",
  };
}

export async function listImports(): Promise<SalesImport[]> {
  if (!USE_MOCK)
    return apiGet(`/api/imports`)
      .then(okJson)
      .then((rows: Record<string, any>[]) => rows.map(fromApiImport));
  try {
    const raw = localStorage.getItem(IMPORTS_KEY);
    return delay(raw ? (JSON.parse(raw) as SalesImport[]) : [], 120);
  } catch {
    return [];
  }
}

export async function saveImport(
  payload: Omit<SalesImport, "id" | "importedAt">
): Promise<SalesImport> {
  const record: SalesImport = {
    ...payload,
    id: `imp_${Date.now().toString(36)}`,
    importedAt: new Date().toISOString(),
  };

  if (!USE_MOCK) {
    // O backend guarda a importação com os nomes da tabela `sales_imports`
    // (snake_case). Mandar o objeto do frontend cru dava 422: ele tem
    // `fileName`/`rowCount`, e a rota espera `filename`/`row_count`.
    const r = await apiSend(`/api/imports`, "POST", {
      filename: record.fileName,
      imported_at: record.importedAt,
      row_count: record.rowCount,
      detected_columns: {
        headers: record.headers,
        delimiter: record.delimiter,
      },
      raw_data: { sampleRows: record.sampleRows },
    });
    if (!r.ok) throw new Error(`Backend respondeu ${r.status}`);
    return fromApiImport(await r.json());
  }

  const current = await listImports();
  localStorage.setItem(IMPORTS_KEY, JSON.stringify([record, ...current]));
  return delay(record, 200);
}

export async function deleteImport(id: string): Promise<void> {
  if (!USE_MOCK) {
    await apiSend(`/api/imports/${id}`, "DELETE", undefined);
    return;
  }
  const current = await listImports();
  localStorage.setItem(
    IMPORTS_KEY,
    JSON.stringify(current.filter((i) => i.id !== id))
  );
  return delay(undefined, 120);
}

// --- Integrações ---
export interface IntegrationCredentials {
  vturbToken: string;
  vturbTier: "basic" | "pro" | "scale" | "enterprise";
  /**
   * Token de API do Clarity (painel → Configurações → Configurações do projeto
   * → API). É a credencial ÚNICA: o token já é do projeto, então não há Client
   * ID, Client Secret nem OAuth do Azure envolvidos.
   */
  clarityToken: string;
  /** Segredo do webhook de venda (PerfectPay dispara). */
  webhookSecret: string;
  /** URL pública do endpoint de webhook deste app. */
  webhookUrl: string;
}

export async function getCredentials(): Promise<IntegrationCredentials> {
  if (!USE_MOCK)
    return apiGet(`/api/integrations/credentials`).then(okJson);
  return delay({
    vturbToken: "",
    vturbTier: "pro",
    clarityToken: "",
    webhookSecret: "",
    webhookUrl: "",
  });
}

export async function saveCredentials(
  payload: IntegrationCredentials
): Promise<void> {
  if (!USE_MOCK) {
    // Cada provider é salvo numa linha própria de api_credentials.
    //
    // Campo vazio NÃO é enviado. O backend nunca devolve token salvo (só a
    // marca de "configurado"), então o formulário abre em branco toda vez —
    // salvar sem essa guarda apagaria o token já gravado a cada visita.
    if (payload.vturbToken) {
      await apiSend(`/api/integrations/credentials`, "POST", {
        provider: "vturb",
        api_token: payload.vturbToken,
        rate_limit_tier: payload.vturbTier,
      }).then();
    }
    if (payload.clarityToken) {
      await apiSend(`/api/integrations/credentials`, "POST", {
        provider: "clarity",
        api_token: payload.clarityToken,
      }).then();
    }
    if (payload.webhookSecret) {
      await apiSend(`/api/integrations/credentials`, "POST", {
        provider: "webhook",
        api_token: payload.webhookSecret,
      }).then();
    }
    return;
  }
  return delay(undefined);
}

export async function testConnection(
  provider: "vturb" | "clarity"
): Promise<{ ok: boolean; message: string }> {
  if (!USE_MOCK)
    return apiSend(`/api/integrations/test`, "POST", { provider }).then((r) =>
      r.json()
    );
  return delay(
    { ok: true, message: `${provider} conectado (mock)` },
    800
  );
}

/** Quantos dias o período cobre. "all" vira 365 para efeito de escala. */
export function periodDays(period: PeriodInput): number {
  if (isDateRange(period)) {
    const from = new Date(period.from).getTime();
    const to = new Date(period.to).getTime();
    if (Number.isNaN(from) || Number.isNaN(to)) return 30;
    return Math.max(1, Math.round((to - from) / 86_400_000) + 1);
  }
  switch (period) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    case "90d":
      return 90;
    default:
      return 365;
  }
}

/** Escala os números mockados proporcionalmente ao tamanho do período. */
function periodScale(period: PeriodInput, n: number): number {
  return n * (periodDays(period) / 30) * 0.6;
}

/**
 * Vira query string para o backend: `?period=30d` ou `?from_date=…&to_date=…`.
 * Os nomes são os do FastAPI (snake_case) — o backend é quem manda no contrato
 * de entrada; as respostas é que vêm em camelCase para o frontend.
 */
function periodQuery(period: PeriodInput): string {
  return isDateRange(period)
    ? `from_date=${period.from}&to_date=${period.to}`
    : `period=${period}`;
}

// --- Clarity API (real, via backend proxy) ---
// O token de exportação (Data.Export) fica no BACKEND (env CLARITY_EXPORT_TOKEN).
// O frontend NUNCA recebe esse token — violação de segurança.
/** Métricas de exemplo no mesmo formato que o backend devolve. */
function mockClarityMetrics(sessoes: number): ClarityMetrics {
  const sessions = Math.round(sessoes);
  return {
    sessions,
    botSessions: Math.round(sessions * 0.04),
    distinctUsers: Math.round(sessions * 0.82),
    pageViews: Math.round(sessions * 3.2),
    pagesPerSession: 3.2,
    avgTime: 145.2,
    avgScrollDepth: 61.4,
    bounceRate: null,
  };
}

/**
 * Métricas zeradas — o formato existe, os números ainda não.
 *
 * A tela Ao Vivo usa isto quando nunca houve importação: some o número, não a
 * página. Quem abre precisa ver a estrutura e o carimbo dizendo que está vazio,
 * não um bloco de texto no lugar onde os cards deveriam estar.
 */
export const CLARITY_METRICS_ZERO: ClarityMetrics = {
  sessions: 0,
  botSessions: 0,
  distinctUsers: 0,
  pageViews: 0,
  pagesPerSession: 0,
  avgTime: 0,
  avgScrollDepth: 0,
  bounceRate: null,
};

export async function getClarityMetrics(
  funnelId: string,
  period: PeriodInput
): Promise<any> {
  if (USE_MOCK) {
    // O mock carrega o carimbo de tempo junto, como o backend faz. Sem isso a
    // tela de exemplo mostraria número sem data — exatamente o que a fonte real
    // não pode fazer.
    return delay({
      ...mockClarityMetrics(periodScale(period, 15000)),
      days: 3,
      asOf: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
      ageMinutes: 300,
      stale: false,
      empty: false,
      refDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    });
  }

  return apiGet(`/api/metrics/clarity?${periodQuery(period)}&funnel_id=${funnelId}`).then(
    (r) => r.json()
  );
}

// ---------------------------------------------------------------------------
// FONTES DE DADOS
// ---------------------------------------------------------------------------
// Duas fontes, nunca somadas. O rastreador mede agora, por sessão nossa; o
// Clarity mede por dia, agregado, com atraso de publicação. Cada uma responde
// no seu formato e com o seu carimbo de tempo.

export type DataSource = "tracker" | "clarity" | "compare";

export const DATA_SOURCE_LABELS: Record<DataSource, string> = {
  tracker: "Nosso rastreador",
  clarity: "Clarity",
  compare: "Comparar",
};

/**
 * Metadados de tempo que acompanham TODO número vindo do Clarity.
 * Nenhuma tela mostra um valor do Clarity sem isto: sem o carimbo, um dado de
 * ontem lido na página "Ao Vivo" passa por "agora".
 */
export interface AsOf {
  /** ISO de quando o dado foi buscado do Clarity. */
  asOf: string | null;
  /** Minutos desde a busca. */
  ageMinutes: number | null;
  /** Mais de 24h sem atualizar. */
  stale: boolean;
  /** Nunca houve importação — diferente de "deu zero". */
  empty: boolean;
  /** Dia de referência do dado (não é o dia de hoje). */
  refDate: string | null;
}

export interface ClaritySnapshot extends AsOf {
  source: "clarity";
  funnelId: string | null;
  period: string | null;
  metrics: ClarityMetrics | null;
}

/**
 * O que a Data Export API do Clarity realmente entrega.
 *
 * `bounceRate` é `null` sempre: o Clarity não publica taxa de rejeição nesse
 * endpoint. Derivar uma a partir da média de páginas por sessão daria um número
 * plausível e errado, então a tela mostra "—".
 */
export interface ClarityMetrics {
  sessions: number;
  /** Sessões que o Clarity classificou como robô. */
  botSessions: number;
  distinctUsers: number;
  pageViews: number;
  pagesPerSession: number;
  /** Segundos por sessão. */
  avgTime: number;
  /** Rolagem média da página, em %. */
  avgScrollDepth: number;
  bounceRate: number | null;
}

export interface TrackerSnapshot {
  funnelId: string;
  bucket: "hour" | "day";
  periodStart: string;
  capturedAt: string;
  visitors: number;
  pageEntries: number;
  byStep?: Record<string, number>;
}

const SOURCE_PREF_KEY = "funneltron:data-source";

/**
 * Fonte escolhida. Lê do localStorage primeiro para a tela abrir já no estado
 * certo (sem piscar na fonte errada) e confirma com o servidor em seguida.
 */
export function readLocalDataSource(): DataSource {
  try {
    const v = localStorage.getItem(SOURCE_PREF_KEY);
    if (v === "tracker" || v === "clarity" || v === "compare") return v;
  } catch {
    /* localStorage bloqueado — cai no padrão */
  }
  return "tracker";
}

export async function getDataSourcePreference(): Promise<DataSource> {
  if (USE_MOCK) return delay(readLocalDataSource(), 0);

  try {
    const r = await apiGet("/api/sources/preference");
    if (!r.ok) return readLocalDataSource();
    const data = await r.json();
    return (data.dataSource as DataSource) ?? "tracker";
  } catch {
    // Preferência é conforto, não dado. Se o servidor não responde, a tela
    // abre na última escolha conhecida em vez de travar.
    return readLocalDataSource();
  }
}

export async function setDataSourcePreference(source: DataSource): Promise<void> {
  try {
    localStorage.setItem(SOURCE_PREF_KEY, source);
  } catch {
    /* segue mesmo sem persistir localmente */
  }

  if (USE_MOCK) return;

  try {
    await apiSend("/api/sources/preference", "PUT", { data_source: source });
  } catch {
    /* já salvou local; sincroniza na próxima */
  }
}

/**
 * Regras de tipo de página por slug, salvas pelo usuário em Configurações.
 * `null` = ainda não personalizou — quem chama cai nos padrões embutidos
 * (`DEFAULT_SLUG_RULES`, em `@/lib/urlImport`).
 *
 * Lança em vez de engolir o erro: `null` já significa "sem regra salva", e
 * devolver `null` também numa falha de rede/servidor deixava indistinguível
 * "nunca personalizou" de "não deu pra saber agora" — quem chama e tem botão
 * de Salvar (SlugRulesCard) precisa dessa diferença pra não sobrescrever uma
 * personalização real com os padrões só porque a leitura falhou uma vez.
 */
export async function getSlugRules(): Promise<SlugTypeRule[] | null> {
  if (USE_MOCK) return delay(null, 0);

  const r = await apiGet("/api/sources/slug-rules");
  if (!r.ok) throw new Error(`Falha ao buscar regras de slug (${r.status})`);
  const data = await r.json();
  return (data.rules as SlugTypeRule[] | null) ?? null;
}

export async function saveSlugRules(rules: SlugTypeRule[]): Promise<void> {
  if (USE_MOCK) return;
  await apiSend("/api/sources/slug-rules", "PUT", { rules }).then(okJson);
}

/** Último dado do Clarity que existe — é o que a página Ao Vivo mostra. */
export async function getLatestClarity(
  funnelId?: string
): Promise<ClaritySnapshot> {
  if (USE_MOCK) {
    const asOf = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    return delay({
      source: "clarity" as const,
      funnelId: funnelId ?? null,
      period: "30d",
      metrics: mockClarityMetrics(15000),
      asOf,
      ageMinutes: 300,
      stale: false,
      empty: false,
      refDate: new Date(Date.now() - 864e5).toISOString().slice(0, 10),
    });
  }

  const q = funnelId ? `?funnel_id=${funnelId}` : "";
  return apiGet(`/api/sources/clarity/latest${q}`).then(okJson);
}

/** Períodos já fechados do nosso rastreador (histórico consultável). */
export async function getTrackerHistory(
  funnelId: string,
  bucket: "hour" | "day" = "hour",
  limit = 48
): Promise<TrackerSnapshot[]> {
  if (USE_MOCK) {
    const now = Date.now();
    return delay(
      Array.from({ length: 12 }, (_, i) => ({
        funnelId,
        bucket,
        periodStart: new Date(now - (i + 1) * 3600e3).toISOString(),
        capturedAt: new Date(now - i * 3600e3).toISOString(),
        visitors: Math.round(120 + Math.sin(i) * 40),
        pageEntries: Math.round(300 + Math.cos(i) * 90),
      }))
    );
  }

  return apiGet(
    `/api/sources/tracker/history?funnel_id=${funnelId}&bucket=${bucket}&limit=${limit}`
  ).then(okJson);
}

/** Fecha o período corrente num snapshot agora, sem esperar o cron. */
export async function captureTrackerSnapshot(
  funnelId: string,
  bucket: "hour" | "day" = "hour"
): Promise<TrackerSnapshot> {
  if (USE_MOCK) {
    return delay({
      funnelId,
      bucket,
      periodStart: new Date().toISOString(),
      capturedAt: new Date().toISOString(),
      visitors: 137,
      pageEntries: 402,
    });
  }

  return apiSend(
    `/api/sources/tracker/snapshot?funnel_id=${funnelId}&bucket=${bucket}`,
    "POST",
    {}
  ).then(okJson);
}


// --- Aba "Ao Vivo" ---

/** Dado de "ao vivo" de uma VSL via proxy VTurb. */
export interface LiveVslData {
  stepId: string;
  playerId: string;
  label: string;
  liveUsers: number;
  domain: string;
  windowMinutes: number;
}

/** Dado de "ao vivo" de uma etapa via rastreador próprio. */
export interface LiveStepData {
  stepId: string;
  online: number;
}

export async function getLiveVsl(
  funnelId: string,
  minutes = 5
): Promise<LiveVslData[]> {
  if (!USE_MOCK)
    return apiGet(
      `/api/live/vsl?funnel_id=${funnelId}&minutes=${minutes}`
    ).then(okJson);

  // Mock: retorna dados realistas para as VSLs do funil
  const layout = readLayout(funnelId);
  const steps = layout?.steps ?? MOCK_STEPS[funnelId] ?? [];
  const vslSteps = steps.filter((s) => s.type === "vsl");

  return delay(
    vslSteps.map((step, i) => ({
      stepId: step.id,
      playerId: `player_${step.id}`,
      label: step.label,
      liveUsers: Math.floor(Math.random() * 50) + 5, // 5-55 pessoas
      domain: new URL(step.url).hostname,
      windowMinutes: minutes,
    })),
    500
  );
}

export async function getLiveFlow(
  funnelId: string
): Promise<LiveStepData[]> {
  if (!USE_MOCK)
    return apiGet(`/api/live?funnel_id=${funnelId}`).then(okJson);

  // Mock: rastreador próprio retornando pessoas online por etapa
  const layout = readLayout(funnelId);
  const steps = layout?.steps ?? MOCK_STEPS[funnelId] ?? [];

  return delay(
    steps.map((step) => ({
      stepId: step.id,
      online: Math.floor(Math.random() * 30) + 1, // 1-30 pessoas por etapa
    })),
    400
  );
}

/** Envia heartbeat/view para o rastreador próprio (backend). */
export async function trackLiveEvent(
  payload: { funnelId: string; sessionId: string; url: string; stepId?: string; referrer?: string; utm?: Record<string, string> }
): Promise<void> {
  if (!USE_MOCK) {
    // Backend espera snake_case + url obrigatória
    await apiSend(`/api/live/track`, "POST", {
      funnel_id: payload.funnelId,
      session_id: payload.sessionId,
      url: payload.url,
      step_id: payload.stepId,
      referrer: payload.referrer,
      utm: payload.utm,
    });
    return;
  }
  // Mock: não faz nada
  return delay(undefined, 50);
}

// --- Autenticação (Supabase Auth via backend proxy) ---

export interface AuthUser {
  id: string;
  email: string;
  fullName?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * O backend devolve snake_case (access_token, user.id, user.user_metadata).
 * Normaliza para o formato camelCase do frontend.
 */
function mapSession(raw: any): AuthSession {
  const u = raw.user ?? {};
  const meta = u.user_metadata ?? {};
  return {
    accessToken: raw.access_token ?? raw.accessToken ?? "",
    refreshToken: raw.refresh_token ?? raw.refreshToken ?? "",
    user: {
      id: u.id ?? raw.id ?? "",
      email: u.email ?? raw.email ?? "",
      fullName: u.full_name ?? meta?.full_name ?? meta?.name ?? raw.fullName,
    },
  };
}

/** Faz login com email/senha. Sem backend, valida contra um usuário de demo. */
export async function login(
  email: string,
  password: string
): Promise<AuthSession> {
  if (!USE_MOCK) {
    const r = await fetch(`/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      const msg = await r.json().catch(() => ({}));
      throw new Error(msg.detail || "Email ou senha inválidos");
    }
    return mapSession(await r.json());
  }
  // Demo: qualquer email/senha não-vazios entram como admin de demonstração.
  if (!email.trim() || !password.trim()) {
    throw new Error("Email e senha são obrigatórios");
  }
  await delay(null, 400);
  return {
    accessToken: `demo_${btoa(email)}`,
    refreshToken: `demo_refresh_${btoa(email)}`,
    user: { id: `demo_${btoa(email)}`, email, fullName: email.split("@")[0] },
  };
}

/** Cria uma conta nova. */
export async function signup(
  email: string,
  password: string,
  fullName = ""
): Promise<AuthSession> {
  if (!USE_MOCK) {
    const r = await fetch(`/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName }),
    });
    if (!r.ok) {
      const msg = await r.json().catch(() => ({}));
      throw new Error(msg.detail || "Não foi possível criar a conta");
    }
    return mapSession(await r.json());
  }
  await delay(null, 500);
  return {
    accessToken: `demo_${btoa(email)}`,
    refreshToken: `demo_refresh_${btoa(email)}`,
    user: { id: `demo_${btoa(email)}`, email, fullName: fullName || email.split("@")[0] },
  };
}

/** Desconecta (revoga sessão no backend). */
export async function logout(): Promise<void> {
  if (!USE_MOCK) {
    await fetch(`/api/auth/logout`, { method: "POST" });
    return;
  }
  return delay(undefined, 200);
}

// --- Vendas via webhook (backend salva, frontend consulta) ---

export type SaleStatus = "pending" | "paid";

/** Venda notificada por webhook (Hotmart, Kiwify, etc.) e salva no backend. */
export interface LiveSale {
  id: string;
  funnelId: string;
  stepId: string;
  status: SaleStatus;
  amount: number;
  /** ISO string — quando a venda entrou. */
  timestamp: string;
  customer?: string;
}

/**
 * Conversão do funil na janela pedida: de quem entrou, quantos converteram,
 * e a taxa de cada etapa (página → página). Usada no card "últimos 30 min".
 */
export interface LiveConversion {
  funnelId: string;
  windowMinutes: number;
  visitors: number;
  conversions: number;
  rate: number; // 0-100, ponta a ponta (entrada → obrigado)
  /** Por etapa: quantos chegaram e a taxa de saída para a próxima. */
  stepRates: { stepId: string; label: string; visitors: number; rate: number }[];
}

/** IDs dos funis que receberam tráfego nos últimos ~5 min. */
export async function getActiveFunnels(): Promise<string[]> {
  if (!USE_MOCK)
    return apiGet(`/api/live/active-funnels`).then(okJson);

  // Mock: todos os funis de exemplo "ativos", exceto inativos que não têm
  // tráfego. Filtra pelos MOCK_FUNNELS para não mostrar lixo.
  return delay(
    MOCK_FUNNELS.filter((f) => f.status !== "inactive").map((f) => f.id),
    300
  );
}

export async function getLiveSales(
  funnelId: string,
  windowMinutes = 60
): Promise<LiveSale[]> {
  if (!USE_MOCK)
    return apiGet(
      `/api/live/sales?funnel_id=${funnelId}&window=${windowMinutes}`
    ).then(okJson);

  // Mock: gera vendas aleatórias com timestamp dentro da janela.
  const now = Date.now();
  const windowMs = windowMinutes * 60_000;
  const layout = readLayout(funnelId);
  const steps = layout?.steps ?? MOCK_STEPS[funnelId] ?? [];
  const checkout =
    steps.find((s) => s.type === "checkout" || s.type === "thank_you") ??
    steps[steps.length - 1];
  const base = Math.max(1, Math.round(windowMinutes / 15)); // 1-4 vendas
  const count = Math.floor(Math.random() * base) + 1;

  return delay(
    Array.from({ length: count }, (_, i) => {
      const paid = Math.random() > 0.35; // ~65% pagas
      const ts = new Date(
        now - Math.floor(Math.random() * windowMs)
      ).toISOString();
      return {
        id: `sale_${funnelId}_${i}_${Math.floor(Math.random() * 99999)}`,
        funnelId,
        stepId: checkout?.id ?? steps[steps.length - 1]?.id ?? "s1",
        status: (paid ? "paid" : "pending") as SaleStatus,
        amount: [97, 197, 297, 497, 997][Math.floor(Math.random() * 5)],
        timestamp: ts,
      };
    }).sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp)),
    400
  );
}

/** Uma pessoa entrando em uma página do funil — linha do log de entradas. */
export interface LivePageEntry {
  id: string;
  funnelId: string;
  stepId: string;
  /** ISO — quando a pessoa abriu a página. */
  timestamp: string;
  /** Identificação anônima do visitante (hash curto da sessão). */
  visitor: string;
  device?: "desktop" | "mobile";
  /** De onde veio: utm_source, domínio do referrer, ou "direto". */
  source?: string;
  url?: string;
}

/**
 * PRNG determinístico a partir de uma string. Existe por causa do polling:
 * o log é recarregado a cada 5s e, com `Math.random()`, a lista inteira se
 * redesenhava a cada tick — nada ficava parado o suficiente para ser lido.
 * Com semente, a mesma entrada gera sempre a mesma linha.
 */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Log de entradas em página: quem entrou, onde, quando. Mais novo primeiro. */
export async function getLivePageEntries(
  funnelId: string,
  windowMinutes = 30,
  limit = 40
): Promise<LivePageEntry[]> {
  if (!USE_MOCK)
    return apiGet(
      `/api/live/entries?funnel_id=${funnelId}&window=${windowMinutes}&limit=${limit}`
    ).then(okJson);

  // Mock: uma entrada a cada ~7s, ancorada numa grade de tempo fixa. Cada
  // "slot" da grade tem semente própria, então as linhas antigas não mudam
  // entre um polling e outro — só entram linhas novas no topo.
  const layout = readLayout(funnelId);
  const steps = layout?.steps ?? MOCK_STEPS[funnelId] ?? [];
  if (steps.length === 0) return delay([], 200);

  const SLOT_MS = 7_000;
  const now = Date.now();
  const windowMs = windowMinutes * 60_000;
  const current = Math.floor(now / SLOT_MS);
  const oldest = Math.floor((now - windowMs) / SLOT_MS);
  const total = Math.min(limit, Math.max(0, current - oldest));

  const sources = ["facebook", "instagram", "google", "youtube", "direto"];

  return delay(
    Array.from({ length: total }, (_, i) => {
      const slot = current - i;
      const rnd = seeded(`${funnelId}:${slot}`);

      // Entrada é mais provável no começo do funil: peso decrescente por etapa.
      const weights = steps.map((_, idx) => 1 / (idx + 1));
      const totalW = weights.reduce((a, b) => a + b, 0);
      let pick = rnd() * totalW;
      let stepIdx = 0;
      for (let k = 0; k < weights.length; k++) {
        pick -= weights[k];
        if (pick <= 0) {
          stepIdx = k;
          break;
        }
      }
      const step = steps[stepIdx];

      return {
        id: `entry_${funnelId}_${slot}`,
        funnelId,
        stepId: step.id,
        timestamp: new Date(slot * SLOT_MS).toISOString(),
        visitor: Math.floor(rnd() * 0xfffff)
          .toString(16)
          .padStart(5, "0"),
        device: (rnd() > 0.42 ? "mobile" : "desktop") as "mobile" | "desktop",
        source: sources[Math.floor(rnd() * sources.length)],
        url: step.url,
      };
    }),
    300
  );
}

/**
 * Cadeia de etapas do funil para os mocks de conversão.
 *
 * Cada etapa recebe uma fatia da ANTERIOR — que é o que "conversão de funil,
 * página a página" quer dizer (decisão 2.2). A versão antiga elevava a taxa da
 * própria etapa ao índice dela (`entry * (rate/100) ** i`), o que despencava
 * bem mais rápido do que qualquer funil real: num funil de 7 páginas o dia
 * inteiro terminava em 0,0% de conversão de compra, e o número parecia bug.
 */
function chainSteps(
  steps: { id: string; label: string }[],
  entry: number,
  rnd: () => number
): { stepId: string; label: string; visitors: number; rate: number }[] {
  let visitors = entry;

  return steps.map((s, i) => {
    // A primeira etapa é a porta de entrada: 100% de quem entrou está nela.
    const rate = i === 0 ? 100 : Math.max(25, 88 - i * 6 - Math.round(rnd() * 8));
    visitors = i === 0 ? entry : Math.max(1, Math.round(visitors * (rate / 100)));
    return { stepId: s.id, label: s.label, visitors, rate };
  });
}

/**
 * Mesma conta da janela curta, mas do **dia inteiro** (desde a meia-noite).
 *
 * Existe porque a janela de 30 min responde "como está agora" e some — não dá
 * para saber se o dia está bom. As duas juntas é que dizem alguma coisa: 0,4%
 * nos últimos 30 min pode ser ruído; 0,4% no dia é um problema.
 */
export async function getDayConversion(
  funnelId: string
): Promise<LiveConversion> {
  if (!USE_MOCK)
    return apiGet(
      `/api/live/conversion?funnel_id=${funnelId}&scope=today`
    ).then(okJson);

  const layout = readLayout(funnelId);
  const steps = layout?.steps ?? MOCK_STEPS[funnelId] ?? [];

  // Semente do dia: o número do "hoje" não pode dançar a cada polling de 5s —
  // acumulado que encolhe entre um refresh e outro é dado que ninguém acredita.
  const today = new Date();
  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const minutesToday = Math.max(
    1,
    Math.round((Date.now() - +startOfDay) / 60_000)
  );
  const rnd = seeded(`${funnelId}:${startOfDay.toDateString()}`);

  // Volume proporcional ao que já correu do dia (~14 entradas por minuto).
  const perMinute = 8 + rnd() * 12;
  const entry = Math.round(minutesToday * perMinute);

  const stepRates = chainSteps(steps, entry, rnd);
  const conversions = stepRates[stepRates.length - 1]?.visitors ?? 0;

  return delay(
    {
      funnelId,
      windowMinutes: minutesToday,
      visitors: entry,
      conversions,
      rate: entry > 0 ? (conversions / entry) * 100 : 0,
      stepRates,
    },
    400
  );
}

export async function getLiveConversion(
  funnelId: string,
  windowMinutes = 30
): Promise<LiveConversion> {
  if (!USE_MOCK)
    return apiGet(
      `/api/live/conversion?funnel_id=${funnelId}&window=${windowMinutes}`
    ).then(okJson);

  // Mock: queda de conversão realista por etapa, cada uma sobre a anterior.
  const layout = readLayout(funnelId);
  const steps = layout?.steps ?? MOCK_STEPS[funnelId] ?? [];

  // Semente pela janela de 5s do polling: o número não pode saltar a cada
  // refresh, senão a comparação com o dia não se sustenta.
  const rnd = seeded(`${funnelId}:conv:${Math.floor(Date.now() / 30_000)}`);
  const entry = Math.floor(rnd() * 600) + 200; // 200-800 visitantes

  const stepRates = chainSteps(steps, entry, rnd);
  const conversions = stepRates[stepRates.length - 1]?.visitors ?? 0;

  return delay(
    {
      funnelId,
      windowMinutes,
      visitors: entry,
      conversions,
      rate: entry > 0 ? (conversions / entry) * 100 : 0,
      stepRates,
    },
    400
  );
}
