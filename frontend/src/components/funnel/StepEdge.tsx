import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "reactflow";
import { cn } from "@/lib/cn";
import { conversionColor, conversionChip } from "@/lib/conversion";
import {
  EDGE_CONDITION_COLOR,
  EDGE_CONDITION_DASH,
  EDGE_CONDITION_LABEL,
} from "@/lib/edgeStyle";
import type { EdgeCondition } from "@/types";

export interface StepEdgeData {
  label?: string;
  condition: EdgeCondition;
  /** Conversão página → página, já calculada pelo canvas. */
  conversionRate?: number;
  sourceVisitors?: number;
  targetVisitors?: number;
  /** Repassado do canvas — "live" liga a animação de bolinha de luz. */
  variant?: "dark" | "light" | "live";
  /** Quantas bolinhas de luz emitir (tráfego na aresta). Só usado no live. */
  pulseCount?: number;
}

/**
 * Bolinha de luz que viaja da página A até a página B ao longo do caminho da
 * aresta. Implementada com SMIL `<animateMotion>`: o atributo `path` recebe o
 * mesmo `edgePath` desenhado pela aresta, então a bolinha segue o traçado
 * exato (curvas inclusive). Várias bolinhas com `begin` escalonado dão a
 * sensação de fluxo contínuo de pessoas.
 *
 * O brilho é feito com um segundo círculo maior e translúcido, **não** com
 * `filter`: a região de um filtro SVG é calculada a partir da bounding box
 * estática do elemento, e a bolinha sai dessa caixa assim que começa a andar —
 * o resultado era a bolinha sumindo no meio do caminho.
 */
function LightBall({
  edgePath,
  begin,
  duration,
}: {
  edgePath: string;
  begin: string;
  duration: number;
}) {
  const motion = (
    <animateMotion
      dur={`${duration}s`}
      begin={begin}
      repeatCount="indefinite"
      path={edgePath}
      keyPoints="0;1"
      keyTimes="0;1"
      calcMode="linear"
    />
  );

  return (
    <g className="pointer-events-none">
      <g>
        <circle r={9} fill="url(#liveBallGlowGradient)" opacity={0.55} />
        <circle r={3.5} fill="#fecaca" />
        <circle r={2} fill="#fff" />
        {motion}
      </g>
    </g>
  );
}

export function StepEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<StepEdgeData>) {
  const condition = data?.condition ?? "default";
  const rate = data?.conversionRate;
  const hasRate = typeof rate === "number" && Number.isFinite(rate);
  const live = data?.variant === "live";

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const stroke = hasRate
    ? conversionColor(rate)
    : EDGE_CONDITION_COLOR[condition];
  const conditionLabel =
    data?.label || (condition === "default" ? "" : EDGE_CONDITION_LABEL[condition]);

  const ballCount = live ? Math.min(3, Math.max(1, data?.pulseCount ?? 1)) : 0;

  return (
    <>
      {/* Sem `filter` no traço: o desfoque gaussiano era recortado pela região
          do filtro e a linha aparecia partida/serrilhada em trechos longos. */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: live ? 3 : hasRate ? 2.5 : 2,
          strokeDasharray: EDGE_CONDITION_DASH[condition],
          ...(live ? { strokeLinecap: "round", opacity: 0.95 } : {}),
        }}
      />

      {live &&
        Array.from({ length: ballCount }).map((_, i) => (
          <LightBall
            key={i}
            edgePath={edgePath}
            begin={`${i * 0.9}s`}
            duration={2.4 + (i % 2) * 0.6}
          />
        ))}

      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-none flex flex-col items-center gap-0.5"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {hasRate && !live && (
            <div
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-bold shadow-sm",
                "bg-card",
                conversionChip(rate)
              )}
            >
              {rate.toFixed(1)}%
            </div>
          )}

          {hasRate &&
            !live &&
            data?.sourceVisitors !== undefined &&
            data?.targetVisitors !== undefined && (
              <div className="rounded bg-card/95 border border-border px-1.5 py-px text-[10px] text-muted-foreground whitespace-nowrap shadow-sm">
                {data.sourceVisitors.toLocaleString("pt-BR")} →{" "}
                {data.targetVisitors.toLocaleString("pt-BR")}
              </div>
            )}

          {conditionLabel && (
            <div className="rounded bg-card/95 border border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground whitespace-nowrap shadow-sm">
              {conditionLabel}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
