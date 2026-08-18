import type {
  Funnel,
  FunnelEdge,
  FunnelStep,
  FunnelStatus,
  FunnelComparisonRow,
  OverviewMetrics,
  StepMetric,
  VslInsight,
  EdgeCondition,
  StepType,
  FunnelKind,
} from "@/types";

/**
 * Tradução entre o formato do app (camelCase) e o do banco (snake_case).
 *
 * Por que num arquivo só
 * ----------------------
 * O app fala `positionX`, `sourceStepId`, `conversionGoalStepId`. As tabelas
 * do Postgres falam `position_x`, `source_step_id`, `conversion_goal_step_id`.
 * Sem uma fronteira explícita, a conversão se espalha: cada tela adivinha um
 * pedaço, e o que sobra chega como `undefined` — que em posição de card vira
 * silenciosamente `0`, empilhando o funil inteiro no canto superior esquerdo
 * sem nenhum erro na tela.
 *
 * Regra: **nenhum objeto do banco atravessa este arquivo sem ser traduzido.**
 * `api/client.ts` chama estas funções na borda; do lado de dentro só existe o
 * formato do app.
 */

// --- Funil ------------------------------------------------------------------

export function fromApiFunnel(row: Record<string, any>): Funnel {
  return {
    id: row.id,
    name: row.name ?? "",
    slug: row.slug ?? "",
    status: (row.status ?? "active") as FunnelStatus,
    baseUrl: row.base_url ?? row.baseUrl ?? "",
    createdAt: row.created_at ?? row.createdAt ?? "",
    updatedAt: row.updated_at ?? row.updatedAt ?? "",
    kind: (row.kind ?? "front") as FunnelKind,
    conversionGoalStepId:
      row.conversion_goal_step_id ?? row.conversionGoalStepId ?? null,
  };
}

export function toApiFunnel(funnel: Partial<Funnel>): Record<string, any> {
  const out: Record<string, any> = {};
  if (funnel.name !== undefined) out.name = funnel.name;
  if (funnel.slug !== undefined) out.slug = funnel.slug;
  if (funnel.status !== undefined) out.status = funnel.status;
  if (funnel.baseUrl !== undefined) out.base_url = funnel.baseUrl;
  if (funnel.kind !== undefined) out.kind = funnel.kind;
  if (funnel.conversionGoalStepId !== undefined)
    out.conversion_goal_step_id = funnel.conversionGoalStepId;
  return out;
}

// --- Etapa ------------------------------------------------------------------

export function fromApiStep(row: Record<string, any>): FunnelStep {
  return {
    id: row.id,
    funnelId: row.funnel_id ?? row.funnelId ?? "",
    label: row.label ?? "",
    url: row.url ?? "",
    type: (row.type ?? "other") as StepType,
    // `Number(...) || 0` e não `?? 0`: uma posição que chega como string ("320")
    // precisa virar número, senão o React Flow soma coordenada com texto.
    positionX: Number(row.position_x ?? row.positionX) || 0,
    positionY: Number(row.position_y ?? row.positionY) || 0,
    parentStepId: row.parent_step_id ?? row.parentStepId ?? null,
    orderIndex: Number(row.order_index ?? row.orderIndex) || 0,
    screenshotUrl: row.screenshot_url ?? row.screenshotUrl ?? null,
    status: (row.status ?? undefined) as FunnelStatus | undefined,
    subFunnelId: row.sub_funnel_id ?? row.subFunnelId ?? null,
    playerId: row.player_id ?? row.playerId ?? null,
  };
}

export function toApiStep(step: FunnelStep): Record<string, any> {
  return {
    id: step.id,
    label: step.label,
    url: step.url ?? "",
    type: step.type,
    position_x: step.positionX,
    position_y: step.positionY,
    parent_step_id: step.parentStepId ?? null,
    order_index: step.orderIndex ?? 0,
    screenshot_url: step.screenshotUrl ?? null,
    status: step.status ?? null,
    sub_funnel_id: step.subFunnelId ?? null,
    player_id: step.playerId ?? null,
  };
}

// --- Conexão ----------------------------------------------------------------

export function fromApiEdge(row: Record<string, any>): FunnelEdge {
  return {
    id: row.id,
    funnelId: row.funnel_id ?? row.funnelId ?? "",
    sourceStepId: row.source_step_id ?? row.sourceStepId ?? "",
    targetStepId: row.target_step_id ?? row.targetStepId ?? "",
    condition: (row.condition ?? "default") as EdgeCondition,
    label: row.label ?? "",
  };
}

export function toApiEdge(edge: FunnelEdge): Record<string, any> {
  return {
    id: edge.id,
    source_step_id: edge.sourceStepId,
    target_step_id: edge.targetStepId,
    condition: edge.condition ?? "default",
    label: edge.label || null,
  };
}

// --- Visão geral ------------------------------------------------------------

export function fromApiOverview(row: Record<string, any>): OverviewMetrics {
  return {
    totalFunnels: Number(row.totalFunnels) || 0,
    activeFunnels: Number(row.activeFunnels) || 0,
    // O backend ainda não separa "em teste" de "desativo" na visão geral.
    testingFunnels: Number(row.testingFunnels) || 0,
    inactiveFunnels: Number(row.inactiveFunnels) || 0,
    totalVisitors: Number(row.totalVisitors) || 0,
    totalConversions: Number(row.totalConversions) || 0,
    // A rota chama de `averageConversionRate`; o app, de `avgConversionRate`.
    avgConversionRate: Number(
      row.avgConversionRate ?? row.averageConversionRate ?? 0
    ),
    // Receita estimada depende do relatório da UTMify, que ainda não é lido.
    estRevenue: Number(row.estRevenue) || 0,
  };
}

// --- Linha de comparação/ranking --------------------------------------------

export function fromApiComparisonRow(
  row: Record<string, any>
): FunnelComparisonRow {
  return {
    // A rota devolve `funnelId`/`funnelName`; o app espera `id`/`name`. Era
    // exatamente isso que derrubava a Home: `r.name.split(...)` num undefined.
    id: row.id ?? row.funnelId ?? "",
    name: row.name ?? row.funnelName ?? "",
    status: (row.status ?? "active") as FunnelStatus,
    visitors: Number(row.visitors) || 0,
    conversions: Number(row.conversions) || 0,
    conversionRate: Number(row.conversionRate) || 0,
    // Tendência compara com o período anterior — conta que o backend ainda não
    // faz. Vem `null` para a tela mostrar "—", em vez de um "▲ 0,0%" que
    // afirmaria estabilidade que ninguém mediu (decisão 2.4).
    trend: row.trend === undefined || row.trend === null ? null : Number(row.trend),
    source: (row.source ?? "manual") as FunnelComparisonRow["source"],
  };
}

// --- VSL --------------------------------------------------------------------

export function fromApiVslInsight(row: Record<string, any>): VslInsight {
  return {
    id: row.id ?? "",
    name: row.name ?? "VSL",
    funnelId: row.funnelId ?? row.funnel_id ?? "",
    funnelName: row.funnelName ?? row.funnel_name ?? "",
    stepId: row.stepId ?? row.step_id ?? "",
    engagementRate: Number(row.engagementRate ?? row.engagement_rate) || 0,
    conversionRate: Number(row.conversionRate ?? row.conversion_rate) || 0,
    views: Number(row.views) || 0,
    completions: Number(row.completions) || 0,
    source: "vturb",
  };
}

// --- Métrica de etapa -------------------------------------------------------

export function fromApiMetric(row: Record<string, any>): StepMetric {
  const visitors = Number(row.visitors) || 0;
  const conversions = Number(row.conversions) || 0;
  return {
    id: row.id,
    funnelId: row.funnel_id ?? row.funnelId ?? "",
    stepId: row.step_id ?? row.stepId ?? "",
    date: row.date ?? row.created_at ?? "",
    visitors,
    conversions,
    // A tabela guarda `conversion_rate`, mas nem toda linha vem com ele
    // preenchido (importação manual, por exemplo). Recalcular é melhor do que
    // exibir 0% para um funil que converteu.
    conversionRate:
      row.conversion_rate !== undefined && row.conversion_rate !== null
        ? Number(row.conversion_rate)
        : visitors > 0
          ? (conversions / visitors) * 100
          : 0,
    source: (row.source ?? "manual") as StepMetric["source"],
  };
}
