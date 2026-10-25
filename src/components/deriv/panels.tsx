import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  binomZ, buildSignal, chiSquareUniform, CONTRACTS, contractHits, detectRegime, digitCounts, expectedValue, mean, needsBarrier,
  shannonEntropy, streaks, theoreticalP, twoSidedP, wilson, klFromUniform, type ContractType,
} from "@/lib/stats";
import { MIN_RELIABLE_TRADES, MIN_TRAIN_TRADES, runBacktest } from "@/lib/backtest";
import { fetchHistory, type SymbolInfo, type Tick } from "@/lib/deriv";
import { Panel, Seg, Stat, StrengthBadge, pct } from "./ui";
import { cn } from "@/lib/utils";

const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }, labelStyle: { color: "var(--muted-foreground)" } };
const axis = { stroke: "var(--muted-foreground)", fontSize: 11 };

interface P { ticks: Tick[]; window: number }
const useData = (ticks: Tick[], w: number) => useMemo(() => {
  const t = ticks.slice(-w);
  return { prices: ticks.slice(-w - 1).map((x) => x.quote), digits: t.map((x) => x.digit), all: ticks };
}, [ticks, w]);

// ---------------- Digits ----------------
export function DigitPanel({ ticks, window }: P) {
  const { digits } = useData(ticks, window);
  const counts = digitCounts(digits);
  const n = digits.length;
  const chi = chiSquareUniform(counts);
  const histCounts = digitCounts(ticks.map((t) => t.digit));
  const data = counts.map((c, d) => ({ d, obs: c, exp: n / 10, z: binomZ(c, n, 0.1), ci: wilson(c, n), hist: ticks.length ? (histCounts[d] / ticks.length) * n : 0 }));
  const max = data.reduce((a, b) => (b.obs > a.obs ? b : a), data[0]);
  const min = data.reduce((a, b) => (b.obs < a.obs ? b : a), data[0]);
  const heatWindows = [25, 50, 100, 250, 500, 1000].filter((w) => w <= ticks.length);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title={`Digit distribution · last ${n}`} className="lg:col-span-2">
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={data}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="d" {...axis} /><YAxis {...axis} />
              <Tooltip {...tip} formatter={(v: number, k) => [typeof v === "number" ? v.toFixed(1) : v, k === "obs" ? "Observed" : k === "hist" ? "Historical avg (scaled)" : k]} />
              <ReferenceLine y={n / 10} stroke="var(--accent)" strokeDasharray="4 4" label={{ value: "Expected N/10", fill: "var(--accent)", fontSize: 10, position: "right" }} />
              <Bar dataKey="obs" radius={[3, 3, 0, 0]}>
                {data.map((x) => <Cell key={x.d} fill={Math.abs(x.z) > 2 ? "var(--destructive)" : "var(--primary)"} />)}
              </Bar>
              <Bar dataKey="hist" fill="var(--chart-5)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 grid grid-cols-5 gap-2 text-center sm:grid-cols-10">
          {data.map((x) => (
            <div key={x.d} className="rounded border border-border p-1.5">
              <div className="num text-base font-bold">{x.d}</div>
              <div className="num text-[11px]">{pct(n ? x.obs / n : 0)}</div>
              <div className={cn("num text-[10px]", Math.abs(x.z) > 2 ? "text-destructive" : "text-muted-foreground")}>z {x.z.toFixed(2)}</div>
              <div className="num text-[9px] text-muted-foreground">{pct(x.ci[0], 0)}–{pct(x.ci[1], 0)}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Goodness of fit">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="χ² (df 9)" value={chi.stat.toFixed(2)} />
          <Stat label="p-value" value={chi.pValue.toFixed(4)} tone={chi.pValue < 0.01 ? "warn" : undefined} />
          <Stat label="Most frequent" value={max.d} sub={`${max.obs} hits`} />
          <Stat label="Least frequent" value={min.d} sub={`${min.obs} hits`} />
          <Stat label="Expected / digit" value={(n / 10).toFixed(1)} />
          <Stat label="Sample adequate" value={chi.adequate ? "Yes" : "No"} sub="needs ≥5 expected" tone={chi.adequate ? "up" : "down"} />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          {!chi.adequate ? "Sample too small for a reliable χ² test." : chi.pValue < 0.01
            ? "The imbalance is statistically unusual at the 1% level. It does not imply the frequent digits will keep appearing."
            : "The observed imbalance is within what random variation commonly produces."}
        </p>
      </Panel>
      <Panel title="Digit heatmap · % by window" className="lg:col-span-2">
        <div className="overflow-x-auto">
          <table className="num w-full text-xs">
            <thead><tr><th className="p-1 text-left text-muted-foreground">Window</th>{[...Array(10)].map((_, d) => <th key={d} className="p-1">{d}</th>)}</tr></thead>
            <tbody>
              {heatWindows.map((w) => {
                const c = digitCounts(ticks.slice(-w).map((t) => t.digit));
                return (
                  <tr key={w}>
                    <td className="p-1 text-muted-foreground">{w}</td>
                    {c.map((v, d) => {
                      const dev = v / w - 0.1;
                      return <td key={d} className="p-0.5"><div className="rounded py-1 text-center" style={{ background: `color-mix(in oklab, ${dev > 0 ? "var(--primary)" : "var(--destructive)"} ${Math.min(90, Math.abs(dev) * 600)}%, transparent)` }}>{((v / w) * 100).toFixed(0)}</div></td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Recent digits">
        <div className="flex flex-wrap gap-1">
          {ticks.slice(-60).reverse().map((t, i) => (
            <span key={t.epoch} className={cn("num grid h-7 w-7 place-items-center rounded text-xs font-semibold", i === 0 ? "bg-primary text-primary-foreground" : t.digit % 2 ? "bg-secondary" : "border border-border")}>{t.digit}</span>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ---------------- Even / Odd ----------------
export function EvenOddPanel({ ticks }: { ticks: Tick[] }) {
  const all = ticks.map((t) => (t.digit % 2 ? "O" : "E"));
  const rows = [25, 50, 100, 250, 500].map((w) => {
    const s = all.slice(-w); const e = s.filter((x) => x === "E").length; const n = s.length;
    const z = binomZ(e, n, 0.5);
    return { w, n, e, ep: n ? e / n : 0, z, ci: wilson(e, n), p: twoSidedP(z) };
  });
  const st = streaks(all.slice(-500));
  const rolling = useMemo(() => {
    const out: { i: number; even: number }[] = [];
    for (let i = 50; i <= all.length; i += 5) out.push({ i, even: all.slice(i - 50, i).filter((x) => x === "E").length / 50 });
    return out.slice(-150);
  }, [ticks.length]); // eslint-disable-line
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Even / Odd by window" className="lg:col-span-2">
        <table className="num w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left">Window</th><th>Even</th><th>Odd</th><th>95% CI (even)</th><th>z</th><th>p</th><th>Verdict</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.w} className="border-t border-border text-center">
              <td className="py-1.5 text-left">{r.n}</td><td>{pct(r.ep)}</td><td>{pct(1 - r.ep)}</td>
              <td>{pct(r.ci[0])}–{pct(r.ci[1])}</td><td>{r.z.toFixed(2)}</td><td>{r.p.toFixed(3)}</td>
              <td className={cn("text-xs", r.p < 0.05 ? "text-warning" : "text-muted-foreground")}>{r.p < 0.05 ? "Unusual" : "Random range"}</td>
            </tr>))}
          </tbody>
        </table>
        <div className="mt-4 h-40">
          <ResponsiveContainer>
            <LineChart data={rolling}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="i" hide /><YAxis domain={[0.2, 0.8]} {...axis} tickFormatter={(v) => pct(v, 0)} />
              <ReferenceLine y={0.5} stroke="var(--accent)" strokeDasharray="4 4" /><Tooltip {...tip} formatter={(v: number) => pct(v)} />
              <Line dataKey="even" stroke="var(--primary)" dot={false} strokeWidth={2} isAnimationActive={false} name="Rolling even % (50)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="Streaks & sequence">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Current streak" value={`${st.current} ${st.currentVal === "E" ? "Even" : "Odd"}`} />
          <Stat label="Longest (500)" value={`${st.longest} ${st.longestVal === "E" ? "Even" : "Odd"}`} sub={`expected ≈ ${Math.log2(Math.min(500, all.length) || 1).toFixed(1)}`} />
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {all.slice(-40).map((x, i) => <span key={i} className={cn("num grid h-6 w-6 place-items-center rounded text-[10px] font-bold", x === "E" ? "bg-primary/20 text-primary" : "bg-accent/20 text-accent")}>{x}</span>)}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Long streaks occur naturally: in 500 fair flips the longest run is usually 7–10.</p>
      </Panel>
    </div>
  );
}

// ---------------- Rise / Fall ----------------
export function RiseFallPanel({ ticks }: { ticks: Tick[] }) {
  const prices = ticks.map((t) => t.quote);
  const diffs = prices.slice(1).map((p, i) => p - prices[i]);
  const win = (w: number) => {
    const d = diffs.slice(-w); const up = d.filter((x) => x > 0); const dn = d.filter((x) => x < 0);
    const z = binomZ(up.length, up.length + dn.length, 0.5);
    const sd = Math.sqrt(mean(d.map((x) => x * x))) || 1;
    return { w: d.length, up: up.length, dn: dn.length, avgUp: mean(up), avgDn: mean(dn), z, roc: prices.length > w ? (prices.at(-1)! / prices.at(-w - 1)! - 1) : 0, vadj: (d.reduce((a, b) => a + b, 0) / (sd * Math.sqrt(d.length || 1))) };
  };
  const rows = [20, 100, 500].map(win);
  const st = streaks(diffs.slice(-500).map((x) => (x > 0 ? "R" : x < 0 ? "F" : "=")));
  const ma = (n: number) => mean(prices.slice(-n));
  const chart = ticks.slice(-200).map((t, i, a) => ({ i, p: t.quote, ma20: i >= 19 ? mean(a.slice(i - 19, i + 1).map((x) => x.quote)) : null }));
  const maxMove = Math.max(0, ...diffs.slice(-100).map(Math.abs));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Price · last 200 ticks with MA20" className="lg:col-span-2">
        <div className="h-56"><ResponsiveContainer><LineChart data={chart}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="i" hide /><YAxis domain={["auto", "auto"]} {...axis} width={70} /><Tooltip {...tip} />
          <Line dataKey="p" stroke="var(--primary)" dot={false} isAnimationActive={false} name="Price" /><Line dataKey="ma20" stroke="var(--accent)" dot={false} isAnimationActive={false} name="MA20" /></LineChart></ResponsiveContainer></div>
        <table className="num mt-3 w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left">Horizon</th><th>Rise</th><th>Fall</th><th>Avg up</th><th>Avg down</th><th>ROC</th><th>Vol-adj drift</th><th>z</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-border text-center"><td className="py-1.5 text-left">{["Short", "Medium", "Long"][i]} ({r.w})</td>
              <td className="text-success">{pct(r.up / (r.w || 1))}</td><td className="text-destructive">{pct(r.dn / (r.w || 1))}</td>
              <td>{r.avgUp.toFixed(3)}</td><td>{r.avgDn.toFixed(3)}</td><td>{(r.roc * 100).toFixed(3)}%</td><td>{r.vadj.toFixed(2)}</td><td>{r.z.toFixed(2)}</td></tr>))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Momentum">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Current streak" value={`${st.current} ${st.currentVal === "R" ? "Rise" : st.currentVal === "F" ? "Fall" : "Flat"}`} />
          <Stat label="Longest (500)" value={st.longest} />
          <Stat label="MA10 vs MA50" value={(ma(10) - ma(50)).toFixed(3)} tone={ma(10) > ma(50) ? "up" : "down"} />
          <Stat label="Max move (100)" value={maxMove.toFixed(3)} />
          <Stat label="Avg |move|" value={mean(diffs.slice(-100).map(Math.abs)).toFixed(3)} />
          <Stat label="Consistency" value={pct(Math.max(rows[0].up, rows[0].dn) / (rows[0].w || 1))} sub="short-term" />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Momentum describes the recent path. Unless a |z| above ~2 persists out-of-sample (see Backtest), it carries no reliable predictive value.</p>
      </Panel>
    </div>
  );
}

// ---------------- Matches / Differs ----------------
export function MatchesPanel({ ticks, window }: P) {
  const [target, setTarget] = useState(7);
  const digits = ticks.slice(-window).map((t) => t.digit);
  const n = digits.length; const hits = digits.filter((d) => d === target).length;
  const idx = digits.map((d, i) => (d === target ? i : -1)).filter((i) => i >= 0);
  const gaps = idx.slice(1).map((v, i) => v - idx[i]);
  const current = idx.length ? n - 1 - idx[idx.length - 1] : n;
  const z = binomZ(hits, n, 0.1); const ci = wilson(hits, n);
  const est = (hits + 100) / (n + 1000);
  const gapHist = Array.from({ length: 8 }, (_, b) => ({ b: b === 7 ? "35+" : `${b * 5}-${b * 5 + 4}`, c: gaps.filter((g) => (b === 7 ? g >= 35 : g >= b * 5 && g < b * 5 + 5)).length }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Target digit" right={<Seg value={target} options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]} onChange={setTarget} />} className="lg:col-span-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <Stat label="Observed" value={pct(n ? hits / n : 0)} sub={`${hits}/${n}`} />
          <Stat label="Expected" value="10.0%" sub={`${(n / 10).toFixed(0)} hits`} />
          <Stat label="95% CI" value={`${pct(ci[0], 0)}–${pct(ci[1], 0)}`} />
          <Stat label="z-score" value={z.toFixed(2)} tone={Math.abs(z) > 2 ? "warn" : undefined} />
          <Stat label="Current gap" value={current} sub="ticks since last" />
          <Stat label="Avg wait" value={gaps.length ? mean(gaps).toFixed(1) : "—"} sub="theory 10" />
          <Stat label="Longest gap" value={gaps.length ? Math.max(...gaps) : "—"} />
          <Stat label="Est. Matches / Differs" value={`${pct(est)} / ${pct(1 - est)}`} sub="shrunk to baseline" />
        </div>
      </Panel>
      <Panel title="Gap (inter-arrival) distribution" className="lg:col-span-2">
        <div className="h-48"><ResponsiveContainer><BarChart data={gapHist}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="b" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><Bar dataKey="c" fill="var(--chart-3)" radius={[3, 3, 0, 0]} name="Gaps" /></BarChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Important">
        <p className="text-sm text-muted-foreground">Ticks are independent: a digit absent for {current} ticks is <b className="text-foreground">not</b> more likely to appear next. The geometric waiting time means gaps of 20–30 are routine.</p>
        <div className="mt-3 flex flex-wrap gap-1">{digits.slice(-50).map((d, i) => <span key={i} className={cn("num grid h-6 w-6 place-items-center rounded text-[10px]", d === target ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground")}>{d}</span>)}</div>
      </Panel>
    </div>
  );
}

// ---------------- Over / Under ----------------
export function OverUnderPanel({ ticks, window }: P) {
  const [b, setB] = useState(5);
  const digits = ticks.slice(-window).map((t) => t.digit); const n = digits.length;
  const over = digits.filter((d) => d > b).length, under = digits.filter((d) => d < b).length, eq = n - over - under;
  const pO = theoreticalP("OVER", b), pU = theoreticalP("UNDER", b);
  const zO = binomZ(over, n, pO), zU = binomZ(under, n, pU);
  const rolling = useMemo(() => {
    const ds = ticks.map((t) => t.digit); const out: { i: number; over: number; under: number }[] = [];
    for (let i = 50; i <= ds.length; i += 5) { const s = ds.slice(i - 50, i); out.push({ i, over: s.filter((d) => d > b).length / 50, under: s.filter((d) => d < b).length / 50 }); }
    return out.slice(-150);
  }, [ticks.length, b]); // eslint-disable-line
  const st = streaks(digits.map((d) => (d > b ? "O" : d < b ? "U" : "=")));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Threshold" right={<Seg value={b} options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]} onChange={setB} />} className="lg:col-span-3">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label={`Over ${b} observed`} value={pct(n ? over / n : 0)} sub={`theory ${pct(pO, 0)}`} />
          <Stat label="Over z" value={zO.toFixed(2)} tone={Math.abs(zO) > 2 ? "warn" : undefined} sub={`CI ${pct(wilson(over, n)[0], 0)}–${pct(wilson(over, n)[1], 0)}`} />
          <Stat label={`Under ${b} observed`} value={pct(n ? under / n : 0)} sub={`theory ${pct(pU, 0)}`} />
          <Stat label="Under z" value={zU.toFixed(2)} tone={Math.abs(zU) > 2 ? "warn" : undefined} sub={`CI ${pct(wilson(under, n)[0], 0)}–${pct(wilson(under, n)[1], 0)}`} />
          <Stat label={`Equal to ${b}`} value={pct(n ? eq / n : 0)} sub="loses both" />
          <Stat label="Current streak" value={`${st.current} ${st.currentVal ?? ""}`} />
          <Stat label="Qualifying digits" value={`${9 - b} / ${b}`} sub="over / under" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Strict inequalities: Over {b} wins on digits {b + 1}–9 ({9 - b} digits, {pct(pO, 0)}); Under {b} wins on 0–{b - 1} ({b} digits, {pct(pU, 0)}). Digit {b} itself loses both.</p>
      </Panel>
      <Panel title="Rolling probability (50-tick)" className="lg:col-span-3">
        <div className="h-48"><ResponsiveContainer><LineChart data={rolling}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="i" hide /><YAxis domain={[0, 1]} {...axis} tickFormatter={(v) => pct(v, 0)} /><Tooltip {...tip} formatter={(v: number) => pct(v)} />
          <ReferenceLine y={pO} stroke="var(--primary)" strokeDasharray="3 3" /><ReferenceLine y={pU} stroke="var(--accent)" strokeDasharray="3 3" />
          <Line dataKey="over" stroke="var(--primary)" dot={false} isAnimationActive={false} /><Line dataKey="under" stroke="var(--accent)" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
      </Panel>
    </div>
  );
}

// ---------------- Market intelligence ----------------
export function IntelPanel({ ticks, window }: P) {
  const prices = ticks.map((t) => t.quote), digits = ticks.map((t) => t.digit);
  const reg = detectRegime(prices, digits, window);
  const H = shannonEntropy(digitCounts(digits.slice(-window)));
  const entSeries = useMemo(() => {
    const out: { i: number; h: number }[] = [];
    for (let i = 100; i <= digits.length; i += 10) out.push({ i, h: shannonEntropy(digitCounts(digits.slice(i - 100, i))) / Math.log2(10) });
    return out;
  }, [ticks.length]); // eslint-disable-line
  const volSeries = reg.vol.rolling.map((v, i) => ({ i, v }));
  // patterns
  const pats = useMemo(() => {
    const d = digits.slice(-window), n = d.length - 1;
    const rep = d.slice(1).filter((x, i) => x === d[i]).length;
    const alt = d.slice(1).filter((x, i) => x % 2 !== d[i] % 2).length;
    const adj = d.slice(1).filter((x, i) => Math.abs(x - d[i]) === 1).length;
    const p = prices.slice(-window - 1); const mv = p.slice(1).map((x, i) => Math.sign(x - p[i]));
    const sameDir = mv.slice(1).filter((x, i) => x !== 0 && x === mv[i]).length;
    const mk = (name: string, k: number, m: number, base: number) => { const z = binomZ(k, m, base); return { name, k, m, obs: m ? k / m : 0, base, z, p: twoSidedP(z) }; };
    return [mk("Repeated digit (d[t]=d[t-1])", rep, n, 0.1), mk("Even/odd alternation", alt, n, 0.5), mk("Adjacent digits (±1)", adj, n, 0.18), mk("Repeated direction", sameDir, Math.max(0, mv.length - 1), 0.5)];
  }, [ticks.length, window]); // eslint-disable-line
  const anomalies: string[] = [];
  const counts = digitCounts(digits.slice(-window)); const n = Math.min(window, digits.length);
  counts.forEach((c, d) => { const z = binomZ(c, n, 0.1); if (Math.abs(z) > 2.58) anomalies.push(`Digit ${d} appeared ${z > 0 ? "more" : "less"} often than expected over the last ${n} ticks (z=${z.toFixed(2)}). Statistically unusual at 1%, but persistence is not confirmed.`); });
  if (reg.cp.score > 3.5) anomalies.push(`Possible change in tick-size behaviour near tick ${reg.cp.index} of the window (score ${reg.cp.score.toFixed(1)}).`);
  if (reg.vol.ratio > 1.5) anomalies.push(`Recent volatility is ${reg.vol.ratio.toFixed(2)}× the full-history level.`);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Market regime" className="lg:col-span-3">
        <div className="flex flex-wrap gap-2">{reg.tags.map((t) => <span key={t} className="rounded border border-primary/40 bg-primary/10 px-2 py-1 text-sm text-primary">{t}</span>)}</div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Volatility pct" value={pct(reg.vol.pct, 0)} sub="vs rolling history" />
          <Stat label="Recent σ / hist σ" value={reg.vol.ratio.toFixed(2)} tone={reg.vol.ratio > 1.2 ? "warn" : undefined} sub={reg.vol.ratio > 1.1 ? "expanding" : reg.vol.ratio < 0.9 ? "contracting" : "stable"} />
          <Stat label="Avg tick range" value={reg.vol.avgAbs.toFixed(4)} />
          <Stat label="Direction z" value={reg.zDir.toFixed(2)} />
          <Stat label="Digit χ² p" value={reg.chi.pValue.toFixed(3)} />
          <Stat label="Change-point" value={reg.cp.score.toFixed(2)} sub=">3.5 flags" />
        </div>
      </Panel>
      <Panel title="Shannon entropy (digits)">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Current" value={`${H.toFixed(3)} bits`} />
          <Stat label="Max" value={`${Math.log2(10).toFixed(3)} bits`} />
          <Stat label="Normalized" value={(H / Math.log2(10)).toFixed(4)} />
          <Stat label="KL vs uniform" value={klFromUniform(counts).toFixed(4)} />
        </div>
        <div className="mt-3 h-28"><ResponsiveContainer><LineChart data={entSeries}><YAxis domain={["auto", 1]} {...axis} width={40} /><XAxis dataKey="i" hide /><Tooltip {...tip} /><Line dataKey="h" stroke="var(--chart-3)" dot={false} isAnimationActive={false} name="Norm. entropy (100)" /></LineChart></ResponsiveContainer></div>
        <p className="text-xs text-muted-foreground">Lower entropy means more concentration — not a guaranteed opportunity.</p>
      </Panel>
      <Panel title="Rolling volatility (σ of tick changes)" className="lg:col-span-2">
        <div className="h-48"><ResponsiveContainer><LineChart data={volSeries}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="i" hide /><YAxis {...axis} width={60} /><Tooltip {...tip} /><ReferenceLine y={reg.vol.hist} stroke="var(--accent)" strokeDasharray="3 3" /><Line dataKey="v" stroke="var(--primary)" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>
      </Panel>
      <Panel title="Pattern detection" className="lg:col-span-2">
        <table className="num w-full text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left">Pattern</th><th>Count</th><th>Observed</th><th>Baseline</th><th>z</th><th>p</th><th>OOS value</th></tr></thead>
          <tbody>{pats.map((p) => (
            <tr key={p.name} className="border-t border-border text-center"><td className="py-1.5 text-left font-sans">{p.name}</td><td>{p.k}/{p.m}</td><td>{pct(p.obs)}</td><td>{pct(p.base)}</td><td>{p.z.toFixed(2)}</td><td className={p.p < 0.05 ? "text-warning" : ""}>{p.p.toFixed(3)}</td><td className="text-xs text-muted-foreground">Not demonstrated</td></tr>))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Anomalies">
        {anomalies.length ? <ul className="space-y-2 text-sm">{anomalies.map((a, i) => <li key={i} className="border-l-2 border-warning pl-2">{a}</li>)}</ul> : <p className="text-sm text-muted-foreground">No anomalies beyond the 1% threshold in this window.</p>}
      </Panel>
    </div>
  );
}

// ---------------- Signals ----------------
export function SignalsPanel({ ticks, window, market }: P & { market: string }) {
  const prices = ticks.map((t) => t.quote), digits = ticks.map((t) => t.digit);
  const regime = detectRegime(prices, digits, window).tags.join(", ");
  const sigs = useMemo(() => {
    const list = CONTRACTS.flatMap((c) => (needsBarrier(c) ? (c === "OVER" ? [1, 2, 3, 4, 5, 6, 7, 8] : c === "UNDER" ? [1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).map((b) => buildSignal(c, prices, digits, window, b)) : [buildSignal(c, prices, digits, window)]));
    return list.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  }, [ticks.length, window]); // eslint-disable-line
  const ts = new Date().toLocaleTimeString();
  return (
    <Panel title={`Signal center · ${market} · window ${window}`} right={<span className="text-xs text-muted-foreground">Regime: {regime}</span>}>
      <p className="mb-3 text-xs text-muted-foreground">Ranked by |z|. With {sigs.length} simultaneous tests, ~{Math.round(sigs.length * 0.05)} "Weak" deviations are expected by chance. Estimates are shrunk toward baseline. Trading-edge: <b className="text-foreground">not demonstrated</b> unless the Backtest shows positive out-of-sample EV.</p>
      <div className="overflow-x-auto">
        <table className="num w-full min-w-[900px] text-sm">
          <thead className="text-xs text-muted-foreground"><tr><th className="text-left">Contract</th><th>n</th><th>Observed</th><th>Estimated</th><th>Baseline</th><th>95% CI</th><th>z</th><th>p</th><th className="text-left">Strength</th><th className="text-left">Explanation</th></tr></thead>
          <tbody>{sigs.slice(0, 20).map((s) => (
            <tr key={s.contract + s.barrier} className="border-t border-border text-center align-top">
              <td className="py-2 text-left font-semibold">{s.contract}{s.barrier !== undefined ? ` ${s.barrier}` : ""}</td><td>{s.n}</td><td>{pct(s.observed)}</td><td>{pct(s.estimated)}</td><td>{pct(s.baseline)}</td>
              <td>{pct(s.ci[0])}–{pct(s.ci[1])}</td><td>{s.z.toFixed(2)}</td><td>{s.pValue.toFixed(3)}</td><td className="text-left"><StrengthBadge s={s.strength} /></td>
              <td className="max-w-sm text-left font-sans text-xs text-muted-foreground">{s.explanation} <span className="opacity-70">· {ts} · review after {Math.round(window / 4)} ticks</span></td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ---------------- Backtest ----------------
export function BacktestPanel({ ticks }: { ticks: Tick[] }) {
  const [contract, setContract] = useState<ContractType>("EVEN");
  const [barrier, setBarrier] = useState(5);
  const [lookback, setLookback] = useState(100);
  const [duration, setDuration] = useState(1);
  const [payout, setPayout] = useState(1.95);
  const [res, setRes] = useState<ReturnType<typeof runBacktest> | null>(null);
  const prices = ticks.map((t) => t.quote), digits = ticks.map((t) => t.digit);
  const run = () => setRes(runBacktest({ contract, barrier, lookback, duration, zCandidates: [1, 1.5, 2, 2.5, 3], trainFrac: 0.6, stake: 1, payoutTotal: payout }, prices, digits));
  const input = "num w-24 rounded border border-input bg-background px-2 py-1 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Configuration">
        <div className="space-y-3 text-sm">
          <div><div className="mb-1 text-xs text-muted-foreground">Contract</div><Seg value={contract} options={CONTRACTS} onChange={setContract} /></div>
          {needsBarrier(contract) && <div><div className="mb-1 text-xs text-muted-foreground">Digit / threshold</div><Seg value={barrier} options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]} onChange={setBarrier} /></div>}
          <label className="flex items-center justify-between">Signal lookback (ticks)<input type="number" className={input} value={lookback} min={20} onChange={(e) => setLookback(Math.max(20, +e.target.value))} /></label>
          <label className="flex items-center justify-between">Duration (ticks)<input type="number" className={input} value={duration} min={1} max={10} onChange={(e) => setDuration(Math.min(10, Math.max(1, +e.target.value)))} /></label>
          <label className="flex items-center justify-between">Total payout per 1 stake<input type="number" step="0.01" className={input} value={payout} onChange={(e) => setPayout(+e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Entry rule: enter when the contract's past-window z ≥ threshold. Threshold chosen on the first 60% (train) and reported once on the last 40% (test); walk-forward runs inside the train part. Signals use only past ticks. Data: {ticks.length} ticks.</p>
          <button onClick={run} disabled={ticks.length < 300} className="w-full rounded bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">Run backtest</button>
        </div>
      </Panel>
      {res ? (
        <>
          <Panel title="Out-of-sample (test) results" className="lg:col-span-2">
            {res.test === null ? (
              <p className="text-sm">Insufficient data: no threshold produced at least {MIN_TRAIN_TRADES} trades in the training period, so no strategy could be selected or tested. Load more ticks or lower the lookback.</p>
            ) : (<>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Trades" value={res.test.trades === 0 ? "No eligible trades" : res.test.trades} sub={`z ≥ ${res.bestZ}`} />
              <Stat label="Win rate" value={res.test.trades ? pct(res.test.winRate) : "—"} sub={res.test.trades ? `CI ${pct(res.test.ci[0])}–${pct(res.test.ci[1])}` : undefined} />
              <Stat label="Baseline p" value={pct(res.base)} sub={`break-even ${pct(res.breakEven)}`} />
              <Stat label="EV / trade" value={res.test.trades ? res.test.ev.toFixed(4) : "—"} tone={res.test.ev > 0 ? "up" : "down"} sub={`baseline ${res.baselineEv.toFixed(4)}`} />
              <Stat label="Profit factor" value={!res.test.trades ? "—" : Number.isFinite(res.test.profitFactor) ? res.test.profitFactor.toFixed(2) : "∞"} />
              <Stat label="Max drawdown" value={res.test.maxDD.toFixed(2)} sub="in stake units" />
              <Stat label="Longest loss streak" value={res.test.longestLoss} />
              <Stat label="Sharpe / trade" value={res.test.sharpe.toFixed(3)} />
            </div>
            <div className="mt-4 h-48"><ResponsiveContainer><LineChart data={res.test.equity.map((v, i) => ({ i, v }))}><CartesianGrid stroke="var(--border)" vertical={false} /><XAxis dataKey="i" {...axis} /><YAxis {...axis} /><Tooltip {...tip} /><ReferenceLine y={0} stroke="var(--muted-foreground)" /><Line dataKey="v" stroke={res.test.ev > 0 ? "var(--success)" : "var(--destructive)"} dot={false} isAnimationActive={false} name="Equity" /></LineChart></ResponsiveContainer></div>
            <p className="mt-2 text-sm">{res.test.trades === 0 ? "No eligible trades in the test period." : res.test.trades < MIN_RELIABLE_TRADES ? `Insufficient data: only ${res.test.trades} test trades (need at least ${MIN_RELIABLE_TRADES}).` : res.test.ev <= 0 ? `This strategy has not demonstrated a profitable edge at a total payout of ${payout}. It lost on average ${Math.abs(res.test.ev).toFixed(3)} per 1 stake; you need to win more than ${pct(res.breakEven)} of trades just to break even.` : res.test.ci[0] > res.breakEven ? "Positive out-of-sample EV with win-rate CI above break-even — still treat with caution." : `Positive EV, but the win-rate range still includes the ${pct(res.breakEven)} break-even, so it could be luck.`}</p>
            {res.bestTrainEv !== null && res.bestTrainEv <= 0 && <p className="mt-1 text-xs text-warning">Note: even the best threshold lost money in training (EV {res.bestTrainEv.toFixed(3)}). It is shown only for reference — no threshold looked profitable.</p>}
            <p className="mt-1 text-xs text-muted-foreground">Trained on ticks 1–{res.split}, tested on ticks {res.split + 1}–{res.N}. Consecutive trades use overlapping lookback windows, so they are not fully independent and the range shown may be too narrow.</p>
            </>)}
          </Panel>
          <Panel title="Train results (threshold selection)">
            <table className="num w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th>z ≥</th><th>Trades</th><th>Win</th><th>EV</th></tr></thead>
              <tbody>{res.trainResults.map((r) => <tr key={r.z} className={cn("border-t border-border text-center", r.z === res.bestZ && "text-primary")}>{r.trades === 0 ? <><td className="py-1">{r.z}</td><td colSpan={3} className="text-muted-foreground">No eligible trades</td></> : <><td className="py-1">{r.z}</td><td>{r.trades}{r.trades < MIN_TRAIN_TRADES && <span className="text-muted-foreground">*</span>}</td><td>{pct(r.winRate)}</td><td>{r.ev.toFixed(3)}</td></>}</tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted-foreground">Highlighted = chosen. Only thresholds with ≥ {MIN_TRAIN_TRADES} trades can be chosen{res.trainResults.some((r) => r.trades > 0 && r.trades < MIN_TRAIN_TRADES) ? " (* = too few)" : ""}.</p>
          </Panel>
          <Panel title="Walk-forward validation (inside training period)" className="lg:col-span-2">
            <table className="num w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th>Fold</th><th>Ticks tested</th><th>z chosen</th><th>Trades</th><th>Win rate</th><th>EV</th><th>Max DD</th></tr></thead>
              <tbody>{res.folds.map((f) => <tr key={f.fold} className="border-t border-border text-center"><td className="py-1">{f.fold}</td><td>{f.from + 1}–{f.to}</td>
                {f.perf === null ? <td colSpan={5} className="text-muted-foreground">Insufficient data — no threshold had enough trades to choose</td>
                  : f.perf.trades === 0 ? <><td>{f.z}</td><td colSpan={4} className="text-muted-foreground">No eligible trades</td></>
                  : <><td>{f.z}</td><td>{f.perf.trades}{f.perf.trades < MIN_RELIABLE_TRADES && <span className="text-muted-foreground">*</span>}</td><td>{pct(f.perf.winRate)}</td><td className={f.perf.ev > 0 ? "text-success" : "text-destructive"}>{f.perf.ev.toFixed(3)}</td><td>{f.perf.maxDD.toFixed(2)}</td></>}
              </tr>)}</tbody></table>
            <p className="mt-2 text-xs text-muted-foreground">Each fold picks a threshold on one block of the training ticks and tests it on the next, later block. None of these blocks overlap the final test (ticks {res.split + 1}–{res.N}). * = fewer than {MIN_RELIABLE_TRADES} trades, too few to judge.</p>
          </Panel>
          <Panel title="What these terms mean" className="lg:col-span-3">
            <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="font-semibold">Training data</dt><dd className="text-muted-foreground">The older {Math.round(0.6 * 100)}% of ticks. The app tries each threshold here and picks the one that did best. Results here are flattering because the choice was made on this data.</dd></div>
              <div><dt className="font-semibold">Out-of-sample testing</dt><dd className="text-muted-foreground">The newest 40% of ticks, never used to choose anything. The chosen rule is run here once — this is the honest result.</dd></div>
              <div><dt className="font-semibold">Walk-forward validation</dt><dd className="text-muted-foreground">Repeats "choose on the past, test on the next block" several times within the training data, to see whether a choice keeps working as time moves forward.</dd></div>
              <div><dt className="font-semibold">Expected value (EV)</dt><dd className="text-muted-foreground">Average profit or loss per trade for a 1 stake. Negative EV means you lose money on average over many trades.</dd></div>
              <div><dt className="font-semibold">Break-even probability</dt><dd className="text-muted-foreground">The win rate needed to not lose money: stake ÷ total payout. At a payout of {payout} it is {pct(res.breakEven)}. A 50% coin flip is below this, so it loses slowly.</dd></div>
              <div><dt className="font-semibold">Maximum drawdown</dt><dd className="text-muted-foreground">The biggest drop from a previous high in your running balance, in stakes. A drawdown of 16 means at one point you were 16 stakes below your best.</dd></div>
            </dl>
          </Panel>
        </>
      ) : <Panel className="lg:col-span-2"><p className="text-sm text-muted-foreground">Configure and run a backtest on the loaded tick history (increase the buffer for more data).</p></Panel>}
    </div>
  );
}

// ---------------- EV calculator ----------------
export function EVPanel() {
  const [stake, setStake] = useState(10);
  const [payout, setPayout] = useState(19.5);
  const [isTotal, setIsTotal] = useState(true);
  const [p, setP] = useState(50);
  const r = expectedValue({ stake, payout, payoutIsTotal: isTotal, pWin: p / 100 });
  const input = "num w-full rounded border border-input bg-background px-2 py-1.5 text-sm";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Inputs">
        <div className="grid gap-3 text-sm">
          <label>Stake<input type="number" className={input} value={stake} onChange={(e) => setStake(+e.target.value)} /></label>
          <label>Payout<input type="number" className={input} value={payout} onChange={(e) => setPayout(+e.target.value)} /></label>
          <div className="flex items-center gap-2"><Seg value={isTotal ? "Total return" : "Net profit"} options={["Total return", "Net profit"]} onChange={(v) => setIsTotal(v === "Total return")} /><span className="text-xs text-muted-foreground">How Deriv quotes it: total return</span></div>
          <label>Estimated win probability (%)<input type="number" className={input} value={p} onChange={(e) => setP(+e.target.value)} /></label>
          <p className="text-xs text-muted-foreground">Use the actual quote from your Deriv contract — payouts differ by contract and barrier.</p>
        </div>
      </Panel>
      <Panel title="Result">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Potential profit" value={r.profit.toFixed(2)} tone="up" />
          <Stat label="Potential loss" value={r.loss.toFixed(2)} tone="down" />
          <Stat label="Break-even probability" value={pct(r.breakEven, 2)} />
          <Stat label="Expected value" value={r.ev.toFixed(3)} tone={r.ev > 0 ? "up" : "down"} />
          <Stat label="Expected return on stake" value={pct(r.roi, 2)} />
        </div>
        <p className="mt-4 text-xs text-muted-foreground">EV = P(win) × profit − P(loss) × stake.</p>
      </Panel>
    </div>
  );
}

// ---------------- Scanner ----------------
export function ScannerPanel({ symbols, window }: { symbols: SymbolInfo[]; window: number }) {
  const [rows, setRows] = useState<{ s: SymbolInfo; best: ReturnType<typeof buildSignal>; chiP: number; volPct: number; n: number; regime: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ContractType | "ALL">("ALL");
  const scan = async () => {
    setBusy(true);
    const out: typeof rows = [];
    for (const s of symbols.slice(0, 25)) {
      try {
        const t = await fetchHistory(s.symbol, Math.max(window, 500), s.pip);
        const prices = t.map((x) => x.quote), digits = t.map((x) => x.digit);
        const cs = (filter === "ALL" ? CONTRACTS : [filter]).flatMap((c) => (needsBarrier(c) ? [1, 3, 5, 7].map((b) => buildSignal(c, prices, digits, window, b)) : [buildSignal(c, prices, digits, window)]));
        const best = cs.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))[0];
        const reg = detectRegime(prices, digits, window);
        out.push({ s, best, chiP: reg.chi.pValue, volPct: reg.vol.pct, n: t.length, regime: reg.tags[0] });
        setRows([...out].sort((a, b) => Math.abs(b.best.z) - Math.abs(a.best.z)));
      } catch { /* skip unavailable */ }
    }
    setBusy(false);
  };
  return (
    <Panel title="Market scanner" right={<div className="flex items-center gap-2"><Seg value={filter} options={["ALL", ...CONTRACTS] as (ContractType | "ALL")[]} onChange={setFilter} /><button onClick={scan} disabled={busy || !symbols.length} className="rounded bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">{busy ? "Scanning…" : "Scan"}</button></div>}>
      <p className="mb-3 text-xs text-muted-foreground">Ranked by largest statistical deviation (|z|) with sample size and regime shown. No market has a validated edge from this ranking alone — expected value at standard payouts remains negative unless the backtest says otherwise.</p>
      <div className="overflow-x-auto"><table className="num w-full min-w-[800px] text-sm">
        <thead className="text-xs text-muted-foreground"><tr><th className="text-left">Market</th><th>n</th><th>Top deviation</th><th>Observed / base</th><th>z</th><th className="text-left">Strength</th><th>Digit χ² p</th><th>Vol pct</th><th className="text-left">Regime</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.s.symbol} className="border-t border-border text-center"><td className="py-1.5 text-left font-sans">{r.s.display_name}</td><td>{r.n}</td><td>{r.best.contract}{r.best.barrier !== undefined ? ` ${r.best.barrier}` : ""}</td><td>{pct(r.best.observed)} / {pct(r.best.baseline)}</td><td>{r.best.z.toFixed(2)}</td><td className="text-left"><StrengthBadge s={r.best.strength} /></td><td>{r.chiP.toFixed(3)}</td><td>{pct(r.volPct, 0)}</td><td className="text-left font-sans text-xs">{r.regime}</td></tr>))}
        </tbody></table></div>
      {!rows.length && <p className="text-sm text-muted-foreground">Press Scan to analyse up to 25 live markets.</p>}
    </Panel>
  );
}

export { contractHits };
