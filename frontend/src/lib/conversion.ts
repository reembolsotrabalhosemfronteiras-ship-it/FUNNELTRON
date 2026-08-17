// Escala de cor única para taxa de conversão. Usada no canvas do funil, nos
// cards de etapa e na página de métricas — para o mesmo número nunca aparecer
// com cores diferentes em telas diferentes.
//
//   >= 80%  verde
//   >= 50%  amarelo
//    < 50%  vermelho

export type ConversionLevel = "high" | "mid" | "low";

export function conversionLevel(rate: number): ConversionLevel {
  if (rate >= 80) return "high";
  if (rate >= 50) return "mid";
  return "low";
}

// Valores literais: o tailwind.config define as cores como HSL fixo, não como
// CSS var — então SVG/inline style precisam do valor cru.
export const CONVERSION_COLOR: Record<ConversionLevel, string> = {
  high: "hsl(142 71% 45%)",
  mid: "hsl(38 92% 50%)",
  low: "hsl(0 72% 51%)",
};

export const CONVERSION_CHIP: Record<ConversionLevel, string> = {
  high: "bg-success/15 text-success border-success/40",
  mid: "bg-warning/15 text-warning border-warning/40",
  low: "bg-danger/15 text-danger border-danger/40",
};

export const CONVERSION_BAR: Record<ConversionLevel, string> = {
  high: "bg-success",
  mid: "bg-warning",
  low: "bg-danger",
};

export function conversionColor(rate: number): string {
  return CONVERSION_COLOR[conversionLevel(rate)];
}

export function conversionChip(rate: number): string {
  return CONVERSION_CHIP[conversionLevel(rate)];
}

export function conversionBar(rate: number): string {
  return CONVERSION_BAR[conversionLevel(rate)];
}

/**
 * Conversão de uma página para a outra: de quem CHEGOU na origem, quantos
 * CHEGARAM no destino. 100 visitantes → 50 visitantes = 50%.
 */
export function pageToPageRate(
  sourceVisitors: number | undefined,
  targetVisitors: number | undefined
): number | undefined {
  if (!sourceVisitors || sourceVisitors <= 0) return undefined;
  if (targetVisitors === undefined) return undefined;
  return (targetVisitors / sourceVisitors) * 100;
}
