import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  TrendingUp,
  Users,
  Target,
  BarChart3,
  Activity,
  GitCompare,
  Globe,
  Trophy,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Header } from "@/components/common/Header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { PeriodPicker, periodLabel } from "@/components/common/PeriodPicker";
import { SourceSelector, useDataSource } from "@/components/common/SourceSelector";
import { AsOfBadge } from "@/components/common/AsOfBadge";
import type { DataSource } from "@/api/client";
import { cn } from "@/lib/cn";
import { conversionBar, conversionColor } from "@/lib/conversion";
import { MetricLabel } from "@/components/common/MetricLabel";
import { metricLabel, type MetricKey } from "@/lib/metricGlossary";
import { computeStats, summarizeVsl, type VslSummary } from "@/lib/funnelStats";
import { FunnelCanvas } from "@/components/funnel";
import {
  getFunnel,
  listFunnels,
  listSteps,
  listEdges,
  getStepMetrics,
  getTrackerMetrics,
  getClarityMetrics,
  getVturbMetrics,
  getVslInsights,
} from "@/api/client";
import type {
  Funnel,
  FunnelStep,
  FunnelEdge,
  StepMetric,
  PeriodInput,
  VslInsight,
} from "@/types";

/** Cores estáveis por posição na comparação. */
const COMPARE_COLORS = ["#2563eb", "#db2777", "#16a34a", "#f59e0b", "#7c3aed"];

interface FunnelBundle {
  funnel: Funnel;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  metrics: StepMetric[];
  vsl: VslSummary;
}

/**
 * As quatro coisas que só existem por funil.
 *
 * `vslAll` chega pronto de fora, e não é buscado aqui: a chamada não depende do
 * funil, então fazê-la dentro baixava a MESMA resposta uma vez por funil para
 * filtrar cada uma no cliente depois.
 */
async function loadBundle(
  id: string,
  vslAll: VslInsight[],
  source: DataSource,
  period: PeriodInput
): Promise<FunnelBundle> {
  const [funnel, steps, edges, metrics] = await Promise.all([
    getFunnel(id),
    listSteps(id),
    listEdges(id),
    // "Comparar" ainda não tem como render lado a lado nesta grade — cai no
    // Clarity/VTurb, igual antes.
    source === "tracker" ? getTrackerMetrics(id, period) : getStepMetrics(id),
  ]);
  return {
    funnel,
    steps,
    edges,
    metrics,
    vsl: summarizeVsl(vslAll.filter((v) => v.funnelId === id)),
  };
}

function totals(b: FunnelBundle) {
  const s = computeStats(b.funnel, b.steps, b.metrics);
  return { ...s, endToEnd: s.purchaseRate };
}

const pct = (n: number | null | undefined) =>
  n == null ? "—" : `${n.toFixed(1)}%`;

/**
 * A passagem do fluxo principal onde o funil mais perde gente. É o número que
 * diz onde mexer primeiro — mais acionável que a média.
 */
function worstStepDrop(b: FunnelBundle) {
  const candidates = b.edges
    .filter((e) => e.condition === "default")
    .map((e) => {
      const from = b.metrics.find((m) => m.stepId === e.sourceStepId);
      const to = b.metrics.find((m) => m.stepId === e.targetStepId);
      if (!from || !to || from.visitors <= 0) return null;
      const fromStep = b.steps.find((s) => s.id === e.sourceStepId);
      const toStep = b.steps.find((s) => s.id === e.targetStepId);
      return {
        label: `${fromStep?.label ?? "?"} → ${toStep?.label ?? "?"}`,
        rate: (to.visitors / from.visitors) * 100,
        lostTotal: Math.max(0, from.visitors - to.visitors),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (candidates.length === 0) return null;
  return candidates.reduce((worst, c) => (c.rate < worst.rate ? c : worst));
}

export function MetricsPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  // Lista vazia = visão global (média de todos os funis). É o padrão da página
  // quando não se entrou por um funil específico.
  const [selectedIds, setSelectedIds] = useState<string[]>(
    routeId ? [routeId] : []
  );
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const [bundles, setBundles] = useState<FunnelBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const { source, setSource } = useDataSource();

  const isGlobal = selectedIds.length === 0;

  useEffect(() => {
    listFunnels().then((list) => {
      setFunnels(list);
      if (list.length === 0) setLoading(false);
    });
  }, []);

  const refreshBundles = useCallback(
    (withSpinner: boolean) => {
      const ids = isGlobal ? funnels.map((f) => f.id) : selectedIds;
      if (ids.length === 0) return;
      if (withSpinner) setLoading(true);
      // Uma chamada de VSL para a tela inteira, não uma por funil.
      return getVslInsights(period)
        .then((vslAll) =>
          Promise.all(ids.map((id) => loadBundle(id, vslAll, source, period)))
        )
        .then(setBundles)
        .finally(() => {
          if (withSpinner) setLoading(false);
        });
    },
    [selectedIds, period, funnels, isGlobal, source]
  );

  useEffect(() => {
    refreshBundles(true);
  }, [refreshBundles]);

  // Atualização silenciosa em segundo plano (sem spinner) — a página só
  // reagia antes quando o período ou o funil selecionado mudava.
  useEffect(() => {
    if (document.visibilityState !== "visible") return;
    const i = setInterval(() => refreshBundles(false), 60000);
    return () => clearInterval(i);
  }, [refreshBundles]);

  useEffect(() => {
    const h = () => {
      if (document.visibilityState === "visible") refreshBundles(false);
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, [refreshBundles]);

  const toggleFunnel = (id: string) => {
    setSelectedIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    );
  };

  const comparing = !isGlobal && bundles.length > 1;

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Métricas"
        subtitle={
          isGlobal
            ? `Visão global · todos os funis · ${periodLabel(period)}`
            : comparing
            ? `Comparando ${bundles.length} funis · ${periodLabel(period)}`
            : `Análise detalhada · ${periodLabel(period)}`
        }
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <SourceSelector value={source} onChange={setSource} />
            <PeriodPicker value={period} onChange={setPeriod} />
            {routeId && (
              <Link to={`/funnel/${routeId}`}>
                <Button variant="outline" size="sm">
                  <ArrowLeft size={14} />
                  Voltar
                </Button>
              </Link>
            )}
          </div>
        }
      />

      <FunnelStrip
        funnels={funnels}
        selectedIds={selectedIds}
        onToggle={toggleFunnel}
        onGlobal={() => setSelectedIds([])}
      />

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Spinner size={32} />
        </div>
      ) : bundles.length === 0 ? (
        <div className="py-24 text-center text-muted-foreground">
          Nenhum funil para analisar.
        </div>
      ) : isGlobal ? (
        <GlobalView bundles={bundles} />
      ) : comparing ? (
        <ComparisonView bundles={bundles} />
      ) : (
        <SingleFunnelView bundle={bundles[0]} period={period} source={source} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra de funis — cada um num container clicável, lado a lado
// ---------------------------------------------------------------------------

function FunnelStrip({
  funnels,
  selectedIds,
  onToggle,
  onGlobal,
}: {
  funnels: Funnel[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onGlobal: () => void;
}) {
  const isGlobal = selectedIds.length === 0;

  return (
    <div className="border-b border-border bg-card/50 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Visão global, um funil, ou vários para comparar
        </p>
        {selectedIds.length > 1 && (
          <Badge variant="info" className="gap-1">
            <GitCompare size={11} />
            {selectedIds.length} em comparação
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onGlobal}
          className={cn(
            "flex min-w-[160px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all",
            isGlobal
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/40"
          )}
        >
          <span
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors",
              isGlobal ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <Globe size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">Global</span>
            <span className="block text-xs text-muted-foreground">
              todos os {funnels.length} funis
            </span>
          </span>
        </button>

        <span className="mx-1 my-1 w-px bg-border" />
        {funnels.map((f) => {
          const index = selectedIds.indexOf(f.id);
          const active = index >= 0;
          return (
            <button
              key={f.id}
              onClick={() => onToggle(f.id)}
              className={cn(
                "flex min-w-[160px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-muted-foreground/40 hover:bg-muted/40"
              )}
            >
              <span
                className="h-8 w-1 shrink-0 rounded-full transition-colors"
                style={{
                  backgroundColor: active
                    ? COMPARE_COLORS[index % COMPARE_COLORS.length]
                    : "hsl(var(--border))",
                }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {f.name}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {f.status === "active"
                    ? "Ativo"
                    : f.status === "testing"
                    ? "Em teste"
                    : "Desativo"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visão global: todos os funis somados
// ---------------------------------------------------------------------------

function GlobalView({ bundles }: { bundles: FunnelBundle[] }) {
  const rows = bundles
    .map((b) => ({ ...totals(b), id: b.funnel.id, name: b.funnel.name, status: b.funnel.status }))
    .sort((a, b) => b.avgRate - a.avgRate);

  const visitors = rows.reduce((s, r) => s + r.visitors, 0);
  const conversions = rows.reduce((s, r) => s + r.conversions, 0);
  // Taxa geral é ponderada pelo volume — média simples daria peso igual a um
  // funil de 200 visitas e a um de 20.000.
  const weightedRate = visitors > 0 ? (conversions / visitors) * 100 : 0;
  const simpleAvg =
    rows.length > 0 ? rows.reduce((s, r) => s + r.avgRate, 0) / rows.length : 0;

  const best = rows[0];
  const worst = rows[rows.length - 1];

  return (
    <main className="space-y-6 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <KpiCard metric="visitors" value={visitors.toLocaleString("pt-BR")} hint={`Somando ${rows.length} funis`} icon={<Users className="text-blue-500" size={24} />} tone="text-blue-500" />
        <KpiCard metric="conversions" value={conversions.toLocaleString("pt-BR")} hint="Total no período" icon={<Target className="text-success" size={24} />} tone="text-success" />
        <KpiCard metric="weightedRate" value={pct(weightedRate)} hint="Ponderada por volume" icon={<TrendingUp className="text-warning" size={24} />} tone="text-warning" />
        <KpiCard metric="simpleAvg" value={pct(simpleAvg)} hint="Média simples entre funis" icon={<Activity className="text-primary" size={24} />} tone="text-primary" />
      </div>

      {best && worst && rows.length > 1 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="border-success/30">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-success">
                Melhor funil
              </p>
              <p className="mt-1 text-lg font-semibold">{best.name}</p>
              <p className="text-sm text-muted-foreground">
                {pct(best.avgRate)} de conversão de funil ·{" "}
                {best.visitors.toLocaleString("pt-BR")} visitas
              </p>
            </CardContent>
          </Card>
          <Card className="border-danger/30">
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-danger">
                Pior funil
              </p>
              <p className="mt-1 text-lg font-semibold">{worst.name}</p>
              <p className="text-sm text-muted-foreground">
                {pct(worst.avgRate)} de conversão de funil ·{" "}
                {worst.visitors.toLocaleString("pt-BR")} visitas
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 size={18} className="text-primary" />
            Todos os funis
          </CardTitle>
          <CardDescription>Ordenado pela conversão de funil</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 text-left font-medium">Funil</th>
                <th className="py-2 text-right font-medium">
                  <MetricLabel metric="visitors">Visitas</MetricLabel>
                </th>
                <th className="py-2 text-right font-medium">
                  <MetricLabel metric="conversions">Conversões de funil</MetricLabel>
                </th>
                <th className="py-2 text-right font-medium">
                  <MetricLabel metric="avgRate">Conversão de funil</MetricLabel>
                </th>
                <th className="py-2 text-right font-medium">
                  <MetricLabel metric="endToEnd">Conversão de compra</MetricLabel>
                </th>
                <th className="py-2 text-right font-medium">
                  <MetricLabel metric="steps">Etapas</MetricLabel>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60">
                  <td className="py-2.5">
                    <Link
                      to={`/funnel/${r.id}/metrics`}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.visitors.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.conversions.toLocaleString("pt-BR")}
                  </td>
                  <td
                    className="py-2.5 text-right font-semibold tabular-nums"
                    style={{ color: conversionColor(r.avgRate) }}
                  >
                    {r.avgRate.toFixed(1)}%
                  </td>
                  <td
                    className={cn(
                      "py-2.5 text-right tabular-nums",
                      r.endToEnd == null && "text-muted-foreground"
                    )}
                    style={
                      r.endToEnd != null
                        ? { color: conversionColor(r.endToEnd) }
                        : undefined
                    }
                    title={
                      r.endToEnd == null
                        ? "Sem página de obrigado neste funil"
                        : undefined
                    }
                  >
                    {pct(r.endToEnd)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                    {r.steps}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Volume por funil</CardTitle>
          <CardDescription>Visitantes e conversões lado a lado</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => v.toLocaleString("pt-BR")} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="visitors" name="Visitantes" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="conversions" name="Conversões" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Comparação: métrica contra métrica
// ---------------------------------------------------------------------------

function ComparisonView({ bundles }: { bundles: FunnelBundle[] }) {
  const rows = bundles.map((b, i) => {
    const t = totals(b);
    const worstEdge = worstStepDrop(b);
    return {
      ...t,
      id: b.funnel.id,
      name: b.funnel.name,
      color: COMPARE_COLORS[i % COMPARE_COLORS.length],
      vslCount: b.vsl.count,
      vslConversion: b.vsl.avgConversion,
      vslEngagement: b.vsl.avgEngagement,
      vslViews: b.vsl.totalViews || null,
      worstDropLabel: worstEdge?.label ?? null,
      worstDropRate: worstEdge?.rate ?? null,
      lostTotal: worstEdge?.lostTotal ?? null,
    };
  });

  const num = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("pt-BR");

  const KPIS: {
    key: keyof (typeof rows)[number];
    metric?: MetricKey;
    label?: string;
    format: (n: number | null) => string;
    higherIsBetter: boolean;
    /**
     * Não entra na disputa de "melhor". Vale para tudo que é VOLUME: um funil
     * com mais tráfego não é melhor, só maior. Só taxa compara desempenho.
     */
    neutral?: boolean;
  }[] = [
    // --- Desempenho: só taxas ---
    { key: "avgRate", metric: "avgRate", format: pct, higherIsBetter: true },
    { key: "endToEnd", metric: "endToEnd", format: pct, higherIsBetter: true },
    { key: "vslConversion", metric: "vslConversion", format: pct, higherIsBetter: true },
    { key: "vslEngagement", metric: "vslEngagement", format: pct, higherIsBetter: true },
    { key: "worstDropRate", label: "Pior passagem", format: pct, higherIsBetter: true },
    // --- Volume e contexto: informativo, não disputa ---
    { key: "visitors", metric: "visitors", format: num, higherIsBetter: true, neutral: true },
    { key: "conversions", metric: "conversions", format: num, higherIsBetter: true, neutral: true },
    { key: "vslViews", label: "Views de VSL", format: num, higherIsBetter: true, neutral: true },
    { key: "vslCount", label: "Quantidade de VSLs", format: num, higherIsBetter: true, neutral: true },
    { key: "lostTotal", label: "Pessoas perdidas na pior passagem", format: num, higherIsBetter: false, neutral: true },
    { key: "steps", metric: "steps", format: num, higherIsBetter: false, neutral: true },
  ];

  // Quem vence em mais métricas de desempenho leva o selo de melhor funil.
  const wins = new Map<string, number>(rows.map((r) => [r.id, 0]));
  for (const kpi of KPIS) {
    if (kpi.neutral) continue;
    const values = rows
      .map((r) => r[kpi.key] as number | null)
      .filter((v): v is number => v != null);
    if (values.length < 2) continue;
    const best = kpi.higherIsBetter ? Math.max(...values) : Math.min(...values);
    for (const r of rows) {
      if ((r[kpi.key] as number | null) === best) {
        wins.set(r.id, (wins.get(r.id) ?? 0) + 1);
      }
    }
  }

  const ranked = [...rows].sort(
    (a, b) => (wins.get(b.id) ?? 0) - (wins.get(a.id) ?? 0)
  );
  const champion = ranked[0];
  const runnerUp = ranked[1];
  // Empate técnico não elege vencedor — dizer que um é melhor seria inventar.
  const tie =
    !champion ||
    !runnerUp ||
    (wins.get(champion.id) ?? 0) === (wins.get(runnerUp.id) ?? 0);

  // Taxa de cada etapa, por posição — permite sobrepor funis de tamanhos
  // diferentes no mesmo gráfico.
  const maxSteps = Math.max(...bundles.map((b) => b.steps.length));
  const stepSeries = Array.from({ length: maxSteps }, (_, i) => {
    const point: Record<string, number | string> = { etapa: `Etapa ${i + 1}` };
    bundles.forEach((b) => {
      const step = b.steps[i];
      const metric = step && b.metrics.find((m) => m.stepId === step.id);
      if (metric) point[b.funnel.name] = Number(metric.conversionRate.toFixed(1));
    });
    return point;
  });

  return (
    <main className="space-y-6 p-4">
      {/* Veredito: quem ganha em mais métricas de desempenho. */}
      <Card
        className={cn(
          "border-2",
          tie ? "border-warning/40" : "border-success/50"
        )}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                tie ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
              )}
            >
              <Trophy size={20} />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {tie ? "Empate técnico" : "Melhor funil"}
              </p>
              <p className="text-xl font-bold">
                {tie ? "Sem vencedor claro" : champion.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {tie
                  ? "Os funis vencem no mesmo número de métricas — a escolha depende do que você prioriza."
                  : `Vence em ${wins.get(champion.id)} de ${
                      KPIS.filter((k) => !k.neutral).length
                    } métricas de desempenho`}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {ranked.map((r, i) => (
              <div
                key={r.id}
                className={cn(
                  "rounded-lg border px-3 py-2 text-center",
                  !tie && i === 0
                    ? "border-success bg-success/10"
                    : "border-border bg-muted/40"
                )}
              >
                <p className="flex items-center justify-center gap-1.5 text-xs font-medium">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: r.color }}
                  />
                  {r.name}
                </p>
                <p className="text-lg font-bold tabular-nums">
                  {wins.get(r.id) ?? 0}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  métricas vencidas
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompare size={18} className="text-primary" />
            Métrica a métrica
          </CardTitle>
          <CardDescription>
            Vencedor de cada linha em verde com troféu · linhas em cinza são
            volume e contexto: não dizem qual funil é melhor, só qual é maior
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 text-left font-medium text-muted-foreground">
                  Métrica
                </th>
                {rows.map((r) => (
                  <th key={r.id} className="py-2 text-right font-medium">
                    <span className="flex items-center justify-end gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      {r.name}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KPIS.map((kpi) => {
                // Ausência de dado não disputa "melhor valor".
                const values = rows
                  .map((r) => r[kpi.key] as number | null)
                  .filter((v): v is number => v != null);
                const best =
                  values.length && !kpi.neutral
                    ? kpi.higherIsBetter
                      ? Math.max(...values)
                      : Math.min(...values)
                    : null;
                return (
                  <tr
                    key={String(kpi.key)}
                    className={cn(
                      "border-b border-border/60",
                      kpi.neutral && "text-muted-foreground"
                    )}
                  >
                    <td className="py-2.5 text-muted-foreground">
                      {kpi.metric ? (
                        <MetricLabel metric={kpi.metric}>
                          {metricLabel(kpi.metric)}
                        </MetricLabel>
                      ) : (
                        kpi.label
                      )}
                    </td>
                    {rows.map((r) => {
                      const v = r[kpi.key] as number | null;
                      const isBest =
                        v != null && best != null && v === best && values.length > 1;
                      return (
                        <td
                          key={r.id}
                          className={cn(
                            "py-2.5 text-right tabular-nums",
                            isBest && "font-bold text-success",
                            v == null && "text-muted-foreground"
                          )}
                        >
                          <span className="inline-flex items-center justify-end gap-1">
                            {kpi.format(v)}
                            {isBest && <Trophy size={11} className="text-success" />}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Volume e conversão</CardTitle>
            <CardDescription>Visitantes e conversões por funil</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => v.toLocaleString("pt-BR")}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="visitors" name="Visitantes" fill="#2563eb" radius={[4, 4, 0, 0]} />
                <Bar dataKey="conversions" name="Conversões" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>VSLs de cada funil</CardTitle>
            <CardDescription>
              Conversão média das VSLs, ponderada pelas views
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis unit="%" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${v.toFixed(1)}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="vslConversion" name="Conversão de VSL" fill="#a855f7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="vslEngagement" name="Engajamento" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Onde cada funil mais perde</CardTitle>
            <CardDescription>A pior passagem do fluxo principal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: r.color }}
                    />
                    <span className="truncate text-sm font-medium">{r.name}</span>
                  </span>
                  <Badge
                    variant={
                      (r.worstDropRate ?? 0) >= 80
                        ? "success"
                        : (r.worstDropRate ?? 0) >= 50
                        ? "warning"
                        : "danger"
                    }
                    className="shrink-0 font-semibold"
                  >
                    {pct(r.worstDropRate)}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {r.worstDropLabel ?? "sem passagem medida"}
                  {r.lostTotal != null && (
                    <>
                      {" · "}
                      <span className="text-danger">
                        {r.lostTotal.toLocaleString("pt-BR")} abandonaram
                      </span>
                    </>
                  )}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Queda etapa a etapa</CardTitle>
            <CardDescription>
              Taxa de conversão por posição no funil
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={stepSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="etapa" tick={{ fontSize: 11 }} />
                <YAxis unit="%" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {bundles.map((b, i) => (
                  <Line
                    key={b.funnel.id}
                    type="monotone"
                    dataKey={b.funnel.name}
                    stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Funil único — visão detalhada
// ---------------------------------------------------------------------------

function SingleFunnelView({
  bundle,
  period,
  source,
}: {
  bundle: FunnelBundle;
  period: PeriodInput;
  source: DataSource;
}) {
  const { funnel, steps, edges, metrics } = bundle;
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const [clarity, setClarity] = useState<any>(null);
  const [vturb, setVturb] = useState<any>(null);

  useEffect(() => {
    setSelectedStep(null);
    Promise.all([
      getClarityMetrics(funnel.id, period),
      getVturbMetrics(funnel.id, period),
    ]).then(([c, v]) => {
      setClarity(c);
      setVturb(v);
    });
  }, [funnel.id, period]);

  const t = totals(bundle);

  // Conversão página → página: de quem chegou na origem, quantos chegaram no
  // destino. Usar `conversions` da origem daria 100% sempre.
  const flow = edges
    .map((edge) => {
      const sourceMetric = metrics.find((m) => m.stepId === edge.sourceStepId);
      const targetMetric = metrics.find((m) => m.stepId === edge.targetStepId);
      const sourceStep = steps.find((s) => s.id === edge.sourceStepId);
      const targetStep = steps.find((s) => s.id === edge.targetStepId);
      if (!sourceMetric || !targetMetric) return null;

      return {
        from: sourceStep?.label ?? edge.sourceStepId,
        to: targetStep?.label ?? edge.targetStepId,
        rate:
          sourceMetric.visitors > 0
            ? (targetMetric.visitors / sourceMetric.visitors) * 100
            : 0,
        sourceVisitors: sourceMetric.visitors,
        targetVisitors: targetMetric.visitors,
        lost: Math.max(0, sourceMetric.visitors - targetMetric.visitors),
        isBranch: edge.condition !== "default",
        branchLabel: edge.label,
        targetOwnRate: targetMetric.conversionRate,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const mainPath = flow.filter((c) => !c.isBranch);
  const branchPath = flow.filter((c) => c.isBranch);

  const stepData = selectedStep
    ? steps.find((s) => s.id === selectedStep)
    : null;
  const stepMetric = selectedStep
    ? metrics.find((m) => m.stepId === selectedStep)
    : null;

  return (
    <main className="space-y-6 p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard metric="visitors" value={t.visitors.toLocaleString("pt-BR")} hint="Total no período" icon={<Users className="text-blue-500" size={24} />} tone="text-blue-500" />
        <KpiCard metric="conversions" value={t.conversions.toLocaleString("pt-BR")} hint="Avanços entre páginas" icon={<Target className="text-success" size={24} />} tone="text-success" />
        <KpiCard metric="avgRate" value={pct(t.avgRate)} hint="Média das passagens" icon={<TrendingUp className="text-warning" size={24} />} tone="text-warning" />
        <KpiCard
          metric="vslConversion"
          value={pct(bundle.vsl.avgConversion)}
          hint={
            bundle.vsl.count === 0
              ? "Nenhuma VSL neste funil"
              : bundle.vsl.count === 1
              ? "1 VSL"
              : `Média ponderada de ${bundle.vsl.count} VSLs`
          }
          icon={<span className="text-2xl leading-none">🎬</span>}
          tone="text-purple-600"
        />
        <KpiCard metric="endToEnd" value={pct(t.endToEnd)} hint={t.endToEnd == null ? "Sem página de obrigado" : "Entrada até a compra"} icon={<Activity className="text-primary" size={24} />} tone="text-primary" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 size={18} className="text-primary" />
            Conversão de Página para Página
          </CardTitle>
          <CardDescription>
            O funil desenhado no ateliê, com a conversão em cada seta — arraste
            para navegar, use os controles para aproximar ou reduzir
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* O mesmo desenho do ateliê, em modo leitura. Ele se centraliza
              sozinho e acompanha a proporção de cada funil. */}
          <FunnelCanvas
            funnel={funnel}
            steps={steps}
            edges={edges}
            metrics={metrics}
            readOnly
          />

          <details className="rounded-lg border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              Ver os números em lista
            </summary>
            <div className="space-y-3 p-3 pt-0">
              {mainPath.map((c, i) => (
                <div key={i} className="space-y-2 rounded-lg bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{c.from}</span>
                      <span className="shrink-0 text-muted-foreground">→</span>
                      <span className="truncate font-medium">{c.to}</span>
                    </div>
                    <Badge
                      variant={c.rate >= 80 ? "success" : c.rate >= 50 ? "warning" : "danger"}
                      className="shrink-0 font-semibold"
                    >
                      {c.rate.toFixed(1)}%
                    </Badge>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all", conversionBar(c.rate))}
                      style={{ width: `${Math.min(100, c.rate)}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{c.sourceVisitors.toLocaleString("pt-BR")} chegaram</span>
                    <span>·</span>
                    <span className="font-medium text-foreground">
                      {c.targetVisitors.toLocaleString("pt-BR")} seguiram
                    </span>
                    {c.lost > 0 && (
                      <>
                        <span>·</span>
                        <span className="font-medium text-danger">
                          {c.lost.toLocaleString("pt-BR")} abandonaram
                        </span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>

          {branchPath.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">Ofertas paralelas</p>
                <p className="text-xs text-muted-foreground">
                  Bump, upsell e downsell não competem com o fluxo principal — a
                  taxa que importa é a de aceite da oferta
                </p>
              </div>
              {branchPath.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-border p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{c.to}</span>
                    {c.branchLabel && (
                      <Badge variant="info" className="shrink-0">
                        {c.branchLabel}
                      </Badge>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      {c.targetVisitors.toLocaleString("pt-BR")} viram a oferta
                    </span>
                    <Badge
                      variant={
                        c.targetOwnRate >= 80
                          ? "success"
                          : c.targetOwnRate >= 50
                          ? "warning"
                          : "danger"
                      }
                      className="font-semibold"
                    >
                      {c.targetOwnRate.toFixed(1)}% aceitaram
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Etapas do Funil</CardTitle>
            <CardDescription>Selecione para ver detalhes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {steps.map((step) => {
              const metric = metrics.find((m) => m.stepId === step.id);
              return (
                <button
                  key={step.id}
                  onClick={() => setSelectedStep(step.id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-all",
                    selectedStep === step.id
                      ? "border-primary bg-primary/10 shadow-sm"
                      : "border-border bg-muted/30 hover:bg-muted/50"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{step.label}</p>
                      <p className="text-xs text-muted-foreground">{step.type}</p>
                    </div>
                    {metric && (
                      <Badge
                        variant={
                          metric.conversionRate >= 80
                            ? "success"
                            : metric.conversionRate >= 50
                            ? "warning"
                            : "danger"
                        }
                      >
                        {metric.conversionRate.toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {stepData && stepMetric ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{stepData.label}</CardTitle>
              <CardDescription>
                Tipo: {stepData.type} · Fonte: {stepMetric.source.toUpperCase()}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="rounded-lg bg-blue-500/10 p-4 text-center">
                  <Users className="mx-auto mb-2 text-blue-500" size={20} />
                  <p className="text-2xl font-bold">
                    {stepMetric.visitors.toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-muted-foreground">Visitantes</p>
                </div>
                <div className="rounded-lg bg-success/10 p-4 text-center">
                  <Target className="mx-auto mb-2 text-success" size={20} />
                  <p className="text-2xl font-bold">
                    {stepMetric.conversions.toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-muted-foreground">Conversões</p>
                </div>
                <div className="rounded-lg bg-warning/10 p-4 text-center">
                  <TrendingUp className="mx-auto mb-2 text-warning" size={20} />
                  <p
                    className="text-2xl font-bold"
                    style={{ color: conversionColor(stepMetric.conversionRate) }}
                  >
                    {stepMetric.conversionRate.toFixed(1)}%
                  </p>
                  <MetricLabel
                    metric="pageToPage"
                    className="text-xs text-muted-foreground"
                  >
                    Conversão de funil
                  </MetricLabel>
                </div>
              </div>
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium">URL da página</p>
                <a
                  href={stepData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-sm text-primary hover:underline"
                >
                  {stepData.url}
                </a>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="flex items-center justify-center lg:col-span-2">
            <CardContent className="py-12 text-center">
              <Activity size={48} className="mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground">
                Selecione uma etapa para ver os detalhes
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <VslSection bundle={bundle} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {source !== "tracker" && (
          <SourceCard
            title="Métricas Clarity"
            emoji="📊"
            description="Conversão real por página"
            badge="Clarity"
            data={clarity}
            fields={[
              ["Sessões", clarity?.sessions?.toLocaleString("pt-BR")],
              ["Visitantes únicos", clarity?.distinctUsers?.toLocaleString("pt-BR")],
              ["Páginas vistas", clarity?.pageViews?.toLocaleString("pt-BR")],
              ["Tempo médio (seg)", clarity?.avgTime?.toFixed(1)],
              // A Data Export API do Clarity não publica taxa de rejeição.
              // Rolagem média é o que ele entrega de fato sobre abandono.
              ["Rolagem média", clarity?.avgScrollDepth != null ? `${clarity.avgScrollDepth.toFixed(1)}%` : undefined],
            ]}
            empty="Configure o token Clarity em Configurações"
            // O período pedido não é o período que o Clarity entregou: ele
            // publica com atraso e o dado pode ser de ontem. O rodapé diz de
            // quando é — sem isso o card herda o rótulo do PeriodPicker e
            // promete um recorte que não é o do número.
            footer={<AsOfBadge {...(clarity ?? { empty: true })} />}
          />
        )}
        <SourceCard
          title="Métricas VTurb"
          emoji="🎬"
          description="Conversão de VSL"
          badge="VTurb"
          data={vturb}
          accent
          fields={[
            ["Views totais", vturb?.totalViews?.toLocaleString("pt-BR")],
            ["Completaram VSL", vturb?.completions?.toLocaleString("pt-BR")],
            ["Engajamento", `${vturb?.engagementRate?.toFixed(1) ?? 0}%`],
            ["Conversão VSL", `${vturb?.conversionRate?.toFixed(1) ?? 0}%`],
          ]}
          empty="Configure o token VTurb em Configurações"
        />
      </div>
    </main>
  );
}

/**
 * Uma VSL por vez: quantos chegaram na página, quantos assistiram até o ponto
 * em que o botão aparece, e quantos clicaram e seguiram. É onde se vê se o
 * problema é o vídeo (ninguém chega no pitch) ou a oferta (chegam e não
 * clicam).
 */
function VslSection({ bundle }: { bundle: FunnelBundle }) {
  const { steps, edges, metrics, vsl } = bundle;
  const vslSteps = steps.filter((s) => s.type === "vsl");

  if (vslSteps.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-xl">🎬</span>
              Conversão das VSLs
              <Badge variant="info">
                {vslSteps.length}{" "}
                {vslSteps.length === 1 ? "vídeo" : "vídeos"}
              </Badge>
            </CardTitle>
            <CardDescription>
              De quem abriu o vídeo até quem clicou no botão e avançou
            </CardDescription>
          </div>

          {/* Média do funil, para quando se fala do funil como um todo. */}
          {vsl.count > 0 && (
            <div className="flex gap-4 rounded-lg border border-purple-500/30 bg-purple-500/5 px-3 py-2">
              <div className="text-center">
                <MetricLabel
                  metric="vslConversion"
                  className="text-[11px] text-muted-foreground"
                >
                  Média do funil
                </MetricLabel>
                <p className="text-lg font-bold text-purple-600">
                  {pct(vsl.avgConversion)}
                </p>
              </div>
              <div className="text-center">
                <MetricLabel
                  metric="vslEngagement"
                  className="text-[11px] text-muted-foreground"
                >
                  Engajamento
                </MetricLabel>
                <p className="text-lg font-bold text-purple-600">
                  {pct(vsl.avgEngagement)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[11px] text-muted-foreground">Views</p>
                <p className="text-lg font-bold">
                  {vsl.totalViews.toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {vslSteps.map((step) => {
          const vslMetric = metrics.find((m) => m.stepId === step.id);
          const insight = vsl.items.find((v) => v.stepId === step.id);
          const isBest = vsl.best?.stepId === step.id && vsl.count > 1;
          // Para onde a VSL manda: o destino da seta que sai dela.
          const outgoing = edges.find((e) => e.sourceStepId === step.id);
          const nextStep = outgoing
            ? steps.find((s) => s.id === outgoing.targetStepId)
            : null;
          const nextMetric = nextStep
            ? metrics.find((m) => m.stepId === nextStep.id)
            : null;

          const viewers = vslMetric?.visitors ?? 0;
          // "Chegou no botão" = assistiu até o pitch. Sem dado do player,
          // usamos as conversões da própria etapa como proxy declarado.
          const reachedButton = vslMetric?.conversions ?? 0;
          const clicked = nextMetric?.visitors ?? 0;

          const toButton = viewers > 0 ? (reachedButton / viewers) * 100 : null;
          const buttonToNext =
            reachedButton > 0 ? (clicked / reachedButton) * 100 : null;
          const endToEnd = viewers > 0 ? (clicked / viewers) * 100 : null;

          const stages = [
            { label: "Abriram o vídeo", value: viewers, rate: 100 },
            { label: "Chegaram no botão", value: reachedButton, rate: toButton },
            {
              label: nextStep ? `Foram para ${nextStep.label}` : "Clicaram",
              value: clicked,
              rate: endToEnd,
            },
          ];

          return (
            <div
              key={step.id}
              className={cn(
                "rounded-lg border p-3",
                isBest ? "border-success/50 bg-success/5" : "border-border"
              )}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    {step.label}
                    {isBest && (
                      <Badge variant="success" className="gap-1 shrink-0">
                        <Trophy size={10} />
                        melhor VSL
                      </Badge>
                    )}
                  </p>
                  <a
                    href={step.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-xs text-primary hover:underline"
                  >
                    {step.url}
                  </a>
                  {insight && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      VTurb: {insight.views.toLocaleString("pt-BR")} views ·{" "}
                      {insight.engagementRate.toFixed(0)}% de engajamento
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    vídeo → botão
                  </span>
                  <Badge
                    variant={
                      (toButton ?? 0) >= 80
                        ? "success"
                        : (toButton ?? 0) >= 50
                        ? "warning"
                        : "danger"
                    }
                    className="font-semibold"
                  >
                    {pct(toButton)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    botão → próxima
                  </span>
                  <Badge
                    variant={
                      (buttonToNext ?? 0) >= 80
                        ? "success"
                        : (buttonToNext ?? 0) >= 50
                        ? "warning"
                        : "danger"
                    }
                    className="font-semibold"
                  >
                    {pct(buttonToNext)}
                  </Badge>
                </div>
              </div>

              {/* Barras encolhendo: a forma do funil da própria VSL. */}
              <div className="space-y-1.5">
                {stages.map((s) => (
                  <div key={s.label} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                      {s.label}
                    </span>
                    <div className="h-5 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={cn(
                          "flex h-full items-center justify-end rounded px-2 transition-all",
                          conversionBar(s.rate ?? 0)
                        )}
                        style={{ width: `${Math.max(6, Math.min(100, s.rate ?? 0))}%` }}
                      >
                        <span className="text-[11px] font-semibold text-white">
                          {s.value.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {pct(s.rate)}
                    </span>
                  </div>
                ))}
              </div>

              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                "Chegaram no botão" usa as conversões registradas na etapa. Com
                o VTurb ligado, esse número passa a vir do player — quantos
                assistiram até o instante em que o botão aparece.
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function KpiCard({
  metric,
  value,
  hint,
  icon,
  tone,
}: {
  metric: MetricKey;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <MetricLabel metric={metric} className="text-sm text-muted-foreground">
              {metricLabel(metric)}
            </MetricLabel>
            <p className={cn("text-2xl font-bold", tone)}>{value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function SourceCard({
  title,
  emoji,
  description,
  badge,
  data,
  fields,
  empty,
  accent,
  footer,
}: {
  title: string;
  emoji: string;
  description: string;
  badge: string;
  data: unknown;
  fields: [string, string | undefined][];
  empty: string;
  accent?: boolean;
  /** Carimbo de tempo, quando a fonte não entrega dado do período pedido. */
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <span className="text-2xl">{emoji}</span>
              {title}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Badge variant="info">{badge}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {data ? (
          <div className="grid grid-cols-2 gap-3">
            {fields.map(([label, value]) => (
              <div
                key={label}
                className={cn(
                  "rounded-lg p-3",
                  accent ? "bg-purple-500/10" : "bg-muted/50"
                )}
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p
                  className={cn(
                    "text-xl font-bold",
                    accent && "text-purple-600"
                  )}
                >
                  {value ?? 0}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-muted-foreground">
            <p>{empty}</p>
          </div>
        )}
        {footer && <div className="mt-3">{footer}</div>}
      </CardContent>
    </Card>
  );
}
