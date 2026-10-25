import { describe, expect, it } from "vitest";
import { perf, runBacktest, selectThreshold } from "../backtest";

const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
function series(n: number, seed = 7) {
  const r = rng(seed); const prices = [1000]; for (let i = 1; i < n; i++) prices.push(prices[i - 1] + (r() - 0.5));
  return { prices, digits: prices.map(() => Math.floor(r() * 10)) };
}
const cfg = { contract: "EVEN" as const, barrier: 5, lookback: 50, duration: 1, zCandidates: [1, 1.5, 2, 2.5, 3], trainFrac: 0.6, stake: 1, payoutTotal: 1.95 };

describe("backtest", () => {
  it("never picks a zero-trade threshold even if its EV (0) beats negative EVs", () => {
    expect(selectThreshold([{ z: 1, trades: 50, ev: -0.1 }, { z: 2, trades: 0, ev: 0 }], 10)).toBe(1);
  });
  it("returns no threshold instead of defaulting when none has enough trades", () => {
    expect(selectThreshold([{ z: 1, trades: 3, ev: 0.5 }], 10)).toBeNull();
  });
  it("walk-forward folds are chronological, disjoint and never touch the final test", () => {
    const { prices, digits } = series(3000);
    const r = runBacktest(cfg, prices, digits);
    r.folds.forEach((f, k) => { expect(f.to).toBeLessThanOrEqual(r.split); if (k) expect(f.from).toBeGreaterThanOrEqual(r.folds[k - 1].to); });
  });
  it("test result does not change when ticks after the test window are altered, and signals ignore future ticks", () => {
    const { prices, digits } = series(3000);
    const a = runBacktest(cfg, prices, digits);
    const d2 = digits.slice(); for (let i = a.split; i < d2.length; i++) d2[i] = 0; // change only test-period ticks
    const b = runBacktest(cfg, prices, d2);
    expect(b.bestZ).toBe(a.bestZ); // selection uses training data only
  });
  it("EV, profit factor and drawdown at 1.95 payout", () => {
    const p = perf([{ i: 0, win: true, pnl: 0.95 }, { i: 1, win: false, pnl: -1 }, { i: 2, win: false, pnl: -1 }]);
    expect(p.ev).toBeCloseTo(-1.05 / 3); expect(p.profitFactor).toBeCloseTo(0.475); expect(p.maxDD).toBeCloseTo(2);
  });
});
