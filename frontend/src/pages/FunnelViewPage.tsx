import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowClockwise as RefreshCw,
  PencilSimple as Edit,
  Gear as Settings,
  ChartBar as BarChart3,
} from "@phosphor-icons/react";
import { Header } from "@/components/common/Header";
import { Card, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { FunnelCanvas } from "@/components/funnel";
import {
  getFunnel,
  listSteps,
  listEdges,
  getMetrics,
  syncMetrics,
  captureScreenshot,
  findVturbPlayerId,
  saveStep,
} from "@/api/client";
import type { Funnel, FunnelStep, FunnelEdge, StepMetric } from "@/types";
import { cn } from "@/lib/cn";
import { SourceSelector, useDataSource } from "@/components/common/SourceSelector";
import { ClarityLiveView } from "@/components/live/ClarityLiveView";

// A tela não tem seletor de período próprio — "all" é o mais honesto: pro
// rastreador, os snapshots diários só existem desde que o agendador passou a
// rodar, então "tudo que existe" já é um recorte natural, não escondido; pro
// Clarity/VTurb, é o mesmo histórico completo que a rota já devolvia antes de
// aceitar período.
const FUNNEL_VIEW_PERIOD = "all" as const;

export function FunnelViewPage() {
  const { id } = useParams<{ id: string }>();
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [edges, setEdges] = useState<FunnelEdge[]>([]);
  const [metrics, setMetrics] = useState<StepMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { source, setSource } = useDataSource();

  const fetchMetrics = useCallback(
    (funnelId: string) => getMetrics(funnelId, source, FUNNEL_VIEW_PERIOD),
    [source]
  );

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getFunnel(id), listSteps(id), listEdges(id), fetchMetrics(id)])
      .then(([f, s, e, m]) => {
        setFunnel(f);
        setSteps(s);
        setEdges(e);
        setMetrics(m);
      })
      .finally(() => setLoading(false));
  }, [id, fetchMetrics]);

  // Métricas por etapa (leitura local, sem custo de cota externa) atualizam
  // sozinhas em segundo plano — sem isso a tela só mudava quando alguém
  // apertava "Sincronizar" ou trocava de página e voltava.
  const refreshMetrics = useCallback(() => {
    if (!id) return;
    fetchMetrics(id).then(setMetrics);
  }, [id, fetchMetrics]);

  // `isPolling` é estado, não uma checagem só no instante em que o efeito
  // monta — sem isso, um intervalo já em andamento continuava disparando
  // depois da aba ir pro fundo, porque nada o parava de novo.
  const [isPolling, setIsPolling] = useState(
    document.visibilityState === "visible"
  );

  useEffect(() => {
    const h = () => setIsPolling(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  useEffect(() => {
    if (!isPolling) return;
    const i = setInterval(refreshMetrics, 30000);
    return () => clearInterval(i);
  }, [isPolling, refreshMetrics]);

  // Além das métricas, "Sincronizar" também atualiza print e player id do
  // VTurb de cada etapa com URL — sem isso o usuário tinha que abrir o
  // Ateliê e refazer isso etapa por etapa toda vez que a VSL mudava.
  const syncScreenshotsAndPlayerIds = useCallback(
    async (funnelId: string, currentSteps: FunnelStep[]) => {
      const targets = currentSteps.filter((s) => s.url && s.url.trim());
      const updated = await Promise.all(
        targets.map(async (s) => {
          const shot = await captureScreenshot(s.url, s.id);
          let playerId = s.playerId;
          if (!playerId) {
            const lookup = await findVturbPlayerId(s.url);
            if (lookup.ok && lookup.playerId) playerId = lookup.playerId;
          }
          const screenshotUrl = shot.ok ? shot.screenshotUrl ?? s.screenshotUrl : s.screenshotUrl;
          if (screenshotUrl === s.screenshotUrl && playerId === s.playerId) return s;
          return saveStep(funnelId, { ...s, screenshotUrl, playerId });
        })
      );
      if (updated.length === 0) return;
      setSteps((prev) =>
        prev.map((s) => updated.find((u) => u.id === s.id) ?? s)
      );
    },
    []
  );

  const handleSync = async () => {
    if (!id) return;
    setSyncing(true);
    // O rastreador não tem o que "sincronizar" — ele já grava sozinho.
    // Sincronizar é só coisa de Clarity/VTurb (puxada manual sob cota).
    if (source !== "tracker") await syncMetrics(id);
    await syncScreenshotsAndPlayerIds(id, steps);
    const m = await fetchMetrics(id);
    setMetrics(m);
    setSyncing(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner size={32} />
      </div>
    );
  }

  if (!funnel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-semibold">Funil não encontrado</h2>
          <Link to="/funnels" className="text-primary hover:underline mt-2 inline-block">
            Voltar à lista
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header
        title={funnel.name}
        subtitle={`Slug: ${funnel.slug} · ${steps.length} etapas`}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SourceSelector value={source} onChange={setSource} />
            <Link to={`/funnel/${funnel.id}/metrics`}>
              <Button variant="outline" size="sm">
                <BarChart3 size={14} />
                Ver Métricas
              </Button>
            </Link>
            <Link to={`/funnel/${funnel.id}/edit`}>
              <Button variant="outline" size="sm">
                <Edit size={14} />
                Editar
              </Button>
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshCw size={14} className={cn(syncing && "animate-spin")} />
              {syncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
          </div>
        }
      />

      <main className="space-y-4 p-4">
        {/* O canvas é desenhado com os números do nosso rastreador. Em "Clarity"
            ele sai de cena em vez de ficar exibindo métrica de outra fonte com
            a legenda desta. */}
        {source !== "clarity" && (
          <Card className="h-full">
            <CardContent className="p-0">
              <FunnelCanvas
                funnel={funnel}
                steps={steps}
                edges={edges}
                metrics={metrics}
                readOnly
                onSync={handleSync}
                onEdit={() => window.location.href = `/funnel/${funnel.id}/edit`}
              />
            </CardContent>
          </Card>
        )}

        {source !== "tracker" && <ClarityLiveView funnelId={funnel.id} />}
      </main>
    </div>
  );
}