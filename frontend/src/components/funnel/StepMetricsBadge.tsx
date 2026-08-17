import { cn } from "@/lib/cn";
import type { StepMetric } from "@/types";

interface StepMetricsBadgeProps {
  metric?: StepMetric;
  compact?: boolean;
}

export function StepMetricsBadge({ metric, compact = false }: StepMetricsBadgeProps) {
  if (!metric) return <span className="text-muted-foreground text-xs">Sem dados</span>;

  const { visitors, conversions, conversionRate, source } = metric;
  const rate = conversionRate ?? 0;

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 text-xs")}>
        <span className="text-muted-foreground">{visitors.toLocaleString("pt-BR")} visitas</span>
        <span className={cn(
          "font-medium px-1.5 py-0.5 rounded border",
          rate >= 20 ? "bg-success/15 text-success border-success/30" :
          rate >= 10 ? "bg-warning/15 text-warning border-warning/30" :
          "bg-danger/15 text-danger border-danger/30"
        )}>
          {rate.toFixed(1)}%
        </span>
        <span className="text-[10px] text-muted-foreground uppercase">{source}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Visitantes</span>
        <span className="font-medium">{visitors.toLocaleString("pt-BR")}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Conversões</span>
        <span className="font-medium text-success">{conversions.toLocaleString("pt-BR")}</span>
      </div>
      <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
        <span className="text-muted-foreground">Conv. funil</span>
        <span className={cn(
          "font-medium px-1.5 py-0.5 rounded border",
          rate >= 20 ? "bg-success/15 text-success border-success/30" :
          rate >= 10 ? "bg-warning/15 text-warning border-warning/30" :
          "bg-danger/15 text-danger border-danger/30"
        )}>
          {rate.toFixed(1)}%
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
        Fonte: {source.toUpperCase()}
      </div>
    </div>
  );
}