import { useCallback, useEffect, useRef, useState } from "react";
import { lastDigit } from "./stats";

const WS_URL = "wss://ws.derivws.com/websockets/v3?app_id=1089";

export interface SymbolInfo { symbol: string; display_name: string; submarket_display_name: string; pip: number }
export interface Tick { epoch: number; quote: number; digit: number }
export type ConnStatus = "connecting" | "live" | "reconnecting" | "offline";

const decimalsFromPip = (pip: number) => Math.max(0, Math.round(-Math.log10(pip)));

type Pending = { resolve: (v: any) => void; reject: (e: any) => void };

// Single shared Deriv WebSocket client with auto-reconnect and req_id routing.
class DerivClient {
  ws: WebSocket | null = null;
  reqId = 1;
  pending = new Map<number, Pending>();
  listeners = new Set<(m: any) => void>();
  statusListeners = new Set<(s: ConnStatus) => void>();
  status: ConnStatus = "connecting";
  retry = 0;
  openPromise: Promise<void> | null = null;
  ping: ReturnType<typeof setInterval> | null = null;

  setStatus(s: ConnStatus) { this.status = s; this.statusListeners.forEach((l) => l(s)); }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise((resolve) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      ws.onopen = () => {
        this.retry = 0; this.setStatus("live"); this.openPromise = null; resolve();
        this.ping = setInterval(() => this.send({ ping: 1 }).catch(() => {}), 25000);
      };
      ws.onmessage = (e) => {
        let m: any; try { m = JSON.parse(e.data); } catch { return; }
        const p = m.req_id && this.pending.get(m.req_id);
        if (p && m.msg_type !== "tick") { this.pending.delete(m.req_id); m.error ? p.reject(m.error) : p.resolve(m); }
        this.listeners.forEach((l) => l(m));
      };
      ws.onclose = () => {
        if (this.ping) clearInterval(this.ping);
        this.openPromise = null;
        this.pending.forEach((p) => p.reject({ message: "Connection closed" }));
        this.pending.clear();
        this.retry++;
        this.setStatus(this.retry > 6 ? "offline" : "reconnecting");
        setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retry));
      };
      ws.onerror = () => ws.close();
    });
    return this.openPromise;
  }

  async send(req: Record<string, unknown>): Promise<any> {
    await this.connect();
    const id = this.reqId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ ...req, req_id: id }));
    });
  }
  reconnect() { this.retry = 0; this.ws?.close(); }
}

let client: DerivClient | null = null;
export const getClient = () => (client ??= new DerivClient());

export function useConnStatus() {
  const [s, setS] = useState<ConnStatus>("connecting");
  useEffect(() => {
    const c = getClient(); setS(c.status); c.statusListeners.add(setS); c.connect();
    return () => { c.statusListeners.delete(setS); };
  }, []);
  return s;
}

export function useSymbols() {
  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getClient().send({ active_symbols: "brief", product_type: "basic" })
      .then((m) => setSymbols(
        (m.active_symbols as any[])
          .filter((s) => s.market === "synthetic_index" && s.exchange_is_open)
          .map((s) => ({ symbol: s.symbol, display_name: s.display_name, submarket_display_name: s.submarket_display_name, pip: s.pip }))
          .sort((a, b) => a.display_name.localeCompare(b.display_name)),
      ))
      .catch((e) => setError(e?.message ?? "Failed to load markets"));
  }, []);
  return { symbols, error };
}

export async function fetchHistory(symbol: string, count: number, pip: number): Promise<Tick[]> {
  const m = await getClient().send({ ticks_history: symbol, count, end: "latest", style: "ticks" });
  const dec = m.pip_size ?? decimalsFromPip(pip);
  const { prices, times } = m.history;
  return (prices as number[]).map((q, i) => ({ epoch: times[i], quote: q, digit: lastDigit(q, dec) }));
}

// Live stream: history + subscription; dedupes by epoch and preserves order.
export function useTicks(symbol: string | null, pip: number, buffer: number) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const status = useConnStatus();
  const subId = useRef<string | null>(null);

  const start = useCallback(async () => {
    if (!symbol) return;
    const c = getClient();
    setError(null);
    if (subId.current) c.send({ forget: subId.current }).catch(() => {});
    subId.current = null;
    try {
      const m = await c.send({ ticks_history: symbol, count: Math.min(5000, buffer), end: "latest", style: "ticks", subscribe: 1 });
      const dec = m.pip_size ?? decimalsFromPip(pip);
      subId.current = m.subscription?.id ?? null;
      const hist: Tick[] = m.history.prices.map((q: number, i: number) => ({ epoch: m.history.times[i], quote: q, digit: lastDigit(q, dec) }));
      setTicks(hist);
      setLastAt(Date.now());
    } catch (e: any) { setError(e?.message ?? "Failed to load ticks"); }
  }, [symbol, pip, buffer]);

  useEffect(() => {
    if (!symbol) return;
    const c = getClient();
    const onMsg = (m: any) => {
      if (m.msg_type !== "tick" || !m.tick || m.tick.symbol !== symbol) return;
      const t = m.tick;
      if (typeof t.quote !== "number" || typeof t.epoch !== "number") return;
      const tick: Tick = { epoch: t.epoch, quote: t.quote, digit: lastDigit(t.quote, t.pip_size ?? decimalsFromPip(pip)) };
      setTicks((prev) => {
        const last = prev[prev.length - 1];
        if (last && tick.epoch <= last.epoch) return prev; // duplicate / out of order
        const next = prev.concat(tick);
        return next.length > buffer ? next.slice(next.length - buffer) : next;
      });
      setLastAt(Date.now());
    };
    c.listeners.add(onMsg);
    start();
    return () => { c.listeners.delete(onMsg); if (subId.current) c.send({ forget: subId.current }).catch(() => {}); subId.current = null; };
  }, [symbol, start, pip, buffer]);

  // resubscribe after reconnect
  const prevStatus = useRef(status);
  useEffect(() => { if (prevStatus.current !== "live" && status === "live" && ticks.length) start(); prevStatus.current = status; }, [status]); // eslint-disable-line

  return { ticks, error, lastAt, status, reconnect: () => getClient().reconnect() };
}
