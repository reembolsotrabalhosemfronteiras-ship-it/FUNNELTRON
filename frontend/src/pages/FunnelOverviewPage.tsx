import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowClockwise, ChartBar, PencilSimple, Eye } from "@phosphor-icons/react";
import { Header } from "@/components/common/Header";
import { Card, CardContent } from "@/components/common/Card";
import { Button } from "@/components/common/Button";
import { Spinner } from "@/components/common/Spinner";
import { StatusBadge } from "@/components/common/Badge";
import { FunnelCanvas } from "@/components/funnel";
import { conversionColor } from "@/lib/conversion";
import { computeStats } from "@/lib/funnelStats";
import {
  listFunnels,
  listSteps,
  listEdges,
  getMetrics,
  syncMetrics,
  getFunnelTicket,
} from "@/api/client";
import type { Funnel, FunnelStep, FunnelEdge, StepMetric } from "@/types";

interface Row {
  funnel: Funnel;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  metrics: StepMetric[];
  avgRate: number;
}

export function FunnelOverviewPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    const funnels = (await listFunnels()).filter((f) => (f.kind ?? "front") === "front");
    const built = await Promise.all(
      funnels.map(async (funnel) => {
        const [steps, edges, metrics, ticket] = await Promise.all([
          listSteps(funnel.id),
          listEdges(funnel.id),
          getMetrics(funnel.id, "tracker", "30d"),
          getFunnelTicket(funnel.id, "30d"),
        ]);
        const s = computeStats(funnel, steps, metrics, ticket.salesCount);
        return { funnel, steps, edges, metrics, avgRate: s.avgRate } satisfies Row;
      })
    );
    setRows(built);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const syncAll = async () => {
    setSyncing(true);
    try {
      await Promise.all(rows.map((r) => syncMetrics(r.funnel.id)));
      await load();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Header
        title="Visão dos funis"
        subtitle={`${rows.length} funis · fluxo e conversão etapa a etapa`}
        actions={
          <Button variant="secondary" size="sm" onClick={syncAll} disabled={syncing}>
            <ArrowClockwise size={14} className={syncing ? "animate-spin" : ""} />
            Sincronizar tudo
          </Button>
        }
      />

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner size={32} />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
          <Eye size={38} />
          <p className="mt-2 text-sm">Nenhum funil de front cadastrado.</p>
        </div>
      ) : (
        <main className="flex flex-col gap-[18px] p-4 md:p-7">
          {rows.map(({ funnel, steps, edges, metrics, avgRate }) => (
            <Card key={funnel.id} className="overflow-hidden !p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-[18px] py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="m-0 text-[15px] font-semibold">{funnel.name}</p>
                    <StatusBadge status={funnel.status} />
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    {funnel.slug} · {steps.length} etapas · conv. funil{" "}
                    <span className="font-semibold" style={{ color: conversionColor(avgRate) }}>
                      {avgRate.toFixed(1)}%
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link to={`/funnel/${funnel.id}/metrics`}>
                    <Button variant="secondary" size="sm">
                      <ChartBar size={14} />
                      Ver métricas
                    </Button>
                  </Link>
                  <Link to={`/funnel/${funnel.id}/edit`}>
                    <Button size="sm">
                      <PencilSimple size={14} />
                      Editar funil
                    </Button>
                  </Link>
                </div>
              </div>
              <CardContent className="!p-0">
                <div style={{ height: 360 }}>
                  <FunnelCanvas
                    funnel={funnel}
                    steps={steps}
                    edges={edges}
                    metrics={metrics}
                    readOnly
                  />
                </div>
              </CardContent>
            </Card>
          ))}
        </main>
      )}
    </div>
  );
}
