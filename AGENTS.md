<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Statistics, backtesting and the Deriv connection live in `src/lib/` (stats.ts, backtest.ts, deriv.ts), separate from UI in `src/components/deriv/` — keeps calculations pure and testable.
- Live data uses Deriv's public options WebSocket (`wss://api.derivws.com/trading/v1/options/ws/public`, no auth); the legacy `ws.derivws.com` endpoint is unreachable. Never show simulated data.
- Undefined metrics (no data, zero trades, impossible contracts) are NaN in `src/lib` and render as "—" via `fx`/`pct`; feed freshness comes only from `feedState` in `src/lib/ticks.ts` — keeps empty/stale data from looking like real results.
