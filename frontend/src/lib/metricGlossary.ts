// Dicionário único das métricas. Toda explicação em balãozinho sai daqui, para
// a mesma métrica nunca ser descrita de dois jeitos em telas diferentes.

export interface MetricDef {
  /** Nome exibido. Fonte única — nenhuma tela inventa rótulo próprio. */
  label: string;
  /** Versão curta, para caber em card estreito. */
  short?: string;
  /** Frase curta: o que o número significa. */
  what: string;
  /** Como ele é calculado, em português. */
  how?: string;
  /** Armadilha comum de leitura. */
  caveat?: string;
  /** Exemplo com números redondos. Métrica que confunde tem que ter um. */
  example?: string;
}

// REGRA DE NOMENCLATURA
// Conversão que fala de VENDA  → "conversão de compra"
// Conversão que fala de AVANÇO entre páginas → "conversão de funil"
// Nunca usar "taxa" sozinho: não diz de qual das duas se trata.

export const METRIC_GLOSSARY = {
  visitors: {
    label: "Visitas",
    what: "Quantas pessoas DIFERENTES entraram neste funil no período.",
    how: "Visitantes da primeira página (entrada), por sessão.",
    caveat:
      "É gente, não pageview — quem vê 5 páginas do mesmo funil conta uma vez só.",
  },
  conversions: {
    label: "Conversões de funil",
    short: "Conv. funil",
    what: "Quantas pessoas chegaram na última página do funil desenhado.",
    how: "Visitantes da última etapa, na ordem do funil.",
    caveat: "É chegar na última página, não venda.",
  },
  avgRate: {
    label: "Conversão de funil",
    short: "Conv. funil",
    what: "De quem entrou na primeira página, quantos chegaram na última.",
    how: "Visitantes da última página ÷ visitantes da primeira página.",
    caveat:
      "Ponta a ponta do funil desenhado — não é venda (isso é conversão de compra) nem a passagem de uma página específica para a seguinte (isso é conversão de página, no diagrama).",
  },
  endToEnd: {
    label: "Conversão de compra",
    short: "Conv. compra",
    what: "De quem entrou no funil, quantos REALMENTE compraram.",
    how: "Vendas pagas confirmadas por webhook ÷ visitantes da primeira página.",
    caveat:
      "Exige venda paga no webhook — visitar a página de obrigado sem pagar não conta como compra.",
  },
  weightedRate: {
    label: "Conversão de funil geral",
    short: "Conv. funil geral",
    what: "A conversão de funil de todos os funis juntos.",
    how: "Total de conversões ÷ total de visitas, somando tudo.",
    caveat: "Ponderada por volume: um funil grande pesa mais que um pequeno.",
  },
  simpleAvg: {
    label: "Média por funil",
    what: "A média das conversões de funil, sem considerar o tamanho de cada um.",
    how: "Soma das taxas ÷ número de funis.",
    caveat:
      "Um funil de 200 visitas pesa igual a um de 20.000 — útil para ver consistência, não desempenho.",
  },
  steps: {
    label: "Etapas",
    what: "Quantas páginas compõem este funil.",
  },
  lostValue: {
    label: "Valor perdido na maior queda",
    short: "Valor perdido",
    what: "Quanto dinheiro as pessoas que abandonaram na pior passagem do funil representam, pelo ticket médio real das vendas do período.",
    how: "Pessoas perdidas na pior passagem × ticket médio das vendas do período.",
    caveat:
      "Fica em branco sem venda registrada no período — sem ticket real, o valor seria inventado.",
    example: "6.280 pessoas perdidas × R$ 97 de ticket médio = R$ 609.160.",
  },
  pageToPage: {
    label: "Conversão de funil (página a página)",
    what: "De quem chegou na página de origem, quantos chegaram na de destino.",
    how: "Visitantes do destino ÷ visitantes da origem.",
    example:
      "100 pessoas na Landing, 50 chegaram na VSL → conversão de funil de 50%.",
  },

  // --- Ao vivo (janela curta, não o período do relatório) ---
  liveVisitors: {
    label: "Pessoas que entraram",
    short: "Pessoas",
    what: "Quantas pessoas entraram no funil na janela de tempo escolhida.",
    how: "Contagem de entradas na primeira página, dentro da janela.",
    caveat: "É a janela do ao vivo (minutos), não o período do relatório.",
    example: "Janela de 30 min, 634 pessoas → 634 entraram nos últimos 30 min.",
  },
  livePurchases: {
    label: "Conversões de compra",
    short: "Compras",
    what: "Quantas dessas pessoas chegaram até a página que encerra a medição.",
    how: "Contagem de quem alcançou a página-meta do funil, na mesma janela.",
    caveat:
      "Não é avanço entre páginas: aqui é venda concluída. Sem página-meta marcada, não há o que contar.",
    example: "Das 634 que entraram, 3 chegaram na página de obrigado → 3 compras.",
  },
  livePurchaseRate: {
    label: "Conversão de compra",
    short: "Conv. compra",
    what: "De quem entrou no funil nesta janela, que fatia comprou.",
    how: "Conversões de compra ÷ pessoas que entraram.",
    caveat:
      "Ponta a ponta. A conversão de funil, página a página, é a lista logo abaixo — as duas quase nunca batem.",
    example: "3 compras ÷ 634 pessoas = 0,5% de conversão de compra.",
  },
  branchAccept: {
    label: "Conversão de compra da oferta",
    what: "Que fatia de quem viu a oferta paralela comprou.",
    caveat:
      "Bump, upsell e downsell acontecem dentro de outra página — recusar não é abandonar o funil.",
  },
  vslConversion: {
    label: "Conversão de funil da VSL",
    what: "Que fatia de quem assistiu à VSL avançou no funil.",
  },
  vslEngagement: {
    label: "Engajamento da VSL",
    what: "Quanto da VSL as pessoas assistem, em média, antes de sair.",
  },
  sessions: {
    label: "Sessões",
    what: "Sessões registradas pelo Microsoft Clarity no período.",
  },
  pageViews: {
    label: "Páginas vistas",
    what: "Total de páginas carregadas nessas sessões.",
  },
  avgTime: {
    label: "Tempo médio (seg)",
    what: "Tempo médio que a pessoa passa na página, em segundos.",
  },
  bounceRate: {
    label: "Taxa de rejeição",
    what: "Fatia das sessões que viram uma página só e saíram.",
    caveat: "Rejeição alta numa landing costuma ser problema de oferta ou tráfego.",
  },
} satisfies Record<string, MetricDef>;

/** Rótulo curto quando existir, senão o completo. */
export function metricLabel(key: MetricKey, short = false): string {
  const def = METRIC_GLOSSARY[key] as MetricDef;
  return short ? def.short ?? def.label : def.label;
}

export type MetricKey = keyof typeof METRIC_GLOSSARY;
