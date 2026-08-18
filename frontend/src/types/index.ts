export type FunnelStatus = "active" | "inactive" | "testing";

export type StepType =
  | "landing"
  | "vsl"
  | "checkout"
  | "upsell"
  | "downsell"
  | "order_bump"
  | "thank_you"
  | "other"
  /** Um funil de upsell inteiro embutido como um único bloco. */
  | "sub_funnel";

/**
 * Funil normal (front) ou funil de upsell reaproveitável. O de upsell é
 * desenhado no mesmo ateliê, mas pode ser invocado dentro de outros funis
 * como um bloco só.
 */
export type FunnelKind = "front" | "upsell";

export type EdgeCondition =
  | "default"
  | "on_accept"
  | "on_decline"
  | "on_bump"
  | "on_no_bump"
  | "back_redirect";

export type MetricSource = "clarity" | "vturb" | "manual";

export interface Funnel {
  id: string;
  name: string;
  slug: string;
  status: FunnelStatus;
  baseUrl: string;
  createdAt: string;
  updatedAt: string;
  /** Ausente = "front", para não quebrar funis já salvos. */
  kind?: FunnelKind;
  /**
   * Página que encerra a medição de conversão de compra deste funil.
   * Sem ela, o cálculo cai na primeira etapa do tipo "obrigado".
   */
  conversionGoalStepId?: string | null;
}

export interface FunnelStep {
  id: string;
  funnelId: string;
  label: string;
  url: string;
  type: StepType;
  positionX: number;
  positionY: number;
  parentStepId: string | null;
  orderIndex: number;
  screenshotUrl?: string | null;
  status?: FunnelStatus;
  /** Preenchido quando `type === "sub_funnel"`: qual funil de upsell embutir. */
  subFunnelId?: string | null;
  /** Preenchido quando `type === "vsl"`: player do VTurb para o proxy de live users. */
  playerId?: string | null;
}

export interface FunnelEdge {
  id: string;
  funnelId: string;
  sourceStepId: string;
  targetStepId: string;
  condition: EdgeCondition;
  label: string;
}

export interface StepMetric {
  id: string;
  funnelId: string;
  stepId: string;
  date: string;
  visitors: number;
  conversions: number;
  conversionRate: number;
  source: MetricSource;
}

/**
 * Um vídeo. Um funil pode ter VÁRIOS — VSL principal, VSL de upsell, VSL de
 * downsell. Por isso a chave é `stepId`: cada insight pertence a uma etapa
 * específica, não ao funil inteiro.
 */
export interface VslInsight {
  id: string;
  name: string;
  funnelId: string;
  funnelName: string;
  /** Etapa do tipo "vsl" a que este vídeo corresponde. */
  stepId: string;
  engagementRate: number;
  conversionRate: number;
  views: number;
  completions: number;
  source: "vturb";
}

export interface FunnelComparisonRow {
  id: string;
  name: string;
  status: FunnelStatus;
  visitors: number;
  conversions: number;
  conversionRate: number;
  /**
   * Variação contra o período anterior. `null` quando não há com o que
   * comparar — a tela mostra "—" em vez de "▲ 0,0%", que afirmaria
   * estabilidade sem ninguém ter medido (decisão 2.4).
   */
  trend: number | null;
  source: MetricSource;
}

export interface OverviewMetrics {
  totalFunnels: number;
  activeFunnels: number;
  testingFunnels: number;
  inactiveFunnels: number;
  totalVisitors: number;
  totalConversions: number;
  avgConversionRate: number;
  estRevenue: number;
}

export type Period = "7d" | "30d" | "90d" | "all";

/** Intervalo escolhido a dedo. Datas em ISO curto: "2026-08-16". */
export interface DateRange {
  from: string;
  to: string;
}

/** O que as telas mandam para a camada de dados: atalho ou intervalo livre. */
export type PeriodInput = Period | DateRange;

export function isDateRange(p: PeriodInput): p is DateRange {
  return typeof p === "object" && "from" in p && "to" in p;
}
