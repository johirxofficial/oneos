import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Logo({ size = 40, glow = true }: { size?: number; glow?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      style={glow ? { filter: "drop-shadow(0 0 14px rgba(79,157,255,0.45))" } : undefined}
    >
      <defs>
        <linearGradient id="oneos-grad" x1="6" y1="4" x2="44" y2="44">
          <stop stopColor="#7b61ff" />
          <stop offset="0.55" stopColor="#4f9dff" />
          <stop offset="1" stopColor="#37d399" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="17.5" stroke="url(#oneos-grad)" strokeWidth="2.5" opacity="0.9" />
      <path
        d="M24 10.5v13.2a5.6 5.6 0 1 0 4.2 5.45"
        stroke="url(#oneos-grad)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="31.5" cy="16.5" r="2.6" fill="url(#oneos-grad)" />
    </svg>
  );
}

type Variant = "primary" | "ghost" | "subtle" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[color:var(--oneos-accent)] text-slate-950 hover:brightness-110 shadow-glow border border-white/10",
  ghost:
    "bg-white/[0.04] text-oneos-text hover:bg-white/[0.09] border border-white/10",
  subtle: "bg-transparent text-oneos-muted hover:text-oneos-text hover:bg-white/5",
  danger: "bg-oneos-danger/15 text-oneos-danger hover:bg-oneos-danger/25 border border-oneos-danger/30",
};

export function Button({
  variant = "ghost",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-[color:var(--oneos-accent)]" : "bg-white/12"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-oneos-muted">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-[11px] text-oneos-muted/80">{hint}</span> : null}
    </label>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "ok" | "warn" | "danger" | "accent";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-white/6 text-oneos-muted border-white/10",
    ok: "bg-oneos-ok/12 text-oneos-ok border-oneos-ok/25",
    warn: "bg-oneos-warn/12 text-oneos-warn border-oneos-warn/25",
    danger: "bg-oneos-danger/12 text-oneos-danger border-oneos-danger/25",
    accent: "bg-[color:var(--oneos-accent)]/12 text-[color:var(--oneos-accent)] border-[color:var(--oneos-accent)]/25",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Meter({
  value,
  tone = "accent",
  className = "",
}: {
  value: number;
  tone?: "accent" | "ok" | "warn" | "danger";
  className?: string;
}) {
  const colors: Record<string, string> = {
    accent: "bg-[color:var(--oneos-accent)]",
    ok: "bg-oneos-ok",
    warn: "bg-oneos-warn",
    danger: "bg-oneos-danger",
  };
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/8 ${className}`}>
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${colors[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-white/15 border-t-[color:var(--oneos-accent)]"
      style={{ width: size, height: size }}
    />
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      {icon ? <div className="text-oneos-muted/70">{icon}</div> : null}
      <div className="text-[13px] font-semibold text-oneos-text">{title}</div>
      {detail ? <div className="max-w-sm text-[12px] leading-relaxed text-oneos-muted">{detail}</div> : null}
      {action}
    </div>
  );
}
