import { cn } from "@/lib/cn";

export interface LiveTab {
  key: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
}

interface LiveTabsProps {
  tabs: LiveTab[];
  active: string;
  onChange: (key: string) => void;
}

export function LiveTabs({ tabs, active, onChange }: LiveTabsProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg bg-muted/50 p-1">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-bold",
                  isActive ? "bg-primary/20 text-primary" : "bg-muted-foreground/20"
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
