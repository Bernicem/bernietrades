import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Strength } from "@/lib/stats";

export function Panel({ title, children, className, right }: { title?: string | undefined; children: ReactNode; className?: string | undefined; right?: ReactNode }) {
  return (
    <section className={cn("rounded-md border border-border bg-card p-4", className)}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode | undefined; tone?: "up" | "down" | "warn" | undefined }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("num truncate text-lg font-semibold", tone === "up" && "text-success", tone === "down" && "text-destructive", tone === "warn" && "text-warning")}>{value}</div>
      {sub && <div className="num text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function StrengthBadge({ s }: { s: Strength }) {
  const tone =
    s.startsWith("Strong") ? "border-destructive/60 text-destructive" :
    s.startsWith("Moderate") ? "border-warning/60 text-warning" :
    s.startsWith("Weak") ? "border-chart-3/60 text-chart-3" :
    s.startsWith("Insufficient") ? "border-border text-muted-foreground" : "border-success/40 text-success";
  return <span className={cn("inline-block rounded border px-2 py-0.5 text-[11px] font-medium", tone)}>{s}</span>;
}

export function Seg<T extends string | number>({ value, options, onChange, fmt }: { value: T; options: T[]; onChange: (v: T) => void; fmt?: ((v: T) => string) | undefined }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button key={String(o)} onClick={() => onChange(o)}
          className={cn("num rounded px-2 py-1 text-xs transition-colors", o === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary")}>
          {fmt ? fmt(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
