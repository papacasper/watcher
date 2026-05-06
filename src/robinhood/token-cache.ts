import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";

export function getTokenDir(): string {
  return Bun.env.RH_TOKEN_DIR ?? `${Bun.env.HOME ?? "."}/.tokens`;
}

export function getAuthCachePath(): string {
  return `${getTokenDir()}/robinhood.pickle.json`;
}

function ensureTokenDir(): void {
  const tokenDir = getTokenDir();
  mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
  chmodSync(tokenDir, 0o700);
}

export function loadAuthCache<T>(): T | null {
  try {
    ensureTokenDir();
    const cachePath = getAuthCachePath();
    if (!existsSync(cachePath)) return null;

    chmodSync(cachePath, 0o600);
    return JSON.parse(readFileSync(cachePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function saveAuthCache(state: unknown): void {
  try {
    ensureTokenDir();
    const cachePath = getAuthCachePath();
    writeFileSync(cachePath, JSON.stringify(state), { mode: 0o600 });
    chmodSync(cachePath, 0o600);
  } catch {
    // Silently fail if we can't write cache
  }
}

export function removeAuthCache(): void {
  try {
    const cachePath = getAuthCachePath();
    if (existsSync(cachePath)) unlinkSync(cachePath);
  } catch {
    // Silently fail if we can't remove cache
  }
}
