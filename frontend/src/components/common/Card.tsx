import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Nocturne: superfície de card. `.elev-sm` é a borda-fina + sombra ambiente
// tunada pro fundo escuro; radius 8px (rounded-md) como no mockup.
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md bg-card text-card-foreground elev-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[18px] pb-2.5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("card-title", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("card-body", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-[18px] pt-2.5", className)} {...props} />;
}
