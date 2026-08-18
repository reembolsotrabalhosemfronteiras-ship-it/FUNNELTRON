import { conversionColor, CONVERSION_COLOR } from "@/lib/conversion";
import type { LiveConversion } from "@/api/client";
import { cn } from "@/lib/cn";
import { MetricLabel } from "@/components/common/MetricLabel";

interface ConversionBarProps {
  data: LiveConversion;
  className?: string;
  /** Recorte de tempo. "today" troca o rótulo e some com o "últimos N min". */
  scope?: "window" | "today";
  /** Presente = mostra o botão de alternar recorte, no lugar de duas cartas empilhadas. */
  onToggleScope?: () => void;
}

export function ConversionBar({
  data,
  className,
  scope = "window",
  onToggleScope,
}: ConversionBarProps) {
  const rateColor = conversionColor(data.rate);
  const periodLabel =
    scope === "today"
      ? "hoje, desde a meia-noite"
      : `últimos ${data.windowMinutes} min`;

  return (
    <Card className={cn("", className)}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Conversão de compra — {periodLabel}
          </h3>
          <div className="flex items-center gap-2">
            {onToggleScope && (
              <button
                type="button"
                onClick={onToggleScope}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {scope === "today" ? "Ver janela curta" : "Ver hoje"}
              </button>
            )}
            <span
              className="text-lg font-bold"
              style={{ color: rateColor }}
            >
              {data.rate.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Os três números são a MESMA conta: entraram → compraram → fatia.
            "Taxa" sozinho não dizia de qual conversão se tratava (regra 2.1). */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold">{data.visitors.toLocaleString("pt-BR")}</p>
            <MetricLabel metric="liveVisitors" className="text-[11px] text-muted-foreground">
              Entraram
            </MetricLabel>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-500">
              {data.conversions.toLocaleString("pt-BR")}
            </p>
            <MetricLabel metric="livePurchases" className="text-[11px] text-muted-foreground">
              Compras
            </MetricLabel>
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: rateColor }}>
              {data.rate.toFixed(1)}%
            </p>
            <MetricLabel
              metric="livePurchaseRate"
              className="text-[11px] text-muted-foreground"
            >
              Conv. compra
            </MetricLabel>
          </div>
        </div>

        {/* Barra de etapas */}
        <div className="mt-4 space-y-1.5">
          <MetricLabel
            metric="pageToPage"
            className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Conversão de funil — página a página
          </MetricLabel>
          {data.stepRates.map((step) => (
            <div key={step.stepId} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[11px] text-muted-foreground">
                {step.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, step.rate)}%`,
                    backgroundColor: CONVERSION_COLOR[step.rate >= 80 ? "high" : step.rate >= 50 ? "mid" : "low"],
                  }}
                />
              </div>
              <span className="w-10 shrink-0 text-right text-[11px] font-medium">
                {step.rate.toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent } from "@/components/common/Card";
