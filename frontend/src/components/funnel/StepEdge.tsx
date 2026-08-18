import { useEffect, useRef, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from "reactflow";
import { cn } from "@/lib/cn";
import { onEdgePulse } from "@/lib/livePulse";
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
}

/** Quanto tempo a bolinha leva de uma página até a outra. */
const BALL_DURATION = 1.5;
/** Espaçamento entre bolinhas do mesmo lote (várias pessoas de uma vez). */
const BALL_STAGGER_MS = 220;
/** Teto de bolinhas simultâneas numa aresta — acima disso vira borrão. */
const MAX_BALLS = 8;

interface Pulse {
  key: number;
  /** Atraso até esta bolinha partir, em ms. */
  delay: number;
}

/**
 * Bolinhas em voo nesta aresta. Cada uma nasce de um pulo de verdade avisado
 * pelo canvas (ver `lib/livePulse.ts`) e morre quando chega no destino — nada
 * anima enquanto ninguém anda.
 */
function useEdgePulses(edgeId: string, enabled: boolean): Pulse[] {
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const nextKey = useRef(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = onEdgePulse(edgeId, (count) => {
      const lote: Pulse[] = [];
      const n = Math.min(count, MAX_BALLS);
      for (let i = 0; i < n; i++) {
        lote.push({ key: nextKey.current++, delay: i * BALL_STAGGER_MS });
      }
      setPulses((atuais) => [...atuais, ...lote].slice(-MAX_BALLS));

      const chaves = new Set(lote.map((p) => p.key));
      const t = window.setTimeout(
        () => setPulses((atuais) => atuais.filter((p) => !chaves.has(p.key))),
        (n - 1) * BALL_STAGGER_MS + BALL_DURATION * 1000 + 120
      );
      timers.current.push(t);
    });
    return () => {
      unsubscribe();
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [edgeId, enabled]);

  return pulses;
}

/**
 * Bolinha de luz que viaja da página A até a página B ao longo do caminho da
 * aresta. Implementada com SMIL `<animateMotion>`: o atributo `path` recebe o
 * mesmo `edgePath` desenhado pela aresta, então a bolinha segue o traçado
 * exato (curvas inclusive).
 *
 * `begin="indefinite"` + `beginElement()` no efeito, e não `begin="0s"`: o
 * relógio do SMIL é o do documento, não o da montagem do elemento. Uma bolinha
 * criada aos 40s de página com `begin="0s"` nasceria com a animação já vencida
 * — aparecia parada no fim do caminho.
 *
 * O brilho é feito com um segundo círculo maior e translúcido, **não** com
 * `filter`: a região de um filtro SVG é calculada a partir da bounding box
 * estática do elemento, e a bolinha sai dessa caixa assim que começa a andar —
 * o resultado era a bolinha sumindo no meio do caminho.
 */
function LightBall({
  edgePath,
  delay,
}: {
  edgePath: string;
  delay: number;
}) {
  const motionRef = useRef<SVGElement>(null);
  const [andando, setAndando] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setAndando(true);
      (motionRef.current as SVGAnimationElement | null)?.beginElement();
    }, delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <g
      className="pointer-events-none"
      // Antes de partir a bolinha fica na origem do caminho; escondida, para
      // não virar um ponto parado em cima do card enquanto espera a vez.
      style={{ opacity: andando ? 1 : 0 }}
    >
      <circle r={9} fill="url(#liveBallGlowGradient)" opacity={0.55} />
      <circle r={3.5} fill="#fecaca" />
      <circle r={2} fill="#fff" />
      <animateMotion
        ref={motionRef}
        dur={`${BALL_DURATION}s`}
        begin="indefinite"
        repeatCount="1"
        fill="freeze"
        path={edgePath}
        keyPoints="0;1"
        keyTimes="0;1"
        calcMode="linear"
      />
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

  const pulses = useEdgePulses(id, live);

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
        pulses.map((p) => (
          <LightBall key={p.key} edgePath={edgePath} delay={p.delay} />
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
