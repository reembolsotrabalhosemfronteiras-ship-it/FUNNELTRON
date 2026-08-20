import { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Zap,
  Users,
  AlertCircle,
  Clock,
  GitBranch,
  LayoutGrid,
} from "lucide-react";
import { Header } from "@/components/common/Header";
import { Card, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Badge } from "@/components/common/Badge";
import { Spinner } from "@/components/common/Spinner";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { cn } from "@/lib/cn";
import {
  listFunnels,
  getFunnel,
  listSteps,
  listEdges,
  getLiveVsl,
  getLiveFlow,
  getLiveSales,
  getLiveConversion,
  getDayConversion,
  getLivePageEntries,
} from "@/api/client";
import type { Funnel, FunnelStep, FunnelEdge } from "@/types";
import type {
  LiveVslData,
  LiveStepData,
  LiveSale,
  LiveConversion,
  LivePageEntry,
} from "@/api/client";
import { LiveFunnelCanvas } from "@/components/funnel/LiveFunnelCanvas";
import { LiveTabs, type LiveTab } from "@/components/live/LiveTabs";
import { TimeWindowPicker } from "@/components/live/TimeWindowPicker";
import { ClarityLiveView } from "@/components/live/ClarityLiveView";
import { SourceSelector, useDataSource } from "@/components/common/SourceSelector";
import { ConversionBar } from "@/components/live/ConversionBar";
import { SalesFeed } from "@/components/live/SalesFeed";
import { PageEntriesFeed } from "@/components/live/PageEntriesFeed";

type SaleFilter = "all" | "paid" | "pending";

// ---------------------------------------------------------------------------
// Hook: carrega o estado "ao vivo" de UM funil e faz polling a cada 5s.
// Pausa quando a aba do navegador não está visível (economiza ciclos).
// ---------------------------------------------------------------------------
interface LiveFunnelData {
  funnel: Funnel;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  liveVsl: LiveVslData[];
  liveFlow: LiveStepData[];
  conversion: LiveConversion | null;
  /** Mesma conta, mas do dia inteiro — contexto para a janela curta. */
  dayConversion: LiveConversion | null;
  sales: LiveSale[];
  entries: LivePageEntry[];
  stepLabels: Record<string, string>;
}

/** Parte que só muda quando alguém edita o funil no ateliê. */
interface FunnelStructure {
  funnel: Funnel;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  stepLabels: Record<string, string>;
}

/** Parte que muda a cada ciclo de polling. */
interface LiveSnapshot {
  liveVsl: LiveVslData[];
  liveFlow: LiveStepData[];
  conversion: LiveConversion | null;
  dayConversion: LiveConversion | null;
  sales: LiveSale[];
  entries: LivePageEntry[];
}

function useLiveFunnel(
  funnelId: string,
  vslWindow: number,
  convWindow: number,
  salesWindow: number
) {
  // Desenho e números vivem em estados separados de propósito. Rebuscar o
  // desenho a cada 5s devolvia sempre a mesma coisa, mas em objetos novos: o
  // canvas via "steps mudaram", remontava os nós e refazia o fitView antes de
  // medi-los — a cada atualização o painel piscava preto.
  const [structure, setStructure] = useState<FunnelStructure | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [structureLoading, setStructureLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [isPolling, setIsPolling] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setStructure(null);
    setStructureLoading(true);
    (async () => {
      try {
        const [f, s, e] = await Promise.all([
          getFunnel(funnelId),
          listSteps(funnelId),
          listEdges(funnelId),
        ]);
        if (cancelled) return;
        const stepLabels: Record<string, string> = {};
        s.forEach((st) => (stepLabels[st.id] = st.label));
        setStructure({ funnel: f, steps: s, edges: e, stepLabels });
      } catch (err) {
        console.error("Erro ao carregar o funil:", err);
      } finally {
        if (!cancelled) setStructureLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [funnelId]);

  const refresh = useCallback(async () => {
    try {
      const [vsl, flow, conv, sls, ents, day] = await Promise.all([
        getLiveVsl(funnelId, vslWindow),
        getLiveFlow(funnelId),
        getLiveConversion(funnelId, convWindow),
        getLiveSales(funnelId, salesWindow),
        // O log de entradas usa a mesma janela das vendas: as duas seções ficam
        // lado a lado e comparar "entrou" com "comprou" em janelas diferentes
        // levaria a conclusão errada.
        getLivePageEntries(funnelId, salesWindow),
        getDayConversion(funnelId),
      ]);
      setSnapshot({
        liveVsl: vsl,
        liveFlow: flow,
        conversion: conv,
        dayConversion: day,
        sales: sls,
        entries: ents,
      });
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Erro ao atualizar métricas ao vivo:", err);
    } finally {
      setLoading(false);
    }
  }, [funnelId, vslWindow, convWindow, salesWindow]);

  const data = useMemo<LiveFunnelData | null>(
    () => (structure && snapshot ? { ...structure, ...snapshot } : null),
    [structure, snapshot]
  );

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isPolling) return;
    const i = setInterval(() => void refresh(), 5000);
    return () => clearInterval(i);
  }, [isPolling, refresh]);

  useEffect(() => {
    const h = () => setIsPolling(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  return {
    data,
    loading: loading || structureLoading,
    lastUpdated,
    refresh,
    isPolling,
  };
}

// ---------------------------------------------------------------------------
// Vista de UM funil: canvas fixo centralizado + conversão + vendas + VSLs.
// ---------------------------------------------------------------------------
function FunnelLiveView({
  funnel,
  vslWindow,
  convWindow,
  salesWindow,
}: {
  funnel: Funnel;
  vslWindow: number;
  convWindow: number;
  salesWindow: number;
}) {
  const { data, loading, lastUpdated, refresh, isPolling } = useLiveFunnel(
    funnel.id,
    vslWindow,
    convWindow,
    salesWindow
  );
  const [saleFilter, setSaleFilter] = useState<SaleFilter>("all");
  const [convScope, setConvScope] = useState<"window" | "today">("window");

  const filteredSales = useMemo(() => {
    if (!data) return [];
    if (saleFilter === "all") return data.sales;
    return data.sales.filter((s) => s.status === saleFilter);
  }, [data, saleFilter]);

  const totalOnline = useMemo(
    () => (data ? data.liveFlow.reduce((sum, l) => sum + l.online, 0) : 0),
    [data]
  );

  const trackerMissing = data
    ? data.liveFlow.every((l) => l.online === 0)
    : false;

  if (loading && !data) return <Spinner size={32} />;
  if (!data) return <div className="p-8 text-center text-muted-foreground">Sem dados.</div>;

  return (
    <div className="space-y-6">
      {/* Canvas fixo e centralizado */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-red-500" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              Fluxo ao Vivo
            </h2>
            <Badge
              variant="info"
              className="border-red-500/50 bg-red-500/20 font-bold text-red-600 dark:text-red-300"
            >
              {totalOnline} pessoas agora
            </Badge>
          </div>
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-red-600/80 dark:text-red-400/80">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isPolling ? "bg-red-500" : "bg-muted-foreground"
              )}
            />
            {isPolling ? "ao vivo" : "pausado"} · {lastUpdated.toLocaleTimeString()}
          </span>
        </div>

        <LiveFunnelCanvas
          funnel={data.funnel}
          steps={data.steps}
          edges={data.edges}
          liveFlow={data.liveFlow}
          entries={data.entries}
        />

        {trackerMissing && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={16} />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Rastreador próprio não detectado — para ver pessoas em cada etapa,
              instale o snippet do Funneltron no &lt;head&gt; das páginas. As VSLs
              continuam via VTurb.
            </p>
          </div>
        )}
      </section>

      {/* Conversão (30m/1h) + Log de entradas em página */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Conversão
          </h3>
          {/* Duas escalas de tempo, um card só: a janela curta diz como está
              agora, o dia diz se isso é normal — o botão alterna entre elas
              em vez de empilhar duas cartas iguais na tela. */}
          {(convScope === "today" ? data.dayConversion : data.conversion) && (
            <ConversionBar
              data={(convScope === "today" ? data.dayConversion : data.conversion)!}
              scope={convScope}
              onToggleScope={() =>
                setConvScope((s) => (s === "today" ? "window" : "today"))
              }
            />
          )}
        </div>

        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Entradas em página
              </h3>
            </div>
            <span className="text-[10px] text-muted-foreground">
              últimos {salesWindow} min · mais recente no topo
            </span>
          </div>
          <PageEntriesFeed
            entries={data.entries}
            stepLabels={data.stepLabels}
          />
        </div>
      </section>

      {/* Vendas (webhook) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Vendas (webhook)
          </h3>
          <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5">
            {(["all", "paid", "pending"] as SaleFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setSaleFilter(f)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  saleFilter === f
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "all" ? "Todas" : f === "paid" ? "Pagas" : "Pendentes"}
              </button>
            ))}
          </div>
        </div>
        <SalesFeed sales={filteredSales} stepLabels={data.stepLabels} />
      </section>

      {/* VSLs ao vivo (VTurb) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-purple-500" />
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Entradas Recentes nas VSLs
          </h3>
        </div>
        {data.liveVsl.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {data.liveVsl.map((vsl) => (
              <Card key={vsl.stepId} className="overflow-hidden border-l-4 border-l-purple-500">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground truncate max-w-[120px]">
                      {vsl.label}
                    </span>
                    <Badge variant="info" className="text-purple-600 bg-purple-100 dark:bg-purple-900/30 border-purple-200 dark:border-purple-800">
                      VTurb
                    </Badge>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold">{vsl.liveUsers}</span>
                    <span className="text-xs text-muted-foreground">pessoas</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2 flex items-center gap-1">
                    <Clock size={10} />
                    Entraram nos últimos {vsl.windowMinutes} min
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center border border-dashed rounded-lg text-muted-foreground text-sm">
            Nenhuma VSL ativa neste funil.
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vista geral: agrega todos os funis ativos (pessoas, conversão, vendas).
// ---------------------------------------------------------------------------
function GeneralLiveView({
  funnels,
  convWindow,
  salesWindow,
}: {
  funnels: Funnel[];
  convWindow: number;
  salesWindow: number;
}) {
  const [byFunnel, setByFunnel] = useState<Record<
    string,
    { conv: LiveConversion; sales: LiveSale[]; funnel: Funnel; steps: FunnelStep[]; totalOnline: number }
  >>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isPolling, setIsPolling] = useState(true);
  const [saleFilter, setSaleFilter] = useState<SaleFilter>("all");
  const [stepsByFunnel, setStepsByFunnel] = useState<Record<string, FunnelStep[]>>({});

  // As etapas do funil ficam FORA do polling: elas só mudam quando alguém edita
  // o funil no ateliê, não a cada 5 segundos. Buscá-las junto somava uma
  // requisição por funil a cada ciclo para receber sempre a mesma resposta.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      funnels.map(async (f) => [f.id, await listSteps(f.id)] as const)
    )
      .then((pares) => {
        if (!cancelled) setStepsByFunnel(Object.fromEntries(pares));
      })
      .catch((err) => console.error("Erro ao carregar etapas dos funis:", err));
    return () => {
      cancelled = true;
    };
  }, [funnels]);

  const refresh = useCallback(async () => {
    // Um funil fora do ar (ou o token expirado) não pode derrubar a vista:
    // sem este catch a falha virava rejeição não tratada e a aba parava de se
    // atualizar em silêncio, mostrando números velhos como se fossem de agora.
    try {
      const entries = await Promise.all(
        funnels.map(async (f) => {
          const [conv, sales, flow] = await Promise.all([
            getLiveConversion(f.id, convWindow),
            getLiveSales(f.id, salesWindow),
            getLiveFlow(f.id),
          ]);
          return [
            f.id,
            {
              conv,
              sales,
              funnel: f,
              steps: stepsByFunnel[f.id] ?? [],
              totalOnline: flow.reduce((s, l) => s + l.online, 0),
            },
          ] as const;
        })
      );
      setByFunnel(Object.fromEntries(entries));
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Erro ao atualizar a vista geral:", err);
    }
  }, [funnels, convWindow, salesWindow, stepsByFunnel]);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!isPolling) return;
    const i = setInterval(() => void refresh(), 5000);
    return () => clearInterval(i);
  }, [isPolling, refresh]);

  useEffect(() => {
    const h = () => setIsPolling(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  const allSales = useMemo(() => {
    const list = Object.values(byFunnel).flatMap((v) => v.sales);
    list.sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));
    return list;
  }, [byFunnel]);

  const stepLabels = useMemo(() => {
    const map: Record<string, string> = {};
    Object.values(byFunnel).forEach((v) =>
      v.steps.forEach((s) => (map[s.id] = s.label))
    );
    return map;
  }, [byFunnel]);

  const filteredSales = useMemo(
    () => (saleFilter === "all" ? allSales : allSales.filter((s) => s.status === saleFilter)),
    [allSales, saleFilter]
  );

  const totals = useMemo(() => {
    let visitors = 0;
    let conversions = 0;
    let online = 0;
    let revenue = 0;
    let paid = 0;
    Object.values(byFunnel).forEach((v) => {
      visitors += v.conv.visitors;
      conversions += v.conv.conversions;
      online += v.totalOnline;
      v.sales.forEach((s) => {
        if (s.status === "paid") {
          revenue += s.amount;
          paid += 1;
        }
      });
    });
    return {
      visitors,
      conversions,
      online,
      revenue,
      paid,
      rate: visitors > 0 ? (conversions / visitors) * 100 : 0,
    };
  }, [byFunnel]);

  if (loading && Object.keys(byFunnel).length === 0) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resumo agregado */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryCard label="Pessoas agora" value={totals.online.toLocaleString("pt-BR")} icon={<Users size={16} className="text-red-500" />} />
        <SummaryCard label="Entraram (janela)" value={totals.visitors.toLocaleString("pt-BR")} icon={<Users size={16} className="text-red-400" />} />
        <SummaryCard label="Conversões" value={totals.conversions.toLocaleString("pt-BR")} sub={`${totals.rate.toFixed(1)}%`} icon={<LayoutGrid size={16} className="text-emerald-500" />} />
        <SummaryCard label="Receita (pagas)" value={`R$ ${totals.revenue.toLocaleString("pt-BR")}`} sub={`${totals.paid} pagas`} icon={<Zap size={16} className="text-purple-500" />} />
      </section>

      {/* Conversão por funil */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Conversão por funil ({convWindow} min)
        </h3>
        <div className="grid gap-4 lg:grid-cols-2">
          {funnels.map((f) => {
            const v = byFunnel[f.id];
            if (!v) return null;
            return (
              <ConversionBar key={f.id} data={{ ...v.conv, windowMinutes: convWindow }} />
            );
          })}
        </div>
      </section>

      {/* Vendas agregadas */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Vendas (webhook) — todos os funis
          </h3>
          <div className="flex items-center gap-1 rounded-md bg-muted/50 p-0.5">
            {(["all", "paid", "pending"] as SaleFilter[]).map((fl) => (
              <button
                key={fl}
                onClick={() => setSaleFilter(fl)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  saleFilter === fl
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {fl === "all" ? "Todas" : fl === "paid" ? "Pagas" : "Pendentes"}
              </button>
            ))}
          </div>
        </div>
        <SalesFeed sales={filteredSales} stepLabels={stepLabels} />
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-[11px] uppercase tracking-wide">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Página principal: carrega funis + ativos, monta as abas e os seletores.
// ---------------------------------------------------------------------------
export function LivePage() {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [funnelMap, setFunnelMap] = useState<Record<string, Funnel>>({});
  const [activeTab, setActiveTab] = useState<string>("geral");
  const [loadingScope, setLoadingScope] = useState(true);
  // Uma janela só para VSL, conversão e vendas — três seletores separados
  // convidavam a comparar "entrou" (num intervalo) com "comprou" (noutro) e
  // tirar conclusão errada. Trocar a janela agora vale para a tela inteira.
  const [liveWindow, setLiveWindow] = useState(30);
  const { source, setSource } = useDataSource();

  // O seletor de janela é do NOSSO rastreador. O Clarity agrega por dia:
  // oferecer "últimos 5 minutos" para ele prometeria um recorte que a fonte
  // não sabe entregar.
  const showWindowPickers = source !== "clarity";

  useEffect(() => {
    let cancelled = false;
    listFunnels()
      .then((all) => {
        if (cancelled) return;
        const map: Record<string, Funnel> = {};
        all.forEach((f) => (map[f.id] = f));
        setFunnels(all);
        setFunnelMap(map);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        if (!cancelled) setLoadingScope(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Aba por funil, sempre — mesmo o que nunca recebeu tráfego. Antes só
  // ganhava aba quem tinha tráfego recente (`getActiveFunnels`), e um funil
  // parado não tinha como ser aberto na tela: sumia da lista de abas
  // inteiro, em vez de aparecer zerado.
  const tabs: LiveTab[] = useMemo(
    () => [
      { key: "geral", label: "Geral", icon: <LayoutGrid size={14} /> },
      ...funnels.map((f) => ({ key: f.id, label: f.name })),
    ],
    [funnels]
  );

  const selectedFunnel = activeTab === "geral" ? null : funnelMap[activeTab];

  if (loadingScope) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (funnels.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <GitBranch size={48} className="mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-medium mb-2">Nenhum funil cadastrado</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Crie um funil primeiro para monitorar em tempo real.
            </p>
            <Link to="/funnels" className="text-primary font-medium hover:underline">
              Ir para Funis →
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Ao Vivo"
        subtitle="Monitoramento em tempo real de visitantes e vendas"
        actions={
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <SourceSelector value={source} onChange={setSource} />
            {showWindowPickers && (
              <TimeWindowPicker
                icon={<Zap size={14} className="text-blue-500" />}
                value={liveWindow}
                onChange={setLiveWindow}
              />
            )}
          </div>
        }
      />

      <main className="p-4 space-y-6">
        <LiveTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

        {/* Uma fonte de cada vez. Em "Comparar" as duas aparecem empilhadas e
            rotuladas — nunca somadas: o Clarity e o nosso rastreador contam
            sessão de formas diferentes, e a soma conta a mesma pessoa duas
            vezes. */}
        {source !== "clarity" &&
          (activeTab === "geral" ? (
            // Mostra TODOS os funis cadastrados, não só os com tráfego agora —
            // senão a aba "Geral" some inteira quando ninguém está online, e
            // "ninguém no sistema" é uma informação, não um estado vazio.
            <ErrorBoundary area="Ao Vivo · Geral">
              <GeneralLiveView
                funnels={funnels}
                convWindow={liveWindow}
                salesWindow={liveWindow}
              />
            </ErrorBoundary>
          ) : selectedFunnel ? (
            <ErrorBoundary area={`Ao Vivo · ${selectedFunnel.name}`}>
              <FunnelLiveView
                funnel={selectedFunnel}
                vslWindow={liveWindow}
                convWindow={liveWindow}
                salesWindow={liveWindow}
              />
            </ErrorBoundary>
          ) : (
            <div className="py-16 text-center text-muted-foreground">
              Funil não encontrado.
            </div>
          ))}

        {source !== "tracker" && (
          <ErrorBoundary area="Ao Vivo · Clarity">
            <ClarityLiveView
              funnelId={activeTab === "geral" ? undefined : activeTab}
            />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}
