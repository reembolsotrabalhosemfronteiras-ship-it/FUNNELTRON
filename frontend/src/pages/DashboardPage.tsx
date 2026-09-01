import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Target,
  Users,
  CheckCircle,
  TrendUp,
  PlayCircle,
  ChartBarHorizontal,
  ArrowClockwise,
  CaretRight,
} from "@phosphor-icons/react";
import { groupVslByFunnel, enrichVslConversion } from "@/lib/funnelStats";
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from "recharts";
import { Header } from "@/components/common/Header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/common/Card";
import { Badge, StatusBadge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { PeriodPicker, periodLabel } from "@/components/common/PeriodPicker";
import { cn } from "@/lib/cn";
import { conversionColor } from "@/lib/conversion";
import { SERIES_COLORS } from "@/lib/series";
import {
  getOverview,
  getFunnelRanking,
  getVslInsights,
  listSteps,
  listEdges,
  getMetrics,
} from "@/api/client";
import type {
  OverviewMetrics,
  FunnelComparisonRow,
  VslInsight,
  PeriodInput,
} from "@/types";

export function DashboardPage() {
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const [overview, setOverview] = useState<OverviewMetrics | null>(null);
  const [ranking, setRanking] = useState<FunnelComparisonRow[]>([]);
  const [vsl, setVsl] = useState<VslInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([getOverview(period), getFunnelRanking(period), getVslInsights(period)])
      .then(async ([o, r, v]) => {
        setOverview(o);
        setRanking(r);

        const funnelIds = [...new Set(v.map((i) => i.funnelId))];
        const perFunnel = await Promise.all(
          funnelIds.map(async (id) => {
            const [steps, edges, metrics] = await Promise.all([
              listSteps(id),
              listEdges(id),
              getMetrics(id, "tracker", period),
            ]);
            return [id, { steps, edges, metrics }] as const;
          })
        );
        const byFunnel = Object.fromEntries(perFunnel);
        const enriched = v.map((item) => {
          const f = byFunnel[item.funnelId];
          if (!f) return item;
          return enrichVslConversion([item], f.steps, f.edges, f.metrics)[0];
        });
        setVsl(enriched);
      })
      .finally(() => setLoading(false));
  }, [period]);

  const kpis = [
    {
      label: "Funis ativos",
      value: String(overview?.activeFunnels ?? 0),
      sub: `Total: ${overview?.totalFunnels ?? 0}`,
      icon: Target,
    },
    {
      label: "Visitantes",
      value: (overview?.totalVisitors ?? 0).toLocaleString("pt-BR"),
      sub: periodLabel(period),
      icon: Users,
    },
    {
      label: "Conversões",
      value: (overview?.totalConversions ?? 0).toLocaleString("pt-BR"),
      sub: "Soma de todos os funis",
      icon: CheckCircle,
    },
    {
      label: "Conversão média",
      value: `${(overview?.avgConversionRate ?? 0).toFixed(1)}%`,
      sub: "Geral do período",
      icon: TrendUp,
    },
  ];

  const maxRate = Math.max(1, ...ranking.map((r) => r.conversionRate));
  const bestVsl = [...vsl].sort((a, b) => b.conversionRate - a.conversionRate)[0];

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Dashboard"
        subtitle={`Métricas gerais de todos os funis · ${periodLabel(period)}`}
        actions={
          <>
            <PeriodPicker value={period} onChange={setPeriod} />
            <Button variant="secondary" size="sm" disabled={loading}>
              <ArrowClockwise size={14} className={cn(loading && "animate-spin")} />
              Atualizar
            </Button>
          </>
        }
      />

      <main className="p-4 md:px-7 md:py-6 flex flex-col gap-6">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Spinner size={32} />
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
              {kpis.map(({ label, value, sub, icon: Icon }) => (
                <div key={label} className="card elev-sm">
                  <div className="flex items-start justify-between">
                    <span className="card-kicker">{label}</span>
                    <Icon size={18} className="text-primary" />
                  </div>
                  <p className="text-[26px] font-semibold mt-1.5 mb-0.5">{value}</p>
                  <p className="text-xs text-muted-foreground">{sub}</p>
                </div>
              ))}
            </div>

            {/* Ranking + VSL */}
            <div className="grid grid-cols-1 gap-5 lg:[grid-template-columns:2fr_1fr] items-start">
              <div className="card elev-sm">
                <p className="card-title flex items-center gap-2">
                  <ChartBarHorizontal className="text-primary" size={18} />
                  Ranking de funis por conversão
                </p>
                <p className="card-body mb-3.5">Melhor → pior no período selecionado</p>

                <div className="flex flex-col gap-2.5">
                  {ranking.map((r, i) => (
                    <div key={r.id}>
                      <div className="flex justify-between text-[12.5px] mb-1">
                        <span>{r.name}</span>
                        <span className="font-semibold">{r.conversionRate.toFixed(1)}%</span>
                      </div>
                      <div className="h-[9px] rounded-md bg-neutral-900/60 overflow-hidden">
                        <div
                          className="h-full rounded-md"
                          style={{
                            width: `${(r.conversionRate / maxRate) * 100}%`,
                            background: SERIES_COLORS[i % SERIES_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hr" />

                <div className="overflow-x-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Funil</th>
                        <th>Status</th>
                        <th className="text-right">Visitas</th>
                        <th className="text-right">Conv.</th>
                        <th className="text-right">Tend.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link to={`/funnel/${r.id}`} className="text-primary hover:underline">
                              {r.name}
                            </Link>
                          </td>
                          <td><StatusBadge status={r.status} /></td>
                          <td className="text-right">{r.visitors.toLocaleString("pt-BR")}</td>
                          <td className="text-right font-semibold">{r.conversionRate.toFixed(1)}%</td>
                          <td
                            className="text-right"
                            style={{
                              color:
                                r.trend == null
                                  ? "hsl(var(--muted-foreground))"
                                  : r.trend >= 0
                                    ? "var(--c-high)"
                                    : "var(--c-low)",
                            }}
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
              </div>

              {/* Painel VSL */}
              <div className="card elev-sm">
                <p className="card-title flex items-center gap-2">
                  <PlayCircle size={18} style={{ color: "var(--c-vsl)" }} />
                  Conversão de VSL
                </p>
                <p className="card-body mb-3">Fonte: VTurb Analytics</p>

                {bestVsl && (
                  <div
                    className="rounded-md p-3 mb-3.5"
                    style={{
                      background: "var(--color-accent-2-900)",
                      border: "1px solid var(--color-accent-2-800)",
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-accent-2-300)" }}>
                      Top VSL
                    </p>
                    <p className="font-semibold my-1">{bestVsl.name}</p>
                    <p className="text-[26px] font-bold" style={{ color: "var(--color-accent-2-300)" }}>
                      {bestVsl.conversionRate.toFixed(1)}%
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Engajamento {bestVsl.engagementRate.toFixed(1)}% ·{" "}
                      {bestVsl.views.toLocaleString("pt-BR")} views
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-2.5">
                  {groupVslByFunnel(vsl).map(({ funnelId, funnelName, summary }) => (
                    <details
                      key={funnelId}
                      className="group rounded-md border border-border p-2.5"
                      open={summary.count === 1}
                    >
                      <summary className="cursor-pointer list-none space-y-1">
                        <div className="flex items-center justify-between gap-2 text-[12.5px]">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <CaretRight
                              size={13}
                              className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                            />
                            <span className="truncate">{funnelName}</span>
                          </span>
                          <span className="tag tag-accent-2 shrink-0">
                            {summary.avgConversion?.toFixed(1) ?? "—"}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded bg-neutral-900/60">
                          <div
                            className="h-full"
                            style={{
                              width: `${Math.min(100, (summary.avgConversion ?? 0) * 2)}%`,
                              background: "var(--c-vsl)",
                            }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
                          <span>
                            {summary.count} {summary.count === 1 ? "VSL" : "VSLs"} · média ponderada
                          </span>
                          <span>{summary.avgEngagement?.toFixed(0) ?? "—"}% engaj.</span>
                        </div>
                      </summary>

                      {summary.count > 1 && (
                        <div className="mt-2.5 space-y-2 border-t border-border pt-2.5">
                          {summary.items.map((v) => (
                            <div key={v.id} className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="truncate">{v.name}</span>
                                <span className="shrink-0 font-semibold" style={{ color: "var(--color-accent-2-300)" }}>
                                  {v.conversionRate.toFixed(1)}%
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded bg-neutral-900/60">
                                <div
                                  className="h-full"
                                  style={{
                                    width: `${Math.min(100, v.conversionRate * 2)}%`,
                                    background: "var(--color-accent-2-300)",
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
              </div>
            </div>

            {/* Detalhe de VSL (radar) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PlayCircle size={18} style={{ color: "var(--c-vsl)" }} />
                  Detalhe de conversão de VSL (VTurb)
                </CardTitle>
                <CardDescription>
                  Engajamento e conversão por VSL — dados da API de Analytics do VTurb
                </CardDescription>
              </CardHeader>
              <CardContent>
                {vsl.length >= 3 ? (
                  <div className="h-80 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart
                        data={vsl.map((v) => ({
                          vsl: v.name.split(" ")[1] || v.name.slice(0, 10),
                          engajamento: v.engagementRate,
                          conversao: v.conversionRate * 2,
                        }))}
                      >
                        <PolarGrid />
                        <PolarAngleAxis dataKey="vsl" />
                        <PolarRadiusAxis domain={[0, 100]} />
                        <Radar name="Engajamento" dataKey="engajamento" stroke="#9690c9" fill="#9690c9" fillOpacity={0.4} />
                        <Radar name="Conversão (x2)" dataKey="conversao" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} />
                        <Tooltip />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="card-body py-10 text-center text-muted-foreground">
                    O radar aparece quando há 3 ou mais VSLs com dados do VTurb no período.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
