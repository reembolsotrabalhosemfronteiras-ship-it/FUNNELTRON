import { cn } from "@/lib/cn";
import { Select } from "@/components/common/Select";

const WINDOW_OPTIONS = [
  { label: "5 min", value: 5 },
  { label: "30 min", value: 30 },
  { label: "1 hora", value: 60 },
  { label: "3 horas", value: 180 },
  { label: "6 horas", value: 360 },
  { label: "12 horas", value: 720 },
  { label: "24 horas", value: 1440 },
] as const;

/**
 * "últimos N min" vira ilegível a partir de 60 (ninguém lê "últimos 1440
 * min" como um dia) — usa o mesmo rótulo do seletor ("1 hora", "24 horas")
 * em vez de re-formatar o número cru em cada tela que mostra a janela.
 */
export function windowLabel(minutes: number): string {
  const found = WINDOW_OPTIONS.find((o) => o.value === minutes);
  if (found) return found.label;
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded}h`;
}

export interface TimeWindowPickerProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function TimeWindowPicker({
  value,
  onChange,
  label,
  icon,
  className,
}: TimeWindowPickerProps) {
  return (
    <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {icon}
      {label && <span>{label}</span>}
      <Select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 h-8"
      >
        {WINDOW_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </Select>
    </div>
  );
}