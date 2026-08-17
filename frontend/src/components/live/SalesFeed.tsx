import { cn } from "@/lib/cn";
import type { LiveSale } from "@/api/client";
import { Card, CardContent } from "@/components/common/Card";
import { Badge } from "@/components/common/Badge";

interface SalesFeedProps {
  sales: LiveSale[];
  stepLabels: Record<string, string>;
  className?: string;
  maxItems?: number;
}

export function SalesFeed({ sales, stepLabels, className, maxItems = 10 }: SalesFeedProps) {
  if (sales.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-4 text-center text-muted-foreground text-sm">
          Nenhuma venda na janela selecionada
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-2">
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {sales.slice(0, maxItems).map((sale) => (
            <div
              key={sale.id}
              className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border/50 bg-card transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant={sale.status === "paid" ? "success" : "warning"}
                  className="text-[10px] shrink-0"
                >
                  {sale.status === "paid" ? "Pago" : "Pendente"}
                </Badge>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">
                    {stepLabels[sale.stepId] || sale.stepId}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(sale.timestamp).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold text-emerald-500">
                R$ {sale.amount.toLocaleString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}