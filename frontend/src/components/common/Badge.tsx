import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import type { FunnelStatus } from "@/types";

const statusMap: Record<FunnelStatus, { label: string; class: string }> = {
  active: { label: "Ativo", class: "bg-success/15 text-success border-success/30" },
  inactive: { label: "Desativo", class: "bg-muted text-muted-foreground border-border" },
  testing: { label: "Em teste", class: "bg-warning/15 text-warning border-warning/30" },
};

export function StatusBadge({ status }: { status: FunnelStatus }) {
  const s = statusMap[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        s.class
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {s.label}
    </span>
  );
}

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info";
}

const variants = {
  default: "bg-muted text-muted-foreground border-border",
  success: "bg-success/15 text-success border-success/30",
  warning: "bg-warning/15 text-warning border-warning/30",
  danger: "bg-danger/15 text-danger border-danger/30",
  info: "bg-primary/15 text-primary border-primary/30",
};

export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
