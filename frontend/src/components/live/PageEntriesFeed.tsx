import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/cn";
import type { LivePageEntry } from "@/api/client";
import { Card, CardContent } from "@/components/common/Card";

interface PageEntriesFeedProps {
  entries: LivePageEntry[];
  stepLabels: Record<string, string>;
  className?: string;
  maxItems?: number;
}

/** "agora", "há 12s", "há 4 min" — o log é lido pelo quão recente é a linha. */
function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.round((Date.now() - +new Date(iso)) / 1000));
  if (secs < 10) return "agora";
  if (secs < 60) return `há ${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `há ${mins} min`;
  return `há ${Math.round(mins / 60)}h`;
}

/**
 * Log de entradas em página: "fulano entrou na Landing Page, há 8s".
 *
 * As duas linhas mais recentes ficam destacadas em vermelho — é o que chegou
 * enquanto o usuário estava olhando. O resto esmaece, para o olho não ter que
 * reprocessar a lista inteira a cada polling.
 */
export function PageEntriesFeed({
  entries,
  stepLabels,
  className,
  maxItems = 12,
}: PageEntriesFeedProps) {
  if (entries.length === 0) {
    return (
      <Card className={className}>
        <CardContent className="p-4 text-center text-sm text-muted-foreground">
          Nenhuma entrada de página na janela selecionada.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardContent className="p-2">
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {entries.slice(0, maxItems).map((entry, i) => {
            const fresh = i < 2;
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded border px-2 py-1.5 transition-colors",
                  fresh
                    ? "border-red-500/40 bg-red-500/10"
                    : "border-border/50 bg-card hover:bg-muted/50"
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      fresh ? "bg-red-500 animate-pulse" : "bg-muted-foreground/40"
                    )}
                  />
                  {entry.device === "mobile" ? (
                    <Smartphone size={13} className="shrink-0 text-muted-foreground" />
                  ) : (
                    <Monitor size={13} className="shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">
                      <span className="font-mono text-muted-foreground">
                        #{entry.visitor}
                      </span>{" "}
                      entrou em{" "}
                      <span className="font-medium">
                        {stepLabels[entry.stepId] || entry.stepId}
                      </span>
                    </span>
                    {entry.source && (
                      <span className="truncate text-[10px] text-muted-foreground">
                        via {entry.source}
                      </span>
                    )}
                  </div>
                </div>

                <span
                  className={cn(
                    "shrink-0 text-[11px] tabular-nums",
                    fresh ? "font-semibold text-red-500" : "text-muted-foreground"
                  )}
                >
                  {timeAgo(entry.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
