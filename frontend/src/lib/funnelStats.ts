import type { Funnel, FunnelStep, FunnelEdge, StepMetric, VslInsight } from "@/types";

/**
 * Substitui a conversão de cada VSL pelo dado real: de quem abriu o vídeo,
 * quantos chegaram na próxima página do funil (não a taxa de conclusão do
 * player, que é outra coisa — ver `engagementRate`).
 *
 * O backend manda `conversionRate` como cópia de `engagementRate`
 * ("Simplificado"), porque não conhece a próxima etapa do funil. Aqui a gente
 * conhece, então corrige.
 */
export function enrichVslConversion(
  items: VslInsight[],
  steps: FunnelStep[],
  edges: FunnelEdge[],
  metrics: StepMetric[]
): VslInsight[] {
  return items.map((v) => {
    const vslMetric = metrics.find((m) => m.stepId === v.stepId);
    const outgoing = edges.find(
      (e) => e.sourceStepId === v.stepId && e.condition === "default"
    );
    const nextMetric = outgoing
      ? metrics.find((m) => m.stepId === outgoing.targetStepId)
      : undefined;

    const viewers = vslMetric?.visitors ?? v.views;
    if (!nextMetric || viewers <= 0) return v;

    return { ...v, conversionRate: (nextMetric.visitors / viewers) * 100 };
  });
}

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

export interface TrackerVslEstimate {
  count: number;
  avgConversion: number | null;
}

/**
 * Estimativa de conversão das VSLs SEM depender do VTurb: usa só o que o
 * rastreador próprio já vê (visitantes da página do vídeo até a próxima
 * página). Existe porque nem toda VSL tem `player_id` configurado — sem
 * essa estimativa o card de VSL ficava vazio mesmo em funis com vídeo e
 * tráfego real, só porque o VTurb não estava ligado.
 */
export function estimateVslConversionFromTracker(
  steps: FunnelStep[],
  edges: FunnelEdge[],
  metrics: StepMetric[]
): TrackerVslEstimate {
  const items = steps
    .filter((s) => s.type === "vsl")
    .map((step) => {
      const metric = metrics.find((m) => m.stepId === step.id);
      const outgoing =
        edges.find(
          (e) => e.sourceStepId === step.id && e.condition === "default"
        ) ?? edges.find((e) => e.sourceStepId === step.id);
      const nextMetric = outgoing
        ? metrics.find((m) => m.stepId === outgoing.targetStepId)
        : undefined;
      const viewers = metric?.visitors ?? 0;
      if (viewers <= 0 || !nextMetric) return null;
      return { viewers, rate: (nextMetric.visitors / viewers) * 100 };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (items.length === 0) return { count: 0, avgConversion: null };

  const totalViewers = items.reduce((s, i) => s + i.viewers, 0);
  const avgConversion =
    totalViewers > 0
      ? items.reduce((s, i) => s + i.rate * i.viewers, 0) / totalViewers
      : items.reduce((s, i) => s + i.rate, 0) / items.length;

  return { count: items.length, avgConversion };
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
  /** Pessoas diferentes que entraram (visitantes da primeira etapa). */
  visitors: number;
  /** Avanços de página para página. */
  conversions: number;
  /**
   * Conversão de funil: de quem entrou na primeira página, quantos chegaram
   * na última — ponta a ponta do funil desenhado, não uma média de taxas.
   */
  avgRate: number;
  /** Visitas na página de entrada (primeira etapa, pela ordem do funil). */
  entry: number;
  /**
   * Conversão de compra: de quem entrou, quantos REALMENTE compraram (venda
   * paga confirmada por webhook — `salesCount`, não visita de página).
   * `null` quando não há entrada pra dividir, ou quando `salesCount` não foi
   * informado a `computeStats` (chamador ainda não busca o ticket).
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
  metrics: StepMetric[],
  /**
   * Vendas pagas confirmadas no período (de `getFunnelTicket`). Sem isso,
   * `purchaseRate` fica `null` — nunca cai de volta para "chegou na página",
   * que conta quem só visitou o obrigado sem pagar como se tivesse comprado.
   */
  salesCount?: number
): FunnelStats {
  // Ordem do funil = orderIndex das etapas. Primeira e última definem a
  // conversão ponta a ponta, não o maior número de visitantes entre as
  // etapas (uma etapa do meio pode ter mais tráfego direto que a de entrada).
  const orderedSteps = [...steps].sort((a, b) => a.orderIndex - b.orderIndex);
  const firstStep = orderedSteps[0];
  const lastStep = orderedSteps[orderedSteps.length - 1];
  const entryMetric = firstStep
    ? metrics.find((m) => m.stepId === firstStep.id)
    : undefined;
  const exitMetric = lastStep
    ? metrics.find((m) => m.stepId === lastStep.id)
    : undefined;
  const entry = entryMetric?.visitors ?? 0;
  // "Conversões de funil" = quem chegou na ÚLTIMA página do funil desenhado,
  // não a soma das conversões de cada etapa (isso dava sempre 0 quando o
  // rastreador atribuía conversão só à etapa-meta de compra, não a cada
  // avanço de página).
  const conversions = exitMetric?.visitors ?? 0;

  const goalStep = resolveGoalStep(funnel, steps);

  return {
    // Gente DIFERENTE que entrou (primeira página) — não pageview somado de
    // toda etapa, que conta a mesma pessoa de novo a cada página vista e não
    // responde "quantos leads entraram no funil".
    visitors: entry,
    conversions,
    avgRate:
      entry > 0 && exitMetric ? (exitMetric.visitors / entry) * 100 : 0,
    entry,
    purchaseRate:
      entry > 0 && salesCount != null ? (salesCount / entry) * 100 : null,
    goalStep,
    steps: steps.length,
  };
}
