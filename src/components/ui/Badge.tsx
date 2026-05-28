import { cn } from "@/lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "critical" | "warning" | "info" | "neutral" | "rise" | "fall";
  className?: string;
}

const variants = {
  critical: "bg-red-100 text-red-700 border border-red-200",
  warning: "bg-yellow-100 text-yellow-700 border border-yellow-200",
  info: "bg-green-100 text-green-700 border border-green-200",
  neutral: "bg-gray-100 text-gray-700 border border-gray-200",
  rise: "bg-red-50 text-red-600 border border-red-100",
  fall: "bg-blue-50 text-blue-600 border border-blue-100",
};

export function Badge({ children, variant = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
