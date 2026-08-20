import { conversionColor, CONVERSION_COLOR } from "@/lib/conversion";
import { windowLabel } from "@/components/live/TimeWindowPicker";
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
  /** Nome do funil, para distinguir os cards quando há mais de um lado a
   *  lado (vista Geral) — sem isso todos mostravam o mesmo título "Conversão
   *  de compra", parecendo cartas duplicadas. */
  funnelName?: string;
}

export function ConversionBar({
  data,
  className,
  scope = "window",
  onToggleScope,
  funnelName,
}: ConversionBarProps) {
  const rateColor = conversionColor(data.rate);
  const periodLabel =
    scope === "today"
      ? "hoje, desde a meia-noite"
      : `últimos ${windowLabel(data.windowMinutes)}`;

  // Conversão de funil (entrada até a última página) é uma conta DIFERENTE
  // da conversão de compra — pode ter gente chegando no fim do funil sem
  // comprar, ou comprando de um jeito que não passa pela última página
  // (checkout em outra aba, por exemplo). Sem esse número, só dava pra ver
  // "comprou", nunca "chegou até o fim mas não converteu".
  const lastStep = data.stepRates[data.stepRates.length - 1];
  const funnelRate =
    lastStep && data.visitors > 0
      ? (lastStep.visitors / data.visitors) * 100
      : null;
  const funnelRateColor = conversionColor(funnelRate ?? 0);

  return (
    <Card className={cn("", className)}>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            {funnelName && (
              <span className="mr-1.5 text-muted-foreground">{funnelName} ·</span>
            )}
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

        {/* Entraram → chegaram no fim → conversão de funil primeiro. Depois,
            a MESMA conta pro lado da compra: entraram → compraram → fatia.
            São duas conversões diferentes (chegar no fim ≠ pagar) — antes só
            existia o lado da compra, e não dava pra saber se o funil tinha
            gente chegando no fim sem comprar, ou se ninguém nem chegava lá. */}
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold">{data.visitors.toLocaleString("pt-BR")}</p>
            <MetricLabel metric="liveVisitors" className="text-[11px] text-muted-foreground">
              Entraram
            </MetricLabel>
          </div>
          <div>
            <p className="text-2xl font-bold">
              {(lastStep?.visitors ?? 0).toLocaleString("pt-BR")}
            </p>
            <MetricLabel metric="conversions" className="text-[11px] text-muted-foreground">
              Chegaram no fim
            </MetricLabel>
          </div>
          <div>
            <p className="text-2xl font-bold" style={{ color: funnelRateColor }}>
              {funnelRate == null ? "—" : `${funnelRate.toFixed(1)}%`}
            </p>
            <MetricLabel metric="avgRate" className="text-[11px] text-muted-foreground">
              Conv. funil
            </MetricLabel>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-4 border-t border-border pt-3 text-center">
          <div>
            <p className="text-2xl font-bold text-emerald-500">
              {data.conversions.toLocaleString("pt-BR")}
            </p>
            <MetricLabel metric="livePurchases" className="text-[11px] text-muted-foreground">
              Compras
            </MetricLabel>
          </div>
          <div className="col-span-2">
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

        {/* Etapas: mesmo formato "chegaram · seguiram · abandonaram" da tela
            de Métricas — só a fonte muda (aqui é a janela ao vivo, ali é o
            período escolhido). A primeira etapa não tem "de onde veio", por
            isso não mostra abandono. */}
        <div className="mt-4 space-y-2">
          <MetricLabel
            metric="pageToPage"
            className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            Conversão de funil — página a página
          </MetricLabel>
          {data.stepRates.map((step, i) => {
            const prev = i > 0 ? data.stepRates[i - 1] : null;
            const lost = prev ? Math.max(0, prev.visitors - step.visitors) : 0;
            return (
              <div key={step.stepId} className="space-y-1 rounded-md bg-muted/30 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{step.label}</span>
                  <span
                    className="shrink-0 text-xs font-semibold"
                    style={{
                      color: CONVERSION_COLOR[step.rate >= 80 ? "high" : step.rate >= 50 ? "mid" : "low"],
                    }}
                  >
                    {step.rate.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, step.rate)}%`,
                      backgroundColor: CONVERSION_COLOR[step.rate >= 80 ? "high" : step.rate >= 50 ? "mid" : "low"],
                    }}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {prev ? (
                    <>
                      {prev.visitors.toLocaleString("pt-BR")} chegaram ·{" "}
                      <span className="font-medium text-foreground">
                        {step.visitors.toLocaleString("pt-BR")} seguiram
                      </span>
                      {lost > 0 && (
                        <>
                          {" "}
                          ·{" "}
                          <span className="font-medium text-danger">
                            {lost.toLocaleString("pt-BR")} abandonaram
                          </span>
                        </>
                      )}
                    </>
                  ) : (
                    <>{step.visitors.toLocaleString("pt-BR")} entraram por aqui</>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

import { Card, CardContent } from "@/components/common/Card";
