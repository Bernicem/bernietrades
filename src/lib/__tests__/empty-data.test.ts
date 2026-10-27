import { describe, expect, it } from "vitest";
import { backtestInvalidReason, perf, runBacktest } from "../backtest";
import { binomZ, buildSignal, chiSquareUniform, classify, detectRegime, rankSignals, volatility, wilson } from "../stats";
import { feedState, parseLiveTick, sanitizeHistory } from "../ticks";

const cfg = { contract: "EVEN" as const, barrier: 5, lookback: 50, duration: 1, zCandidates: [1, 2], trainFrac: 0.6, stake: 1, payoutTotal: 1.95 };

describe("empty and tiny inputs", () => {
  it("empty arrays give 'Insufficient Data', never a signal", () => {
    const s = buildSignal("EVEN", [], [], 100);
    expect(s.n).toBe(0); expect(s.strength).toBe("Insufficient Data"); expect(Number.isFinite(s.z)).toBe(true);
  });
  it("one observation is insufficient", () => {
    expect(buildSignal("MATCHES", [1000], [7], 100, 7).strength).toBe("Insufficient Data");
  });
  it("99 samples is insufficient even with an extreme z; 100 is enough", () => {
    expect(classify(10, 99)).toBe("Insufficient Data");
    expect(classify(10, 100)).toBe("Strong Statistical Deviation");
  });
  it("chi-square on no data is flagged inadequate", () => { expect(chiSquareUniform(new Array(10).fill(0)).adequate).toBe(false); });
  it("wilson on 0 samples is the uninformative [0,1]", () => { expect(wilson(0, 0)).toEqual([0, 1]); });
  it("binomZ never returns NaN/Infinity for impossible contracts (p=0 or 1) or n=0", () => {
    expect(binomZ(0, 100, 0)).toBe(0); expect(binomZ(100, 100, 1)).toBe(0); expect(binomZ(0, 0, 0.5)).toBe(0);
  });
  it("volatility percentile is unknown (NaN), not 0 / 'Low volatility', with too few ticks", () => {
    const prices = Array.from({ length: 60 }, (_, i) => 1000 + (i % 3));
    expect(Number.isNaN(volatility(prices, 100).pct)).toBe(true);
    expect(detectRegime(prices, prices.map(() => 1), 100).tags).not.toContain("Low volatility");
  });
  it("insufficient rows never outrank eligible ones", () => {
    const r = rankSignals([{ z: 9, strength: "Insufficient Data" as const }, { z: 0.1, strength: "No Meaningful Deviation" as const }]);
    expect(r[0].strength).toBe("No Meaningful Deviation");
  });
});

describe("zero-trade and single-trade metrics", () => {
  it("zero trades: win rate, EV, profit factor and Sharpe are undefined (NaN), not 0", () => {
    const p = perf([]);
    expect(p.trades).toBe(0); expect(p.winRate).toBeNaN(); expect(p.ev).toBeNaN(); expect(p.profitFactor).toBeNaN(); expect(p.sharpe).toBeNaN();
  });
  it("one trade: Sharpe undefined; one win and no losses → profit factor ∞", () => {
    const p = perf([{ i: 0, win: true, pnl: 0.95 }]);
    expect(p.sharpe).toBeNaN(); expect(p.profitFactor).toBe(Infinity); expect(p.ev).toBeCloseTo(0.95);
  });
  it("genuine zero wins is a real result (win rate 0, finite EV), distinct from no trades", () => {
    const p = perf([{ i: 0, win: false, pnl: -1 }, { i: 1, win: false, pnl: -1 }]);
    expect(p.winRate).toBe(0); expect(p.ev).toBe(-1); expect(p.profitFactor).toBe(0); expect(p.maxDD).toBe(2);
  });
  it("backtest refuses too-short history, bad payout and impossible contracts", () => {
    expect(backtestInvalidReason(cfg, 299)).toMatch(/300/);
    expect(backtestInvalidReason({ ...cfg, payoutTotal: 1 }, 3000)).toMatch(/payout/i);
    expect(backtestInvalidReason({ ...cfg, payoutTotal: NaN }, 3000)).toMatch(/payout/i);
    expect(backtestInvalidReason({ ...cfg, lookback: NaN }, 3000)).toMatch(/Lookback/);
    expect(backtestInvalidReason({ ...cfg, contract: "UNDER", barrier: 0 }, 3000)).toMatch(/never/);
    expect(backtestInvalidReason(cfg, 3000)).toBeNull();
  });
  it("constant data yields no threshold rather than a fabricated strategy", () => {
    const r = runBacktest(cfg, new Array(400).fill(1000), new Array(400).fill(1)); // all odd → EVEN z very negative
    expect(r.bestZ).toBeNull(); expect(r.test).toBeNull();
  });
});

describe("invalid ticks", () => {
  it("drops NaN, Infinity, strings, non-positive, duplicate and out-of-order ticks", () => {
    const t = sanitizeHistory([100.12, NaN, "x", Infinity, -5, 100.15, 100.2, 100.3], [1, 2, 3, 4, 5, 6, 6, 5], 2);
    expect(t.map((x) => x.epoch)).toEqual([1, 6]);
  });
  it("non-array history → empty list", () => { expect(sanitizeHistory(undefined, null, 2)).toEqual([]); });
  it("live tick validation", () => {
    expect(parseLiveTick({ quote: NaN, epoch: 1 }, 2)).toBeNull();
    expect(parseLiveTick(null, 2)).toBeNull();
    expect(parseLiveTick({ quote: 1234.5, epoch: 9 }, 2)).toEqual({ epoch: 9, quote: 1234.5, digit: 0 });
  });
});

describe("feed state", () => {
  const base = { status: "live" as const, lastAt: 1000, now: 1000, error: null, tickCount: 100 };
  it("fresh ticks on an open connection are live", () => { expect(feedState(base)).toBe("live"); });
  it("older than 10s is stale", () => { expect(feedState({ ...base, now: 11_001 })).toBe("stale"); });
  it("disconnect and reconnect states win over old ticks", () => {
    expect(feedState({ ...base, status: "offline" })).toBe("offline");
    expect(feedState({ ...base, status: "reconnecting" })).toBe("reconnecting");
  });
  it("no ticks yet is loading, an error is an error", () => {
    expect(feedState({ ...base, tickCount: 0, lastAt: null })).toBe("loading");
    expect(feedState({ ...base, error: "boom" })).toBe("error");
  });
});
