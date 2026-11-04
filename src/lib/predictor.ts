// Pure next-tick last-digit predictor: models, walk-forward validation, threshold trigger, EV.
// Every prediction for target index t uses only digits[0..t-1] (passed as `end = t`).
import { wilson } from "./stats";

export type Dist = number[]; // length 10, finite, >= 0, sums to 1
export type ModelId = "rolling" | "decay" | "markov";
export const MODELS: ModelId[] = ["rolling", "decay", "markov"];
export const MODEL_LABEL: Record<ModelId, string> = { rolling: "Rolling", decay: "Decay-weighted", markov: "Markov" };
export interface ModelCfg { window: number; halfLife: number; alpha: number }

export const WINDOWS = [100, 300, 1000];
export const HALF_LIVES = [25, 50, 100, 200];
export const WF_START = 500;
export const MIN_CURRENT_TICKS = 100;
export const MIN_MARKOV_ROW = 20;
export const THRESHOLDS = [0.1, 0.11, 0.12, 0.13, 0.14, 0.15, 0.17, 0.2];
export const MIN_TRIGGER_TRAIN = 50;
export const MIN_HOLDOUT = 30;
export const TRAIN_FRAC = 0.7;
export const MAX_GAP_SEC = 30;

const uniform = (): Dist => Array(10).fill(0.1);

export function normalize(w: number[]): Dist {
  const clean = w.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const s = clean.reduce((a, b) => a + b, 0);
  return s > 0 ? clean.map((x) => x / s) : uniform();
}

// Model A: relative frequency over the last `window` digits before `end`.
export function rollingFreq(digits: number[], end: number, window: number): Dist {
  const c = Array(10).fill(0);
  for (let i = Math.max(0, end - window); i < end; i++) c[digits[i]]++;
  return normalize(c);
}

// Model B: exponential decay weights 0.5^(age/halfLife), plus `alpha` pseudo-count per digit.
export function decayFreq(digits: number[], end: number, halfLife: number, alpha = 0.5): Dist {
  const lambda = Math.pow(0.5, 1 / Math.max(1e-9, halfLife));
  const c = Array(10).fill(alpha);
  const start = Math.max(0, end - Math.ceil(halfLife * 20)); // older weights < 1e-6
  let w = 1;
  for (let i = end - 1; i >= start; i--) { c[digits[i]] += w; w *= lambda; }
  return normalize(c);
}

// Model C: P(next | previous) from transitions inside the last `window` digits, Laplace `alpha`.
export function markovRow(digits: number[], end: number, window: number, alpha = 1): { dist: Dist; rowCount: number; prev: number | null } {
  if (end < 1) return { dist: uniform(), rowCount: 0, prev: null };
  const prev = digits[end - 1];
  const c = Array(10).fill(alpha);
  let rowCount = 0;
  for (let i = Math.max(1, end - window); i < end; i++) if (digits[i - 1] === prev) { c[digits[i]]++; rowCount++; }
  return { dist: normalize(c), rowCount, prev };
}

export function predict(model: ModelId, digits: number[], end: number, cfg: ModelCfg): Dist {
  if (model === "rolling") return rollingFreq(digits, end, cfg.window);
  if (model === "decay") return decayFreq(digits, end, cfg.halfLife);
  return markovRow(digits, end, cfg.window, cfg.alpha).dist;
}

export const argmax = (d: Dist) => d.reduce((b, x, i) => (x > d[b] ? i : b), 0);
export const pEven = (d: Dist) => d[0] + d[2] + d[4] + d[6] + d[8];
export type Lean = "EVEN" | "ODD" | "NEUTRAL";
export function evenOddLean(d: Dist): { lean: Lean; p: number } {
  const e = pEven(d);
  if (Math.abs(e - 0.5) < 1e-12) return { lean: "NEUTRAL", p: 0.5 };
  return e > 0.5 ? { lean: "EVEN", p: e } : { lean: "ODD", p: 1 - e };
}

// Keep only the ticks after the last timestamp gap so separate sessions are never bridged.
export function contiguousTail<T extends { epoch: number }>(ticks: T[], maxGap = MAX_GAP_SEC): { ticks: T[]; gapAt: number | null } {
  for (let i = ticks.length - 1; i > 0; i--) if (ticks[i].epoch - ticks[i - 1].epoch > maxGap) return { ticks: ticks.slice(i), gapAt: ticks[i].epoch };
  return { ticks, gapAt: null };
}

export interface Pred { t: number; top: number; pTop: number; lean: Lean; actual: number; matchHit: boolean; eoHit: boolean | null; pActual: number }

export function walkForward(model: ModelId, digits: number[], cfg: ModelCfg, start = WF_START): Pred[] {
  const out: Pred[] = [];
  for (let t = start; t < digits.length; t++) {
    const d = predict(model, digits, t, cfg); // uses digits[0..t-1] only
    const top = argmax(d), { lean } = evenOddLean(d), actual = digits[t];
    out.push({ t, top, pTop: d[top], lean, actual, matchHit: top === actual, eoHit: lean === "NEUTRAL" ? null : (actual % 2 === 0) === (lean === "EVEN"), pActual: d[actual] });
  }
  return out;
}

export interface Score { n: number; mHits: number; mRate: number; mCI: [number, number]; eoN: number; eoHits: number; eoRate: number; eoCI: [number, number]; meanPActual: number; logLoss: number }

export function score(preds: Pred[]): Score {
  const n = preds.length, mHits = preds.filter((p) => p.matchHit).length;
  const eo = preds.filter((p) => p.eoHit !== null), eoHits = eo.filter((p) => p.eoHit).length;
  const nanCI: [number, number] = [NaN, NaN];
  return {
    n, mHits, mRate: n ? mHits / n : NaN, mCI: n ? wilson(mHits, n) : nanCI,
    eoN: eo.length, eoHits, eoRate: eo.length ? eoHits / eo.length : NaN, eoCI: eo.length ? wilson(eoHits, eo.length) : nanCI,
    meanPActual: n ? preds.reduce((a, p) => a + p.pActual, 0) / n : NaN,
    logLoss: n ? -preds.reduce((a, p) => a + Math.log(Math.max(1e-12, p.pActual)), 0) / n : NaN,
  };
}

export interface TriggerResult { splitT: number; threshold: number | null; train: Score | null; holdout: Score | null; holdoutTotal: number; coverage: number; reason: string | null }

// Pick threshold on training targets (t < split) by highest Wilson lower bound with >= minTrain predictions; freeze; test on t >= split.
export function selectAndTest(preds: Pred[], totalTicks: number, minTrain = MIN_TRIGGER_TRAIN): TriggerResult {
  const splitT = Math.floor(totalTicks * TRAIN_FRAC);
  const train = preds.filter((p) => p.t < splitT), hold = preds.filter((p) => p.t >= splitT);
  const base = { splitT, holdoutTotal: hold.length };
  if (!train.length || !hold.length) return { ...base, threshold: null, train: null, holdout: null, coverage: NaN, reason: "Not enough history for a 70/30 split after the 500-tick warm-up." };
  let best: { th: number; lb: number; s: Score } | null = null;
  for (const th of THRESHOLDS) {
    const s = score(train.filter((p) => p.pTop >= th));
    if (s.n < minTrain) continue;
    if (!best || s.mCI[0] > best.lb) best = { th, lb: s.mCI[0], s };
  }
  if (!best) return { ...base, threshold: null, train: null, holdout: null, coverage: NaN, reason: `No threshold had at least ${minTrain} training predictions.` };
  const q = hold.filter((p) => p.pTop >= best.th);
  return { ...base, threshold: best.th, train: best.s, holdout: score(q), coverage: q.length / hold.length, reason: q.length < MIN_HOLDOUT ? `Only ${q.length} holdout predictions passed the trigger (need ${MIN_HOLDOUT}).` : null };
}

export const breakEven = (total: number) => (Number.isFinite(total) && total > 1 ? 1 / total : NaN);
export const evPerTrade = (p: number, total: number) => (Number.isFinite(p) && Number.isFinite(total) && total > 0 ? p * (total - 1) - (1 - p) : NaN);
