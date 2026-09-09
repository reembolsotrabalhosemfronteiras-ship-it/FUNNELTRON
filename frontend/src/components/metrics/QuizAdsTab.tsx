import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Target,
  Users,
  CheckCircle,
  CurrencyDollar,
  TrendUp,
  GridFour,
  ChartBar,
  MapPin,
  DeviceMobile,
  Clock,
  Heart,
  ArrowClockwise,
  Spinner as SpinnerIcon,
  CaretDown,
  Funnel,
  Download,
} from "@phosphor-icons/react";
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
import { Select } from "@/components/common/Select";
import { SourceSelector, useDataSource } from "@/components/common/SourceSelector";
import { useNotifications } from "@/components/common/NotificationsProvider";
import { cn } from "@/lib/cn";
import { periodDays } from "@/api/client";
import type {
  QuizDataSource,
  QuizHeatmapRow,
  DropOffBySource,
  AudienceBreakdown,
  AdPerformanceRow,
  PeriodInput,
} from "@/types";
import {
  getQuizHeatmap,
  getDropOffBySource,
  getAudienceBreakdown,
  getAdPerformance,
  syncUtmfy,
} from "@/api/client";

/** Cor por placement (Instagram_Reels, Facebook_Feed, etc.). */
function placementColor(placement: string): string {
  const p = (placement || "").toLowerCase();
  if (p.includes("reels")) return "#e1306c";
  if (p.includes("story") || p.includes("stories")) return "#f77737";
  if (p.includes("feed")) return "#1877f2";
  if (p.includes("search")) return "#4285f4";
  if (p.includes("display")) return "#34a853";
  if (p.includes("tiktok")) return "#000000";
  return "#6b7280";
}

const QUESTION_TYPE_LABELS: Record<QuizHeatmapRow["questionType"], string> = {
  single: "Única escolha",
  multiple: "Múltipla escolha",
  open: "Aberta",
};

const QUESTION_TYPE_COLORS: Record<QuizHeatmapRow["questionType"], string> = {
  single: "var(--primary)",
  multiple: "var(--accent)",
  open: "var(--warning)",
};

export function QuizAdsTab({ funnelId }: { funnelId: string }) {
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const { source: dataSource, setSource } = useDataSource();
  const [quizSource, setQuizSource] = useState<QuizDataSource>("tracker");
  const [selectedCampaign, setSelectedCampaign] = useState<string>("all");
  const [selectedAdId, setSelectedAdId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [heatmap, setHeatmap] = useState<QuizHeatmapRow[]>([]);
  const [dropoff, setDropoff] = useState<DropOffBySource[]>([]);
  const [audience, setAudience] = useState<AudienceBreakdown[]>([]);
  const [adPerformance, setAdPerformance] = useState<AdPerformanceRow[]>([]);

  const campaigns = useMemo(() => {
    const set = new Set<string>();
    heatmap.forEach((row) => Object.keys(row.byCampaign).forEach((c) => set.add(c)));
    return ["all", ...Array.from(set).sort()];
  }, [heatmap]);

  const adIds = useMemo(() => {
    const set = new Set<string>();
    audience.forEach((a) => set.add(a.adId));
    return Array.from(set).sort();
  }, [audience]);

  const { notify } = useNotifications();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [h, d, a, ap] = await Promise.all([
        getQuizHeatmap(funnelId, period, quizSource),
        getDropOffBySource(funnelId, period, quizSource),
        getAudienceBreakdown(funnelId, selectedAdId, period),
        getAdPerformance(funnelId, period, quizSource),
      ]);
      setHeatmap(h);
      setDropoff(d);
      setAudience(a);
      setAdPerformance(ap);
    } catch (err) {
      notify({
        title: "Falha ao carregar dados de Quiz & Ads",
        body: err instanceof Error ? err.message : "Tente novamente.",
        url: "",
      });
    } finally {
      setLoading(false);
    }
  }, [funnelId, period, quizSource, selectedAdId, notify]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncUtmfy(funnelId);
      await fetchAll();
    } catch (err) {
      notify({
        title: "Falha ao sincronizar UTMfy",
        body: err instanceof Error ? err.message : "Tente novamente.",
        url: "",
      });
    } finally {
      setSyncing(false);
    }
  };

  const kpiData = useMemo(() => {
    const totalResponses = heatmap[0]?.totalResponses ?? 0;
    const avgCompletion = heatmap.length
      ? heatmap.reduce((s, r) => s + (r.byCampaign[Object.keys(r.byCampaign)[0]]?.percentage ?? 0), 0) / heatmap.length
      : 0;
    const totalConversions = adPerformance.reduce((s, r) => s + (r.conversions ?? 0), 0);
    const totalSpend = adPerformance.reduce((s, r) => s + (r.spend ?? 0), 0);
    const cpa = totalConversions > 0 ? totalSpend / totalConversions : 0;
    const totalRevenue = adPerformance.reduce((s, r) => s + (r.revenue ?? 0), 0);
    const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;

    return [
      {
        label: "Quizzes Ativos",
        value: heatmap.length > 0 ? "5" : "0",
        sub: heatmap.map((r) => r.questionLabel).join(", "),
        icon: Target,
        tone: "text-blue-500",
      },
      {
        label: "Respostas Totais",
        value: totalResponses.toLocaleString("pt-BR"),
        sub: `Período: ${periodLabel(period)}`,
        icon: Users,
        tone: "text-purple-500",
      },
      {
        label: "Taxa de Conclusão",
        value: `${avgCompletion.toFixed(1)}%`,
        sub: "Média ponderada por pergunta",
        icon: CheckCircle,
        tone: "text-success",
      },
      {
        label: "CPA Médio (Quiz)",
        value: cpa > 0 ? `R$ ${cpa.toFixed(2)}` : "—",
        sub: "Blended all campaigns",
        icon: CurrencyDollar,
        tone: "text-warning",
      },
      {
        label: "ROAS Quiz → Compra",
        value: roas > 0 ? `${roas.toFixed(1)}x` : "—",
        sub: "Atribuição last-click",
        icon: TrendUp,
        tone: "text-primary",
      },
    ];
  }, [heatmap, adPerformance, period]);

  const maxHeatmapPct = useMemo(() => {
    let max = 0;
    heatmap.forEach((row) =>
      Object.values(row.byCampaign).forEach((v) => {
        if (v.percentage > max) max = v.percentage;
      })
    );
    return max || 100;
  }, [heatmap]);

  return (
    <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {kpiData.map(({ label, value, sub, icon: Icon, tone }) => (
            <Card key={label} className="elev-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <span className="card-kicker">{label}</span>
                  <Icon size={20} className={cn(tone, "shrink-0")} />
                </div>
                <p className="text-[24px] font-bold mt-1.5 mb-1">{value}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Heatmap */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GridFour size={18} className="text-primary" />
                  Heatmap de Respostas por Pergunta × Campanha
                </CardTitle>
                <CardDescription>
                  % de respostas por opção × campanha — normalize para comparar campanhas de tamanhos diferentes
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" defaultChecked className="h-4 w-4" />
                  Normalizar %
                </label>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {heatmap.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nenhum dado de quiz encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table" style={{ minWidth: 700 }}>
                  <thead>
                    <tr>
                      <th style={{ minWidth: 220 }}>Pergunta</th>
                      <th style={{ width: 110 }}>Tipo</th>
                      <th style={{ width: 90 }}>Total</th>
                      {campaigns.filter((c) => c !== "all").map((campaign) => (
                        <th key={campaign} style={{ minWidth: 100 }}>
                          {campaign}
                        </th>
                      ))}
                      <th style={{ width: 90 }}>Gap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heatmap.map((row, rowIdx) => {
                      const campaignValues = campaigns
                        .filter((c) => c !== "all")
                        .map((c) => row.byCampaign[c]?.percentage ?? 0);
                      const max = Math.max(...campaignValues);
                      const min = Math.min(...campaignValues.filter((v) => v > 0));
                      const gap = max - min;
                      return (
                        <tr key={rowIdx}>
                          <td style={{ fontWeight: 500 }}>{row.questionLabel}</td>
                          <td>
                            <Badge
                              variant="info"
                              className="text-[11px]"
                              style={{
                                backgroundColor: `${QUESTION_TYPE_COLORS[row.questionType]}15`,
                                color: QUESTION_TYPE_COLORS[row.questionType],
                                borderColor: `${QUESTION_TYPE_COLORS[row.questionType]}30`,
                              }}
                            >
                              {QUESTION_TYPE_LABELS[row.questionType]}
                            </Badge>
                          </td>
                          <td className="text-right tabular-nums text-muted-foreground">
                            {row.totalResponses.toLocaleString("pt-BR")}
                          </td>
                          {campaigns.filter((c) => c !== "all").map((campaign) => {
                            const val = row.byCampaign[campaign];
                            const pct = val?.percentage ?? 0;
                            const intensity = pct / 100;
                            const bgColor = `rgba(37, 99, 235, ${0.15 + intensity * 0.6})`;
                            return (
                              <td key={campaign}>
                                <span
                                  className="heatmap-cell"
                                  style={{
                                    backgroundColor: bgColor,
                                    color: intensity > 0.5 ? "white" : "var(--text)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {pct}%
                                </span>
                              </td>
                            );
                          })}
                          <td
                            style={{
                              color: gap > 30 ? "var(--danger)" : gap > 15 ? "var(--warning)" : "var(--success)",
                              fontWeight: 600,
                            }}
                          >
                            {gap > 0 ? `−${gap}pp` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Drop-off por Source */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChartBar size={18} className="text-primary" />
              Drop-off por Source (UTM)
            </CardTitle>
            <CardDescription>
              Funil Entrada → P1→P2 → P2→P3 → P3→Oferta → Oferta→Compra segmentado por source/medium/campaign
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dropoff.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nenhum dado de drop-off encontrado.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {dropoff.map((d, idx) => {
                  const steps = [
                    { label: "Entrada", count: d.entryCount, rate: 100, color: "var(--primary)" },
                    { label: "P1 → P2", count: d.step1To2.count, rate: d.step1To2.rate, color: "var(--primary)" },
                    { label: "P2 → P3", count: d.step2To3.count, rate: d.step2To3.rate, color: "var(--accent)" },
                    { label: "P3 → Oferta", count: d.step3ToOffer.count, rate: d.step3ToOffer.rate, color: "var(--cyan)" },
                    { label: "Oferta → Compra", count: d.offerToPurchase.count, rate: d.offerToPurchase.rate, color: "var(--success)" },
                  ];
                  return (
                    <article
                      key={idx}
                      className="card-group"
                      style={{
                        background: "var(--surface-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        padding: "16px",
                        borderTop: `3px solid var(--primary)`,
                      }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                          {d.source} / {d.medium}
                        </span>
                        <Badge variant="info" className="text-[10px]">
                          {d.overallRate.toFixed(1)}% geral
                        </Badge>
                      </div>
                      <p className="text-sm font-medium text-muted-foreground mb-3 truncate">{d.campaignName}</p>
                      <div className="space-y-2">
                        {steps.map((step, stepIdx) => (
                          <div key={stepIdx} className="space-y-1">
                            <div className="flex items-center justify-between text-[12px]">
                              <span className="font-medium truncate pr-2">{step.label}</span>
                              <span className="font-bold tabular-nums shrink-0">
                                {step.count.toLocaleString("pt-BR")}
                              </span>
                            </div>
                            <div className="h-2 bg-muted/50 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all duration-500 ease-out"
                                style={{
                                  width: `${step.rate}%`,
                                  background: step.color,
                                  boxShadow: `0 0 8px ${step.color}66`,
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-[11px] text-muted-foreground">
                              <span>{step.rate}% de retenção</span>
                              {stepIdx > 0 && (
                                <span className="text-danger">
                                  −{100 - step.rate}pp
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Audience Breakdown */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MapPin size={18} className="text-primary" />
                  Audience Breakdown por Ad ID (UTMfy)
                </CardTitle>
                <CardDescription>
                  Idade, gênero, localização, dispositivo, horários de pico e interesses por anúncio
                </CardDescription>
              </div>
              {adIds.length > 1 && (
                <Select
                  value={selectedAdId ?? "all"}
                  onChange={(e) => setSelectedAdId(e.target.value === "all" ? undefined : e.target.value)}
                  className="w-full sm:w-auto sm:min-w-[220px] min-h-[44px]"
                >
                  <option value="all">Todos os Ad IDs (agregado)</option>
                  {adIds.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {audience.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nenhum dado de audience encontrado.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {audience.map((a) => (
                  <article
                    key={a.adId}
                    className="card-group"
                    style={{
                      background: "var(--surface-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      padding: "16px",
                      borderTop: `3px solid var(--primary)`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-semibold text-sm truncate pr-2">{a.adName || a.adId}</span>
                      <Badge variant="info" className="text-[10px] shrink-0">
                        {a.campaignId}
                      </Badge>
                    </div>
                    <div className="space-y-4">
                      {[
                        { key: "age", label: "Idade", data: a.age, color: "var(--primary)" },
                        { key: "gender", label: "Gênero", data: a.gender, color: "var(--accent)" },
                        { key: "location", label: "Top 5 Localizações", data: a.location, color: "var(--cyan)" },
                        { key: "device", label: "Dispositivo", data: a.device, color: "var(--warning)" },
                        { key: "peakHours", label: "Horários de Pico", data: a.peakHours, color: "var(--accent)" },
                        { key: "interests", label: "Interesses", data: a.interests, color: "var(--success)" },
                      ].map(({ key, label, data, color }) => (
                        <div key={key} className="space-y-1">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
                          <div className="space-y-1.5">
                            {data.slice(0, key === "location" ? 5 : 6).map((item, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2"
                                style={{
                                  opacity: i < 3 ? 1 : 0.7,
                                }}
                              >
                                <span className="text-[12px] text-muted-foreground min-w-[80px] truncate">
                                  {key === "location" && "city" in item ? `${(item as { city: string; state: string }).city} - ${(item as { city: string; state: string }).state}` : ((item as any).range || (item as any).label)}
                                </span>
                                <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${item.percentage}%`,
                                      background: color,
                                      boxShadow: `0 0 6px ${color}66`,
                                    }}
                                  />
                                </div>
                                <span className="text-[12px] font-semibold tabular-nums shrink-0 w-12 text-right">
                                  {item.percentage}%
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ad Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ChartBar size={18} className="text-primary" />
              Performance Detalhada por Criativo
            </CardTitle>
            <CardDescription>
              Sessões, respostas de quiz, taxa de quiz, conversões, receita, spend, CPA e ROAS
            </CardDescription>
          </CardHeader>
          <CardContent>
            {adPerformance.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">Nenhum dado de performance encontrado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table" style={{ minWidth: 900 }}>
                  <thead>
                    <tr>
                      <th>Criativo</th>
                      <th>Campanha</th>
                      <th>Placement</th>
                      <th style={{ textAlign: "right" }}>Sessões</th>
                      <th style={{ textAlign: "right" }}>Quiz</th>
                      <th style={{ textAlign: "right" }}>Taxa Quiz</th>
                      <th style={{ textAlign: "right" }}>Conversões</th>
                      <th style={{ textAlign: "right" }}>Receita</th>
                      <th style={{ textAlign: "right" }}>Spend</th>
                      <th style={{ textAlign: "right" }}>CPA</th>
                      <th style={{ textAlign: "right" }}>ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adPerformance.map((row, idx) => {
                      const pColor = placementColor(row.placement);
                      return (
                        <tr key={`${row.creativeCode}-${row.campaignCode}-${idx}`}>
                          <td>
                            <code className="text-[12px] font-mono">{row.creativeCode || "—"}</code>
                          </td>
                          <td className="font-medium text-[12px] truncate max-w-[160px]">{row.campaignCode || "—"}</td>
                          <td>
                            <Badge
                              variant="info"
                              className="text-[10px]"
                              style={{
                                backgroundColor: `${pColor}15`,
                                color: pColor,
                                borderColor: `${pColor}30`,
                              }}
                            >
                              {row.placement || "—"}
                            </Badge>
                          </td>
                          <td className="text-right tabular-nums">{(row.sessions ?? 0).toLocaleString("pt-BR")}</td>
                          <td className="text-right tabular-nums">{(row.quizResponses ?? 0).toLocaleString("pt-BR")}</td>
                          <td className="text-right tabular-nums font-medium" style={{ color: "var(--primary)" }}>
                            {(row.quizRate ?? 0).toFixed(1)}%
                          </td>
                          <td className="text-right tabular-nums font-bold" style={{ color: "var(--success)" }}>
                            {(row.conversions ?? 0).toLocaleString("pt-BR")}
                          </td>
                          <td className="text-right tabular-nums">
                            R$ {(row.revenue ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="text-right tabular-nums text-muted-foreground">
                            R$ {(row.spend ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="text-right tabular-nums">
                            {row.cpa != null ? `R$ ${row.cpa.toFixed(2)}` : "—"}
                          </td>
                          <td className="text-right tabular-nums font-bold" style={{ color: "var(--primary)" }}>
                            {row.roas != null ? `${row.roas.toFixed(1)}x` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
  );
}