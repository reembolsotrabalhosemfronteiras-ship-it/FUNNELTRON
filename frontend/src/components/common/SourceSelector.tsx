import { useCallback, useEffect, useState } from "react";
import { Database, Cloud, Columns2 } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DATA_SOURCE_LABELS,
  getDataSourcePreference,
  readLocalDataSource,
  setDataSourcePreference,
  type DataSource,
} from "@/api/client";

const OPTIONS: { value: DataSource; icon: React.ReactNode; hint: string }[] = [
  {
    value: "tracker",
    icon: <Database size={13} />,
    hint: "Nosso snippet. Mede agora, por sessão, em tempo real.",
  },
  {
    value: "clarity",
    icon: <Cloud size={13} />,
    hint: "Microsoft Clarity. Agrega por dia e publica com atraso — os números vêm carimbados com a data a que se referem.",
  },
  {
    value: "compare",
    icon: <Columns2 size={13} />,
    hint: "As duas lado a lado, cada uma rotulada. Nunca somadas: elas contam sessão de formas diferentes.",
  },
];

/**
 * Escolha da fonte de dados, compartilhada por Ao Vivo, Métricas e Funil.
 *
 * A escolha é global de propósito: alternar a fonte numa página e encontrar
 * outra página mostrando a outra fonte é o caminho mais curto para comparar
 * números que não são comparáveis.
 */
export function useDataSource() {
  // Abre já na última escolha conhecida (localStorage) e confirma com o
  // servidor depois — sem isso a tela pisca na fonte errada a cada carga.
  const [source, setSource] = useState<DataSource>(readLocalDataSource);

  useEffect(() => {
    let cancelled = false;
    getDataSourcePreference().then((s) => {
      if (!cancelled) setSource(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const change = useCallback((s: DataSource) => {
    setSource(s);
    void setDataSourcePreference(s);
  }, []);

  return { source, setSource: change };
}

export interface SourceSelectorProps {
  value: DataSource;
  onChange: (value: DataSource) => void;
  className?: string;
}

export function SourceSelector({ value, onChange, className }: SourceSelectorProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-muted-foreground">Fonte</span>
      <div className="flex items-center gap-0.5 rounded-md bg-muted/50 p-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            aria-pressed={value === opt.value}
            className={cn(
              "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors",
              value === opt.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.icon}
            {DATA_SOURCE_LABELS[opt.value]}
          </button>
        ))}
      </div>
    </div>
  );
}
