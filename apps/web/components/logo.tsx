import { useId } from "react";

const cn = (...c: (string | undefined | false)[]) => c.filter(Boolean).join(" ");

/**
 * The Settle mark: two payment rails flow into one settlement point, which lands on a ledger line.
 * "Money from anywhere, settled." Drawn on a 32-unit grid so it stays crisp from 16px (favicon) up.
 */
export function LogoMark({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs>
        <linearGradient id={`${id}-t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e3f0ff" />
          <stop offset="0.5" stopColor="#82b4ff" />
          <stop offset="1" stopColor="#2e5ff5" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}-t)`} />
      <g fill="none" stroke="#04102e" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.5 7.5c0 6 7.5 5 7.5 10.5" />
        <path d="M23.5 7.5c0 6-7.5 5-7.5 10.5" />
        <path d="M9 24h14" />
      </g>
      <circle cx="16" cy="19" r="2.6" fill="#04102e" />
    </svg>
  );
}

/** Mark + wordmark. */
export function Logo({ size = 24, className, wordClassName }: { size?: number; className?: string; wordClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} className="drop-shadow-[0_0_14px_rgb(110_160_255/0.45)]" />
      <span className={cn("text-[17px] font-medium tracking-[-0.02em]", wordClassName)}>Settle</span>
    </span>
  );
}
