import { useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
} from "reactflow";
import { LiveNode } from "./LiveNode";
import { StepEdge } from "./StepEdge";
import { buildFlow } from "./FunnelCanvas";
import type { Funnel, FunnelStep, FunnelEdge, StepMetric } from "@/types";
import { resolveGoalStep } from "@/lib/funnelStats";
import {
  spreadSteps,
  resolveBadgeSide,
  LIVE_BADGE_H,
} from "@/lib/canvasLayout";
import { useTheme } from "@/components/common/Header";
import {
  detectTransitions,
  newestEntryTime,
  pulseEdge,
} from "@/lib/livePulse";
import type { LiveStepData, LivePageEntry } from "@/api/client";

// Nós "ao vivo" usam o LiveNode (partículas de pessoas dentro do print) e as
// arestas usam o StepEdge na variante live (bolinha de luz viajando A→B).
const nodeTypes = { step: LiveNode };
const edgeTypes = { step: StepEdge };

interface LiveFunnelCanvasProps {
  funnel: Funnel;
  steps: FunnelStep[];
  edges: FunnelEdge[];
  /** Pessoas online por etapa — alimenta as partículas e o badge. */
  liveFlow: LiveStepData[];
  /** Log de entradas em página: é dele que saem os pulos animados nas setas. */
  entries?: LivePageEntry[];
  onOpen?: (stepId: string) => void;
}

function LiveViewport({
  funnel,
  steps,
  edges,
  liveFlow,
  entries,
  onOpen,
}: LiveFunnelCanvasProps) {
  const { fitView } = useReactFlow();
  const { dark } = useTheme();

  // Trocar de funil zera o marcador: os instantes são comparáveis entre funis,
  // e sem isso a primeira leitura do funil novo animaria o histórico inteiro.
  const pulseCursor = useRef<number | null>(null);
  useEffect(() => {
    pulseCursor.current = null;
  }, [funnel.id]);

  // Um pulo de verdade = uma bolinha. A primeira leitura só marca onde o log
  // estava: quem já tinha andado antes de a tela abrir não vira animação.
  useEffect(() => {
    if (!entries) return;
    const newest = newestEntryTime(entries);
    if (pulseCursor.current === null) {
      pulseCursor.current = newest;
      return;
    }

    const transicoes = detectTransitions(entries, pulseCursor.current);
    if (newest > pulseCursor.current) pulseCursor.current = newest;
    if (transicoes.length === 0) return;

    // Duas pessoas no mesmo trecho viram duas bolinhas na MESMA aresta, em
    // sequência — por isso agrupa antes de avisar.
    const porAresta = new Map<string, number>();
    for (const t of transicoes) {
      const aresta = edges.find(
        (e) => e.sourceStepId === t.from && e.targetStepId === t.to
      );
      // Pulo sem seta desenhada (ex.: entrou direto numa página do meio) não
      // tem por onde animar — o número do card já mostra que ela chegou.
      if (!aresta) continue;
      porAresta.set(aresta.id, (porAresta.get(aresta.id) ?? 0) + 1);
    }
    porAresta.forEach((n, id) => pulseEdge(id, n));
  }, [entries, edges]);

  // Mapa stepId → online. Memoizado pelos VALORES, não pelo array: o polling
  // devolve um array novo a cada 5s, quase sempre com os mesmos números, e
  // recriar o mapa refaria as arestas (e reiniciaria as bolinhas de luz) à toa.
  const onlineKey = useMemo(
    () =>
      liveFlow
        .map((l) => `${l.stepId}:${l.online}`)
        .sort()
        .join("|"),
    [liveFlow]
  );
  const onlineMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of liveFlow) map[l.stepId] = l.online;
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineKey]);

  const goalId = resolveGoalStep(funnel, steps)?.id;

  // Posições com folga garantida: o desenho salvo pode ter cards encostados
  // (o ateliê deixa), e aqui o número grande de pessoas ainda ocupa espaço
  // fora do card. `extraH` reserva essa faixa na conta da sobreposição.
  const positions = useMemo(
    () => spreadSteps(steps, { extraH: LIVE_BADGE_H }),
    [steps]
  );

  // De que lado o número de pessoas fica em cada card.
  const badgeSides = useMemo(
    () => resolveBadgeSide(steps, positions),
    [steps, positions]
  );

  // Nós: estrutura + posição (só muda quando o desenho muda).
  const layoutNodes = useMemo<Node[]>(
    () =>
      steps.map((step) => ({
        id: step.id,
        type: "step",
        position: positions[step.id] ?? {
          x: step.positionX,
          y: step.positionY,
        },
        data: {
          label: step.label,
          type: step.type,
          url: step.url,
          screenshotUrl: step.screenshotUrl,
          variant: "live" as const,
          isGoal: goalId === step.id,
          online: onlineMap[step.id] ?? 0,
          badgeSide: badgeSides[step.id] ?? "bottom",
          onOpen,
        },
      })),
    // online propositalmente FORA das deps: mudar só o número não remonta a
    // estrutura (evita "pulo" no fitView). O online é atualizado à parte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, funnel, goalId, positions, badgeSides, onOpen]
  );

  // Arestas: conversão página→página derivada do online (visual no live).
  const flowEdges = useMemo<Edge[]>(() => {
    const metrics: StepMetric[] = steps.map((s) => {
      const online = onlineMap[s.id] ?? 0;
      return {
        id: s.id,
        funnelId: funnel.id,
        stepId: s.id,
        date: new Date().toISOString(),
        visitors: online,
        conversions: 0,
        conversionRate: 0,
        source: "manual" as const,
      };
    });
    return buildFlow(steps, edges, metrics, funnel, "live").flowEdges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, edges, funnel, onlineMap]);

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  // Assinatura do desenho: o que de fato muda a aparência e a posição dos nós.
  // O polling pode devolver as MESMAS etapas em objetos novos; comparar por
  // identidade acharia que o funil mudou.
  const layoutKey = useMemo(
    () =>
      steps
        .map((s) => {
          const p = positions[s.id] ?? { x: s.positionX, y: s.positionY };
          return [
            s.id,
            s.label,
            s.type,
            s.url ?? "",
            s.screenshotUrl ?? "",
            p.x,
            p.y,
            badgeSides[s.id] ?? "bottom",
            goalId === s.id ? "goal" : "",
          ].join("~");
        })
        .join("|"),
    [steps, positions, badgeSides, goalId]
  );

  // Encaixa o funil centralizado quando o DESENHO muda (monta + edição no
  // ateliê). Trocar os nós zera as medidas que o React Flow tinha de cada card,
  // e o fitView seguinte enquadra caixas de tamanho zero — o painel escurecia a
  // cada ciclo de polling. Com a assinatura, só refaz quando algo mudou mesmo.
  const lastLayoutKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastLayoutKey.current === layoutKey) return;
    lastLayoutKey.current = layoutKey;
    setNodes(layoutNodes);
    const t = setTimeout(() => fitView({ padding: 0.25, duration: 300 }), 60);
    return () => clearTimeout(t);
    // layoutNodes acompanha layoutKey; a chave é quem decide se roda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, setNodes, fitView]);

  // Arestas: atualiza conversão/page→page quando o online muda.
  useEffect(() => {
    setEdges(flowEdges);
  }, [flowEdges, setEdges]);

  // Só o número de "online" mudou: atualiza o node sem remontar/refit.
  const lastOnline = useRef(onlineMap);
  useEffect(() => {
    const prev = lastOnline.current;
    let changed = false;
    for (const id in onlineMap) {
      if (prev[id] !== onlineMap[id]) {
        changed = true;
        break;
      }
    }
    for (const id in prev) {
      if (prev[id] !== onlineMap[id]) {
        changed = true;
        break;
      }
    }
    lastOnline.current = onlineMap;
    if (!changed) return;
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, online: onlineMap[n.id] ?? 0 },
      }))
    );
  }, [onlineMap, setNodes]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={rfEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      minZoom={0.2}
      maxZoom={1.2}
      // Painel fixo e centralizado: sem pan, sem zoom, sem scroll roubando.
      panOnDrag={false}
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomOnDoubleClick={false}
      preventScrolling={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        variant={BackgroundVariant.Dots}
        color={dark ? "#7f1d1d" : "#fca5a5"}
        gap={22}
        size={1.5}
      />
    </ReactFlow>
  );
}

export function LiveFunnelCanvas({
  funnel,
  steps,
  edges,
  liveFlow,
  entries,
  onOpen,
}: LiveFunnelCanvasProps) {
  if (steps.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border border-dashed border-border bg-slate-950">
        <div className="text-center p-8">
          <span className="text-5xl mb-4 block">📊</span>
          <h3 className="text-lg font-medium mb-1 text-slate-100">
            Nenhuma etapa configurada
          </h3>
          <p className="text-sm text-slate-400">
            Abra o ateliê e desenhe o funil para ver o fluxo ao vivo
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-lg border-2 border-red-500/50 bg-slate-950 shadow-[0_0_40px_-12px_rgba(239,68,68,0.5)]">
      {/* Fundo vermelho do painel ao vivo: brilho radial nos cantos, por baixo
          do canvas. `pointer-events-none` para não roubar clique dos nós. */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, rgba(239,68,68,0.22) 0%, rgba(239,68,68,0.08) 45%, transparent 75%)",
        }}
      />

      {/* Gradiente das bolinhas de luz das setas. Fica AQUI, uma vez só: se cada
          aresta declarasse o próprio <defs>, o mesmo id apareceria repetido no
          documento. */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <radialGradient id="liveBallGlowGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.9" />
            <stop offset="55%" stopColor="#ef4444" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>

      <span className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full border border-red-500/60 bg-red-950/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-red-300 backdrop-blur">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        ao vivo
      </span>

      <div className="relative z-[1] h-full w-full">
        <ReactFlowProvider>
          <LiveViewport
            funnel={funnel}
            steps={steps}
            edges={edges}
            liveFlow={liveFlow}
            entries={entries}
            onOpen={onOpen}
          />
        </ReactFlowProvider>
      </div>
    </div>
  );
}
