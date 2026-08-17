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

export interface AtelierEdgeData {
  condition: EdgeCondition;
  label?: string;
  conversionRate?: number;
  sourceVisitors?: number;
  targetVisitors?: number;
  onPick?: (edgeId: string) => void;
}

export function AtelierEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  selected,
  data,
}: EdgeProps<AtelierEdgeData>) {
  const condition = data?.condition ?? "default";
  const rate = data?.conversionRate;
  const hasRate = typeof rate === "number" && Number.isFinite(rate);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  });

  // Com métrica quem manda na cor é a conversão; sem métrica, o tipo da seta.
  const stroke = hasRate
    ? conversionColor(rate)
    : EDGE_CONDITION_COLOR[condition];

  const typeLabel = data?.label || EDGE_CONDITION_LABEL[condition];

  return (
    <>
      {/* Trilho invisível e grosso: dá área de clique confortável na seta. */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={18}
        style={{ cursor: "pointer" }}
        onClick={() => data?.onPick?.(id)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke,
          strokeWidth: selected ? 3.5 : hasRate ? 2.5 : 2,
          strokeDasharray: EDGE_CONDITION_DASH[condition],
        }}
      />

      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => data?.onPick?.(id)}
          className="nodrag nopan absolute flex flex-col items-center gap-0.5"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          {hasRate ? (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-xs font-bold shadow-lg",
                "bg-slate-900",
                conversionChip(rate)
              )}
            >
              {rate.toFixed(1)}%
            </span>
          ) : (
            <span
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium shadow-lg"
              style={{
                borderColor: stroke,
                color: stroke,
                backgroundColor: "rgb(15 23 42 / 0.95)",
              }}
            >
              {typeLabel}
            </span>
          )}

          {hasRate &&
            data?.sourceVisitors !== undefined &&
            data?.targetVisitors !== undefined && (
              <span className="whitespace-nowrap rounded border border-slate-700 bg-slate-900/95 px-1.5 py-px text-[10px] text-slate-400 shadow">
                {data.sourceVisitors.toLocaleString("pt-BR")} →{" "}
                {data.targetVisitors.toLocaleString("pt-BR")}
              </span>
            )}

          {hasRate && condition !== "default" && (
            <span
              className="whitespace-nowrap rounded border px-1.5 py-px text-[10px] font-medium shadow"
              style={{
                borderColor: EDGE_CONDITION_COLOR[condition],
                color: EDGE_CONDITION_COLOR[condition],
                backgroundColor: "rgb(15 23 42 / 0.95)",
              }}
            >
              {typeLabel}
            </span>
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
