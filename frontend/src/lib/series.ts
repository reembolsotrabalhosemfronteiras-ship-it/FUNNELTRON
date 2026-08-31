/** Paleta para séries/funis em rankings, comparações e gráficos.
 *  Mesma sequência do mockup Nocturne (FRONTENDNOVO). */
export const SERIES_COLORS = [
  "hsl(217 91% 62%)", // azul (accent)
  "hsl(271 91% 65%)", // roxo (VSL)
  "hsl(142 69% 52%)", // verde
  "hsl(38 92% 58%)", // amarelo
  "hsl(199 89% 60%)", // ciano
] as const;

export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length];
}
