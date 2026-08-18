import type { LivePageEntry } from "@/api/client";

/**
 * Pulos página → página no modo ao vivo.
 *
 * A bolinha de luz da aresta **não** é decoração de fundo: cada uma é uma
 * pessoa que saiu de uma página e entrou na seguinte. Antes elas corriam em
 * laço infinito enquanto a tela estivesse aberta, o que dizia "tem fluxo" mesmo
 * quando ninguém tinha se mexido — o olho aprendia a ignorar.
 *
 * A fonte é o log de entradas (`/api/live/entries`). O backend só grava uma
 * linha quando a URL da sessão muda, então duas entradas seguidas do mesmo
 * visitante já **são** um pulo: da etapa da primeira para a etapa da segunda.
 */

export interface StepTransition {
  /** Etapa de onde a pessoa saiu. */
  from: string;
  /** Etapa onde ela entrou. */
  to: string;
  /** Momento da entrada, em ms. */
  at: number;
}

/** Instante da entrada mais recente da lista (0 se não houver nenhuma). */
export function newestEntryTime(entries: LivePageEntry[]): number {
  let newest = 0;
  for (const e of entries) {
    const t = +new Date(e.timestamp);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest;
}

/**
 * Deriva os pulos ocorridos **depois** de `sinceMs`.
 *
 * O corte por tempo é o que impede a tela de reanimar o passado: o log traz a
 * janela inteira a cada polling, e sem ele todo ciclo de 5s dispararia de novo
 * as mesmas dezenas de transições antigas.
 */
export function detectTransitions(
  entries: LivePageEntry[],
  sinceMs: number
): StepTransition[] {
  // `visitor` é o fim do session_id — mesma pessoa, páginas diferentes.
  const byVisitor = new Map<string, LivePageEntry[]>();
  for (const e of entries) {
    if (!e.stepId) continue; // URL fora do desenho do funil: não há aresta.
    const list = byVisitor.get(e.visitor);
    if (list) list.push(e);
    else byVisitor.set(e.visitor, [e]);
  }

  const out: StepTransition[] = [];
  byVisitor.forEach((list) => {
    list.sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));
    for (let i = 1; i < list.length; i++) {
      const at = +new Date(list[i].timestamp);
      if (!Number.isFinite(at) || at <= sinceMs) continue;
      const from = list[i - 1].stepId;
      const to = list[i].stepId;
      // Recarregar a mesma página não é pulo.
      if (!from || !to || from === to) continue;
      out.push({ from, to, at });
    }
  });

  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------------------
// Canal aresta → animação.
//
// O pulso não viaja pelos dados da aresta de propósito: mudar `data` obrigaria
// o canvas a recriar todas as arestas a cada pessoa que anda no funil, e o
// React Flow remonta o SVG quando isso acontece — a bolinha morreria no meio do
// caminho. Aqui a aresta se inscreve pelo próprio id e o canvas só avisa.
// ---------------------------------------------------------------------------

type PulseListener = (count: number) => void;

const listeners = new Map<string, Set<PulseListener>>();

export function onEdgePulse(edgeId: string, fn: PulseListener): () => void {
  let set = listeners.get(edgeId);
  if (!set) {
    set = new Set();
    listeners.set(edgeId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(edgeId);
  };
}

/** Dispara `count` bolinhas na aresta. Sem ouvinte, não faz nada. */
export function pulseEdge(edgeId: string, count = 1): void {
  const set = listeners.get(edgeId);
  if (!set) return;
  set.forEach((fn) => fn(count));
}
