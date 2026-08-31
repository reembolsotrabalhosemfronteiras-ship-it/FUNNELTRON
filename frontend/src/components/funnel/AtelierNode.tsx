import { Handle, Position, type NodeProps } from "reactflow";
import {
  ImageBroken as ImageOff,
  PencilSimple as Pencil,
  ArrowSquareOut as ExternalLink,
  Package,
} from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { conversionChip } from "@/lib/conversion";
import type { FunnelStep, StepMetric, StepType } from "@/types";

export const STEP_TYPE_LABEL: Record<StepType, string> = {
  landing: "Landing",
  vsl: "VSL",
  checkout: "Checkout",
  upsell: "Upsell",
  downsell: "Downsell",
  order_bump: "Order Bump",
  thank_you: "Obrigado",
  other: "Outra",
  sub_funnel: "Funil de upsell",
};

export const STEP_TYPE_ICON: Record<StepType, string> = {
  landing: "🎯",
  vsl: "🎬",
  checkout: "💳",
  upsell: "⬆️",
  downsell: "⬇️",
  order_bump: "➕",
  thank_you: "✅",
  other: "📄",
  sub_funnel: "📦",
};

export type AtelierNodeData = FunnelStep & {
  metric?: StepMetric | null;
  capturing?: boolean;
  /** Página que encerra a medição de conversão de compra. */
  isGoal?: boolean;
  /** "dark" no ateliê, "light" nos previews. A GEOMETRIA é idêntica nos dois:
   *  mesma largura e mesmas alturas internas (print em formato retrato,
   *  como a tela de um celular), para o espaçamento salvo no ateliê
   *  aparecer igual em todo lugar. */
  variant?: "dark" | "light" | "live";
  /** Resumo do funil de upsell embutido, quando `type === "sub_funnel"`. */
  subFunnel?: { name: string; stepCount: number } | null;
  onOpen?: (stepId: string) => void;
};

export function AtelierNode({ id, data, selected }: NodeProps<AtelierNodeData>) {
  const {
    label,
    type,
    url,
    screenshotUrl,
    metric,
    capturing,
    isGoal,
    subFunnel,
    onOpen,
    variant = "dark",
  } = data;
  const light = variant === "light";
  const live = variant === "live";
  const isSubFunnel = type === "sub_funnel";

  return (
    <div
      className={cn(
        "group relative w-[180px] overflow-hidden rounded-xl border shadow-xl transition-all",
        light ? "bg-card" : "bg-slate-900/90 backdrop-blur",
        live && "bg-slate-900/90 backdrop-blur border-blue-500/50",
        selected
          ? "border-sky-400 ring-2 ring-sky-400/40"
          : light
          ? "border-border hover:border-muted-foreground/40"
          : "border-slate-700 hover:border-slate-500",
        isGoal && "ring-2 ring-emerald-400/60"
      )}
    >
      {isGoal && (
        <span className="absolute right-1.5 top-1.5 z-10 rounded bg-emerald-500 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white shadow">
          meta
        </span>
      )}
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          "!h-3 !w-3 !border-2 !bg-sky-400",
          light ? "!border-card" : "!border-slate-900"
        )}
      />

      {/* Cabeçalho */}
      <div
        className={cn(
          "flex items-center justify-between gap-2 border-b px-2.5 py-2",
          light ? "border-border" : "border-slate-700/80"
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-sm leading-none">{STEP_TYPE_ICON[type]}</span>
          <span
            className={cn(
              "truncate text-sm font-medium",
              light ? "text-foreground" : "text-slate-100"
            )}
          >
            {label}
          </span>
        </div>
        {onOpen && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpen(id);
            }}
            title="Editar página"
            className={cn(
              "shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100",
              light
                ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                : "text-slate-400 hover:bg-slate-700 hover:text-slate-100"
            )}
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {/* Print da página */}
      <div
        className={cn(
          "relative aspect-[9/16]",
          light ? "bg-muted" : "bg-slate-950"
        )}
      >
        {isSubFunnel ? (
          // Funil inteiro representado como um bloco só.
          <div
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1 px-3 text-center",
              light ? "bg-cyan-500/10" : "bg-cyan-500/10"
            )}
          >
            <Package size={22} className="text-cyan-400" />
            {subFunnel ? (
              <>
                <span
                  className={cn(
                    "line-clamp-2 text-xs font-medium",
                    light ? "text-foreground" : "text-slate-100"
                  )}
                >
                  {subFunnel.name}
                </span>
                <span className="text-[10px] text-cyan-400">
                  {subFunnel.stepCount}{" "}
                  {subFunnel.stepCount === 1 ? "página" : "páginas"} embutidas
                </span>
              </>
            ) : (
              <span className="text-[11px] text-amber-400">
                escolha qual funil de upsell
              </span>
            )}
          </div>
        ) : capturing ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-500">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
            <span className="text-[11px]">capturando print…</span>
          </div>
        ) : screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt={`Print de ${label}`}
            className="h-full w-full object-cover object-top"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div
            className={cn(
              "flex h-full flex-col items-center justify-center gap-1.5",
              light ? "text-muted-foreground" : "text-slate-600"
            )}
          >
            <ImageOff size={20} />
            <span className="text-[11px]">sem print</span>
          </div>
        )}

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute right-1.5 top-1.5 rounded-md p-1 opacity-0 transition-opacity hover:text-sky-400 group-hover:opacity-100",
              light ? "bg-card/90 text-muted-foreground" : "bg-slate-950/80 text-slate-300"
            )}
            title="Abrir página real"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* Rodapé: tipo + métrica ou pessoas online */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span
          className={cn(
            "truncate text-[11px] uppercase tracking-wide",
            light ? "text-muted-foreground" : "text-slate-500"
          )}
        >
          {STEP_TYPE_LABEL[type]}
        </span>
        {live && metric ? (
          <span
            className={cn(
              "flex shrink-0 items-center gap-1 rounded border border-blue-500/30 bg-blue-500/10 px-1.5 py-px text-[11px] font-semibold text-blue-400"
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
            {metric.visitors} online
          </span>
        ) : metric ? (
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-px text-[11px] font-semibold",
              conversionChip(metric.conversionRate)
            )}
          >
            {metric.visitors.toLocaleString("pt-BR")} ·{" "}
            {metric.conversionRate.toFixed(0)}%
          </span>
        ) : (
          <span
            className={cn(
              "shrink-0 text-[11px]",
              light ? "text-muted-foreground" : "text-slate-600"
            )}
          >
            sem dados
          </span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          "!h-3 !w-3 !border-2 !bg-sky-400",
          light ? "!border-card" : "!border-slate-900"
        )}
      />
    </div>
  );
}
