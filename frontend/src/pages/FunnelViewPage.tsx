import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, RefreshCw, Edit, Settings, BarChart3 } from "lucide-react";
import { Header } from "@/components/common/Header";
import { Card, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { FunnelCanvas } from "@/components/funnel";
import { getFunnel, listSteps, listEdges, getStepMetrics, syncMetrics } from "@/api/client";
import type { Funnel, FunnelStep, FunnelEdge, StepMetric } from "@/types";
import { cn } from "@/lib/cn";

export function FunnelViewPage() {
  const { id } = useParams<{ id: string }>();
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [edges, setEdges] = useState<FunnelEdge[]>([]);
  const [metrics, setMetrics] = useState<StepMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([getFunnel(id), listSteps(id), listEdges(id), getStepMetrics(id)])
      .then(([f, s, e, m]) => {
        setFunnel(f);
        setSteps(s);
        setEdges(e);
        setMetrics(m);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleSync = async () => {
    if (!id) return;
    setSyncing(true);
    await syncMetrics(id);
    const m = await getStepMetrics(id);
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
          <div className="flex items-center gap-2">
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

      <main className="p-4">
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
      </main>
    </div>
  );
}