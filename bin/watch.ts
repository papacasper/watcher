#!/usr/bin/env bun
import { auth } from "../src/robinhood/auth.js";
import { getOpenStockPositions } from "../src/robinhood/accounts.js";
import { WhaleMonitor } from "../src/monitor/whale.js";
import { SystemNotifier } from "../src/utils/notifier.js";
import { TickerWatcher, type TickerQuote } from "../src/monitor/tickers.js";
import { loadOptionalRobinhoodCredentials, numberEnv } from "../src/config.js";

const POLL_INTERVAL_MS = numberEnv("POLL_INTERVAL_MS", 60000, Bun.env, { integer: true, min: 1_000 });
const DXY_THRESHOLD = numberEnv("DXY_THRESHOLD", 97.0, Bun.env);
const ALERT_COOLDOWN_MS = 300_000;

// Parse WATCH_THRESHOLDS=O:60.0,JEPI:52.0
const thresholds = new Map<string, number>();
for (const entry of (Bun.env.WATCH_THRESHOLDS ?? "").split(",").map(s => s.trim()).filter(Boolean)) {
  const colonIdx = entry.lastIndexOf(":");
  if (colonIdx < 1) continue;
  const sym = entry.slice(0, colonIdx).toUpperCase();
  const val = parseFloat(entry.slice(colonIdx + 1));
  if (sym && !isNaN(val)) thresholds.set(sym, val);
}

async function resolveWatchSymbols(): Promise<string[]> {
  if (Bun.env.WATCH_SYMBOLS) {
    return Bun.env.WATCH_SYMBOLS.split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
  }
  const credentials = loadOptionalRobinhoodCredentials();
  if (credentials) {
    try {
      await auth.login(credentials);
      const positions = await getOpenStockPositions() as any[];
      const symbols = positions.map((p: any) => (p.symbol as string | undefined)?.toUpperCase()).filter(Boolean) as string[];
      if (symbols.length > 0) {
        console.log(`[watch] Auto-detected ${symbols.length} symbols from Robinhood portfolio`);
        return symbols;
      }
    } catch (e) {
      console.warn("[watch] Could not auto-detect symbols from Robinhood:", e instanceof Error ? e.message : e);
    }
  }
  console.warn("[watch] No WATCH_SYMBOLS set and no RH credentials for auto-detection. No symbols to watch.");
  return [];
}

const WATCH_SYMBOLS = await resolveWatchSymbols();

console.log(`[watch] Starting Whale Monitor...`);
console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
console.log(`  DXY threshold: ${DXY_THRESHOLD}`);
console.log(`  Watching: ${WATCH_SYMBOLS.join(", ") || "(none)"}`);
if (thresholds.size > 0) {
  console.log(`  Price thresholds: ${[...thresholds.entries()].map(([s, v]) => `${s}:${v}`).join(", ")}`);
}
console.log(`  Press Ctrl+C to stop\n`);

const notifier = new SystemNotifier();
const whaleMonitor = new WhaleMonitor();
const tickerWatcher = new TickerWatcher(WATCH_SYMBOLS);

let lastAlertAt = 0;
let checking = false;

async function checkAndNotify() {
  if (checking) return;
  checking = true;

  try {
    const [whaleResult, tickersResult] = await Promise.allSettled([
      whaleMonitor.check(),
      tickerWatcher.getAllQuotes(),
    ]);
    const whaleSignal = whaleResult.status === "fulfilled" ? whaleResult.value : null;
    const tickers: TickerQuote[] = tickersResult.status === "fulfilled" ? tickersResult.value : [];

    const alerts: string[] = [];

    if (whaleSignal && whaleSignal.dxy < DXY_THRESHOLD) {
      alerts.push(`DXY Alert: ${whaleSignal.dxy.toFixed(4)} < ${DXY_THRESHOLD}`);
    }

    for (const t of tickers) {
      const threshold = thresholds.get(t.symbol);
      if (threshold !== undefined && t.price > 0 && t.price < threshold) {
        alerts.push(`${t.symbol} Price Alert: $${t.price.toFixed(2)} < $${threshold}`);
      }
    }

    const priceMap = new Map(tickers.map(t => [t.symbol, t.price]));
    const quoteText = WATCH_SYMBOLS
      .map(sym => { const p = priceMap.get(sym); return `${sym}: ${p == null ? "n/a" : `$${p.toFixed(2)}`}`; })
      .join(" | ");

    const dxyText = whaleSignal ? whaleSignal.dxy.toFixed(4) : "n/a";
    console.log(`[${new Date().toLocaleTimeString()}] DXY: ${dxyText}${quoteText ? ` | ${quoteText}` : ""}`);

    if (whaleResult.status === "rejected") {
      console.warn(`  DXY provider failed: ${whaleResult.reason instanceof Error ? whaleResult.reason.message : whaleResult.reason}`);
    }
    if (tickersResult.status === "rejected") {
      console.warn(`  Ticker provider failed: ${tickersResult.reason instanceof Error ? tickersResult.reason.message : tickersResult.reason}`);
    }

    if (alerts.length > 0) {
      const now = Date.now();
      if (now - lastAlertAt > ALERT_COOLDOWN_MS) {
        lastAlertAt = now;
        const msg = alerts.join("\n");
        console.log(`\nALERT: ${msg}\n`);
        notifier.notify("Whale Watcher Alert", msg);
      }
    }
  } catch (e) {
    console.warn(`[${new Date().toLocaleTimeString()}] watch poll failed:`, e instanceof Error ? e.message : e);
  } finally {
    checking = false;
  }
}

await checkAndNotify();
const interval = setInterval(checkAndNotify, POLL_INTERVAL_MS);

process.on("SIGINT", () => {
  console.log("\n[watch] Stopping...");
  clearInterval(interval);
  process.exit(0);
});
