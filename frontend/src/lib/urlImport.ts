import type { StepType } from "@/types";

export interface ParsedUrl {
  url: string;
  /** Nome legível derivado do slug: "pergunta-1" → "Pergunta 1". */
  label: string;
  slug: string;
  type: StepType;
}

/** Uma palavra do slug que sempre vira um tipo de página, na ordem da lista. */
export interface SlugTypeRule {
  keyword: string;
  type: StepType;
}

/**
 * Regras padrão — o mesmo palpite que sempre existiu, agora como lista
 * editável em vez de `if` fixo no código. A tela de Configurações começa com
 * elas já preenchidas; o usuário edita, adiciona ou remove dali.
 */
export const DEFAULT_SLUG_RULES: SlugTypeRule[] = [
  { keyword: "obrigado", type: "thank_you" },
  { keyword: "thank", type: "thank_you" },
  { keyword: "success", type: "thank_you" },
  { keyword: "sucesso", type: "thank_you" },
  { keyword: "confirmac", type: "thank_you" },
  { keyword: "checkout", type: "checkout" },
  { keyword: "pagamento", type: "checkout" },
  { keyword: "payment", type: "checkout" },
  { keyword: "pay", type: "checkout" },
  { keyword: "assinar", type: "checkout" },
  { keyword: "comprar", type: "checkout" },
  { keyword: "bump", type: "order_bump" },
  { keyword: "downsell", type: "downsell" },
  { keyword: "down-sell", type: "downsell" },
  { keyword: "ds", type: "downsell" },
  { keyword: "upsell", type: "upsell" },
  { keyword: "up-sell", type: "upsell" },
  { keyword: "oto", type: "upsell" },
  { keyword: "us", type: "upsell" },
  { keyword: "vsl", type: "vsl" },
  { keyword: "video", type: "vsl" },
  { keyword: "aula", type: "vsl" },
  { keyword: "apresentac", type: "vsl" },
  { keyword: "webinar", type: "vsl" },
];

/**
 * Deduz o tipo da página pelo slug. É palpite, não verdade — o usuário troca
 * no ateliê. `rules` é checada NA ORDEM, primeira que bater vence — é o que
 * permite ao usuário sobrepor um palpite genérico com uma regra própria
 * colocando-a antes na lista salva em Configurações. Sem regra nenhuma
 * batendo, sobra a estrutura: primeira URL é "landing", o resto é "outra".
 */
export function guessStepType(
  slug: string,
  isFirst: boolean,
  rules: SlugTypeRule[] = DEFAULT_SLUG_RULES
): StepType {
  const s = slug.toLowerCase();

  for (const rule of rules) {
    const keyword = rule.keyword.trim().toLowerCase();
    if (!keyword) continue;
    if (new RegExp(`(^|[-_/])${escapeRegExp(keyword)}`).test(s)) {
      return rule.type;
    }
  }

  if (isFirst || s === "") return "landing";
  return "other";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "metodo-pagamento" → "Metodo pagamento" */
function humanize(slug: string): string {
  if (!slug) return "Home";
  const last = slug.split("/").filter(Boolean).pop() ?? slug;
  const words = last.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Lê a lista colada. Aceita uma URL por linha, ignora linhas vazias e
 * duplicatas, e devolve o que não parecia URL para a tela avisar em vez de
 * descartar em silêncio.
 */
export function parseUrlList(
  raw: string,
  rules: SlugTypeRule[] = DEFAULT_SLUG_RULES
): {
  urls: ParsedUrl[];
  invalid: string[];
} {
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const urls: ParsedUrl[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    // Aceita colar sem protocolo.
    const candidate = /^https?:\/\//i.test(line) ? line : `https://${line}`;

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      invalid.push(line);
      continue;
    }

    if (!parsed.hostname.includes(".")) {
      invalid.push(line);
      continue;
    }

    const normalized = parsed.toString().replace(/\/$/, "");
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const slug = parsed.pathname.replace(/^\/|\/$/g, "");
    urls.push({
      url: normalized,
      slug,
      label: humanize(slug),
      type: guessStepType(slug, urls.length === 0, rules),
    });
  }

  return { urls, invalid };
}
