import { binomZ, contractHits, digitWins, theoreticalP, wilson, type ContractType } from "./stats";

export interface BacktestConfig {
  contract: ContractType;
  barrier: number;
  lookback: number; // ticks used to compute signal (past only)
  duration: number; // ticks until exit
  zCandidates: number[]; // thresholds optimised on train only
  trainFrac: number;
  stake: number;
  payoutTotal: number; // total return on win (stake + profit)
}

export interface Trade { i: number; win: boolean; pnl: number }
export interface Perf {
  trades: number; wins: number; losses: number; winRate: number; ci: [number, number];
  ev: number; profitFactor: number; maxDD: number; longestLoss: number; avg: number; sharpe: number; equity: number[];
}

function outcome(c: ContractType, prices: number[], digits: number[], i: number, dur: number, barrier: number) {
  const exit = i + dur;
  if (c === "RISE") return prices[exit] > prices[i];
  if (c === "FALL") return prices[exit] < prices[i];
  return digitWins(c, digits[exit], barrier);
}

// Signal at index i uses ONLY ticks [i-lookback+1 .. i]. Entry at i, exit at i+duration.
function simulate(cfg: BacktestConfig, prices: number[], digits: number[], from: number, to: number, zThr: number): Trade[] {
  const base = theoreticalP(cfg.contract, cfg.barrier);
  const trades: Trade[] = [];
  const profit = cfg.payoutTotal - cfg.stake;
  let i = Math.max(from, cfg.lookback);
  while (i + cfg.duration < to) {
    const p = prices.slice(i - cfg.lookback, i + 1);
    const d = digits.slice(i - cfg.lookback + 1, i + 1);
    const { hit, n } = contractHits(cfg.contract, p, d, cfg.barrier);
    const z = binomZ(hit, n, base);
    if (z >= zThr) {
      const win = outcome(cfg.contract, prices, digits, i, cfg.duration, cfg.barrier);
      trades.push({ i, win, pnl: win ? profit : -cfg.stake });
      i += cfg.duration; // no overlapping positions
    } else i++;
  }
  return trades;
}

export function perf(trades: Trade[]): Perf {
  const wins = trades.filter((t) => t.win).length;
  let eq = 0, peak = 0, maxDD = 0, ls = 0, longest = 0, gp = 0, gl = 0;
  const equity = [0];
  for (const t of trades) {
    eq += t.pnl; equity.push(eq);
    peak = Math.max(peak, eq); maxDD = Math.max(maxDD, peak - eq);
    if (t.win) { ls = 0; gp += t.pnl; } else { ls++; longest = Math.max(longest, ls); gl -= t.pnl; }
  }
  const n = trades.length;
  const avg = n ? eq / n : 0;
  const sd = n > 1 ? Math.sqrt(trades.reduce((s, t) => s + (t.pnl - avg) ** 2, 0) / (n - 1)) : 0;
  return { trades: n, wins, losses: n - wins, winRate: n ? wins / n : 0, ci: wilson(wins, n), ev: avg, profitFactor: gl ? gp / gl : gp ? Infinity : 0, maxDD, longestLoss: longest, avg, sharpe: sd ? avg / sd : 0, equity };
}

export const MIN_TRAIN_TRADES = 10;
export const MIN_FOLD_TRAIN_TRADES = 5;
export const MIN_RELIABLE_TRADES = 30;

// Pick the threshold with the best EV among thresholds that produced enough trades.
// Thresholds with too few (or zero) trades are never eligible, so "0 trades → EV 0" can't win.
// Returns null when no threshold qualifies — we never silently fall back to a default.
export function selectThreshold(results: { z: number; trades: number; ev: number }[], minTrades: number): number | null {
  let best: number | null = null, bestEv = -Infinity;
  for (const r of results) if (r.trades >= minTrades && r.ev > bestEv) { bestEv = r.ev; best = r.z; }
  return best;
}

export interface Fold { fold: number; z: number | null; trainEv: number | null; from: number; to: number; perf: Perf | null }

export function runBacktest(cfg: BacktestConfig, prices: number[], digits: number[]) {
  const N = prices.length;
  const split = Math.floor(N * cfg.trainFrac);
  // 1) Final test: threshold chosen on [0, split) only, reported on [split, N).
  const trainResults = cfg.zCandidates.map((z) => ({ z, ...perf(simulate(cfg, prices, digits, 0, split, z)) }));
  const bestZ = selectThreshold(trainResults, MIN_TRAIN_TRADES);
  const bestTrainEv = bestZ === null ? null : trainResults.find((r) => r.z === bestZ)!.ev;
  const test = bestZ === null ? null : perf(simulate(cfg, prices, digits, split, N, bestZ));
  // 2) Walk-forward runs INSIDE the training period only, so it never reuses the final test data.
  //    Training period is cut into 5 chronological blocks; fold k picks a threshold on block k
  //    and evaluates it on block k+1 (later, non-overlapping).
  const folds: Fold[] = [];
  const seg = Math.floor(split / 5);
  for (let f = 1; f <= 4; f++) {
    const tr = cfg.zCandidates.map((z) => ({ z, ...perf(simulate(cfg, prices, digits, (f - 1) * seg, f * seg, z)) }));
    const fz = selectThreshold(tr, MIN_FOLD_TRAIN_TRADES);
    const from = f * seg, to = f === 4 ? split : (f + 1) * seg;
    folds.push({ fold: f, z: fz, trainEv: fz === null ? null : tr.find((r) => r.z === fz)!.ev, from, to, perf: fz === null ? null : perf(simulate(cfg, prices, digits, from, to, fz)) });
  }
  const base = theoreticalP(cfg.contract, cfg.barrier);
  const baselineEv = base * (cfg.payoutTotal - cfg.stake) - (1 - base) * cfg.stake;
  const breakEven = cfg.stake / cfg.payoutTotal;
  return { N, split, bestZ, bestTrainEv, trainResults, test, folds, base, baselineEv, breakEven };
}
