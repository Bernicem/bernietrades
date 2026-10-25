// Pure statistical functions. No UI, no network — independently testable.

export const lastDigit = (price: number, decimals: number): number => {
  const s = price.toFixed(decimals);
  return Number(s[s.length - 1]);
};

export function digitCounts(digits: number[]): number[] {
  const c = new Array(10).fill(0);
  for (const d of digits) c[d]++;
  return c;
}

// --- distributions ---
function logGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const v of g) ser += v / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}
// regularized lower incomplete gamma P(a,x)
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 200; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-12) break; }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-12) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}
export const chiSquarePValue = (stat: number, df: number) => 1 - gammaP(df / 2, stat / 2);

export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}
export const twoSidedP = (z: number) => 2 * (1 - normalCdf(Math.abs(z)));

export function chiSquareUniform(counts: number[]) {
  const n = counts.reduce((a, b) => a + b, 0);
  const k = counts.length;
  const e = n / k;
  const stat = n === 0 ? 0 : counts.reduce((s, o) => s + (o - e) ** 2 / e, 0);
  const df = k - 1;
  return { stat, df, pValue: n === 0 ? 1 : chiSquarePValue(stat, df), expected: e, adequate: e >= 5 };
}

// Binomial z-score of observed successes vs baseline p
export function binomZ(successes: number, n: number, p: number): number {
  if (n === 0) return 0;
  return (successes - n * p) / Math.sqrt(n * p * (1 - p));
}

// Wilson score interval
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const ph = successes / n;
  const denom = 1 + (z * z) / n;
  const center = (ph + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function shannonEntropy(counts: number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  if (!n) return 0;
  return -counts.reduce((s, c) => (c ? s + (c / n) * Math.log2(c / n) : s), 0);
}

// KL divergence of observed vs uniform (bits)
export function klFromUniform(counts: number[]): number {
  return Math.log2(counts.length) - shannonEntropy(counts);
}

export function streaks<T>(seq: T[]) {
  let longest = 0, cur = 0, curVal: T | undefined, longestVal: T | undefined;
  for (const v of seq) {
    if (v === curVal) cur++; else { cur = 1; curVal = v; }
    if (cur > longest) { longest = cur; longestVal = v; }
  }
  return { current: cur, currentVal: curVal, longest, longestVal };
}

export function mean(a: number[]) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
export function std(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
export function percentileRank(arr: number[], v: number) {
  if (!arr.length) return 0;
  return arr.filter((x) => x <= v).length / arr.length;
}

// --- contracts ---
export type ContractType = "EVEN" | "ODD" | "RISE" | "FALL" | "MATCHES" | "DIFFERS" | "OVER" | "UNDER";
export const CONTRACTS: ContractType[] = ["EVEN", "ODD", "RISE", "FALL", "MATCHES", "DIFFERS", "OVER", "UNDER"];
export const needsBarrier = (c: ContractType) => c === "MATCHES" || c === "DIFFERS" || c === "OVER" || c === "UNDER";

// Theoretical probability under uniform digits / symmetric moves.
// Over N: digit > N (strict). Under N: digit < N (strict).
export function theoreticalP(c: ContractType, barrier = 5): number {
  switch (c) {
    case "EVEN": case "ODD": return 0.5;
    case "RISE": case "FALL": return 0.5;
    case "MATCHES": return 0.1;
    case "DIFFERS": return 0.9;
    case "OVER": return (9 - barrier) / 10;
    case "UNDER": return barrier / 10;
  }
}

// Outcome of a digit contract given the exit digit
export function digitWins(c: ContractType, d: number, barrier = 5): boolean {
  switch (c) {
    case "EVEN": return d % 2 === 0;
    case "ODD": return d % 2 === 1;
    case "MATCHES": return d === barrier;
    case "DIFFERS": return d !== barrier;
    case "OVER": return d > barrier;
    case "UNDER": return d < barrier;
    default: return false;
  }
}

// Observed successes for contract over a window of ticks
export function contractHits(c: ContractType, prices: number[], digits: number[], barrier = 5) {
  if (c === "RISE" || c === "FALL") {
    let hit = 0, n = 0;
    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      n++;
      if (c === "RISE" ? diff > 0 : diff < 0) hit++;
    }
    return { hit, n };
  }
  let hit = 0;
  for (const d of digits) if (digitWins(c, d, barrier)) hit++;
  return { hit, n: digits.length };
}

// --- payout / EV ---
export function expectedValue(opts: { stake: number; payout: number; payoutIsTotal: boolean; pWin: number }) {
  const profit = opts.payoutIsTotal ? opts.payout - opts.stake : opts.payout;
  const loss = opts.stake;
  const ev = opts.pWin * profit - (1 - opts.pWin) * loss;
  const breakEven = profit + loss > 0 ? loss / (profit + loss) : 1;
  return { profit, loss, ev, breakEven, roi: opts.stake ? ev / opts.stake : 0 };
}

// --- signals ---
export type Strength = "Strong Statistical Deviation" | "Moderate Statistical Deviation" | "Weak Statistical Deviation" | "No Meaningful Deviation" | "Insufficient Data";

export function classify(z: number, n: number, minN = 100): Strength {
  if (n < minN) return "Insufficient Data";
  const a = Math.abs(z);
  if (a >= 3) return "Strong Statistical Deviation";
  if (a >= 2.33) return "Moderate Statistical Deviation";
  if (a >= 1.65) return "Weak Statistical Deviation";
  return "No Meaningful Deviation";
}

export interface Signal {
  contract: ContractType;
  barrier?: number | undefined;
  window: number;
  n: number;
  observed: number;
  estimated: number; // shrunk toward baseline
  baseline: number;
  ci: [number, number];
  z: number;
  pValue: number;
  strength: Strength;
  explanation: string;
}

export function buildSignal(c: ContractType, prices: number[], digits: number[], window: number, barrier = 5): Signal {
  const p = prices.slice(-window - 1);
  const d = digits.slice(-window);
  const { hit, n } = contractHits(c, p, d, barrier);
  const base = theoreticalP(c, barrier);
  const obs = n ? hit / n : 0;
  const z = binomZ(hit, n, base);
  // Bayesian shrinkage: Beta prior worth 1000 pseudo-ticks at baseline
  const prior = 1000;
  const est = (hit + prior * base) / (n + prior);
  const strength = classify(z, n);
  const pv = twoSidedP(z);
  const label = needsBarrier(c) ? `${c} ${barrier}` : c;
  const explanation =
    strength === "Insufficient Data"
      ? `Only ${n} samples — too few to assess ${label}.`
      : `${label} occurred ${(obs * 100).toFixed(1)}% over ${n} ticks vs ${(base * 100).toFixed(1)}% baseline (z=${z.toFixed(2)}, p=${pv.toFixed(3)}). ` +
        (Math.abs(z) < 1.65
          ? "Consistent with random variation."
          : "Unusual in-sample, but persistence is unverified — check the backtest before acting.");
  return { contract: c, barrier: needsBarrier(c) ? barrier : undefined, window, n, observed: obs, estimated: est, baseline: base, ci: wilson(hit, n), z, pValue: pv, strength, explanation };
}

// --- regime ---
export function volatility(prices: number[], window: number) {
  const diffs: number[] = [];
  for (let i = 1; i < prices.length; i++) diffs.push(prices[i] - prices[i - 1]);
  const recent = std(diffs.slice(-window));
  const rolling: number[] = [];
  for (let i = window; i <= diffs.length; i += Math.max(1, Math.floor(window / 5))) rolling.push(std(diffs.slice(i - window, i)));
  const pct = percentileRank(rolling, recent);
  const hist = std(diffs);
  return { recent, hist, pct, ratio: hist ? recent / hist : 1, rolling, avgAbs: mean(diffs.slice(-window).map(Math.abs)) };
}

// Simple CUSUM-style change point on |diff| mean: max standardized split difference
export function changePoint(values: number[]) {
  const n = values.length;
  if (n < 40) return { index: -1, score: 0 };
  let best = { index: -1, score: 0 };
  const s = std(values) || 1;
  for (let k = 20; k < n - 20; k += 2) {
    const a = mean(values.slice(0, k)), b = mean(values.slice(k));
    const score = Math.abs(a - b) / (s * Math.sqrt(1 / k + 1 / (n - k)));
    if (score > best.score) best = { index: k, score };
  }
  return best;
}

export function detectRegime(prices: number[], digits: number[], window: number) {
  const v = volatility(prices, Math.min(window, 100));
  const chi = chiSquareUniform(digitCounts(digits.slice(-window)));
  const rf = contractHits("RISE", prices.slice(-window - 1), []);
  const zDir = binomZ(rf.hit, rf.n, 0.5);
  const diffs = prices.slice(1).map((p, i) => Math.abs(p - prices[i]));
  const cp = changePoint(diffs.slice(-window));
  const tags: string[] = [];
  if (v.pct > 0.85) tags.push("High volatility");
  else if (v.pct < 0.15) tags.push("Low volatility");
  if (Math.abs(zDir) > 2.33) tags.push("Directional momentum");
  if (chi.adequate && chi.pValue < 0.01) tags.push("Digit distribution imbalance");
  if (cp.score > 3.5) tags.push("Potential structural change");
  if (!tags.length) tags.push(chi.adequate ? "Random-like / stable distribution" : "Insufficient data");
  return { tags, vol: v, chi, zDir, cp };
}
