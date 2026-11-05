import { describe, expect, it } from "vitest";
import { markovRow, predict, walkForward, selectAndTest, contiguousTail, MODELS } from "../predictor";
import { pipDecimals, sanitizeHistory, parseLiveTick, feedState } from "../ticks";

const rand = (n: number, seed = 3) => { let s = seed; return Array.from({ length: n }, () => { s = (s * 16807) % 2147483647; return s % 10; }); };
const cfg = { window: 100, halfLife: 25, alpha: 1 };

describe("market precision", () => {
  it("accepts both Deriv pip formats", () => {
    expect(pipDecimals(0.01)).toBe(2); expect(pipDecimals(0.001)).toBe(3); expect(pipDecimals(2)).toBe(2); expect(pipDecimals(3)).toBe(3);
    expect(pipDecimals(undefined)).toBeNull(); expect(pipDecimals(0)).toBeNull(); expect(pipDecimals(1.5)).toBeNull();
  });
  it("history and live ticks extract the same digit, keeping trailing zeros", () => {
    const h = sanitizeHistory([513.2], [1], 2)[0], l = parseLiveTick({ quote: 513.2, epoch: 1 }, 2)!;
    expect(h.digit).toBe(0); expect(l.digit).toBe(h.digit);
  });
});

describe("Markov window boundary", () => {
  it("window W uses exactly the last W digits (W-1 transitions)", () => {
    // digits: 5 7 | 5 7 5 — window 3 covers [7,5,7]... prev = last digit
    const d = [5, 7, 5, 7, 5];
    expect(markovRow(d, 5, 3, 1).rowCount).toBe(1); // only 5→7 inside [5,7,5]
    expect(markovRow(d, 5, 5, 1).rowCount).toBe(2);
    expect(markovRow(d, 5, 1, 1).rowCount).toBe(0);
    expect(markovRow(d, 5, 1000, 1).rowCount).toBe(2); // capped at available history
  });
  it("digit just outside the window has no effect", () => {
    const a = [9, ...rand(100)], b = [0, ...a.slice(1)];
    expect(markovRow(a, 101, 100, 1).dist).toEqual(markovRow(b, 101, 100, 1).dist);
  });
});

describe("validation integrity", () => {
  it("all models predict the same target ticks", () => {
    const d = rand(900), ts = MODELS.map((m) => walkForward(m, d, cfg).map((p) => p.t).join());
    expect(new Set(ts).size).toBe(1);
  });
  it("Even/Odd counts differ only by neutral (exact 50/50) predictions", () => {
    const d = rand(900);
    for (const m of MODELS) { const p = walkForward(m, d, cfg); expect(p.filter((x) => x.eoHit !== null).length + p.filter((x) => x.lean === "NEUTRAL").length).toBe(p.length); }
  });
  it("changing future digits never changes earlier predictions for any model", () => {
    const a = rand(800), b = a.slice(); for (let i = 650; i < 800; i++) b[i] = (b[i] + 3) % 10;
    for (const m of MODELS) for (let t = 500; t <= 650; t += 15) expect(predict(m, a, t, cfg)).toEqual(predict(m, b, t, cfg));
  });
  it("threshold ignores holdout predictions entirely", () => {
    const preds = walkForward("decay", rand(3000), cfg);
    const r = selectAndTest(preds, 3000, 50);
    expect(selectAndTest(preds.filter((p) => p.t < r.splitT).concat(preds.filter((p) => p.t >= r.splitT).map((p) => ({ ...p, pTop: 0.99 }))), 3000, 50).threshold).toBe(r.threshold);
  });
});

describe("feed integrity", () => {
  it("drops duplicate and out-of-order ticks", () => {
    expect(sanitizeHistory([1, 1.1, 1.2, 1.3], [10, 10, 9, 11], 2).map((t) => t.epoch)).toEqual([10, 11]);
  });
  it("gap > 30 s splits; exactly 30 s does not", () => {
    expect(contiguousTail([{ epoch: 0 }, { epoch: 30 }]).gapAt).toBeNull();
    expect(contiguousTail([{ epoch: 0 }, { epoch: 31 }]).ticks.length).toBe(1);
  });
  it("only a fresh connected feed counts as live", () => {
    const base = { lastAt: 1000, now: 2000, error: null, tickCount: 500 };
    expect(feedState({ ...base, status: "live" })).toBe("live");
    expect(feedState({ ...base, status: "reconnecting" })).not.toBe("live");
    expect(feedState({ ...base, status: "offline" })).not.toBe("live");
    expect(feedState({ ...base, status: "live", now: 1000 + 11_000 })).toBe("stale");
    expect(feedState({ ...base, status: "live", lastAt: null, tickCount: 0 })).toBe("loading"); // market switch clears ticks
  });
});
