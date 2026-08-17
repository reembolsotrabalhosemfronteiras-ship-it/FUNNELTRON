import type { FunnelStep } from "@/types";

/**
 * Geometria do card do funil. É a mesma para o ateliê, a página do funil e o
 * modo ao vivo (decisão 2.8): mudar a altura de um sem mudar a do outro faria
 * o mesmo desenho aparecer com espaçamentos diferentes em cada tela.
 *
 * Medido no DOM: 240 x 219 px.
 */
export const NODE_W = 240;
export const NODE_H = 219;

/** Folga mínima entre dois cards vizinhos, em px do canvas. */
export const GAP_X = 56;
export const GAP_Y = 48;

/** Altura reservada para o número grande de pessoas ao vivo, fora do card. */
export const LIVE_BADGE_H = 46;

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Box, b: Box, gapX: number, gapY: number): boolean {
  return (
    a.x < b.x + b.w + gapX &&
    b.x < a.x + a.w + gapX &&
    a.y < b.y + b.h + gapY &&
    b.y < a.y + a.h + gapY
  );
}

/**
 * Afasta cards que se sobrepõem, **sem alterar o desenho salvo**.
 *
 * O ateliê deixa arrastar livremente e não impede encostar um card no outro —
 * é o certo lá, porque é o usuário desenhando. Mas nas telas de *visualização*
 * (página do funil, métricas, ao vivo) o funil precisa ser legível sozinho:
 * dois cards encavalados escondem print, métrica e seta.
 *
 * Então aqui, na leitura, aplica-se o mínimo de deslocamento necessário para
 * que ninguém encoste em ninguém. O algoritmo é uma separação iterativa de
 * retângulos: a cada passada, o par que colide é empurrado pelo **eixo de menor
 * penetração** — se estão mais colados na horizontal, separa na horizontal; se
 * na vertical, na vertical. Assim a forma que o usuário desenhou é preservada
 * (uma coluna continua coluna, uma ramificação continua ao lado), só ganha ar.
 *
 * Determinístico: a ordem de processamento é fixa (x, depois y, depois id), e o
 * card mais "à frente" na ordem é o que cede. Rodar duas vezes com a mesma
 * entrada dá exatamente a mesma saída — importante porque o polling do ao vivo
 * refaz esse cálculo, e posição instável faria o funil tremer na tela.
 */
export function spreadSteps(
  steps: FunnelStep[],
  opts: {
    gapX?: number;
    gapY?: number;
    /** Altura extra reservada abaixo/acima do card (badge do ao vivo). */
    extraH?: number;
  } = {}
): Record<string, { x: number; y: number }> {
  const gapX = opts.gapX ?? GAP_X;
  const gapY = opts.gapY ?? GAP_Y;
  const h = NODE_H + (opts.extraH ?? 0);

  const boxes: Box[] = steps
    .map((s) => ({ id: s.id, x: s.positionX, y: s.positionY, w: NODE_W, h }))
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));

  // Passadas até estabilizar. O teto de 60 é um freio: com muitos cards no
  // mesmo ponto a separação pode demorar a convergir, e travar a tela seria
  // pior do que um resíduo de sobreposição em um caso patológico.
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!overlaps(a, b, gapX, gapY)) continue;

        // Quanto falta para separar em cada eixo.
        const dx =
          a.x < b.x ? a.x + a.w + gapX - b.x : b.x + b.w + gapX - a.x;
        const dy =
          a.y < b.y ? a.y + a.h + gapY - b.y : b.y + b.h + gapY - a.y;

        // Empurra só `b` (o de trás na ordem), pelo eixo mais barato.
        if (dx <= dy) {
          b.x += a.x <= b.x ? dx : -dx;
        } else {
          b.y += a.y <= b.y ? dy : -dy;
        }
        moved = true;
      }
    }

    if (!moved) break;
  }

  const out: Record<string, { x: number; y: number }> = {};
  for (const b of boxes) out[b.id] = { x: b.x, y: b.y };
  return out;
}

/**
 * Decide se o número de pessoas ao vivo fica **embaixo** ou **em cima** do card.
 *
 * Padrão é embaixo — é onde o olho cai depois de ler o print. Mas se houver
 * outro card logo abaixo, o número passaria por cima dele; nesse caso sobe.
 * Se os dois lados estiverem ocupados, fica embaixo mesmo: com o espaçamento
 * de `spreadSteps` aplicado isso não deve acontecer, e escolher um lado é
 * melhor do que esconder o número.
 */
export function resolveBadgeSide(
  steps: FunnelStep[],
  positions: Record<string, { x: number; y: number }>,
  badgeH = LIVE_BADGE_H
): Record<string, "top" | "bottom"> {
  const out: Record<string, "top" | "bottom"> = {};

  for (const step of steps) {
    const p = positions[step.id] ?? { x: step.positionX, y: step.positionY };

    const band = (side: "top" | "bottom") => ({
      x: p.x,
      y: side === "bottom" ? p.y + NODE_H : p.y - badgeH,
      w: NODE_W,
      h: badgeH,
    });

    const hits = (side: "top" | "bottom") => {
      const b = band(side);
      return steps.some((other) => {
        if (other.id === step.id) return false;
        const q = positions[other.id] ?? {
          x: other.positionX,
          y: other.positionY,
        };
        return (
          b.x < q.x + NODE_W &&
          q.x < b.x + b.w &&
          b.y < q.y + NODE_H &&
          q.y < b.y + b.h
        );
      });
    };

    out[step.id] = hits("bottom") && !hits("top") ? "top" : "bottom";
  }

  return out;
}
