import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Nome da área protegida — aparece na mensagem e no console. */
  area: string;
}

interface State {
  error: Error | null;
}

/**
 * Barreira de erro.
 *
 * Sem ela, uma exceção durante o render ou dentro de um `useEffect` faz o
 * React 18 desmontar a árvore INTEIRA: some tudo — cabeçalho, abas, vendas —
 * e sobra o fundo da página, que no tema escuro é preto. Foi exatamente esse
 * o sintoma de "a tela fica preta do nada": não era um problema de layout, era
 * um erro sem ninguém para segurar.
 *
 * Aqui o estrago para na seção. O resto da página continua de pé e a mensagem
 * mostra o que quebrou, em vez de deixar a pessoa olhando para o vazio.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area}] quebrou:`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-500" size={18} />
          <div className="min-w-0 space-y-2">
            <h3 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
              Algo quebrou em “{this.props.area}”.
            </h3>
            <p className="text-xs text-muted-foreground">
              O resto da página continua funcionando. Recarregue para tentar de
              novo — se repetir, o detalhe abaixo diz o que foi.
            </p>
            <pre className="max-h-40 overflow-auto rounded bg-background/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
              {error.message}
            </pre>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-amber-500/50 px-2.5 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
            >
              Tentar de novo
            </button>
          </div>
        </div>
      </div>
    );
  }
}
