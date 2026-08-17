import { useEffect, useMemo } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "reactflow";
import { AtelierNode } from "./AtelierNode";
import { StepEdge } from "./StepEdge";
import type { FunnelStep, FunnelEdge, StepMetric, Funnel } from "@/types";
import { resolveGoalStep } from "@/lib/funnelStats";
import { spreadSteps } from "@/lib/canvasLayout";
import { useTheme } from "@/components/common/Header";
import { cn } from "@/lib/cn";
import {
  conversionColor,
  pageToPageRate,
  CONVERSION_COLOR,
} from "@/lib/conversion";
import { EDGE_CONDITION_COLOR } from "@/lib/edgeStyle";

// MESMO componente do ateliê, só que na variante clara. Card com outra altura
// nas mesmas coordenadas produziria espaçamento diferente do desenhado.
const nodeTypes = { step: AtelierNode };
const edgeTypes = { step: StepEdge };

/** steps + edges + métricas → nós e arestas do React Flow. */
export function buildFlow(
  steps: FunnelStep[],
  edges: FunnelEdge[],
  metrics: StepMetric[],
  funnel?: Pick<Funnel, "conversionGoalStepId"> | null,
  variant?: "dark" | "light" | "live"
): { nodes: Node[]; flowEdges: Edge[] } {
  const goalStep = resolveGoalStep(funnel, steps);

  // Folga garantida na leitura: o ateliê deixa encostar um card no outro, mas
  // aqui o funil precisa se explicar sozinho. Só desloca o necessário, e não
  // toca no desenho salvo. Ver `lib/canvasLayout.ts`.
  const positions = spreadSteps(steps);

  const nodes: Node[] = steps.map((step) => ({
    id: step.id,
    type: "step",
    position: positions[step.id] ?? { x: step.positionX, y: step.positionY },
    // A métrica vai dentro de `data`: é o único canal que o React Flow
    // repassa ao componente do nó.
    data: {
      ...step,
      status: step.status ?? ("active" as const),
      metric: metrics.find((m) => m.stepId === step.id) ?? null,
      isGoal: goalStep?.id === step.id,
      variant: variant ?? "light",
    },
  }));

  const flowEdges: Edge[] = edges.map((edge) => {
    const sourceMetric = metrics.find((m) => m.stepId === edge.sourceStepId);
    const targetMetric = metrics.find((m) => m.stepId === edge.targetStepId);

    // Conversão página → página: quem chegou na origem vs. quem chegou no
    // destino. 100 visitantes → 50 visitantes = 50%.
    const conversionRate = pageToPageRate(
      sourceMetric?.visitors,
      targetMetric?.visitors
    );

    const strokeColor =
      conversionRate !== undefined
        ? conversionColor(conversionRate)
        : EDGE_CONDITION_COLOR[edge.condition];

    return {
      id: edge.id,
      source: edge.sourceStepId,
      target: edge.targetStepId,
      type: "step",
      data: {
        label: edge.label,
        condition: edge.condition,
        conversionRate,
        sourceVisitors: sourceMetric?.visitors,
        targetVisitors: targetMetric?.visitors,
        // Repassa variant para a aresta — usado no modo "live" para animações
        variant: variant ?? "light",
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        color: strokeColor,
      },
    };
  });

  return { nodes, flowEdges };
}

interface FunnelCanvasProps {
  funnel: Funnel;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  metrics: StepMetric[];
  readOnly?: boolean;
  variant?: "dark" | "light" | "live";
  onSync?: () => void;
  onEdit?: () => void;
}

function CanvasViewport({
  funnel,
  steps,
  edges,
  metrics,
  readOnly,
  variant,
}: {
  funnel?: Funnel | null;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  metrics: StepMetric[];
  readOnly: boolean;
  variant?: "dark" | "light" | "live";
}) {
  const { nodes: builtNodes, flowEdges } = useMemo(
    () => buildFlow(steps, edges, metrics, funnel, variant),
    [steps, edges, metrics, funnel, variant]
  );

  // Estado controlado pelo próprio React Flow. Passar arrays novos direto na
  // prop a cada render faz as arestas sumirem — elas dependem das dimensões
  // já medidas dos nós, que se perdem quando o store é reinicializado.
  const [nodes, setNodes, onNodesChange] = useNodesState(builtNodes);
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(flowEdges);
  const { fitView } = useReactFlow();
  const { dark } = useTheme();

  useEffect(() => {
    setNodes(builtNodes);
    setEdges(flowEdges);
    // Reencaixa depois que os nós forem medidos.
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 60);
    return () => clearTimeout(t);
  }, [builtNodes, flowEdges, setNodes, setEdges, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      onNodesChange={readOnly ? undefined : onNodesChange}
      onEdgesChange={readOnly ? undefined : onEdgesChange}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.15}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      {/* Cores cruas: o React Flow escreve isto em atributos de SVG, onde
          var(--x) do CSS não resolve. Por isso segue o tema pelo hook. */}
      <Background
        variant={BackgroundVariant.Dots}
        color={dark ? "#334155" : "#cbd5e1"}
        gap={22}
        size={1.5}
      />
      <Controls
        showInteractive={false}
        className={cn(
          "!rounded-lg !border !border-border !shadow-sm",
          "[&>button]:!border-border [&>button]:!bg-card [&>button]:!fill-foreground [&>button:hover]:!bg-muted"
        )}
      />
      <MiniMap
        pannable
        zoomable
        className="!rounded-lg !border !border-border"
        style={{ backgroundColor: dark ? "#0f172a" : "#ffffff" }}
        nodeColor={(node) => {
          const rate = (node.data as { metric?: StepMetric | null })?.metric
            ?.conversionRate;
          return typeof rate === "number" ? conversionColor(rate) : "#94a3b8";
        }}
        maskColor={dark ? "rgba(2, 6, 23, 0.7)" : "rgba(241, 245, 249, 0.6)"}
      />
    </ReactFlow>
  );
}

function ConversionLegend() {
  const items = [
    { label: "80% ou mais", color: CONVERSION_COLOR.high },
    { label: "50% a 80%", color: CONVERSION_COLOR.mid },
    { label: "abaixo de 50%", color: CONVERSION_COLOR.low },
  ];

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur">
      <span className="text-[11px] font-medium text-muted-foreground">
        Conversão
      </span>
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            className="h-2 w-4 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-[11px] text-muted-foreground">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

export function FunnelCanvas({
  funnel,
  steps,
  edges,
  metrics,
  readOnly = true,
  variant,
  onSync,
  onEdit,
}: FunnelCanvasProps) {
  if (steps.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center bg-muted/50 rounded-lg border border-dashed border-border">
        <div className="text-center p-8">
          <span className="text-5xl mb-4 block">📊</span>
          <h3 className="text-lg font-medium mb-1">Nenhuma etapa configurada</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Abra o ateliê e desenhe o funil arrastando as setas
          </p>
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-primary text-sm font-medium hover:underline"
            >
              Abrir ateliê de funil
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[600px] w-full rounded-lg border border-border bg-card overflow-hidden">
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        {onSync && (
          <button
            onClick={onSync}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shadow-sm"
          >
            <span className="text-base">🔄</span> Sincronizar
          </button>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <span className="text-base">✏️</span> Abrir ateliê
          </button>
        )}
      </div>

      <ReactFlowProvider>
        <CanvasViewport
          funnel={funnel}
          steps={steps}
          edges={edges}
          metrics={metrics}
          readOnly={readOnly}
          variant={variant}
        />
      </ReactFlowProvider>
      <ConversionLegend />
    </div>
  );
}
