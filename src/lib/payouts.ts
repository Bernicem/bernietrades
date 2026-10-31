// Per-contract payout settings for the Backtest. Pure, no UI.
// Convention: payout = TOTAL return per 1 stake, including the stake (win profit = payout − 1).
import { theoreticalP, needsBarrier, type ContractType } from "./stats";

// Illustrative house margin used only to prefill estimates. NOT an actual Deriv payout.
export const ILLUSTRATIVE_RETURN = 0.95;

export const payoutKey = (c: ContractType, barrier: number) => (needsBarrier(c) ? `${c}-${barrier}` : c);

// Illustrative estimate: ≈ 0.95 ÷ baseline probability. NaN for impossible/certain contracts.
export function estimatePayout(c: ContractType, barrier = 5): number {
  const p = theoreticalP(c, barrier);
  if (!(p > 0 && p < 1)) return NaN;
  return Math.round((ILLUSTRATIVE_RETURN / p) * 100) / 100;
}

// Expected profit per 1 stake if the contract wins at its random-chance baseline.
export function baselineEV(c: ContractType, barrier: number, payoutTotal: number): number {
  const p = theoreticalP(c, barrier);
  if (!(payoutTotal > 0)) return NaN;
  return p * (payoutTotal - 1) - (1 - p);
}

export const breakEvenP = (payoutTotal: number) => (payoutTotal > 1 ? 1 / payoutTotal : NaN);

export function payoutWarnings(c: ContractType, barrier: number, payoutTotal: number): string[] {
  const p = theoreticalP(c, barrier);
  const label = needsBarrier(c) ? `${c} ${barrier}` : c;
  const w: string[] = [];
  if (!(p > 0 && p < 1)) { w.push(`${label} can never win or always wins — no payout makes it a meaningful trade.`); return w; }
  if (!Number.isFinite(payoutTotal) || payoutTotal <= 1) { w.push("Total payout must be greater than 1 (the stake), otherwise a win makes no profit."); return w; }
  const ev = baselineEV(c, barrier, payoutTotal);
  const be = 1 / payoutTotal;
  if (ev > 0) w.push(`At this payout ${label} would profit at pure random chance (${(p * 100).toFixed(0)}% win, break-even ${(be * 100).toFixed(1)}%). Real Deriv payouts are below this — check the value.`);
  else if (ev < -0.25) w.push(`At this payout break-even is ${(be * 100).toFixed(1)}% but ${label} only wins about ${(p * 100).toFixed(0)}% by chance (EV ${ev.toFixed(3)} per stake). This payout looks too low for ${label}.`);
  return w;
}

// Settings that produced a backtest run, so results can be labelled and flagged as outdated.
export interface RunSettings { contract: ContractType; barrier: number | null; payout: number }
export const runSettings = (c: ContractType, barrier: number, payout: number): RunSettings => ({ contract: c, barrier: needsBarrier(c) ? barrier : null, payout });
export const runLabel = (s: RunSettings) => (s.barrier === null ? s.contract : `${s.contract} ${s.barrier}`);
export const settingsChanged = (ran: RunSettings, now: RunSettings) => ran.contract !== now.contract || ran.barrier !== now.barrier || ran.payout !== now.payout;
