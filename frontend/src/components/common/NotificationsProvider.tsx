import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Lightning as Zap, X } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import { onPushMessage, resumePushIfEnabled, type PushMessage } from "@/lib/push";

interface Toast extends PushMessage {
  id: number;
}

interface NotificationsContextType {
  /** Mostra o container arredondado no canto inferior direito. */
  notify: (msg: PushMessage) => void;
}

const NotificationsContext = createContext<NotificationsContextType | null>(null);

const TOAST_TTL_MS = 8000;

/**
 * Monta uma vez, no topo do app: reinscreve push silenciosamente (se o
 * usuário já tinha ativado antes) e escuta tanto o service worker (venda
 * chegou com a aba em segundo plano mas ainda focada — não deveria
 * acontecer, ver `sw.js`) quanto chamadas diretas de `notify()` feitas pelas
 * telas que detectam venda nova via polling.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const navigate = useNavigate();

  const notify = useCallback((msg: PushMessage) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { ...msg, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const dismiss = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  useEffect(() => {
    void resumePushIfEnabled();
    return onPushMessage(notify);
  }, [notify]);

  return (
    <NotificationsContext.Provider value={{ notify }}>
      {children}

      {/* Canto inferior direito, empilhando a mais nova por cima. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-2xl border border-border/60",
              "bg-card p-4 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-300"
            )}
          >
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
              <Zap size={16} />
            </div>
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                dismiss(t.id);
                navigate(t.url);
              }}
            >
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.body}</p>
            </button>
            <button
              type="button"
              aria-label="Fechar"
              className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => dismiss(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications deve ser usado dentro de NotificationsProvider");
  return ctx;
}
