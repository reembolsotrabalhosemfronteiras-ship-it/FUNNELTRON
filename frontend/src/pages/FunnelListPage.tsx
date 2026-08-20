import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, GitBranch, ArrowDownWideNarrow, Pencil, Copy, Trash2 } from "lucide-react";
import { Header } from "@/components/common/Header";
import { Card, CardContent } from "@/components/common/Card";
import { StatusBadge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { Input } from "@/components/common/Input";
import { Spinner } from "@/components/common/Spinner";
import { PeriodPicker, periodLabel } from "@/components/common/PeriodPicker";
import { SourceSelector, useDataSource } from "@/components/common/SourceSelector";
import {
  listFunnels,
  deleteFunnel,
  duplicateFunnel,
  setFunnelStatus,
  listSteps,
  getMetrics,
  getVslInsights,
} from "@/api/client";
import type { Funnel, FunnelKind, FunnelStatus, PeriodInput } from "@/types";
import { useNewFunnel } from "@/components/funnel/NewFunnelProvider";
import { summarizeVsl, type VslSummary } from "@/lib/funnelStats";
import { cn } from "@/lib/cn";
import { conversionColor } from "@/lib/conversion";
import { MetricLabel } from "@/components/common/MetricLabel";
import { metricLabel, type MetricKey } from "@/lib/metricGlossary";

type FilterTab = "all" | FunnelStatus;

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "active", label: "Ativos" },
  { key: "testing", label: "Em teste" },
  { key: "inactive", label: "Desativos" },
];

/** Números já agregados de um funil, usados para ordenar os cards. */
interface FunnelStats {
  visitors: number;
  conversions: number;
  rate: number;
  /**
   * Ponta a ponta: de quem entrou, quantos chegaram ao fim. `null` quando o
   * funil não tem página de obrigado — sem etapa final não há o que medir, e
   * mostrar 0% faria um funil sadio parecer quebrado.
   */
  endToEnd: number | null;
  /** Um funil pode ter várias VSLs — aqui vai o resumo delas. */
  vsl: VslSummary;
}

type SortKey = keyof Pick<
  FunnelStats,
  "visitors" | "conversions" | "rate" | "endToEnd"
>;

/** A chave da métrica no glossário, para rótulo e explicação virem de lá. */
const SORT_OPTIONS: { key: SortKey; metric: MetricKey }[] = [
  { key: "rate", metric: "avgRate" },
  { key: "endToEnd", metric: "endToEnd" },
  { key: "conversions", metric: "conversions" },
  { key: "visitors", metric: "visitors" },
];

const KIND_TABS: { value: FunnelKind; label: string }[] = [
  { value: "front", label: "Funis de front" },
  { value: "upsell", label: "Funis de upsell" },
];

export function FunnelListPage() {
  const { open: openNewFunnel } = useNewFunnel();
  const [kind, setKind] = useState<FunnelKind>("front");
  const [editing, setEditing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [stats, setStats] = useState<Record<string, FunnelStats>>({});
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<PeriodInput>("30d");
  const { source, setSource } = useDataSource();
  const [sortKey, setSortKey] = useState<SortKey>("rate");
  const [sortDesc, setSortDesc] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listFunnels()
      .then(setFunnels)
      .finally(() => setLoading(false));
  }, []);

  // As estatísticas ficam aqui, e não dentro de cada card, porque a ordenação
  // precisa conhecer os números de todos os funis antes de desenhar a grade.
  useEffect(() => {
    if (funnels.length === 0) return;
    let cancelled = false;

    // Uma chamada de VSL para a lista inteira: ela não depende do funil, e
    // buscá-la dentro do laço baixava a MESMA resposta uma vez por funil.
    const vslDaTela = getVslInsights(period);

    Promise.all(
      funnels.map(async (f) => {
        const [metrics, steps, vslAll] = await Promise.all([
          getMetrics(f.id, source, period),
          listSteps(f.id),
          vslDaTela,
        ]);
        const visitors = metrics.reduce((s, m) => s + m.visitors, 0);
        const conversions = metrics.reduce((s, m) => s + m.conversions, 0);
        const entry = Math.max(0, ...metrics.map((m) => m.visitors));
        const exit = metrics.find(
          (m) => steps.find((s) => s.id === m.stepId)?.type === "thank_you"
        );
        return [
          f.id,
          {
            visitors,
            conversions,
            rate: visitors > 0 ? (conversions / visitors) * 100 : 0,
            endToEnd:
              entry > 0 && exit ? (exit.visitors / entry) * 100 : null,
            vsl: summarizeVsl(vslAll.filter((v) => v.funnelId === f.id)),
          } satisfies FunnelStats,
        ] as const;
      })
    ).then((entries) => {
      if (!cancelled) setStats(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [funnels, period, source]);

  // --- Gerenciar funis ------------------------------------------------------

  const changeStatus = async (funnel: Funnel, status: FunnelStatus) => {
    setBusyId(funnel.id);
    try {
      await setFunnelStatus(funnel.id, status);
      setFunnels((prev) =>
        prev.map((f) => (f.id === funnel.id ? { ...f, status } : f))
      );
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (funnel: Funnel) => {
    setBusyId(funnel.id);
    try {
      const copy = await duplicateFunnel(funnel.id);
      setFunnels((prev) => [...prev, copy]);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (funnel: Funnel) => {
    // Apagar funil não tem volta — confirmar pelo nome evita clique errado.
    if (
      !window.confirm(
        `Apagar "${funnel.name}"? O desenho e as configurações vão junto. Isso não pode ser desfeito.`
      )
    ) {
      return;
    }
    setBusyId(funnel.id);
    try {
      await deleteFunnel(funnel.id);
      setFunnels((prev) => prev.filter((f) => f.id !== funnel.id));
    } finally {
      setBusyId(null);
    }
  };

  const visible = useMemo(() => {
    // A aba front/upsell vem antes de qualquer outro filtro.
    let result = funnels.filter((f) => (f.kind ?? "front") === kind);
    if (tab !== "all") result = result.filter((f) => f.status === tab);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((f) => f.name.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      // Funil sem a métrica vai para o fim em qualquer direção de ordenação:
      // "sem dado" não é o pior valor, é ausência de valor.
      const va = stats[a.id]?.[sortKey];
      const vb = stats[b.id]?.[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortDesc ? vb - va : va - vb;
    });
  }, [funnels, kind, tab, search, stats, sortKey, sortDesc]);

  const sortMetric =
    SORT_OPTIONS.find((o) => o.key === sortKey)?.metric ?? "avgRate";
  const sortLabel = metricLabel(sortMetric);

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Funis"
        subtitle={`${funnels.length} funis cadastrados · ${periodLabel(period)}`}
        actions={
          <Button onClick={openNewFunnel}>
            <Plus size={16} />
            Novo funil
          </Button>
        }
      />

      {/* Front × upsell: mesmo ateliê, papéis diferentes. */}
      <div className="border-b border-border bg-card/50 px-4 pt-3">
        <div className="flex gap-1">
          {KIND_TABS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                kind === k.value
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {k.label}
              <span className="ml-1.5 text-xs text-muted-foreground">
                {funnels.filter((f) => (f.kind ?? "front") === k.value).length}
              </span>
            </button>
          ))}
        </div>
        <p className="pb-2 pt-1 text-xs text-muted-foreground">
          {kind === "upsell"
            ? "Funis de upsell são desenhados igual aos outros, mas podem ser inseridos dentro de qualquer funil de front como um bloco só."
            : "Seus funis principais — da entrada do tráfego até a compra."}
        </p>
      </div>

      <main className="space-y-4 p-4">
        {/* Filtros, período e ordenação na mesma faixa. */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
            {filterTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === t.key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <SourceSelector value={source} onChange={setSource} />
          <PeriodPicker value={period} onChange={setPeriod} align="start" />

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {/* Ordenar por métrica — melhores primeiro ou piores primeiro */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setSortKey(o.key)}
                  title={metricLabel(o.metric)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    sortKey === o.key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {metricLabel(o.metric, true)}
                </button>
              ))}
              <button
                onClick={() => setSortDesc((d) => !d)}
                title={
                  sortDesc
                    ? `Melhores ${sortLabel.toLowerCase()} primeiro`
                    : `Piores ${sortLabel.toLowerCase()} primeiro`
                }
                className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <ArrowDownWideNarrow
                  size={13}
                  className={cn("transition-transform", !sortDesc && "rotate-180")}
                />
                {sortDesc ? "melhores" : "piores"}
              </button>
            </div>

            <button
              onClick={() => setEditing((e) => !e)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                editing
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              )}
            >
              <Pencil size={13} />
              {editing ? "Concluir edição" : "Editar funis"}
            </button>

            <div className="relative w-full sm:w-52">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Buscar funil..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Spinner size={32} />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <GitBranch size={48} className="mb-3 text-muted-foreground" />
            <h3 className="font-medium">Nenhum funil encontrado</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {search ? "Tente outra busca" : "Crie seu primeiro funil"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visible.map((funnel, i) => (
              <FunnelCardItem
                key={funnel.id}
                funnel={funnel}
                stats={stats[funnel.id]}
                rank={i + 1}
                highlightKey={sortKey}
                editing={editing}
                busy={busyId === funnel.id}
                onStatus={(s) => changeStatus(funnel, s)}
                onDuplicate={() => duplicate(funnel)}
                onDelete={() => remove(funnel)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

const STATUS_CHOICES: {
  value: FunnelStatus;
  label: string;
  dot: string;
  activeClass: string;
}[] = [
  {
    value: "active",
    label: "Ativo",
    dot: "bg-success",
    activeClass: "border-success bg-success/15 text-success",
  },
  {
    value: "testing",
    label: "Em teste",
    dot: "bg-warning",
    activeClass: "border-warning bg-warning/15 text-warning",
  },
  {
    value: "inactive",
    label: "Desativo",
    dot: "bg-muted-foreground",
    activeClass: "border-muted-foreground/60 bg-muted text-foreground",
  },
];

function FunnelCardItem({
  funnel,
  stats,
  rank,
  highlightKey,
  editing,
  busy,
  onStatus,
  onDuplicate,
  onDelete,
}: {
  funnel: Funnel;
  stats?: FunnelStats;
  rank: number;
  highlightKey: SortKey;
  editing: boolean;
  busy: boolean;
  onStatus: (s: FunnelStatus) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const pct = (n: number | null | undefined) =>
    n == null ? "—" : `${n.toFixed(1)}%`;

  const tiles: {
    key: SortKey;
    metric: MetricKey;
    value: string;
    rate?: number | null;
    tone?: string;
  }[] = [
    {
      key: "visitors",
      metric: "visitors",
      value: (stats?.visitors ?? 0).toLocaleString("pt-BR"),
    },
    {
      key: "conversions",
      metric: "conversions",
      value: (stats?.conversions ?? 0).toLocaleString("pt-BR"),
      tone: "text-success",
    },
    {
      key: "rate",
      metric: "avgRate",
      value: pct(stats?.rate),
      rate: stats?.rate ?? null,
    },
    {
      key: "endToEnd",
      metric: "endToEnd",
      value: pct(stats?.endToEnd),
      rate: stats?.endToEnd ?? null,
    },
  ];

  // Em modo de edição o card deixa de navegar: clicar ali é para gerenciar,
  // não para abrir. Sem isso, cada clique numa ação levaria pro funil.
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    editing ? <div>{children}</div> : <Link to={`/funnel/${funnel.id}`}>{children}</Link>;

  return (
    <Wrapper>
      <Card
        className={cn(
          "group transition-all",
          editing
            ? "border-primary/40"
            : "cursor-pointer hover:border-primary/30 hover:shadow-md",
          busy && "opacity-60"
        )}
      >
        <CardContent className="p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                #{rank}
              </span>
              <h3 className="truncate font-semibold transition-colors group-hover:text-primary">
                {funnel.name}
              </h3>
            </div>
            <StatusBadge status={funnel.status} />
          </div>

          <p className="mb-3 truncate text-sm text-muted-foreground">
            {funnel.baseUrl}
          </p>

          <div className="grid grid-cols-4 gap-2 text-center">
            {tiles.map((t) => (
              <div
                key={t.key}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  t.key === highlightKey
                    ? "bg-primary/10 ring-1 ring-primary/30"
                    : "bg-muted/50"
                )}
              >
                <MetricLabel
                  metric={t.metric}
                  className="text-xs text-muted-foreground"
                >
                  {metricLabel(t.metric, true)}
                </MetricLabel>
                <p
                  className={cn(
                    "text-sm font-semibold",
                    t.rate === null && "text-muted-foreground",
                    t.tone
                  )}
                  style={
                    t.rate != null
                      ? { color: conversionColor(t.rate) }
                      : undefined
                  }
                  title={t.rate === null ? "Sem página de obrigado neste funil" : undefined}
                >
                  {t.value}
                </p>
              </div>
            ))}
          </div>

          {stats && stats.vsl.count > 0 && (
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="text-purple-500">🎬</span>
                <MetricLabel metric="vslConversion">
                  {stats.vsl.count > 1
                    ? `${stats.vsl.count} VSLs (média)`
                    : "VSL"}
                </MetricLabel>
                : {stats.vsl.avgConversion?.toFixed(1) ?? "—"}%
              </span>
              <span className="flex items-center gap-1">
                <MetricLabel metric="vslEngagement">Engaj</MetricLabel>:{" "}
                {stats.vsl.avgEngagement?.toFixed(0) ?? "—"}%
              </span>
            </div>
          )}

          {editing && (
            <div className="mt-3 space-y-2.5 border-t border-border pt-3">
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Status
                </p>
                {/* Cada opção com borda própria: sem isso as não-selecionadas
                    viram texto solto e ninguém percebe que dá para clicar. */}
                <div className="flex gap-1.5">
                  {STATUS_CHOICES.map((s) => {
                    const active = funnel.status === s.value;
                    return (
                      <button
                        key={s.value}
                        onClick={() => onStatus(s.value)}
                        disabled={busy}
                        aria-pressed={active}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60",
                          active
                            ? `${s.activeClass} shadow-sm`
                            : "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            active ? s.dot : "bg-muted-foreground/40"
                          )}
                        />
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                <Link
                  to={`/funnel/${funnel.id}/edit`}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
                >
                  <Pencil size={12} />
                  Ateliê
                </Link>
                <button
                  onClick={onDuplicate}
                  disabled={busy}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed"
                >
                  <Copy size={12} />
                  Duplicar
                </button>
                <button
                  onClick={onDelete}
                  disabled={busy}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-danger/40 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed"
                >
                  <Trash2 size={12} />
                  Apagar
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Wrapper>
  );
}
