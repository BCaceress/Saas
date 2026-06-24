import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-11 w-full rounded-[var(--radius)] border border-line-strong bg-surface px-4 text-sm text-ink",
      "placeholder:text-faint transition-colors",
      "focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-24 w-full rounded-[var(--radius)] border border-line-strong bg-surface px-4 py-3 text-sm text-ink",
      "placeholder:text-faint transition-colors",
      "focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Classe do wrapper (controla largura). Padrão: ocupa toda a largura. */
  containerClassName?: string;
}

/**
 * Select padronizado — componente único de seleção do app.
 *
 * Esconde a seta nativa do SO (`appearance-none`, inconsistente entre browsers
 * e feia no modo claro) e desenha um chevron próprio com os tokens de design.
 * Mesma altura/raio/foco do Input para alinhar em formulários e barras de filtro.
 * Largura via `containerClassName` (ex.: "w-auto", "w-44") — o <select> sempre
 * preenche o wrapper.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, children, ...props }, ref) => (
    <div className={cn("relative w-full", containerClassName)}>
      <select
        ref={ref}
        className={cn(
          "h-11 w-full appearance-none rounded-[var(--radius)] border border-line-strong bg-surface pl-4 pr-9 text-sm text-ink",
          "cursor-pointer transition-colors hover:border-faint",
          "focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ring)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  )
);
Select.displayName = "Select";
