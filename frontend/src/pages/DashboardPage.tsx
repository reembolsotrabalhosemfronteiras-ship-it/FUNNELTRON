import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  Users,
  Target,
  TrendingUp,
  Zap,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import { groupVslByFunnel } from "@/lib/funnelStats";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { Header } from "@/components/common/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/common/Card";
import { Badge, StatusBadge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { PeriodPicker, periodLabel } from "@/components/common/PeriodPicker";
import { cn } from "@/lib/cn";
import {
  getOverview,
  getFunnelRanking,
  getVslInsights,
} from "@/api/client";
import type {
  OverviewMetrics,
  FunnelComparisonRow,
  VslInsight,
  PeriodInput,
} from "@/types";

const sourceColors: Record<string, string> = {
  clarity: "#3b82f6",
  vturb: "#a855f7",
  manual: "#64748b",
};

export function DashboardPage() {
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [ranking, setRanking] = useState<FunnelComparisonRow[]>([]);
  const [vsl, setVsl] = useState<VslInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getOverview(period), getFunnelRanking(period), getVslInsights(period)])
      .then(([o, r, v]) => {
        setOverview(o);
        setRanking(r);
        setVsl(v);
      })
      .finally(() => setLoading(false));
  }, [period]);

  const kpis = [
    {
      label: "Funis ativos",
      value: overview?.activeFunnels ?? 0,
      sub: `Total: ${overview?.totalFunnels ?? 0}`,
      icon: <Target className="text-primary" />,
      accent: "text-primary",
    },
    {
      label: "Visitantes",
      value: overview?.totalVisitors.toLocaleString("pt-BR") ?? 0,
      sub: `Período: ${periodLabel(period)}`,
      icon: <Users className="text-blue-500" />,
      accent: "text-blue-500",
    },
    {
      label: "Conversões",
      value: overview?.totalConversions.toLocaleString("pt-BR") ?? 0,
      sub: "Soma de todos os funis",
      icon: <Target className="text-success" />,
      accent: "text-success",
    },
    {
      label: "Conversão média",
      value: `${(overview?.avgConversionRate ?? 0).toFixed(1)}%`,
      sub: "Geral do período",
      icon: <TrendingUp className="text-warning" />,
      accent: "text-warning",
    },
  ];

  // Dados para gráficos
  const chartData = ranking.map((r) => ({
    name: r.name.split(/[\s-]/)[0].slice(0, 12),
    taxa: r.conversionRate,
    visitantes: r.visitors,
    fill: sourceColors[r.source],
  }));

  const bestVsl = [...vsl].sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Dashboard"
        subtitle="Métricas gerais de todos os funis"
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button variant="outline" size="sm" disabled={loading}>
              <RefreshCw size={14} className={cn(loading && "animate-spin")} />
              Atualizar
            </Button>
          </>
        }
      />

      <main className="p-4 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Spinner size={32} />
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {kpis.map((kpi) => (
                <Card key={kpi.label}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">{kpi.label}</p>
                        <p className={cn("text-2xl font-bold mt-1", kpi.accent)}>{kpi.value}</p>
                        <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p>
                      </div>
                      <div className="p-3 rounded-lg bg-muted/50">{kpi.icon}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Ranking + VSL */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Ranking de funis */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 size={18} className="text-primary" />
                    Ranking de Funis por Conversão
                  </CardTitle>
                  <CardDescription>Melhor → pior no período selecionado</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
                        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <YAxis type="category" dataKey="name" width={90} fontSize={12} />
                        <Tooltip
                          formatter={(v: number) => [`${v}%`, "Conversão"]}
                          contentStyle={{
                            borderRadius: 8,
                            border: "1px solid hsl(var(--border))",
                          }}
                        />
                        <Bar dataKey="taxa" radius={[0, 4, 4, 0]} barSize={28}>
                          {chartData.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Tabela comparativa */}
                  <div className="mt-6 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="pb-2 font-medium">Funil</th>
                          <th className="pb-2 font-medium">Status</th>
                          <th className="pb-2 font-medium text-right">Visitas</th>
                          <th className="pb-2 font-medium text-right">Conv.</th>
                          <th className="pb-2 font-medium text-muted-foreground">Conv. funil</th>
                          <th className="pb-2 font-medium text-right">Tend.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ranking.map((r) => (
                          <tr key={r.id} className="border-b border-border/60 hover:bg-muted/30">
                            <td className="py-2 font-medium">
                              <Link to={`/funnel/${r.id}`} className="hover:text-primary hover:underline">
                                {r.name}
                              </Link>
                            </td>
                            <td className="py-2"><StatusBadge status={r.status} /></td>
                            <td className="py-2 text-right text-muted-foreground">{r.visitors.toLocaleString("pt-BR")}</td>
                            <td className="py-2 text-right text-muted-foreground">{r.conversions.toLocaleString("pt-BR")}</td>
                            <td className="py-2 font-medium">{r.conversionRate.toFixed(1)}%</td>
                            {/* Sem período anterior para comparar, "—" em
                                cinza. Ver decisão 2.4. */}
                            <td
                              className={cn(
                                "py-2 text-right font-medium",
                                r.trend == null
                                  ? "text-muted-foreground"
                                  : r.trend >= 0
                                    ? "text-success"
                                    : "text-danger"
                              )}
                            >
                              {r.trend == null
                                ? "—"
                                : `${r.trend >= 0 ? "▲" : "▼"} ${Math.abs(r.trend).toFixed(1)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Painel VSL (VTurb) */}
              <Card className="lg:col-span-1">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap size={18} className="text-purple-500" />
                    Conversão de VSL
                  </CardTitle>
                  <CardDescription>Fonte: VTurb Analytics</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {bestVsl && (
                    <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider">Top VSL</p>
                      <p className="font-semibold mt-1">{bestVsl.name}</p>
                      <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-2">
                        {bestVsl.conversionRate.toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Engajamento: {bestVsl.engagementRate.toFixed(1)}% · {bestVsl.views.toLocaleString("pt-BR")} views
                      </p>
                    </div>
                  )}

                  {/* Agrupado por funil: a linha do funil traz a média das
                      VSLs dele; abrir mostra cada VSL individualmente. */}
                  <div className="space-y-3">
                    {groupVslByFunnel(vsl).map(({ funnelId, funnelName, summary }) => (
                      <details
                        key={funnelId}
                        className="group rounded-lg border border-border p-2.5"
                        open={summary.count === 1}
                      >
                        <summary className="cursor-pointer list-none space-y-1">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ChevronRight
                                size={13}
                                className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                              />
                              <span className="truncate font-medium">{funnelName}</span>
                            </span>
                            <Badge variant="info" className="shrink-0">
                              {summary.avgConversion?.toFixed(1) ?? "—"}%
                            </Badge>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-purple-500"
                              style={{
                                width: `${Math.min(100, (summary.avgConversion ?? 0) * 2)}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              {summary.count}{" "}
                              {summary.count === 1 ? "VSL" : "VSLs"} · média
                              ponderada
                            </span>
                            <span>
                              {summary.avgEngagement?.toFixed(0) ?? "—"}% engaj.
                            </span>
                          </div>
                        </summary>

                        {summary.count > 1 && (
                          <div className="mt-2.5 space-y-2 border-t border-border pt-2.5">
                            {summary.items.map((v) => (
                              <div key={v.id} className="space-y-1">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <span className="truncate">{v.name}</span>
                                  <span className="shrink-0 font-semibold text-purple-600">
                                    {v.conversionRate.toFixed(1)}%
                                  </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full bg-purple-400"
                                    style={{
                                      width: `${Math.min(100, v.conversionRate * 2)}%`,
                                    }}
                                  />
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                  <span>{v.views.toLocaleString("pt-BR")} views</span>
                                  <span>{v.engagementRate.toFixed(0)}% engaj.</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </details>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Insights de VSL em detalhe */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap size={18} className="text-purple-500" />
                  Detalhe de Conversão de VSL (VTurb)
                </CardTitle>
                <CardDescription>
                  Engajamento e conversão por VSL — dados da API de Analytics do VTurb
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-80 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={vsl.map((v) => ({
                      vsl: v.name.split(" ")[1] || v.name.slice(0, 10),
                      engajamento: v.engagementRate,
                      conversao: v.conversionRate * 2, // escala p/ visualização
                    }))}>
                      <PolarGrid />
                      <PolarAngleAxis dataKey="vsl" />
                      <PolarRadiusAxis domain={[0, 100]} />
                      <Radar name="Engajamento" dataKey="engajamento" stroke="#a855f7" fill="#a855f7" fillOpacity={0.4} />
                      <Radar name="Conversão (x2)" dataKey="conversao" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                      <Tooltip />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}