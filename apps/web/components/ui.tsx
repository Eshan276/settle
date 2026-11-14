"use client";
import { forwardRef, useId, useState } from "react";
import { Check, Copy, Loader2, AlertTriangle, RotateCw } from "lucide-react";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

const focus = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,color,box-shadow,transform,filter] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        focus,
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-[18px] text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variant === "primary" && "bg-[image:var(--pill)] text-primary-foreground shadow-[var(--pill-glow)] hover:brightness-110",
        variant === "secondary" && "bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--border)] hover:bg-accent",
        variant === "ghost" && "text-foreground hover:bg-muted",
        variant === "destructive" && "bg-destructive-soft text-destructive shadow-[inset_0_0_0_1px_rgb(255_106_94/0.35)] hover:bg-destructive/20",
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass min-w-0 rounded-[22px] text-card-foreground", className)} {...p} />;
}

export function CardHeader({ title, description, action }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[17px] font-normal tracking-tight">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const descId = hint || error ? `${id}-desc` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": descId, "aria-invalid": error ? true : undefined })}
      {(error || hint) && (
        <p id={descId} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-xl border border-input bg-[var(--field)] px-3 text-sm transition-colors placeholder:text-muted-foreground/70 hover:border-[var(--input-hover)] aria-[invalid=true]:border-destructive",
        focus,
        className,
      )}
      {...p}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn("min-h-28 w-full rounded-xl border border-input bg-[var(--field)] px-3 py-2 text-sm placeholder:text-muted-foreground/70", focus, className)} {...p} />;
});

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-10 w-full rounded-xl border border-input bg-[var(--field)] px-3 text-sm", focus, className)} {...p} />;
}

const badgeTone: Record<string, string> = {
  paid: "bg-accent text-accent-foreground",
  active: "bg-accent text-accent-foreground",
  approved: "bg-accent text-accent-foreground",
  claimed: "bg-accent text-accent-foreground",
  ready: "bg-accent text-accent-foreground",
  success: "bg-accent text-accent-foreground",
  open: "bg-muted text-foreground",
  sent: "bg-muted text-foreground",
  pending: "bg-warning-soft text-warning",
  pending_approval: "bg-warning-soft text-warning",
  needs_review: "bg-warning-soft text-warning",
  past_due: "bg-warning-soft text-warning",
  processing: "bg-warning-soft text-warning",
  cancelled: "bg-muted text-muted-foreground",
  completed: "bg-muted text-muted-foreground",
  rejected: "bg-destructive-soft text-destructive",
  failed: "bg-destructive-soft text-destructive",
};

export function Badge({ status, children }: { status: string; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium capitalize", badgeTone[status.toLowerCase()] ?? "bg-muted text-foreground")}>
      {children ?? status.replace(/_/g, " ")}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-md bg-muted", className)} />;
}

export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y" aria-label="Loading" role="status">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 grid size-10 place-items-center rounded-full bg-accent text-accent-foreground shadow-[inset_0_0_0_1px_var(--border)]">{icon}</div>}
      <p className="font-medium">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted-foreground">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <AlertTriangle className="size-5 text-destructive" aria-hidden />
      <p className="max-w-md text-sm text-muted-foreground">{error}</p>
      {retry && (
        <Button variant="secondary" size="sm" onClick={retry}>
          <RotateCw className="size-3.5" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      aria-label={done ? "Copied" : label}
      className={cn("grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", focus)}
    >
      {done ? <Check className="size-3.5 text-primary" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[13px] tnum", className)}>{children}</span>;
}

export function Address({ value, className }: { value: string; className?: string }) {
  const short = value.length > 30 ? `${value.slice(0, 14)}…${value.slice(-12)}` : value;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)} title={value}>
      <Mono className="truncate">{short}</Mono>
      <CopyButton value={value} label={`Copy ${value}`} />
    </span>
  );
}

export function Tabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex rounded-full p-1 shadow-[inset_0_0_0_1px_var(--border)]">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors",
            focus,
            value === it.value ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--input)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="text-2xl font-medium tracking-[-0.03em] tnum">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
