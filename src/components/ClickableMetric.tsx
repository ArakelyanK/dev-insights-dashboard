import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ClickableMetricProps {
  value: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export function ClickableMetric({ value, onClick, className, disabled }: ClickableMetricProps) {
  if (!onClick || disabled) {
    return <span className={className}>{value}</span>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center cursor-pointer hover:underline hover:text-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary/20 rounded",
        className
      )}
    >
      {value}
    </button>
  );
}
