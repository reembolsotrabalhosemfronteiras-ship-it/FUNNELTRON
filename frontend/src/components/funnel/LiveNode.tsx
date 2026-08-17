import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { ImageOff, Pencil, ExternalLink, Package } from "lucide-react";
import { cn } from "@/lib/cn";
import { STEP_TYPE_LABEL, STEP_TYPE_ICON } from "./AtelierNode";
import type { FunnelStep, StepType } from "@/types";

export interface LiveNodeData {
  label: string;
  type: StepType;
  url?: string;
  screenshotUrl?: string;
  variant: "live";
  isGoal?: boolean;
  online?: number;
  /** Lado do número grande. Calculado pelo canvas para não cobrir outro card. */
  badgeSide?: "top" | "bottom";
  onOpen?: (stepId: string) => void;
}

/**
 * Nó do funil no modo "ao vivo". Igual ao AtelierNode na geometria, mas com o
 * número de pessoas ao vivo em destaque **fora** do card (acima ou abaixo,
 * conforme o canvas decide) e um véu vermelho sobre o print quando há gente.
 *
 * Já teve uma partícula por visitante flutuando dentro do print. Saiu: com 30
 * pessoas o print sumia atrás das bolinhas, e a contagem exata já está escrita
 * no número grande — a nuvem não dizia nada que o número não diga melhor.
 */
function LiveNodeBase({ id, data, selected }: NodeProps<LiveNodeData>) {
  const {
    label,
    type,
    url,
    screenshotUrl,
    isGoal,
    online = 0,
    badgeSide = "bottom",
    onOpen,
  } = data;
  const isSubFunnel = type === "sub_funnel";

  return (
    // Wrapper SEM overflow-hidden: o número grande vive fora do card. Ele é
    // `absolute`, então não entra no tamanho medido pelo React Flow — as
    // âncoras das setas continuam nas bordas do card, não do número.
    <div className="relative w-[240px]">
      {/* Número grande de pessoas ao vivo. O lado (cima/baixo) vem pronto do
          canvas, que sabe onde estão os outros cards. */}
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2",
          badgeSide === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5"
        )}
      >
        <span
          className={cn(
            "flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 shadow-lg backdrop-blur transition-colors",
            online > 0
              ? "border-red-500/60 bg-red-950/85 shadow-[0_0_20px_-4px_rgba(239,68,68,0.7)]"
              : "border-slate-700 bg-slate-900/85"
          )}
        >
          {online > 0 && (
            <span className="h-2 w-2 shrink-0 self-center rounded-full bg-red-500 animate-pulse" />
          )}
          <span
            className={cn(
              "text-2xl font-extrabold leading-none tabular-nums",
              online > 0 ? "text-red-400" : "text-slate-600"
            )}
          >
            {online}
          </span>
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wide",
              online > 0 ? "text-red-300/80" : "text-slate-600"
            )}
          >
            ao vivo
          </span>
        </span>
      </div>

      <div
        className={cn(
          "group relative w-[240px] overflow-hidden rounded-xl border shadow-xl transition-all",
        "bg-slate-900/90 backdrop-blur border-red-500/50",
        // Com gente na página, o card acende: halo vermelho proporcional ao
        // volume. Vazio fica apagado, para o olho achar sozinho onde tem fluxo.
        online > 0 && "border-red-500/80 shadow-[0_0_24px_-4px_rgba(239,68,68,0.55)]",
        selected && "border-red-400 ring-2 ring-red-400/40",
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
        className="!h-3 !w-3 !border-2 !border-slate-900 !bg-red-500"
      />

      {/* Cabeçalho */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/80 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-sm leading-none">{STEP_TYPE_ICON[type]}</span>
          <span className="truncate text-sm font-medium text-slate-100">
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
            className="shrink-0 rounded-md p-1 text-slate-400 opacity-0 transition-opacity hover:bg-slate-700 hover:text-slate-100 group-hover:opacity-100"
          >
            <Pencil size={13} />
          </button>
        )}
      </div>

      {/* Print + partículas de pessoas ao vivo */}
      <div className="relative aspect-[16/10] bg-slate-950">
        {isSubFunnel ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 bg-cyan-500/10 px-3 text-center">
            <Package size={22} className="text-cyan-400" />
            <span className="text-xs font-medium text-slate-100">{label}</span>
            <span className="text-[10px] text-cyan-400">funil de upsell</span>
          </div>
        ) : screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt={`Print de ${label}`}
            className="h-full w-full object-cover object-top opacity-80"
            loading="lazy"
            draggable={false}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-slate-600">
            <ImageOff size={20} />
            <span className="text-[11px]">sem print</span>
          </div>
        )}

        {/* Véu vermelho sobre o print quando há gente na página. */}
        {online > 0 && (
          <div className="pointer-events-none absolute inset-0 bg-red-600/15" />
        )}

        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute right-1.5 top-1.5 rounded-md bg-slate-950/80 p-1 text-slate-300 opacity-0 transition-opacity hover:text-sky-400 group-hover:opacity-100"
            title="Abrir página real"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      {/* Rodapé: só o tipo da etapa. A contagem saiu daqui e virou o número
          grande fora do card — repetir os dois só rouba atenção. */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="truncate text-[11px] uppercase tracking-wide text-slate-500">
          {STEP_TYPE_LABEL[type]}
        </span>
      </div>

        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-slate-900 !bg-red-500"
        />
      </div>
    </div>
  );
}

export const LiveNode = memo(LiveNodeBase);
