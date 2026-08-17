import type { Funnel, FunnelStep, StepMetric, VslInsight } from "@/types";

/** Resumo das VSLs de um funil. Um funil pode ter várias. */
export interface VslSummary {
  count: number;
  /** Conversão média, ponderada por views — uma VSL de 10 views não pesa
   *  igual a uma de 10.000. `null` quando não há VSL com dado. */
  avgConversion: number | null;
  avgEngagement: number | null;
  totalViews: number;
  /** A de melhor conversão, para destaque. */
  best: VslInsight | null;
  items: VslInsight[];
}

export function summarizeVsl(items: VslInsight[]): VslSummary {
  if (items.length === 0) {
    return {
      count: 0,
      avgConversion: null,
      avgEngagement: null,
      totalViews: 0,
      best: null,
      items,
    };
  }

  const totalViews = items.reduce((s, v) => s + v.views, 0);
  const weighted = (pick: (v: VslInsight) => number) =>
    totalViews > 0
      ? items.reduce((s, v) => s + pick(v) * v.views, 0) / totalViews
      : items.reduce((s, v) => s + pick(v), 0) / items.length;

  return {
    count: items.length,
    avgConversion: weighted((v) => v.conversionRate),
    avgEngagement: weighted((v) => v.engagementRate),
    totalViews,
    best: [...items].sort((a, b) => b.conversionRate - a.conversionRate)[0],
    items,
  };
}

/** Agrupa insights por funil, preservando a ordem de chegada. */
export function groupVslByFunnel(
  items: VslInsight[]
): { funnelId: string; funnelName: string; summary: VslSummary }[] {
  const byFunnel = new Map<string, VslInsight[]>();
  for (const v of items) {
    const list = byFunnel.get(v.funnelId);
    if (list) list.push(v);
    else byFunnel.set(v.funnelId, [v]);
  }
  return [...byFunnel.entries()].map(([funnelId, list]) => ({
    funnelId,
    funnelName: list[0].funnelName,
    summary: summarizeVsl(list),
  }));
}

/**
 * Métricas agregadas de um funil. Uma fonte só, para a lista, a página de
 * métricas e o ateliê nunca discordarem sobre o mesmo número.
 */
export interface FunnelStats {
  /** Volume de acesso somando todas as etapas. */
  visitors: number;
  /** Avanços de página para página. */
  conversions: number;
  /** Conversão de funil: média das passagens entre páginas. */
  avgRate: number;
  /** Visitas na página de entrada. */
  entry: number;
  /**
   * Conversão de compra: de quem entrou, quantos chegaram na página-meta.
   * `null` quando o funil não tem meta definida nem página de obrigado —
   * ausência de dado, não desempenho zero.
   */
  purchaseRate: number | null;
  /** A etapa usada como fim da medição, se houver. */
  goalStep: FunnelStep | null;
  steps: number;
}

/**
 * Qual etapa encerra a medição de conversão de compra.
 *
 * 1. a configurada à mão no funil (`conversionGoalStepId`);
 * 2. senão, a primeira etapa do tipo "obrigado".
 *
 * Isso importa em funil com upsell: o "final do front" costuma ser o obrigado
 * do produto principal, não a última página do fluxo inteiro.
 */
export function resolveGoalStep(
  funnel: Pick<Funnel, "conversionGoalStepId"> | null | undefined,
  steps: FunnelStep[]
): FunnelStep | null {
  if (funnel?.conversionGoalStepId) {
    const chosen = steps.find((s) => s.id === funnel.conversionGoalStepId);
    if (chosen) return chosen;
  }
  return steps.find((s) => s.type === "thank_you") ?? null;
}

export function computeStats(
  funnel: Pick<Funnel, "conversionGoalStepId"> | null | undefined,
  steps: FunnelStep[],
  metrics: StepMetric[]
): FunnelStats {
  const visitors = metrics.reduce((s, m) => s + m.visitors, 0);
  const conversions = metrics.reduce((s, m) => s + m.conversions, 0);
  const entry = metrics.length ? Math.max(...metrics.map((m) => m.visitors)) : 0;

  const goalStep = resolveGoalStep(funnel, steps);
  const goalMetric = goalStep
    ? metrics.find((m) => m.stepId === goalStep.id)
    : undefined;

  return {
    visitors,
    conversions,
    avgRate: visitors > 0 ? (conversions / visitors) * 100 : 0,
    entry,
    purchaseRate:
      entry > 0 && goalMetric ? (goalMetric.visitors / entry) * 100 : null,
    goalStep,
    steps: steps.length,
  };
}
