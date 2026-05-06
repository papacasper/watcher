import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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

export function loadDataCache(): DashboardData | null {
  try {
    ensureCacheDir();
    const path = getCachePath();
    if (!existsSync(path)) return null;
    chmodSync(path, 0o600);
    return JSON.parse(readFileSync(path, "utf8")) as DashboardData;
  } catch {
    return null;
  }
}

export function saveDataCache(data: DashboardData): void {
  try {
    ensureCacheDir();
    const path = getCachePath();
    writeFileSync(path, JSON.stringify(data), { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // non-fatal
  }
}
