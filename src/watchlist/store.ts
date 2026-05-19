import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { getCacheDir } from "../dashboard/cache.js";

function getWatchlistPath(): string {
  return `${getCacheDir()}/watchlist.json`;
}

function ensureDir(): void {
  const dir = getCacheDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function loadWatchlist(): string[] {
  const path = getWatchlistPath();
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(raw)) return raw.filter(s => typeof s === "string");
  } catch { /* ignore corrupt file, return empty */ }
  return [];
}

function persist(tickers: string[]): void {
  ensureDir();
  const path = getWatchlistPath();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(tickers, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function addToWatchlist(ticker: string): string[] {
  const upper = ticker.trim().toUpperCase();
  const list = loadWatchlist();
  if (!list.includes(upper)) { list.push(upper); persist(list); }
  return list;
}

export function removeFromWatchlist(ticker: string): string[] {
  const upper = ticker.trim().toUpperCase();
  const list = loadWatchlist().filter(t => t !== upper);
  persist(list);
  return list;
}
