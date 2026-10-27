import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, ShieldAlert } from "lucide-react";
import { useSymbols, useTicks } from "@/lib/deriv";
import { buildSignal, CONTRACTS, detectRegime, needsBarrier, rankSignals } from "@/lib/stats";
import { feedState } from "@/lib/ticks";
import { Panel, Seg, Stat, StrengthBadge, pct } from "@/components/deriv/ui";
import { BacktestPanel, DigitPanel, EVPanel, EvenOddPanel, IntelPanel, MatchesPanel, OverUnderPanel, RiseFallPanel, ScannerPanel, SignalsPanel } from "@/components/deriv/panels";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TickLens — Deriv Market Intelligence" },
      { name: "description", content: "Live statistical analysis of Deriv synthetic indices: digits, even/odd, rise/fall, matches, over/under, signals and backtesting." },
      { property: "og:title", content: "TickLens — Deriv Market Intelligence" },
      { property: "og:description", content: "Real-time digit statistics, regime detection and honest backtesting for Deriv synthetic indices." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const TABS = ["Dashboard", "Digits", "Even/Odd", "Rise/Fall", "Matches/Differs", "Over/Under", "Intelligence", "Signals", "Scanner", "Backtest", "EV Calculator"] as const;
type Tab = (typeof TABS)[number];

function Index() {
  const { symbols, error: symErr } = useSymbols();
  const [symbol, setSymbol] = useState<string>("R_100");
  const [buffer, setBuffer] = useState(2000);
  const [win, setWin] = useState(250);
  const [custom, setCustom] = useState("");
  const [tab, setTab] = useState<Tab>("Dashboard");
  const info = symbols.find((s) => s.symbol === symbol);
  useEffect(() => { if (symbols.length && !info) setSymbol(symbols[0].symbol); }, [symbols, info]);
  const { ticks, status, lastAt, error, reconnect } = useTicks(info ? symbol : null, info?.pip ?? 0.01, buffer);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const window = Math.min(win, ticks.length);
  const last = ticks.at(-1), prev = ticks.at(-2);
  const move = last && prev ? last.quote - prev.quote : 0;
  const stale = lastAt ? (now - lastAt) / 1000 : Infinity;
  const feed = feedState({ status, lastAt, now, error, tickCount: ticks.length });
  const live = feed === "live";
  const asOf = last ? new Date(last.epoch * 1000).toLocaleTimeString() : null;
  const marketName = info?.display_name ?? symbol;

  const statusEl = (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn("h-2 w-2 rounded-full", live ? "bg-success animate-pulse" : status === "offline" ? "bg-destructive" : "bg-warning")} />
      <span className="text-muted-foreground">{{ live: "Live", stale: "Stale data", offline: "Disconnected", reconnecting: "Reconnecting…", error: "Feed error", loading: "Connecting…" }[feed]}</span>
      <button onClick={reconnect} className="rounded p-1 text-muted-foreground hover:bg-secondary" aria-label="Reconnect"><RefreshCw className="h-3.5 w-3.5" /></button>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1500px] px-3 py-4 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h1 className="text-lg font-bold tracking-tight">Tick<span className="text-primary">Lens</span></h1></div>
        <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="rounded border border-input bg-card px-2 py-1.5 text-sm">
          {!symbols.length && <option>Loading markets…</option>}
          {symbols.map((s) => <option key={s.symbol} value={s.symbol}>{s.display_name}</option>)}
        </select>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">Window
          <Seg value={win} options={[50, 100, 250, 500, 1000]} onChange={(v) => { setWin(v); setCustom(""); }} />
          <input placeholder="custom" value={custom} onChange={(e) => { setCustom(e.target.value); const n = parseInt(e.target.value); if (n >= 10) setWin(n); }} className="num w-20 rounded border border-input bg-card px-2 py-1 text-xs" />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">Buffer<Seg value={buffer} options={[1000, 2000, 5000]} onChange={setBuffer} /></div>
        <div className="ml-auto">{statusEl}</div>
      </header>

      {(symErr || error) && <div className="mb-3 rounded border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{symErr || error} — analysis paused until live data returns.</div>}

      <div className="mb-4 grid grid-cols-2 gap-4 rounded-md border border-border bg-card p-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={marketName} value={last ? last.quote.toFixed(info ? Math.max(0, Math.round(-Math.log10(info.pip))) : 2) : "—"} tone={move > 0 ? "up" : move < 0 ? "down" : undefined} />
        <Stat label="Last digit" value={last ? last.digit : "—"} />
        <Stat label="Tick change" value={last && prev ? (move > 0 ? "+" : "") + move.toFixed(4) : "—"} tone={move > 0 ? "up" : move < 0 ? "down" : undefined} />
        <Stat label="Last tick" value={last ? new Date(last.epoch * 1000).toLocaleTimeString() : "—"} sub={Number.isFinite(stale) ? `${Math.max(0, stale).toFixed(0)}s ago` : ""} tone={stale > 10 ? "warn" : undefined} />
        <Stat label="Ticks loaded" value={ticks.length} sub={`analysing ${window}`} />
        <Stat label="Mode" value={live ? "Live" : "Paused"} tone={live ? "up" : "warn"} />
      </div>

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors", tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
      </nav>

      {!live && ticks.length >= 50 && tab !== "EV Calculator" && (
        <div role="status" className="mb-3 rounded border border-warning/60 bg-warning/10 p-2 text-sm text-warning">
          {feed === "stale" ? "Feed is stale" : feed === "offline" ? "Feed disconnected" : feed === "reconnecting" ? "Reconnecting to Deriv" : feed === "error" ? "Feed error" : "Loading"} — figures below are frozen at the last tick received{asOf ? ` (${asOf})` : ""}. They are historical, not current live signals.
        </div>
      )}
      {ticks.length < 50 && tab !== "EV Calculator" ? (
        <Panel><p className="text-sm text-muted-foreground">{
          feed === "offline" ? "Disconnected from Deriv — no analysis is shown. Press reconnect to try again."
          : feed === "reconnecting" ? "Connection lost — reconnecting. No analysis is shown until live data returns."
          : feed === "error" ? "Could not load ticks for this market. No analysis is shown."
          : ticks.length ? `Insufficient data: ${ticks.length} ticks loaded, at least 50 are needed before any statistics are shown.`
          : "Waiting for live Deriv tick data… No simulated data is shown."}</p></Panel>
      ) : (
        <>
          {tab === "Dashboard" && <Overview ticks={ticks} window={window} />}
          {tab === "Digits" && <DigitPanel ticks={ticks} window={window} />}
          {tab === "Even/Odd" && <EvenOddPanel ticks={ticks} />}
          {tab === "Rise/Fall" && <RiseFallPanel ticks={ticks} />}
          {tab === "Matches/Differs" && <MatchesPanel ticks={ticks} window={window} />}
          {tab === "Over/Under" && <OverUnderPanel ticks={ticks} window={window} />}
          {tab === "Intelligence" && <IntelPanel ticks={ticks} window={window} />}
          {tab === "Signals" && <SignalsPanel ticks={ticks} window={window} market={marketName} live={live} asOf={asOf} />}
          {tab === "Scanner" && <ScannerPanel symbols={symbols} window={window} live={status === "live"} />}
          {tab === "Backtest" && <BacktestPanel key={symbol} ticks={ticks} />}
          {tab === "EV Calculator" && <EVPanel />}
        </>
      )}

      <footer className="mt-8 flex gap-3 rounded-md border border-warning/40 bg-warning/5 p-4 text-xs text-muted-foreground">
        <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
        <p><b className="text-foreground">Analytical tool, not a profit system.</b> Historical patterns do not guarantee future outcomes. Synthetic indices are generated to behave randomly and may differ from real markets. Statistical deviations occur by chance, a high win rate does not imply positive expected value, and payouts set the break-even probability. Nothing here guarantees profitable signals — trade responsibly.</p>
      </footer>
    </div>
  );
}

function Overview({ ticks, window }: { ticks: { quote: number; digit: number }[]; window: number }) {
  const prices = ticks.map((t) => t.quote), digits = ticks.map((t) => t.digit);
  const reg = detectRegime(prices, digits, window);
  const top = useMemo(() => rankSignals(CONTRACTS.flatMap((c) => (needsBarrier(c) ? [2, 5, 7].map((b) => buildSignal(c, prices, digits, window, b)) : [buildSignal(c, prices, digits, window)]))).slice(0, 5), [ticks.length, window]); // eslint-disable-line
  const even = digits.slice(-window).filter((d) => d % 2 === 0).length / Math.max(1, Math.min(window, digits.length));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Market state">
        <div className="mb-3 flex flex-wrap gap-2">{reg.tags.map((t) => <span key={t} className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary">{t}</span>)}</div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Volatility pct" value={pct(reg.vol.pct, 0)} sub={Number.isFinite(reg.vol.pct) ? `σ ratio ${reg.vol.ratio.toFixed(2)}` : "needs more ticks"} />
          <Stat label="Direction z" value={reg.zDir.toFixed(2)} />
          <Stat label="Even share" value={pct(even)} />
          <Stat label="Digit χ² p" value={reg.chi.adequate ? reg.chi.pValue.toFixed(3) : "—"} sub={reg.chi.adequate ? undefined : "sample too small"} tone={reg.chi.adequate && reg.chi.pValue < 0.01 ? "warn" : undefined} />
        </div>
      </Panel>
      <Panel title="Largest current deviations" className="lg:col-span-2">
        <ul className="space-y-2">
          {top.map((s) => (
            <li key={s.contract + s.barrier} className="flex flex-wrap items-center gap-3 border-b border-border pb-2 text-sm last:border-0">
              <span className="num w-24 font-semibold">{s.contract}{s.barrier !== undefined ? ` ${s.barrier}` : ""}</span>
              <span className="num w-36 text-muted-foreground">{pct(s.observed)} vs {pct(s.baseline)}</span>
              <span className="num w-16">z {s.z.toFixed(2)}</span>
              <StrengthBadge s={s.strength} />
            </li>
          ))}
        </ul>
      </Panel>
      <div className="lg:col-span-3"><DigitPanel ticks={ticks as never} window={window} /></div>
    </div>
  );
}
