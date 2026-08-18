import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type OnConnectEnd,
  type OnConnectStart,
} from "reactflow";
import {
  ArrowLeft,
  Plus,
  Camera,
  Trash2,
  Check,
  Loader2,
  X,
  Link2,
  Save,
  Flag,
  Undo2,
} from "lucide-react";
import {
  AtelierNode,
  STEP_TYPE_ICON,
  STEP_TYPE_LABEL,
  type AtelierNodeData,
} from "@/components/funnel/AtelierNode";
import { AtelierEdge } from "@/components/funnel/AtelierEdge";
import { cn } from "@/lib/cn";
import { conversionColor, pageToPageRate } from "@/lib/conversion";
import {
  EDGE_CONDITIONS,
  EDGE_CONDITION_COLOR,
  EDGE_CONDITION_LABEL,
} from "@/lib/edgeStyle";
import {
  getFunnel,
  listFunnels,
  listSteps,
  listEdges,
  getStepMetrics,
  captureScreenshot,
  saveFunnelLayout,
} from "@/api/client";
import type {
  EdgeCondition,
  Funnel,
  FunnelEdge,
  FunnelStatus,
  FunnelStep,
  StepMetric,
  StepType,
} from "@/types";

const nodeTypes = { atelier: AtelierNode };
const edgeTypes = { atelier: AtelierEdge };

// Caixa de colisão de um card: a largura é fixa (w-[240px] + borda + ring), a
// altura é variável (print com aspect 16/10 + cabeçalho + rodapé + ring). Usamos
// um valor GENEROSO — errar para cima garante "nunca sobrepor", que é a regra.
const NODE_WIDTH = 246;
const NODE_HEIGHT = 232;

/**
 * Empurra `desired` para fora de qualquer caixa em `others`, mantendo-o o mais
 * próximo possível do ponto onde o usuário soltou. Resolve sobreposições uma a
 * uma pelo eixo de menor penetração (MTV), repetindo até ficar livre. Assim o
 * card nunca encosta em outro — e as setas continuam visíveis atrás dele.
 */
function resolveOverlap(
  desired: { x: number; y: number },
  others: { x: number; y: number }[],
  w = NODE_WIDTH,
  h = NODE_HEIGHT
): { x: number; y: number } {
  let pos = { x: Math.round(desired.x), y: Math.round(desired.y) };
  for (let iter = 0; iter < 24; iter++) {
    let moved = false;
    for (const o of others) {
      const overlapX = Math.min(pos.x + w, o.x + w) - Math.max(pos.x, o.x);
      const overlapY = Math.min(pos.y + h, o.y + h) - Math.max(pos.y, o.y);
      if (overlapX <= 0 || overlapY <= 0) continue;
      // Empurra pelo eixo de menor penetração, para fora do centro de `o`.
      if (overlapX < overlapY) {
        pos.x += pos.x + w / 2 < o.x + w / 2 ? -overlapX : overlapX;
      } else {
        pos.y += pos.y + h / 2 < o.y + h / 2 ? -overlapY : overlapY;
      }
      moved = true;
    }
    if (!moved) break;
  }
  return pos;
}

const STEP_TYPES: StepType[] = [
  "landing",
  "vsl",
  "checkout",
  "order_bump",
  "upsell",
  "downsell",
  "thank_you",
  "other",
  "sub_funnel",
];

const FUNNEL_STATUSES: {
  value: FunnelStatus;
  label: string;
  dot: string;
  activeClass: string;
}[] = [
  { value: "active", label: "Ativo", dot: "#22c55e", activeClass: "bg-emerald-500/20 text-emerald-300" },
  { value: "testing", label: "Em teste", dot: "#f59e0b", activeClass: "bg-amber-500/20 text-amber-300" },
  { value: "inactive", label: "Desativo", dot: "#94a3b8", activeClass: "bg-slate-600/40 text-slate-300" },
];

/**
 * Id de página/seta novo.
 *
 * Tem que ser UUID: as colunas `funnel_steps.id` e `funnel_edges.id` são do
 * tipo `uuid` no Postgres, e as chaves estrangeiras entre elas também. Ids
 * legíveis do tipo `s_msxbmveo_0` funcionavam enquanto tudo morava no
 * localStorage, mas o banco recusa na hora de salvar ("invalid input syntax
 * for type uuid") — e o erro só aparece ao apertar Salvar, depois de o funil
 * inteiro já ter sido desenhado.
 *
 * O prefixo continua no argumento só para as chamadas existentes não mudarem;
 * ele não entra mais no id.
 */
const newId = (_prefix: string) => crypto.randomUUID();

function Atelier({ funnelId }: { funnelId: string }) {
  const navigate = useNavigate();
  const { screenToFlowPosition } = useReactFlow();

  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [steps, setSteps] = useState<FunnelStep[]>([]);
  const [links, setLinks] = useState<FunnelEdge[]>([]);
  const [metrics, setMetrics] = useState<StepMetric[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [edgeMenu, setEdgeMenu] = useState<string | null>(null);
  const [capturingIds, setCapturingIds] = useState<string[]>([]);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Histórico de posições para o Ctrl+Z. Guarda só o que muda de lugar —
  // desfazer arrasto é o caso que dói, porque um empurrão sem querer não tem
  // como ser refeito na mão com precisão.
  type PositionSnapshot = Record<string, { x: number; y: number }>;
  const undoStack = useRef<PositionSnapshot[]>([]);
  const redoStack = useRef<PositionSnapshot[]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);

  const snapshotPositions = useCallback(
    (list: FunnelStep[]): PositionSnapshot =>
      Object.fromEntries(
        list.map((s) => [s.id, { x: s.positionX, y: s.positionY }])
      ),
    []
  );

  // Guarda de onde a seta saiu, para criar a página no ponto onde ela é solta.
  const connectStart = useRef<string | null>(null);
  // Marca se o arraste terminou numa ligação válida. Sem isso, soltar a seta
  // em cima de outro card criava a ligação E uma página fantasma.
  const connectionMade = useRef(false);

  // Funis de upsell disponíveis para embutir como bloco.
  const [upsellFunnels, setUpsellFunnels] = useState<Funnel[]>([]);
  const [upsellSizes, setUpsellSizes] = useState<Record<string, number>>({});

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getFunnel(funnelId),
      listSteps(funnelId),
      listEdges(funnelId),
      getStepMetrics(funnelId),
    ])
      .then(([f, s, e, m]) => {
        setFunnel(f);
        setSteps(s);
        setLinks(e);
        setMetrics(m);
      })
      .finally(() => setLoading(false));
  }, [funnelId]);

  useEffect(() => {
    listFunnels().then(async (all) => {
      // Um funil de upsell não pode embutir a si mesmo.
      const list = all.filter(
        (f) => f.kind === "upsell" && f.id !== funnelId
      );
      setUpsellFunnels(list);
      const sizes = await Promise.all(
        list.map(async (f) => [f.id, (await listSteps(f.id)).length] as const)
      );
      setUpsellSizes(Object.fromEntries(sizes));
    });
  }, [funnelId]);

  const selectedStep = steps.find((s) => s.id === selectedStepId) ?? null;

  // --- Salvar ---------------------------------------------------------------

  const save = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { savedAt } = await saveFunnelLayout(
        funnelId,
        steps,
        links,
        funnel?.status,
        funnel?.conversionGoalStepId
      );
      setSavedAt(savedAt);
      setDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }, [funnelId, steps, links, funnel?.status, funnel?.conversionGoalStepId]);

  const setStatus = useCallback((status: FunnelStatus) => {
    setFunnel((f) => (f ? { ...f, status } : f));
    setDirty(true);
  }, []);

  /**
   * Marca (ou desmarca) a página que encerra a medição de conversão de compra.
   * Num funil com upsell, o fim do front raramente é a última página do fluxo.
   */
  const toggleGoal = useCallback((stepId: string) => {
    setFunnel((f) =>
      f
        ? {
            ...f,
            conversionGoalStepId:
              f.conversionGoalStepId === stepId ? null : stepId,
          }
        : f
    );
    setDirty(true);
  }, []);

  // Ctrl+S / Cmd+S salva sem tirar a mão do teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !saving) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, saving, save]);

  // Fechar a aba com trabalho pendente pede confirmação do navegador.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const leaveAtelier = useCallback(() => {
    if (
      dirty &&
      !window.confirm("Você tem alterações não salvas. Sair mesmo assim?")
    ) {
      return;
    }
    navigate(`/funnel/${funnelId}`);
  }, [dirty, funnelId, navigate]);

  // --- Ações sobre páginas -------------------------------------------------

  const addStep = useCallback(
    (position: { x: number; y: number }, type: StepType = "other") => {
      // Respeita a regra "nunca sobrepor": afasta o novo card dos existentes.
      const safePos = resolveOverlap(position, steps.map((s) => ({
        x: s.positionX,
        y: s.positionY,
      })));
      const step: FunnelStep = {
        id: newId("s"),
        funnelId,
        label: "Nova página",
        url: "",
        type,
        positionX: safePos.x,
        positionY: safePos.y,
        parentStepId: null,
        orderIndex: steps.length,
        screenshotUrl: null,
      };
      setSteps((prev) => [...prev, step]);
      setSelectedStepId(step.id);
      setDirty(true);
      return step;
    },
    [funnelId, steps.length, steps]
  );

  const patchStep = useCallback((id: string, patch: Partial<FunnelStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setDirty(true);
  }, []);

  const removeStep = useCallback((id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
    setLinks((prev) =>
      prev.filter((e) => e.sourceStepId !== id && e.targetStepId !== id)
    );
    setSelectedStepId(null);
    setDirty(true);
  }, []);

  /** Puxa o print da URL. Sem backend de captura, avisa em vez de falhar mudo. */
  const grabScreenshot = useCallback(
    async (stepId: string, url: string) => {
      if (!url.trim()) return;
      setCapturingIds((prev) => [...prev, stepId]);
      const result = await captureScreenshot(url.trim(), stepId);
      setCapturingIds((prev) => prev.filter((i) => i !== stepId));
      if (result.ok && result.screenshotUrl) {
        patchStep(stepId, { screenshotUrl: result.screenshotUrl });
        setCaptureError(null);
      } else {
        setCaptureError(
          result.reason ??
            "Não consegui capturar o print. Cole uma imagem no painel da direita."
        );
      }
    },
    [patchStep]
  );

  // --- Ações sobre setas ---------------------------------------------------

  const setEdgeCondition = useCallback(
    (edgeId: string, condition: EdgeCondition) => {
      setLinks((prev) =>
        prev.map((e) => (e.id === edgeId ? { ...e, condition } : e))
      );
      setDirty(true);
    },
    []
  );

  const removeEdge = useCallback((edgeId: string) => {
    setLinks((prev) => prev.filter((e) => e.id !== edgeId));
    setEdgeMenu(null);
    setDirty(true);
  }, []);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target || conn.source === conn.target) return;
      connectionMade.current = true;

      // Não duplicar uma ligação que já existe entre as mesmas duas páginas.
      setLinks((prev) => {
        const exists = prev.some(
          (e) =>
            e.sourceStepId === conn.source && e.targetStepId === conn.target
        );
        if (exists) return prev;
        return [
          ...prev,
          {
            id: newId("e"),
            funnelId,
            sourceStepId: conn.source!,
            targetStepId: conn.target!,
            condition: "default",
            label: "",
          },
        ];
      });
      setDirty(true);
    },
    [funnelId]
  );

  const onConnectStart: OnConnectStart = useCallback((_, params) => {
    connectStart.current = params.nodeId ?? null;
    connectionMade.current = false;
  }, []);

  /**
   * Soltar a seta no vazio cria a próxima página ali mesmo e já liga — é o
   * fluxo "puxo a seta, depois digo que página é essa".
   */
  const onConnectEnd: OnConnectEnd = useCallback(
    (event) => {
      const sourceId = connectStart.current;
      const linked = connectionMade.current;
      connectStart.current = null;
      connectionMade.current = false;

      // Já ligou em alguma página existente: nada a criar.
      if (!sourceId || linked) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Soltar em cima de um card (mesmo sem acertar a bolinha) não cria página.
      if (target.closest(".react-flow__node")) return;
      if (!target.classList.contains("react-flow__pane")) return;

      const point =
        "clientX" in event
          ? { x: event.clientX, y: event.clientY }
          : { x: event.touches[0].clientX, y: event.touches[0].clientY };

      const position = screenToFlowPosition(point);

      // Último cinto de segurança: se o ponto cair sobre um card existente,
      // é ligação mal-sucedida, não pedido de página nova.
      const overExisting = steps.some(
        (s) =>
          position.x >= s.positionX &&
          position.x <= s.positionX + 240 &&
          position.y >= s.positionY &&
          position.y <= s.positionY + 240
      );
      if (overExisting) return;
      // Centraliza o card novo no cursor (card tem ~240px de largura) e já o
      // afasta de qualquer card existente (regra "nunca sobrepor").
      const step = addStep({ x: position.x - 120, y: position.y - 60 });

      setLinks((prev) => [
        ...prev,
        {
          id: newId("e"),
          funnelId,
          sourceStepId: sourceId,
          targetStepId: step.id,
          condition: "default",
          label: "",
        },
      ]);
    },
    [addStep, funnelId, screenToFlowPosition, steps]
  );

  // --- steps/links → React Flow -------------------------------------------

  const flowNodes: Node<AtelierNodeData>[] = useMemo(
    () =>
      steps.map((step) => ({
        id: step.id,
        type: "atelier",
        position: { x: step.positionX, y: step.positionY },
        data: {
          ...step,
          metric: metrics.find((m) => m.stepId === step.id) ?? null,
          capturing: capturingIds.includes(step.id),
          isGoal: funnel?.conversionGoalStepId === step.id,
          subFunnel: step.subFunnelId
            ? {
                name:
                  upsellFunnels.find((f) => f.id === step.subFunnelId)?.name ??
                  "funil removido",
                stepCount: upsellSizes[step.subFunnelId] ?? 0,
              }
            : null,
          onOpen: setSelectedStepId,
        },
        selected: step.id === selectedStepId,
      })),
    [
      steps,
      metrics,
      capturingIds,
      selectedStepId,
      funnel?.conversionGoalStepId,
      upsellFunnels,
      upsellSizes,
    ]
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      links.map((edge) => {
        const sourceMetric = metrics.find((m) => m.stepId === edge.sourceStepId);
        const targetMetric = metrics.find((m) => m.stepId === edge.targetStepId);
        const conversionRate = pageToPageRate(
          sourceMetric?.visitors,
          targetMetric?.visitors
        );
        const color =
          conversionRate !== undefined
            ? conversionColor(conversionRate)
            : EDGE_CONDITION_COLOR[edge.condition];

        return {
          id: edge.id,
          source: edge.sourceStepId,
          target: edge.targetStepId,
          type: "atelier",
          data: {
            condition: edge.condition,
            label: edge.label,
            conversionRate,
            sourceVisitors: sourceMetric?.visitors,
            targetVisitors: targetMetric?.visitors,
            onPick: setEdgeMenu,
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color,
          },
        };
      }),
    [links, metrics]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flowEdges);

  useEffect(() => setNodes(flowNodes), [flowNodes, setNodes]);
  useEffect(() => setEdges(flowEdges), [flowEdges, setEdges]);

  // Antes de mover, fotografa onde tudo estava — é o que o Ctrl+Z restaura.
  const handleNodeDragStart = useCallback(() => {
    undoStack.current.push(snapshotPositions(steps));
    // Limite de 50: histórico infinito só ocupa memória.
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    setHistoryDepth(undoStack.current.length);
  }, [steps, snapshotPositions]);

  // Arrastar o card grava a posição de volta no step. Se soltar em cima de
  // outro, resolvemos a sobreposição antes de salvar — nunca encosta.
  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const others = steps
        .filter((s) => s.id !== node.id)
        .map((s) => ({ x: s.positionX, y: s.positionY }));
      const pos = resolveOverlap(node.position, others);
      patchStep(node.id, {
        positionX: pos.x,
        positionY: pos.y,
      });
    },
    [patchStep, steps]
  );

  const applySnapshot = useCallback((snap: PositionSnapshot) => {
    setSteps((prev) =>
      prev.map((s) =>
        snap[s.id]
          ? { ...s, positionX: snap[s.id].x, positionY: snap[s.id].y }
          : s
      )
    );
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(snapshotPositions(steps));
    applySnapshot(previous);
    setHistoryDepth(undoStack.current.length);
  }, [steps, snapshotPositions, applySnapshot]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(snapshotPositions(steps));
    applySnapshot(next);
    setHistoryDepth(undoStack.current.length);
  }, [steps, snapshotPositions, applySnapshot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      // Não sequestrar o atalho enquanto se digita num campo do inspector.
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;

      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData("application/funnel-step-type");
      if (!type) return;
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const step = addStep({ x: position.x - 120, y: position.y - 60 }, type as StepType);
      patchStep(step.id, { label: STEP_TYPE_LABEL[type as StepType] });
    },
    [addStep, patchStep, screenToFlowPosition]
  );

  const menuEdge = links.find((e) => e.id === edgeMenu) ?? null;

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-sky-400" size={28} />
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onNodeClick={(_, node) => setSelectedStepId(node.id)}
        onPaneClick={() => {
          setSelectedStepId(null);
          setEdgeMenu(null);
        }}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.1}
        maxZoom={2}
        deleteKeyCode={["Backspace", "Delete"]}
        connectionRadius={30}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color="#334155"
          gap={26}
          size={1.6}
        />
        <Controls
          showInteractive={false}
          className="!bottom-4 !left-1/2 !flex !-translate-x-1/2 !flex-row !rounded-lg !border !border-slate-700 !bg-slate-900/95 !shadow-xl [&>button]:!border-slate-700 [&>button]:!bg-transparent [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-800"
        />
        <MiniMap
          pannable
          zoomable
          className="!bottom-4 !right-4 !rounded-lg !border !border-slate-700 !bg-slate-900"
          maskColor="rgba(2, 6, 23, 0.75)"
          nodeColor={(n) => {
            const rate = (n.data as AtelierNodeData)?.metric?.conversionRate;
            return typeof rate === "number" ? conversionColor(rate) : "#475569";
          }}
        />
      </ReactFlow>

      <TopBar
        funnel={funnel}
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        saveError={saveError}
        stepCount={steps.length}
        canUndo={historyDepth > 0}
        onUndo={undo}
        onBack={leaveAtelier}
        onSave={save}
        onStatusChange={setStatus}
      />

      <Palette onAdd={(type) => {
        const step = addStep({ x: 0, y: 0 }, type);
        patchStep(step.id, { label: STEP_TYPE_LABEL[type] });
      }} />

      <ArrowLegend />

      {menuEdge && (
        <EdgeTypeMenu
          edge={menuEdge}
          onPick={(condition) => {
            setEdgeCondition(menuEdge.id, condition);
            setEdgeMenu(null);
          }}
          onDelete={() => removeEdge(menuEdge.id)}
          onClose={() => setEdgeMenu(null)}
        />
      )}

      {selectedStep && (
        <Inspector
          step={selectedStep}
          metric={metrics.find((m) => m.stepId === selectedStep.id) ?? null}
          capturing={capturingIds.includes(selectedStep.id)}
          captureError={captureError}
          upsellFunnels={upsellFunnels}
          upsellSizes={upsellSizes}
          isGoal={funnel?.conversionGoalStepId === selectedStep.id}
          onPatch={(patch) => patchStep(selectedStep.id, patch)}
          onCapture={(url) => grabScreenshot(selectedStep.id, url)}
          onToggleGoal={() => toggleGoal(selectedStep.id)}
          onDelete={() => removeStep(selectedStep.id)}
          onClose={() => setSelectedStepId(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painéis flutuantes
// ---------------------------------------------------------------------------

function TopBar({
  funnel,
  dirty,
  saving,
  savedAt,
  saveError,
  stepCount,
  canUndo,
  onUndo,
  onBack,
  onSave,
  onStatusChange,
}: {
  funnel: Funnel | null;
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  saveError: string | null;
  stepCount: number;
  canUndo: boolean;
  onUndo: () => void;
  onBack: () => void;
  onSave: () => void;
  onStatusChange: (status: FunnelStatus) => void;
}) {
  const savedLabel = savedAt
    ? `salvo ${new Date(savedAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "sem alterações";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex flex-col items-center gap-1.5 px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-2xl backdrop-blur">
        <button
          onClick={onBack}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100"
          title="Voltar ao funil"
        >
          <ArrowLeft size={16} />
        </button>

        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="Desfazer movimento (Ctrl+Z)"
          className={cn(
            "rounded-lg p-1.5 transition-colors",
            canUndo
              ? "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              : "cursor-not-allowed text-slate-700"
          )}
        >
          <Undo2 size={16} />
        </button>

        <div className="h-5 w-px bg-slate-700" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-100">
            {funnel?.name ?? "Funil"}
          </p>
          <p className="text-[11px] text-slate-500">
            {stepCount} {stepCount === 1 ? "página" : "páginas"} no ateliê
          </p>
        </div>
        <div className="h-5 w-px bg-slate-700" />

        <div className="flex items-center gap-0.5 rounded-lg bg-slate-800 p-0.5">
          {FUNNEL_STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => onStatusChange(s.value)}
              title={`Marcar funil como ${s.label.toLowerCase()}`}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                funnel?.status === s.value
                  ? `${s.activeClass} shadow-sm`
                  : "text-slate-500 hover:text-slate-300"
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: s.dot }}
              />
              {s.label}
            </button>
          ))}
        </div>

        <div className="h-5 w-px bg-slate-700" />
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
            dirty
              ? "bg-amber-400/15 text-amber-300"
              : "bg-emerald-400/15 text-emerald-300"
          )}
        >
          {dirty ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              não salvo
            </>
          ) : (
            <>
              <Check size={12} />
              {savedLabel}
            </>
          )}
        </span>

        <button
          onClick={onSave}
          disabled={!dirty || saving}
          title="Salvar funil (Ctrl+S)"
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
            !dirty || saving
              ? "cursor-not-allowed bg-slate-800 text-slate-500"
              : "bg-sky-600 text-white hover:bg-sky-500"
          )}
        >
          {saving ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              salvando…
            </>
          ) : (
            <>
              <Save size={13} />
              Salvar
            </>
          )}
        </button>
      </div>

      {saveError && (
        <div className="pointer-events-auto max-w-md rounded-lg border border-red-500/40 bg-red-950/90 px-3 py-1.5 text-[11px] text-red-300 shadow-xl backdrop-blur">
          {saveError}
        </div>
      )}
    </div>
  );
}

function Palette({ onAdd }: { onAdd: (type: StepType) => void }) {
  return (
    <div className="absolute left-4 top-4 z-20 w-[190px] rounded-xl border border-slate-700 bg-slate-900/95 p-2.5 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center gap-1.5 px-0.5">
        <Plus size={13} className="text-sky-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Adicionar página
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {STEP_TYPES.map((type) => (
          <button
            key={type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("application/funnel-step-type", type);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={() => onAdd(type)}
            className="flex cursor-grab flex-col items-center gap-1 rounded-lg border border-slate-700/70 bg-slate-800/50 px-1.5 py-2 text-slate-300 transition-colors hover:border-sky-500 hover:bg-slate-800 hover:text-slate-100 active:cursor-grabbing"
          >
            <span className="text-base leading-none">{STEP_TYPE_ICON[type]}</span>
            <span className="text-[10px] leading-tight">
              {STEP_TYPE_LABEL[type]}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-2 px-0.5 text-[10px] leading-snug text-slate-500">
        Clique ou arraste para o canvas. Puxe a bolinha da direita de um card e
        solte no vazio para já criar a próxima página ligada.
      </p>
    </div>
  );
}

function ArrowLegend() {
  return (
    <div className="absolute bottom-4 left-4 z-20 rounded-xl border border-slate-700 bg-slate-900/95 p-2.5 shadow-2xl backdrop-blur">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Tipos de seta
      </p>
      <div className="space-y-1">
        {EDGE_CONDITIONS.map((c) => (
          <div key={c} className="flex items-center gap-2">
            <span
              className="h-0.5 w-6 rounded-full"
              style={{ backgroundColor: EDGE_CONDITION_COLOR[c] }}
            />
            <span className="text-[11px] text-slate-400">
              {EDGE_CONDITION_LABEL[c]}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 max-w-[170px] text-[10px] leading-snug text-slate-500">
        Com métrica, a seta assume a cor da conversão: verde ≥ 80%, amarelo ≥
        50%, vermelho abaixo.
      </p>
    </div>
  );
}

function EdgeTypeMenu({
  edge,
  onPick,
  onDelete,
  onClose,
}: {
  edge: FunnelEdge;
  onPick: (condition: EdgeCondition) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute left-1/2 top-20 z-30 w-[230px] -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-900/98 p-2.5 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          <Link2 size={12} className="text-sky-400" />
          Tipo da seta
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          <X size={13} />
        </button>
      </div>

      <div className="space-y-1">
        {EDGE_CONDITIONS.map((c) => (
          <button
            key={c}
            onClick={() => onPick(c)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
              edge.condition === c
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            )}
          >
            <span
              className="h-0.5 w-6 shrink-0 rounded-full"
              style={{ backgroundColor: EDGE_CONDITION_COLOR[c] }}
            />
            {EDGE_CONDITION_LABEL[c]}
            {edge.condition === c && (
              <Check size={12} className="ml-auto text-sky-400" />
            )}
          </button>
        ))}
      </div>

      <button
        onClick={onDelete}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-2 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
      >
        <Trash2 size={12} />
        Remover seta
      </button>
    </div>
  );
}

function Inspector({
  step,
  metric,
  capturing,
  captureError,
  upsellFunnels,
  upsellSizes,
  isGoal,
  onPatch,
  onCapture,
  onToggleGoal,
  onDelete,
  onClose,
}: {
  step: FunnelStep;
  metric: StepMetric | null;
  capturing: boolean;
  captureError: string | null;
  upsellFunnels: Funnel[];
  upsellSizes: Record<string, number>;
  isGoal: boolean;
  onPatch: (patch: Partial<FunnelStep>) => void;
  onCapture: (url: string) => void;
  onToggleGoal: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Colar print direto (Ctrl+V) enquanto o painel estiver aberto.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.items ?? [])]
        .find((i) => i.type.startsWith("image/"))
        ?.getAsFile();
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => onPatch({ screenshotUrl: String(reader.result) });
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onPatch]);

  const readFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onPatch({ screenshotUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <aside className="absolute right-4 top-4 z-20 flex max-h-[calc(100vh-2rem)] w-[290px] flex-col overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Esta página
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3.5 p-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Nome</label>
          <input
            value={step.label}
            onChange={(e) => onPatch({ label: e.target.value })}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">
            O que é esta página
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {STEP_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => onPatch({ type })}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] transition-colors",
                  step.type === type
                    ? "border-sky-500 bg-sky-500/15 text-sky-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-500 hover:text-slate-200"
                )}
              >
                <span className="leading-none">{STEP_TYPE_ICON[type]}</span>
                {STEP_TYPE_LABEL[type]}
              </button>
            ))}
          </div>
        </div>

        {step.type === "sub_funnel" ? (
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">
              Qual funil de upsell embutir
            </label>
            {upsellFunnels.length === 0 ? (
              <p className="rounded-lg border border-slate-700 bg-slate-800/40 p-2.5 text-[11px] leading-snug text-slate-500">
                Você ainda não tem funis de upsell. Crie um na aba "Funis de
                upsell" e ele aparecerá aqui.
              </p>
            ) : (
              <div className="space-y-1.5">
                {upsellFunnels.map((f) => (
                  <button
                    key={f.id}
                    onClick={() =>
                      onPatch({ subFunnelId: f.id, label: f.name })
                    }
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                      step.subFunnelId === f.id
                        ? "border-cyan-500 bg-cyan-500/15 text-cyan-100"
                        : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {f.name}
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        {upsellSizes[f.id] ?? 0} páginas
                      </span>
                    </span>
                    {step.subFunnelId === f.id && (
                      <Check size={13} className="shrink-0 text-cyan-400" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">
            URL da página
          </label>
          <input
            value={step.url}
            placeholder="https://meusite.com/vsl"
            onChange={(e) => onPatch({ url: e.target.value })}
            onBlur={(e) => {
              // Assim que a URL entra, já tenta puxar o print.
              if (e.target.value.trim() && !step.screenshotUrl) {
                onCapture(e.target.value);
              }
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500"
          />
          <button
            onClick={() => onCapture(step.url)}
            disabled={!step.url.trim() || capturing}
            className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
          >
            {capturing ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                capturando…
              </>
            ) : (
              <>
                <Camera size={12} />
                {step.screenshotUrl ? "Recapturar print" : "Puxar print da URL"}
              </>
            )}
          </button>

          {captureError && (
            <p className="mt-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] leading-snug text-amber-300">
              {captureError}
            </p>
          )}
        </div>
        )}

        {step.type === "vsl" && (
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">
              Player ID do VTurb
            </label>
            <input
              value={step.playerId ?? ""}
              placeholder="ex: 64f1a2b3c4d5e6f7"
              onChange={(e) =>
                onPatch({ playerId: e.target.value.trim() || null })
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-sky-500"
            />
            <p className="mt-1 text-[10px] leading-snug text-slate-500">
              Sem isso a página "Ao Vivo" não mostra quem está assistindo esta
              VSL agora.
            </p>
          </div>
        )}

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">
            Print da página
          </label>
          <div
            onDrop={(e) => {
              e.preventDefault();
              readFile(e.dataTransfer.files[0]);
            }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = "image/*";
              input.onchange = () => readFile(input.files?.[0]);
              input.click();
            }}
            className="cursor-pointer overflow-hidden rounded-lg border border-dashed border-slate-600 bg-slate-800/40 transition-colors hover:border-sky-500"
          >
            {step.screenshotUrl ? (
              <img
                src={step.screenshotUrl}
                alt={`Print de ${step.label}`}
                className="w-full object-cover object-top"
              />
            ) : (
              <p className="px-3 py-6 text-center text-[11px] leading-snug text-slate-500">
                Clique, arraste ou cole (Ctrl+V) um print aqui
              </p>
            )}
          </div>
          {step.screenshotUrl && (
            <button
              onClick={() => onPatch({ screenshotUrl: null })}
              className="mt-1 text-[11px] text-slate-500 hover:text-red-400"
            >
              remover print
            </button>
          )}
        </div>

        {/* Página que fecha a conta da conversão de compra. */}
        <button
          onClick={onToggleGoal}
          className={cn(
            "flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors",
            isGoal
              ? "border-emerald-500/50 bg-emerald-500/10"
              : "border-slate-700 bg-slate-800/40 hover:border-slate-500"
          )}
        >
          <Flag
            size={14}
            className={cn(
              "mt-0.5 shrink-0",
              isGoal ? "text-emerald-400" : "text-slate-500"
            )}
          />
          <span>
            <span
              className={cn(
                "block text-xs font-medium",
                isGoal ? "text-emerald-300" : "text-slate-300"
              )}
            >
              {isGoal
                ? "Fim da medição de conversão de compra"
                : "Marcar como fim da medição"}
            </span>
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
              A conversão de compra é medida da entrada do funil até esta
              página. Útil quando o front termina antes do upsell.
            </span>
          </span>
        </button>

        {metric && (
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Métricas · {metric.source}
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-sm font-bold text-slate-100">
                  {metric.visitors.toLocaleString("pt-BR")}
                </p>
                <p className="text-[10px] text-slate-500">visitas</p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-100">
                  {metric.conversions.toLocaleString("pt-BR")}
                </p>
                <p className="text-[10px] text-slate-500">conv.</p>
              </div>
              <div>
                <p
                  className="text-sm font-bold"
                  style={{ color: conversionColor(metric.conversionRate) }}
                >
                  {metric.conversionRate.toFixed(1)}%
                </p>
                <p className="text-[10px] text-slate-500">taxa</p>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={onDelete}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-2 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-500/10"
        >
          <Trash2 size={12} />
          Excluir página
        </button>
      </div>
    </aside>
  );
}

export function FunnelEditorPage() {
  const { id } = useParams<{ id: string }>();
  if (!id) return null;
  return (
    <ReactFlowProvider>
      <Atelier funnelId={id} />
    </ReactFlowProvider>
  );
}
