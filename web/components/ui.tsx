import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

// Small building blocks shared by every page. They carry the look; pages carry the content.

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-lg border border-border bg-surface", className)}>{children}</section>;
}

export function CardHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:opacity-85",
  secondary: "border border-border-strong bg-surface hover:bg-surface-hover",
  danger: "border border-danger/40 text-danger hover:bg-danger-surface",
  ghost: "text-muted hover:bg-surface-hover hover:text-foreground",
};

export function Button({ variant = "secondary", pending = false, className, children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; pending?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled === true || pending}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-[background-color,opacity] disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariants[variant],
        className,
      )}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner() {
  return <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-border-strong bg-surface px-3 text-sm placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-hover text-muted",
  success: "border-success/30 bg-success-surface text-success",
  warning: "border-warning/30 bg-warning-surface text-warning",
  danger: "border-danger/30 bg-danger-surface text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", badgeTones[tone])}>{children}</span>;
}

// An on/off control. The label is part of the hit target and names the switch for assistive tech.
export function Switch({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-4 py-3", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className={cn("block text-sm font-medium", disabled && "text-subtle")}>{label}</span>
        {description ? <span className="mt-0.5 block text-sm text-muted">{description}</span> : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span aria-hidden="true" className="h-5 w-9 rounded-full bg-border-strong transition-[background-color] peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-50" />
        <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

// The same on/off control for tight spots such as a table cell: the label is read out but not shown.
export function CompactSwitch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={cn("relative inline-flex align-middle", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <span className="sr-only">{label}</span>
      <input type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span aria-hidden="true" className="h-5 w-9 rounded-full bg-border-strong transition-[background-color] peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:opacity-50" />
      <span aria-hidden="true" className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-hover", className)} />;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

// Inline message for a failed request; announced to screen readers when it appears.
export function ErrorNote({ message }: { message: string | undefined }) {
  return (
    <p role="status" aria-live="polite" className={cn("text-sm text-danger", message ? "mt-2" : "sr-only")}>
      {message ?? ""}
    </p>
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </Card>
  );
}
