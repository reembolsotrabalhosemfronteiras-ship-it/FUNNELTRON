import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

// Nocturne: o primário é um contorno do accent, nunca um preenchimento sólido.
const variants: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  outline: "btn btn-secondary",
  ghost: "btn btn-ghost",
  danger: "btn btn-danger",
};

const sizes: Record<Size, string> = {
  sm: "btn-sm",
  md: "",
  lg: "text-base px-6 py-2.5",
  icon: "w-9 h-9 p-0",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", loading, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          variants[variant],
          sizes[size],
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          className
        )}
        {...props}
      >
        {loading && <Spinner size={size === "sm" ? 14 : 16} />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
