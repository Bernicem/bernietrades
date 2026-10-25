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

export function runBacktest(cfg: BacktestConfig, prices: number[], digits: number[]) {
  const N = prices.length;
  const split = Math.floor(N * cfg.trainFrac);
  // optimise threshold on training data only
  let bestZ = cfg.zCandidates[0], bestEv = -Infinity;
  const trainResults = cfg.zCandidates.map((z) => {
    const p = perf(simulate(cfg, prices, digits, 0, split, z));
    if (p.trades >= 10 && p.ev > bestEv) { bestEv = p.ev; bestZ = z; }
    return { z, ...p };
  });
  const test = perf(simulate(cfg, prices, digits, split, N, bestZ));
  // walk-forward: 4 folds, each optimised on the preceding segment
  const folds: { fold: number; z: number; perf: Perf }[] = [];
  const seg = Math.floor(N / 5);
  for (let f = 1; f <= 4; f++) {
    let fz = cfg.zCandidates[0], fe = -Infinity;
    for (const z of cfg.zCandidates) {
      const p = perf(simulate(cfg, prices, digits, (f - 1) * seg, f * seg, z));
      if (p.trades >= 5 && p.ev > fe) { fe = p.ev; fz = z; }
    }
    folds.push({ fold: f, z: fz, perf: perf(simulate(cfg, prices, digits, f * seg, (f + 1) * seg, fz)) });
  }
  const base = theoreticalP(cfg.contract, cfg.barrier);
  const baselineEv = base * (cfg.payoutTotal - cfg.stake) - (1 - base) * cfg.stake;
  return { split, bestZ, trainResults, test, folds, base, baselineEv };
}
