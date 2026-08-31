import { Clock, Warning as AlertTriangle } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import type { AsOf } from "@/api/client";

/**
 * Carimbo de tempo do dado do Clarity.
 *
 * Existe porque o Clarity agrega por dia e publica com atraso: o número que ele
 * devolve é sempre de antes, mesmo consultado agora. Numa página chamada "Ao
 * Vivo" isso engana sozinho — daí a regra de que nenhum valor do Clarity
 * aparece na tela sem este componente ao lado.
 */

/** "há 5h", "há 12 min", "há 3 dias". */
export function formatAge(minutes: number | null): string {
  if (minutes === null) return "momento desconhecido";
  if (minutes < 1) return "agora há pouco";
  if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 60 * 24) return `há ${Math.floor(minutes / 60)}h`;

  const dias = Math.floor(minutes / (60 * 24));
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/** Dia de referência em pt-BR, sem o fuso mexer na data. */
function formatRefDate(refDate: string | null): string | null {
  if (!refDate) return null;
  const [ano, mes, dia] = refDate.slice(0, 10).split("-");
  if (!ano || !mes || !dia) return null;
  return `${dia}/${mes}`;
}

export interface AsOfBadgeProps extends Partial<AsOf> {
  className?: string;
  /** Prefixo do texto. Padrão: "Clarity". */
  label?: string;
}

export function AsOfBadge({
  asOf,
  ageMinutes = null,
  stale = false,
  empty = false,
  refDate = null,
  label = "Clarity",
  className,
}: AsOfBadgeProps) {
  if (empty || !asOf) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
          className
        )}
      >
        <Clock size={10} />
        {label} — nenhuma importação ainda
      </span>
    );
  }

  const dia = formatRefDate(refDate);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        stale
          ? "border-warning/30 bg-warning/15 text-warning"
          : "border-border bg-muted text-muted-foreground",
        className
      )}
      title={`Buscado do Clarity em ${new Date(asOf).toLocaleString("pt-BR")}`}
    >
      {stale ? <AlertTriangle size={10} /> : <Clock size={10} />}
      {label}
      {dia && ` — dado de ${dia}`}, atualizado {formatAge(ageMinutes)}
      {stale && " (defasado)"}
    </span>
  );
}

/**
 * Aviso de que a tela está mostrando dado do Clarity numa página de tempo real.
 * Vai no topo do painel, não escondido num tooltip: a diferença entre "agora" e
 * "ontem" muda a decisão que a pessoa toma olhando o número.
 */
export function ClarityDelayNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      O Clarity agrega por dia e publica com atraso — não existe "agora" nesta
      fonte. Os números abaixo são do último período disponível, com a data ao
      lado de cada um. Para tempo real, troque a fonte para o nosso rastreador.
    </p>
  );
}
