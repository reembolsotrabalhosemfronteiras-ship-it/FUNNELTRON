import type { EdgeCondition } from "@/types";

// Vocabulário das setas do funil. A cor aqui é a identidade do TIPO de
// ligação — quando a seta já tem métrica, quem manda na cor é a conversão
// (ver `conversion.ts`); sem métrica, cai nesta paleta.

export const EDGE_CONDITION_LABEL: Record<EdgeCondition, string> = {
  default: "Direto",
  on_accept: "Ao aceitar",
  on_decline: "Ao recusar",
  on_bump: "Com bump",
  on_no_bump: "Sem bump",
  back_redirect: "Back redirect",
};

export const EDGE_CONDITION_COLOR: Record<EdgeCondition, string> = {
  default: "hsl(215 16% 55%)",
  on_accept: "hsl(142 71% 45%)",
  on_decline: "hsl(0 72% 51%)",
  on_bump: "hsl(38 92% 50%)",
  on_no_bump: "hsl(215 16% 65%)",
  back_redirect: "hsl(271 76% 58%)",
};

/** Setas condicionais são tracejadas; o caminho principal é sólido. */
export const EDGE_CONDITION_DASH: Record<EdgeCondition, string | undefined> = {
  default: undefined,
  on_accept: "7 4",
  on_decline: "7 4",
  on_bump: "7 4",
  on_no_bump: "7 4",
  back_redirect: "2 4",
};

export const EDGE_CONDITIONS: EdgeCondition[] = [
  "default",
  "on_accept",
  "on_decline",
  "on_bump",
  "on_no_bump",
  "back_redirect",
];
