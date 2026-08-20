import {
  useState,
  useEffect,
  createContext,
  useContext,
  ReactNode,
} from "react";
import { Sun, Moon, Menu, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { Modal } from "./Modal";

interface ThemeContextType {
  dark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

const THEME_KEY = "funil-analytics:theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    // Escolha salva ganha da preferência do sistema; sem escolha, segue o SO.
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark") return true;
    if (saved === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  // Aplica no <html> já na montagem, senão o estado inicial vindo do SO não
  // pinta nada até o primeiro clique no botão.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ dark, toggle }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme deve ser usado dentro de ThemeProvider");
  return ctx;
}

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const { dark, toggle } = useTheme();

  return (
    <header className="min-h-16 border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
      {/* Não é h-16 fixo: um subtítulo longo (ex. "Visão global · todos os
          3 funis · 30 dias") quebra linha, e com altura fixa o conteúdo
          transbordava — as ações (fonte, período) ficavam soltas acima do
          título em vez de alinhadas ao lado dele. */}
      <div className="min-h-16 px-4 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? "Tema claro" : "Tema escuro"}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </div>
      </div>
    </header>
  );
}