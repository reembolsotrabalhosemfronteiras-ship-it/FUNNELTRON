import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MagnifyingGlass,
  ArrowClockwise,
  TrendUp,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Hash,
  Image as ImageIcon,
} from "@phosphor-icons/react";
import {
  Card,
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
} from "@/api/client";
import { type PeriodInput } from "@/types";
import { useWorkspace } from "@/components/common/WorkspaceContext";

// ---------------------------------------------------------------------------
// Helpers de exibicao
// ---------------------------------------------------------------------------

/** Nome humano da campanha: prefere campaignName (legivel), cai em rawCampaign
 *  (utm cru) e por ultimo no campaignCode tecnico (#bm.16.ca.01). */
function displayName(c: ParsedCampaign): string {
  return c.campaignName || c.rawCampaign || c.campaignCode || "Sem campanha";
}

/** Rotulo do criativo: creativeCode quando existe, senao "Criativo unico". */
function creativeLabel(c: ParsedCampaign): string {
  return c.creativeCode || "Criativo unico";
}

function fmt(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString("pt-BR");
}

// ---------------------------------------------------------------------------
// Drill-down: heatmap horario de uma campanha especifica
// ---------------------------------------------------------------------------
function CampaignHeatmap({
  funnelId,
  campaignCode,
  campaignLabel,
  period,
  onClose,
}: {
  funnelId: string;
  campaignCode: string;
  campaignLabel: string;
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
            Heatmap — {campaignLabel}
          </h3>
          <p className="text-xs text-muted-foreground">
            {periodLabel(period)} · {fmt(totalResponses)} respostas · {completionRate}% conclusao
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
          Nenhuma resposta registrada para esta campanha no periodo.
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
                                ? `${cell.responses} resp · ${cell.completions} concluidas`
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
// Barra horizontal proporcional (sessions ou quiz responses)
// ---------------------------------------------------------------------------
function MetricBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-all duration-500 ease-out"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tipos de agrupamento
// ---------------------------------------------------------------------------
type GroupMode = "campaign" | "creative";

interface GroupBucket {
  key: string;
  label: string;
  subLabel: string | null;
  rows: ParsedCampaign[];
  /** Visitantes unicos reais (device_id distinto). Soma dos c.users do grupo. */
  users: number;
  quizResponses: number;
}

/** Visitantes unicos de uma campanha: prefere c.users (reais), cai em
 *  c.sessions como proxy quando o backend nao conseguiu contar (timeout). */
function userCount(c: ParsedCampaign): number {
  return c.users ?? c.sessions ?? 0;
}

function conversion(users: number, quizResponses: number): number | null {
  return users > 0 ? (quizResponses / users) * 100 : null;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export function ParsedCampaignsTab({ funnelId }: { funnelId: string }) {
  const { active } = useWorkspace();
  const workspaceId = active?.id ?? "";
  const { notify } = useNotifications();

  const [campaigns, setCampaigns] = useState<ParsedCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const [search, setSearch] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>("campaign");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<{ code: string; label: string } | null>(null);

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

  // Filtra por busca (nome, codigo, placement, criativo)
  const filtered = useMemo(() => {
    if (!search.trim()) return campaigns;
    const q = search.toLowerCase();
    return campaigns.filter(
      (c) =>
        displayName(c).toLowerCase().includes(q) ||
        (c.creativeCode ?? "").toLowerCase().includes(q) ||
        (c.campaignCode ?? "").toLowerCase().includes(q) ||
        (c.placement ?? "").toLowerCase().includes(q)
    );
  }, [campaigns, search]);

  // Agrupa por campanha ou por criativo
  const groups = useMemo<GroupBucket[]>(() => {
    const map = new Map<string, GroupBucket>();
    for (const c of filtered) {
      const isCamp = groupMode === "campaign";
      const key = isCamp
        ? c.campaignCode || "__none__"
        : c.creativeCode || "__none__";
      const label = isCamp ? displayName(c) : creativeLabel(c);
      const subLabel = isCamp
        ? c.campaignCode && c.campaignCode !== displayName(c)
          ? c.campaignCode
          : null
        : displayName(c);

      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          key,
          label,
          subLabel,
          rows: [],
          users: 0,
          quizResponses: 0,
        };
        map.set(key, bucket);
      }
      bucket.rows.push(c);
      bucket.users += userCount(c);
      bucket.quizResponses += c.quizResponses ?? 0;
    }
    // Ordena grupos por usuarios unicos decrescente
    return Array.from(map.values()).sort((a, b) => b.users - a.users);
  }, [filtered, groupMode]);

  // Maximos globais para as barras serem comparaveis entre grupos
  const maxUsers = useMemo(
    () => Math.max(1, ...groups.map((g) => g.users)),
    [groups]
  );
  const maxQuiz = useMemo(
    () => Math.max(1, ...groups.map((g) => g.quizResponses)),
    [groups]
  );

  // Totais gerais
  const totalUsers = useMemo(
    () => filtered.reduce((s, c) => s + userCount(c), 0),
    [filtered]
  );
  const totalQuiz = useMemo(
    () => filtered.reduce((s, c) => s + (c.quizResponses ?? 0), 0),
    [filtered]
  );

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (drill) {
    return (
      <CampaignHeatmap
        funnelId={funnelId}
        campaignCode={drill.code}
        campaignLabel={drill.label}
        period={period}
        onClose={() => setDrill(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de filtros + KPIs */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <TrendUp size={18} className="text-emerald-500" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Trafego por {groupMode === "campaign" ? "Campanha" : "Criativo"}
          </h2>
          <Badge variant="info">{groups.length}</Badge>
        </div>
        <div className="flex flex-col gap-2 w-full sm:flex-row sm:w-auto sm:flex-wrap sm:items-center">
          {/* Toggle de agrupamento */}
          <div className="inline-flex rounded-md border border-border p-0.5">
            <button
              onClick={() => setGroupMode("campaign")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                groupMode === "campaign"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Por Campanha
            </button>
            <button
              onClick={() => setGroupMode("creative")}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                groupMode === "creative"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              Por Criativo
            </button>
          </div>
          <div className="relative w-full sm:w-auto">
            <MagnifyingGlass
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Buscar…"
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

      {/* KPIs resumidos */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Usuarios" value={fmt(totalUsers)} accent="text-sky-600 dark:text-sky-400" />
        <KpiTile label="Respostas Quiz" value={fmt(totalQuiz)} accent="text-emerald-600 dark:text-emerald-400" />
        <KpiTile
          label="Conversao"
          value={conversion(totalUsers, totalQuiz) === null ? "—" : `${conversion(totalUsers, totalQuiz)!.toFixed(1)}%`}
          accent="text-violet-600 dark:text-violet-400"
        />
        <KpiTile label={groupMode === "campaign" ? "Campanhas" : "Criativos"} value={fmt(groups.length)} accent="text-amber-600 dark:text-amber-400" />
      </div>

      {/* Grupos recolhiveis */}
      {loading && campaigns.length === 0 ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size={28} />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {search
            ? "Nenhuma campanha encontrada para esta busca."
            : "Nenhuma campanha detectada via UTM neste workspace."}
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            const rate = conversion(g.users, g.quizResponses);
            // ordena linhas internas por sessions desc
            const innerRows = [...g.rows].sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0));
            return (
              <Card key={`${groupMode}-${g.key}`} className="overflow-hidden">
                <CardContent className="p-0">
                  {/* Cabecalho do grupo (clicavel para expandir) */}
                  <button
                    onClick={() => toggleExpand(g.key)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="text-muted-foreground">
                      {isOpen ? <CaretDown size={14} /> : <CaretRight size={14} />}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {groupMode === "campaign" ? <Hash size={16} /> : <ImageIcon size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{g.label}</div>
                      {g.subLabel && (
                        <div className="truncate font-mono text-[10px] text-muted-foreground">
                          {g.subLabel}
                        </div>
                      )}
                    </div>
                    <div className="hidden w-40 shrink-0 sm:block">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Usuarios</span>
                        <span className="tabular-nums">{fmt(g.users)}</span>
                      </div>
                      <MetricBar value={g.users} max={maxUsers} color="#0ea5e9" />
                    </div>
                    <div className="hidden w-32 shrink-0 sm:block">
                      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Quiz</span>
                        <span className="tabular-nums">{fmt(g.quizResponses)}</span>
                      </div>
                      <MetricBar value={g.quizResponses} max={maxQuiz} color="#10b981" />
                    </div>
                    <div className="w-16 shrink-0 text-right">
                      {rate === null ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          {rate.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Linhas detalhadas (quando expandido) */}
                  {isOpen && (
                    <div className="border-t border-border/60">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border/60 bg-muted/20 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2">
                              {groupMode === "campaign" ? "Criativo" : "Campanha"}
                            </th>
                            <th className="px-4 py-2">Placement</th>
                            <th className="px-4 py-2 text-right">Usuarios</th>
                            <th className="px-4 py-2 text-right">Quiz</th>
                            <th className="px-4 py-2 text-right">Conv.</th>
                            <th className="px-4 py-2 text-right">Ultima</th>
                          </tr>
                        </thead>
                        <tbody>
                          {innerRows.map((c, i) => {
                            const r = conversion(userCount(c), c.quizResponses);
                            return (
                              <tr
                                key={`${c.campaignCode}-${c.creativeCode}-${i}`}
                                className="border-b border-border/40 last:border-0 hover:bg-muted/30"
                              >
                                <td className="px-4 py-2 font-mono text-[11px]">
                                  {groupMode === "campaign" ? creativeLabel(c) : displayName(c)}
                                </td>
                                <td className="px-4 py-2">
                                  <Badge variant="default" className="text-[9px]">
                                    {c.placement || "—"}
                                  </Badge>
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  {fmt(userCount(c))}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  {fmt(c.quizResponses)}
                                </td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  {r === null ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    <span className="text-emerald-600 dark:text-emerald-400">
                                      {r.toFixed(1)}%
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-right text-[10px] text-muted-foreground">
                                  {c.lastSeen ? new Date(c.lastSeen).toLocaleDateString("pt-BR") : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="flex items-center justify-end border-t border-border/40 px-4 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setDrill({
                              code: g.rows[0]?.campaignCode || g.key,
                              label: g.label,
                            })
                          }
                        >
                          <CalendarBlank size={12} className="mr-1" />
                          Ver heatmap de respostas
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Clique num grupo para ver o detalhe por {groupMode === "campaign" ? "criativo" : "campanha"}.
        Os numeros sobem conforme o snippet registra visitas com UTM.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile de KPI
// ---------------------------------------------------------------------------
function KpiTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", accent)}>{value}</div>
    </div>
  );
}