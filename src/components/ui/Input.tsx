import { cn } from "@/lib/utils";
import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  autoFilled?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, autoFilled, id, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={id} className="text-sm font-medium text-gray-700 flex items-center gap-1">
            {label}
            {autoFilled && (
              <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-normal">
                자동입력
              </span>
            )}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          className={cn(
            "w-full px-3 py-2 text-sm border rounded-lg outline-none transition-colors",
            "placeholder:text-gray-400",
            error
              ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500"
              : "border-gray-300 focus:border-[#0A2A5E] focus:ring-1 focus:ring-[#0A2A5E]",
            autoFilled && "bg-green-50 border-green-300",
            className
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
