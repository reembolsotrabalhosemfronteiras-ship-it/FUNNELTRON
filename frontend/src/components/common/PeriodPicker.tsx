import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isDateRange,
  type DateRange,
  type Period,
  type PeriodInput,
} from "@/types";

const PRESETS: { value: Period; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "all", label: "Tudo" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** "Hoje" é um intervalo de um dia só — não cabe nos atalhos de N dias. */
export function todayRange(): DateRange {
  const t = iso(new Date());
  return { from: t, to: t };
}

function isToday(period: PeriodInput): boolean {
  if (!isDateRange(period)) return false;
  const t = iso(new Date());
  return period.from === t && period.to === t;
}

export function periodLabel(period: PeriodInput): string {
  if (!isDateRange(period)) {
    return PRESETS.find((p) => p.value === period)?.label ?? String(period);
  }
  if (isToday(period)) return "Hoje";

  const fmt = (s: string) =>
    new Date(`${s}T00:00:00`).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    });
  // Intervalo de um dia só não precisa repetir a data duas vezes.
  if (period.from === period.to) return fmt(period.from);
  return `${fmt(period.from)} — ${fmt(period.to)}`;
}

/**
 * Atalhos de período + intervalo livre. O intervalo só é aplicado quando as
 * duas datas existem e estão na ordem certa, para não disparar uma consulta
 * com metade da informação.
 */
export function PeriodPicker({
  value,
  onChange,
  align = "end",
}: {
  value: PeriodInput;
  onChange: (p: PeriodInput) => void;
  /** Onde o painel de datas encosta. "start" para uso em barra de filtros. */
  align?: "start" | "end";
}) {
  const custom = isDateRange(value);
  const todayActive = isToday(value);
  // "Hoje" já tem botão próprio; não deve acender o botão de datas livres.
  const customActive = custom && !todayActive;
  const [open, setOpen] = useState(customActive);
  const today = iso(new Date());

  const [from, setFrom] = useState(custom ? value.from : "");
  const [to, setTo] = useState(custom ? value.to : today);

  const invalid = Boolean(from && to && from > to);

  const apply = (nextFrom: string, nextTo: string) => {
    if (nextFrom && nextTo && nextFrom <= nextTo) {
      onChange({ from: nextFrom, to: nextTo });
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        align === "end" ? "items-end" : "items-start"
      )}
    >
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
        <button
          onClick={() => {
            setOpen(false);
            onChange(todayRange());
          }}
          className={cn(
            "rounded-md px-2.5 py-2 text-xs font-medium transition-colors",
            todayActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          Hoje
        </button>

        {PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              setOpen(false);
              onChange(p.value);
            }}
            className={cn(
              "rounded-md px-2.5 py-2 text-xs font-medium transition-colors",
              !custom && value === p.value
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {p.label}
          </button>
        ))}

        <button
          onClick={() => setOpen((o) => !o)}
          title="Escolher datas"
          className={cn(
            "flex items-center gap-1 rounded-md px-2.5 py-2 text-xs font-medium transition-colors",
            customActive
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          <CalendarDays size={13} />
          {customActive ? periodLabel(value) : "Escolher datas"}
        </button>
      </div>

      {open && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 shadow-sm">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            de
            <input
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => {
                setFrom(e.target.value);
                apply(e.target.value, to);
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            até
            <input
              type="date"
              value={to}
              min={from || undefined}
              max={today}
              onChange={(e) => {
                setTo(e.target.value);
                apply(from, e.target.value);
              }}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
            />
          </label>
          {invalid && (
            <span className="text-xs text-danger">data inicial maior que a final</span>
          )}
        </div>
      )}
    </div>
  );
}
