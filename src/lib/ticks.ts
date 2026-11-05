// Pure tick validation and feed-state logic (no React, no network) so it can be unit-tested.
import { lastDigit } from "./stats";
import type { ConnStatus, Tick } from "./deriv";

export const STALE_AFTER_SEC = 10;

// Deriv sends precision in two formats: active_symbols gives a fractional pip (0.01, 0.001),
// ticks / ticks_history give a decimal count (2, 3). Accept either; null if unusable.
export function pipDecimals(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  if (v < 1) return Math.max(0, Math.round(-Math.log10(v)));
  return Number.isInteger(v) && v <= 10 ? v : null;
}

const valid = (q: unknown, e: unknown): q is number => typeof q === "number" && Number.isFinite(q) && q > 0 && typeof e === "number" && Number.isFinite(e) && e > 0;

// Drops non-numeric, non-finite, non-positive, duplicate and out-of-order ticks.
export function sanitizeHistory(prices: unknown, times: unknown, decimals: number): Tick[] {
  if (!Array.isArray(prices) || !Array.isArray(times)) return [];
  const out: Tick[] = [];
  for (let i = 0; i < Math.min(prices.length, times.length); i++) {
    const q = prices[i], e = times[i];
    if (!valid(q, e)) continue;
    if (out.length && (e as number) <= out[out.length - 1].epoch) continue;
    out.push({ epoch: e as number, quote: q, digit: lastDigit(q, decimals) });
  }
  return out;
}

export function parseLiveTick(t: unknown, decimals: number): Tick | null {
  if (!t || typeof t !== "object") return null;
  const { quote, epoch } = t as { quote: unknown; epoch: unknown };
  return valid(quote, epoch) ? { epoch: epoch as number, quote, digit: lastDigit(quote, decimals) } : null;
}

export type FeedState = "loading" | "live" | "stale" | "reconnecting" | "offline" | "error";

// One answer to "can the numbers on screen be treated as current?" — only "live" means yes.
export function feedState(o: { status: ConnStatus; lastAt: number | null; now: number; error: string | null; tickCount: number }): FeedState {
  if (o.status === "offline") return "offline";
  if (o.status === "reconnecting") return "reconnecting";
  if (o.error) return "error";
  if (o.status === "connecting" || o.lastAt === null || o.tickCount === 0) return "loading";
  return (o.now - o.lastAt) / 1000 > STALE_AFTER_SEC ? "stale" : "live";
}
