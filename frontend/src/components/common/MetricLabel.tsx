import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import {
  METRIC_GLOSSARY,
  type MetricDef,
  type MetricKey,
} from "@/lib/metricGlossary";

/**
 * Nome de métrica com balãozinho de explicação ao passar o mouse (ou focar
 * pelo teclado). O balão sobe acima do rótulo e não empurra o layout.
 */
export function MetricLabel({
  metric,
  children,
  className,
}: {
  metric: MetricKey;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const def = METRIC_GLOSSARY[metric] as MetricDef;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // O rótulo costuma viver dentro de um card clicável.
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "cursor-help underline decoration-dotted decoration-muted-foreground/50 underline-offset-2 transition-colors hover:text-foreground",
          className
        )}
      >
        {children}
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2",
            "rounded-lg border border-border bg-card p-2.5 text-left shadow-xl"
          )}
        >
          <span className="block text-xs font-medium leading-snug text-foreground">
            {def.what}
          </span>
          {def.how && (
            <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
              {def.how}
            </span>
          )}
          {def.example && (
            <span className="mt-1 block rounded bg-muted/60 px-1.5 py-1 text-[11px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">Ex.: </span>
              {def.example}
            </span>
          )}
          {def.caveat && (
            <span className="mt-1 block border-t border-border pt-1 text-[11px] leading-snug text-warning">
              {def.caveat}
            </span>
          )}
          {/* Bico do balão */}
          <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1 rotate-45 border-b border-r border-border bg-card" />
        </span>
      )}
    </span>
  );
}
