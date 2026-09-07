import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlass,
  ArrowClockwise,
  TrendUp,
  CalendarBlank,
} from "@phosphor-icons/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { Badge } from "@/components/common/Badge";
import { PeriodPicker, periodLabel } from "@/components/common/PeriodPicker";
import { useNotifications } from "@/components/common/NotificationsProvider";
import { cn } from "@/lib/cn";
import {
  getParsedCampaigns,
  getQuizByCampaign,
  type ParsedCampaign,
  type QuizByCampaignRow,
  type PeriodInput,
} from "@/api/client";
import { useWorkspace } from "@/components/common/WorkspaceContext";

// ---------------------------------------------------------------------------
// Drill-down: heatmap horário de uma campanha específica
// ---------------------------------------------------------------------------
function CampaignHeatmap({
  funnelId,
  campaignCode,
  period,
  onClose,
}: {
  funnelId: string;
  campaignCode: string;
  period: PeriodInput;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<QuizByCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { notify } = useNotifications();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getQuizByCampaign(funnelId, campaignCode, period);
      setRows(data);
    } catch (err) {
      notify({
        title: "Erro ao carregar heatmap da campanha",
        body: err instanceof Error ? err.message : "Tente novamente.",
        url: "",
      });
    } finally {
      setLoading(false);
    }
  }, [funnelId, campaignCode, period, notify]);

  useEffect(() => {
    load();
  }, [load]);

  // Agrupa por dia para o heatmap
  const byDate = useMemo(() => {
    const map = new Map<string, QuizByCampaignRow[]>();
    rows.forEach((r) => {
      const list = map.get(r.date) ?? [];
      list.push(r);
      map.set(r.date, list);
    });
    return map;
  }, [rows]);

  const maxResponses = useMemo(
    () => Math.max(1, ...rows.map((r) => r.responses)),
    [rows]
  );

  const totalResponses = useMemo(
    () => rows.reduce((s, r) => s + r.responses, 0),
    [rows]
  );

  const totalCompletions = useMemo(
    () => rows.reduce((s, r) => s + r.completions, 0),
    [rows]
  );

  const completionRate =
    totalResponses > 0 ? ((totalCompletions / totalResponses) * 100).toFixed(1) : "0";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Heatmap — {campaignCode}
          </h3>
          <p className="text-xs text-muted-foreground">
            {periodLabel(period)} · {totalResponses.toLocaleString("pt-BR")} respostas ·{" "}
            {completionRate}% conclusão
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={load}>
            <ArrowClockwise size={14} className="mr-1" />
            Atualizar
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}>
            Voltar
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhuma resposta registrada para esta campanha no período.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                  Data
                </th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th
                    key={h}
                    className="px-0.5 py-1.5 text-center font-medium text-muted-foreground"
                  >
                    {h}h
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(byDate.entries())
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([date, hours]) => {
                  const hourMap = new Map(hours.map((h) => [h.hour, h]));
                  return (
                    <tr key={date} className="border-b border-border/50 last:border-0">
                      <td className="whitespace-nowrap px-2 py-1 font-mono text-muted-foreground">
                        {date.slice(5)}
                      </td>
                      {Array.from({ length: 24 }, (_, h) => {
                        const cell = hourMap.get(h);
                        const intensity = cell
                          ? (cell.responses / maxResponses) * 100
                          : 0;
                        return (
                          <td
                            key={h}
                            className="px-0.5 py-1 text-center"
                            title={
                              cell
                                ? `${cell.responses} resp · ${cell.completions} concluídas`
                                : "Sem dados"
                            }
                          >
                            <div
                              className="mx-auto h-5 w-5 rounded-sm transition-colors"
                              style={{
                                backgroundColor:
                                  intensity > 0
                                    ? `rgba(16, 185, 129, ${Math.max(0.08, intensity / 100)})`
                                    : "transparent",
                              }}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Componente principal: tabela de campanhas detectadas
// ---------------------------------------------------------------------------
export function ParsedCampaignsTab({ funnelId }: { funnelId: string }) {
  const { active } = useWorkspace();
  const workspaceId = active?.id ?? "";
  const { notify } = useNotifications();

  const [campaigns, setCampaigns] = useState<ParsedCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const [search, setSearch] = useState("");
  const [drillCampaign, setDrillCampaign] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    try {
      const data = await getParsedCampaigns(workspaceId);
      setCampaigns(data);
    } catch (err) {
      notify({
        title: "Erro ao carregar campanhas parseadas",
        body: err instanceof Error ? err.message : "Tente novamente.",
        url: "",
      });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, notify]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter(
      (c) =>
        c.creativeCode.toLowerCase().includes(q) ||
        c.campaignCode.toLowerCase().includes(q) ||
        c.placement.toLowerCase().includes(q)
    );
  }, [campaigns, search]);

  // Calcula taxa de conversão (quiz_responses / sessions)
  const getConversionRate = (c: ParsedCampaign): number | null => {
    if (c.sessions === 0) return null;
    return (c.quizResponses / c.sessions) * 100;
  };

  // Ordena por conversão decrescente (null vai para o final)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const rateA = getConversionRate(a);
      const rateB = getConversionRate(b);
      if (rateA === null && rateB === null) return 0;
      if (rateA === null) return 1;
      if (rateB === null) return -1;
      return rateB - rateA;
    });
  }, [filtered]);

  // Identifica a melhor conversão (maior taxa não-nula)
  const bestConversionRate = useMemo(() => {
    let best: number | null = null;
    sorted.forEach((c) => {
      const rate = getConversionRate(c);
      if (rate !== null && (best === null || rate > best)) {
        best = rate;
      }
    });
    return best;
  }, [sorted]);

  if (drillCampaign) {
    return (
      <CampaignHeatmap
        funnelId={funnelId}
        campaignCode={drillCampaign}
        period={period}
        onClose={() => setDrillCampaign(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <TrendUp size={18} className="text-emerald-500" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Campanhas Detectadas (UTM)
          </h2>
          <Badge variant="info">{sorted.length}</Badge>
        </div>
        <div className="flex flex-col gap-2 w-full sm:flex-row sm:w-auto sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:w-auto">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Buscar campanha…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-[44px] w-full sm:w-auto sm:h-8 rounded-md border border-border bg-background pl-8 pr-3 text-sm sm:text-xs outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <PeriodPicker value={period} onChange={setPeriod} />
          <Button size="sm" variant="ghost" className="min-h-[44px] w-full sm:w-auto" onClick={load} disabled={loading}>
            <ArrowClockwise
              size={14}
              className={cn("mr-1", loading && "animate-spin")}
            />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Tabela */}
      {loading && campaigns.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search
            ? "Nenhuma campanha encontrada para esta busca."
            : "Nenhuma campanha detectada via UTM neste workspace."}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3">Creative Code</th>
                    <th className="px-4 py-3">Campaign Code</th>
                    <th className="px-4 py-3">Placement</th>
                    <th className="px-4 py-3 text-right">Sessions</th>
                    <th className="px-4 py-3 text-right">Quiz Responses</th>
                    <th className="px-4 py-3 text-right">Conversão</th>
                    <th className="px-4 py-3 text-right">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((c) => {
                    const rate = getConversionRate(c);
                    const isBest = rate !== null && rate === bestConversionRate;
                    return (
                      <tr
                        key={`${c.campaignCode}-${c.creativeCode}`}
                        className={cn(
                          "cursor-pointer border-b border-border/50 transition-colors last:border-0",
                          isBest ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-muted/40"
                        )}
                        onClick={() => setDrillCampaign(c.campaignCode)}
                      >
                        <td className="px-4 py-3 font-mono text-xs">{c.creativeCode}</td>
                        <td className="px-4 py-3 font-mono text-xs text-emerald-600 dark:text-emerald-400">
                          {c.campaignCode}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="neutral" className="text-[10px]">
                            {c.placement}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.sessions.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.quizResponses.toLocaleString("pt-BR")}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {rate === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              {isBest && (
                                <Badge variant="success" className="text-[9px] px-1.5 py-0.5">
                                  Melhor
                                </Badge>
                              )}
                              <span className={isBest ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}>
                                {rate.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          <div className="flex items-center justify-end gap-1">
                            <CalendarBlank size={12} />
                            {new Date(c.lastSeen).toLocaleDateString("pt-BR")}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">
        Clique em uma linha para ver o heatmap de respostas do quiz daquela campanha.
      </p>
    </div>
  );
}