import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import type { DashboardData } from "./data.js";

export function getCacheDir(): string {
  return Bun.env.WATCHER_CACHE_DIR ?? `${Bun.env.HOME ?? "."}/.watcher`;
}

export function getCachePath(): string {
  return `${getCacheDir()}/data.json`;
}

function ensureCacheDir(): void {
  const cacheDir = getCacheDir();
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  chmodSync(cacheDir, 0o700);
}

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function loadDataCache(): DashboardData | null {
  try {
    ensureCacheDir();
    const path = getCachePath();
    if (!existsSync(path)) return null;
    chmodSync(path, 0o600);
    const age = Date.now() - statSync(path).mtimeMs;
    if (age > CACHE_MAX_AGE_MS) {
      unlinkSync(path);
      return null;
    }
    return JSON.parse(readFileSync(path, "utf8")) as DashboardData;
  } catch {
    return null;
  }
}

export function saveDataCache(data: DashboardData): void {
  try {
    ensureCacheDir();
    const path = getCachePath();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  } catch {
    // non-fatal
  }
}
