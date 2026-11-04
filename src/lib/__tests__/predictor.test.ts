import { describe, expect, it } from "vitest";
import { argmax, breakEven, contiguousTail, decayFreq, evenOddLean, evPerTrade, markovRow, normalize, predict, rollingFreq, score, selectAndTest, walkForward } from "../predictor";

const sum = (d: number[]) => d.reduce((a, b) => a + b, 0);
const rand = (n: number, seed = 1) => { let s = seed; return Array.from({ length: n }, () => { s = (s * 16807) % 2147483647; return s % 10; }); };
const cfg = { window: 100, halfLife: 25, alpha: 1 };

describe("predictor", () => {
  it("normalizes to finite non-negative probabilities summing to 1", () => {
    for (const d of [normalize([0, 0]), normalize([NaN, -1, 3]), ...(["rolling", "decay", "markov"] as const).map((m) => predict(m, rand(300), 300, cfg))]) {
      expect(d.every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
      expect(sum(d)).toBeCloseTo(1, 10);
    }
  });
  it("rolling frequency counts only the last W digits", () => {
    const d = rollingFreq([1, 1, 1, 2, 3], 5, 2);
    expect(d[2]).toBe(0.5); expect(d[3]).toBe(0.5); expect(d[1]).toBe(0);
  });
  it("decay weights recent digits more and smooths zeros", () => {
    const d = decayFreq([7, 7, 7, 7, 3], 5, 2, 0.5);
    expect(d[3]).toBeGreaterThan(rollingFreq([7, 7, 7, 7, 3], 5, 5)[3]);
    expect(d[0]).toBeGreaterThan(0);
  });
  it("Markov uses the previous digit's row with Laplace smoothing", () => {
    const r = markovRow([1, 2, 1, 2, 1], 5, 100, 1);
    expect(r.prev).toBe(1); expect(r.rowCount).toBe(2);
    expect(r.dist[2]).toBeCloseTo(3 / 12); expect(r.dist[5]).toBeCloseTo(1 / 12);
    expect(markovRow([1, 2, 1, 2, 1], 5, 100, 5).dist[2]).toBeCloseTo(7 / 52);
  });
  it("exact 50/50 is Neutral", () => { expect(evenOddLean(Array(10).fill(0.1)).lean).toBe("NEUTRAL"); });
  it("walk-forward records hits against the actual next digit", () => {
    const digits = Array.from({ length: 600 }, (_, i) => (i % 2 ? 3 : 4)); // alternating → Markov predicts perfectly
    const s = score(walkForward("markov", digits, cfg));
    expect(s.n).toBe(100); expect(s.mRate).toBe(1); expect(s.eoRate).toBe(1);
    expect(score([]).mRate).toBeNaN();
  });
  it("never leaks the target or future ticks", () => {
    const a = rand(700), b = a.slice(); for (let i = 600; i < 700; i++) b[i] = (b[i] + 5) % 10;
    const pa = walkForward("rolling", a, cfg).filter((p) => p.t <= 600), pb = walkForward("rolling", b, cfg).filter((p) => p.t <= 600);
    expect(pa.map((p) => p.top)).toEqual(pb.map((p) => p.top));
    for (const m of ["rolling", "decay", "markov"] as const) expect(walkForward(m, a, cfg)[0].top).toBe(argmax(predict(m, a.slice(0, 500), 500, cfg)));
  });
  it("threshold is chosen on training data only with a minimum count", () => {
    const digits = rand(3000);
    const preds = walkForward("rolling", digits, cfg);
    const r = selectAndTest(preds, 3000, 50);
    expect(r.splitT).toBe(2100);
    if (r.threshold !== null) expect(r.train!.n).toBeGreaterThanOrEqual(50);
    // mutating holdout outcomes must not change the selected threshold
    const flipped = preds.map((p) => (p.t >= 2100 ? { ...p, matchHit: !p.matchHit } : p));
    expect(selectAndTest(flipped, 3000, 50).threshold).toBe(r.threshold);
    expect(selectAndTest(preds, 3000, 1e9).threshold).toBeNull();
  });
  it("payout maths: break-even and EV", () => {
    expect(breakEven(9.5)).toBeCloseTo(0.10526); expect(evPerTrade(0.1, 9.5)).toBeCloseTo(-0.05);
    expect(evPerTrade(0.5, 1.95)).toBeCloseTo(-0.025); expect(breakEven(1)).toBeNaN();
  });
  it("does not bridge timestamp gaps", () => {
    const r = contiguousTail([{ epoch: 1 }, { epoch: 2 }, { epoch: 100 }, { epoch: 101 }]);
    expect(r.ticks.length).toBe(2); expect(r.gapAt).toBe(100);
  });
});
