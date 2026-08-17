import type { StepType } from "@/types";

export interface ParsedUrl {
  url: string;
  /** Nome legível derivado do slug: "pergunta-1" → "Pergunta 1". */
  label: string;
  slug: string;
  type: StepType;
}

/**
 * Deduz o tipo da página pelo slug. É palpite, não verdade — o usuário troca
 * no ateliê. Só existe para não obrigar a classificar 20 páginas na mão.
 */
export function guessStepType(slug: string, isFirst: boolean): StepType {
  const s = slug.toLowerCase();

  if (/(^|[-_/])(obrigado|thank|success|sucesso|confirmac)/.test(s))
    return "thank_you";
  if (/(^|[-_/])(checkout|pagamento|payment|pay|assinar|comprar)/.test(s))
    return "checkout";
  if (/(^|[-_/])(bump)/.test(s)) return "order_bump";
  if (/(^|[-_/])(downsell|down-sell|ds\d*)/.test(s)) return "downsell";
  if (/(^|[-_/])(upsell|up-sell|oto\d*|us\d*)/.test(s)) return "upsell";
  if (/(^|[-_/])(vsl|video|aula|apresentac|webinar)/.test(s)) return "vsl";
  if (isFirst || s === "") return "landing";
  return "other";
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
export function parseUrlList(raw: string): {
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
      type: guessStepType(slug, urls.length === 0),
    });
  }

  return { urls, invalid };
}
