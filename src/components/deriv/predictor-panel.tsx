import { useMemo, useState } from "react";
import type { Tick } from "@/lib/deriv";
import {
  argmax, breakEven, contiguousTail, evenOddLean, evPerTrade, markovRow, MIN_CURRENT_TICKS, MIN_HOLDOUT, MIN_MARKOV_ROW, MODEL_LABEL, MODELS,
  predict, score, selectAndTest, walkForward, WF_START, WINDOWS, HALF_LIVES, type ModelCfg, type ModelId, type Score,
} from "@/lib/predictor";
import { Panel, Seg, fx, pct } from "./ui";
import { cn } from "@/lib/utils";

const ci = (c: [number, number]) => (Number.isFinite(c[0]) ? `${pct(c[0])} – ${pct(c[1])}` : "—");
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function PredictorPanel({ ticks, market, live, asOf }: { ticks: Tick[]; market: string; live: boolean; asOf: string | null }) {
  const [model, setModel] = useState<ModelId>("markov");
  const [window, setWindow] = useState(300);
  const [halfLife, setHalfLife] = useState(50);
  const [alpha, setAlpha] = useState(1);
  const [mPay, setMPay] = useState("");
  const [eoPay, setEoPay] = useState("");
  const cfg: ModelCfg = { window, halfLife, alpha };

  const { ticks: seg, gapAt } = useMemo(() => contiguousTail(ticks), [ticks]);
  const digits = useMemo(() => seg.map((t) => t.digit), [seg]);
  const n = digits.length;
  const enough = n >= MIN_CURRENT_TICKS;

  const dists = useMemo(() => Object.fromEntries(MODELS.map((m) => [m, predict(m, digits, n, cfg)])) as Record<ModelId, number[]>, [digits, n, window, halfLife, alpha]); // eslint-disable-line
  const mk = markovRow(digits, n, window, alpha);
  const sel = dists[model], top = argmax(sel), eo = evenOddLean(sel);

  // Validation is heavier; recompute only every 25 new ticks.
  const bucket = Math.floor(n / 25);
  const wf = useMemo(() => {
    if (n <= WF_START) return null;
    const d = digits.slice(0, bucket * 25);
    const per = Object.fromEntries(MODELS.map((m) => {
      const preds = walkForward(m, d, cfg);
      return [m, { all: score(preds), trig: selectAndTest(preds, d.length) }];
    })) as Record<ModelId, { all: Score; trig: ReturnType<typeof selectAndTest> }>;
    return { per, total: d.length };
  }, [bucket, window, halfLife, alpha, seg[0]?.epoch]); // eslint-disable-line

  const trig = wf?.per[model].trig;
  const hold = trig?.holdout ?? null;
  const holdOk = !!hold && hold.n >= MIN_HOLDOUT;
  const mP = num(mPay), eP = num(eoPay);
  const mBE = breakEven(mP), eBE = breakEven(eP);
  const mEV = holdOk ? evPerTrade(hold!.mRate, mP) : NaN, eEV = holdOk ? evPerTrade(hold!.eoRate, eP) : NaN;
  const lastTime = seg.at(-1) ? new Date(seg.at(-1)!.epoch * 1000).toLocaleTimeString() : "—";
  const param = model === "decay" ? `half-life ${halfLife} ticks` : `window ${window} ticks`;

  const summary = !wf ? `Not enough history for validation: ${n} contiguous ticks, more than ${WF_START} needed.`
    : !hold || !holdOk ? `Too few out-of-sample predictions to judge Matches accuracy (${hold?.n ?? 0}, need ${MIN_HOLDOUT}). ${trig?.reason ?? ""}`
    : `Matches prediction accuracy: ${pct(hold.mRate)} (95% CI ${ci(hold.mCI)}), compared with ${Number.isFinite(mBE) ? pct(mBE) : "— (enter the Matches payout)"} required to break even at the entered payout. Based on ${hold.n} out-of-sample predictions.${Number.isFinite(mBE) ? (hold.mCI[0] > mBE ? " The lower confidence bound is above break-even historically — still not a guarantee." : " This is not evidence of profitability.") : ""}`;

  return (
    <div className="space-y-4">
      <Panel title="Summary"><p className="text-sm">{summary}</p>
        {!live && <p className="mt-2 text-sm text-warning">Feed is not live — figures are frozen at {asOf ?? "the last tick"} and are not current predictions.</p>}
        {gapAt && <p className="mt-2 text-xs text-warning">A timestamp gap was detected; only the {n} ticks since {new Date(gapAt * 1000).toLocaleTimeString()} are used.</p>}
      </Panel>

      <Panel title="Settings">
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2">Model<Seg value={model} options={MODELS} onChange={setModel} fmt={(m) => MODEL_LABEL[m]} /></span>
          <span className="flex items-center gap-2">Window W<Seg value={window} options={WINDOWS} onChange={setWindow} /></span>
          <span className="flex items-center gap-2">Half-life<Seg value={halfLife} options={HALF_LIVES} onChange={setHalfLife} /></span>
          <span className="flex items-center gap-2">Markov smoothing α<Seg value={alpha} options={[0.5, 1, 2, 5]} onChange={setAlpha} /></span>
        </div>
      </Panel>

      <Panel title="Current prediction">
        {!enough || !live ? <p className="text-sm text-muted-foreground">{!enough ? `Insufficient data: ${n} contiguous valid ticks, at least ${MIN_CURRENT_TICKS} needed. No prediction issued.` : "No current prediction while the feed is not live."}</p> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <table className="num w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th>Digit</th>{MODELS.map((m) => <th key={m}>{MODEL_LABEL[m]}</th>)}</tr></thead>
              <tbody>{Array.from({ length: 10 }, (_, d) => (
                <tr key={d} className="border-t border-border"><td>{d}</td>{MODELS.map((m) => <td key={m} className={cn(argmax(dists[m]) === d && "font-bold text-primary")}>{pct(dists[m][d], 2)}</td>)}</tr>
              ))}</tbody>
            </table>
            <table className="w-full text-sm"><tbody>
              {[
                ["Market", market], ["Model", `${MODEL_LABEL[model]} (${param})`],
                ["Best Matches digit", `${top} — ${pct(sel[top], 2)}`],
                ["Even/Odd lean", eo.lean === "NEUTRAL" ? "Neutral (50/50)" : `${eo.lean} — ${pct(eo.p, 2)}`],
                ["Previous digit", mk.prev ?? "—"], ["Ticks used", model === "decay" ? n : Math.min(n, window)], ["Last update", lastTime],
              ].map(([k, v]) => <tr key={k as string} className="border-t border-border"><td className="py-1 text-muted-foreground">{k}</td><td className="num">{v}</td></tr>)}
            </tbody></table>
            <div className="text-xs text-warning lg:col-span-2 space-y-1">
              {n < window && <p>Rolling/Markov: only {n} of {window} window ticks available.</p>}
              {mk.rowCount < MIN_MARKOV_ROW && <p>Markov: only {mk.rowCount} transitions from digit {mk.prev} (need {MIN_MARKOV_ROW}); its row is mostly smoothing.</p>}
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Walk-forward validation (all predictions from tick 500)">
        {!wf ? <p className="text-sm text-muted-foreground">Insufficient data: need more than {WF_START} contiguous ticks ({n} loaded).</p> : (
          <div className="overflow-x-auto"><table className="num w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th>Model</th><th>N</th><th>Matches hits</th><th>Rate</th><th>95% CI</th><th>E/O hits</th><th>Rate</th><th>95% CI</th><th>Mean P(actual)</th><th>Log loss</th></tr></thead>
            <tbody>{MODELS.map((m) => { const s = wf.per[m].all; return (
              <tr key={m} className="border-t border-border"><td>{MODEL_LABEL[m]}</td><td>{s.n}</td><td>{s.mHits}</td><td>{pct(s.mRate)}</td><td>{ci(s.mCI)}</td><td>{s.eoHits}/{s.eoN}</td><td>{pct(s.eoRate)}</td><td>{ci(s.eoCI)}</td><td>{fx(s.meanPActual, 4)}</td><td>{fx(s.logLoss, 4)}</td></tr>
            ); })}</tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">Baselines: Matches 10%, Even/Odd 50%, mean P(actual) 0.1000, log loss ln 10 ≈ 2.3026. Each prediction uses only earlier ticks. Overlapping CIs mean the models are not distinguishable. Uses {wf.total} ticks (updates every 25).</p></div>
        )}
      </Panel>

      <Panel title={`Confidence trigger — ${MODEL_LABEL[model]} (train first 70%, frozen, test last 30%)`}>
        {!trig ? <p className="text-sm text-muted-foreground">Insufficient data.</p> : trig.threshold === null ? <p className="text-sm text-muted-foreground">Insufficient data: {trig.reason}</p> : (
          <table className="num w-full text-sm"><tbody>
            {[
              ["Selected threshold (top P ≥)", pct(trig.threshold, 0)],
              ["Training qualifying / Matches rate", `${trig.train!.n} / ${pct(trig.train!.mRate)}`],
              ["Holdout qualifying predictions", `${hold!.n} of ${trig.holdoutTotal}`],
              ["Coverage", pct(trig.coverage)],
              ["Holdout Matches rate (95% CI)", `${pct(hold!.mRate)} (${ci(hold!.mCI)}) vs 10% baseline`],
              ["Holdout Even/Odd rate (95% CI)", `${pct(hold!.eoRate)} (${ci(hold!.eoCI)}) vs 50% baseline, n=${hold!.eoN}`],
            ].map(([k, v]) => <tr key={k} className="border-t border-border"><td className="py-1 text-muted-foreground">{k}</td><td>{v}</td></tr>)}
          </tbody></table>
        )}
        {trig?.reason && trig.threshold !== null && <p className="mt-2 text-xs text-warning">{trig.reason} Results are not reliable.</p>}
      </Panel>

      <Panel title="Payout & expected value (historical, not guaranteed)">
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">Matches total return per 1 stake<input value={mPay} onChange={(e) => setMPay(e.target.value)} placeholder="from Deriv" className="num w-24 rounded border border-input bg-card px-2 py-1" /></label>
          <label className="flex items-center gap-2">Even/Odd total return per 1 stake<input value={eoPay} onChange={(e) => setEoPay(e.target.value)} placeholder="from Deriv" className="num w-24 rounded border border-input bg-card px-2 py-1" /></label>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Copy the total return (including stake) from the actual Deriv proposal. No payout is prefilled or estimated here.</p>
        <table className="num w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th>Contract</th><th>Holdout hit rate</th><th>Break-even</th><th>Historical EV / trade</th></tr></thead>
          <tbody>
            {[["Matches", hold?.mRate, mBE, mEV, mP], ["Even/Odd", hold?.eoRate, eBE, eEV, eP]].map(([k, r, be, ev, p]) => (
              <tr key={k as string} className="border-t border-border"><td>{k}</td><td>{holdOk ? pct(r as number) : "insufficient"}</td><td>{Number.isFinite(p as number) && (p as number) <= 1 ? "payout must exceed 1" : pct(be as number)}</td>
                <td className={cn((ev as number) < 0 && "text-destructive")}>{fx(ev as number, 3)}{(ev as number) < 0 ? " — negative historical EV at this payout" : ""}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Deriv Bot rule (manual reconstruction guide)">
        <pre className="num whitespace-pre-wrap rounded bg-secondary p-3 text-xs">{[
          `Market: ${market}`,
          `Model: ${MODEL_LABEL[model]} (${param}${model === "markov" ? `, Laplace α=${alpha}` : ""})`,
          `Matches: contract DIGITMATCH, prediction digit ${enough ? top : "—"}, duration 1 tick`,
          `Even/Odd: contract ${eo.lean === "EVEN" ? "DIGITEVEN" : eo.lean === "ODD" ? "DIGITODD" : "none (neutral)"}, duration 1 tick`,
          `Trigger: trade only when the model's top digit probability ≥ ${trig?.threshold != null ? pct(trig.threshold, 0) : "— (no validated threshold)"}`,
          `Stake/payout: use the live Deriv proposal; skip if hit rate < 1 / total return.`,
        ].join("\n")}</pre>
        <p className="mt-2 text-xs text-muted-foreground">Deriv Bot does not receive TickLens's predictions. There is no export or automatic connection — rebuild this rule yourself in Deriv Bot blocks. The digit shown is a snapshot and changes with every tick.</p>
      </Panel>
    </div>
  );
}
