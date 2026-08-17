// Leitor de CSV/TSV. Escrito à mão porque o app não tem dependência de parser
// e relatórios de plataforma trazem os casos chatos de sempre: campo entre
// aspas com vírgula dentro, aspas escapadas, quebra de linha dentro do campo.

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
  /** Linhas com número de colunas diferente do cabeçalho. */
  malformedRows: number;
}

/**
 * Descobre o separador contando ocorrências fora de aspas na primeira linha.
 * Relatórios brasileiros costumam vir com `;` porque o Excel-PT usa vírgula
 * como decimal.
 */
function sniffDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/)[0] ?? "";
  const candidates = [";", ",", "\t", "|"];

  let best = ",";
  let bestCount = 0;
  for (const d of candidates) {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < firstLine.length; i++) {
      const c = firstLine[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (c === d && !inQuotes) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseDelimited(text: string, delimiter?: string): ParsedTable {
  // BOM do Excel entra como caractere invisível no primeiro cabeçalho.
  const input = text.replace(/^﻿/, "");
  const delim = delimiter ?? sniffDelimiter(input);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'; // aspas escapadas: ""
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignora: o \n seguinte fecha a linha
    } else {
      field += c;
    }
  }

  // Última linha sem quebra no fim.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Descarta linhas totalmente vazias (rodapé em branco é comum).
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (clean.shift() ?? []).map((h) => h.trim());

  return {
    headers,
    rows: clean,
    delimiter: delim,
    malformedRows: clean.filter((r) => r.length !== headers.length).length,
  };
}

/** Converte a tabela em objetos, casando cada célula com seu cabeçalho. */
export function toRecords(table: ParsedTable): Record<string, string>[] {
  return table.rows.map((row) => {
    const obj: Record<string, string> = {};
    table.headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

/**
 * Palpite do tipo de cada coluna, para a tela de importação mostrar o que
 * chegou sem precisar da documentação da plataforma.
 */
export type ColumnKind = "número" | "dinheiro" | "data" | "texto" | "vazia";

export function guessColumnKind(values: string[]): ColumnKind {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (filled.length === 0) return "vazia";

  const sample = filled.slice(0, 60);
  const hit = (re: RegExp) =>
    sample.filter((v) => re.test(v)).length / sample.length >= 0.8;

  if (hit(/^-?\s*(R\$|\$|€)\s*[\d.,]+$/i)) return "dinheiro";
  if (hit(/^\d{4}-\d{2}-\d{2}([ T]|$)/) || hit(/^\d{2}\/\d{2}\/\d{4}/))
    return "data";
  if (hit(/^-?[\d.,]+%?$/)) return "número";
  return "texto";
}
