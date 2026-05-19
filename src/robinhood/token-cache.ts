import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { decrypt, encrypt, isEncrypted } from "../security/secret-box.js";

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

const TOKEN_FIELDS = ["accessToken", "refreshToken", "deviceToken"] as const;

function decryptTokens(raw: Record<string, unknown>): Record<string, unknown> {
  const result = { ...raw };
  for (const field of TOKEN_FIELDS) {
    if (typeof result[field] === "string") {
      result[field] = decrypt(result[field] as string);
    }
  }
  return result;
}

function encryptTokens(state: Record<string, unknown>): Record<string, unknown> {
  const result = { ...state };
  for (const field of TOKEN_FIELDS) {
    if (typeof result[field] === "string" && result[field]) {
      result[field] = encrypt(result[field] as string);
    }
  }
  return result;
}

export function loadAuthCache<T>(): T | null {
  try {
    ensureTokenDir();
    const cachePath = getAuthCachePath();
    if (!existsSync(cachePath)) return null;

    chmodSync(cachePath, 0o600);
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, unknown>;
    // Decrypt token fields; isEncrypted check allows loading legacy plaintext caches
    const anyEncrypted = TOKEN_FIELDS.some(f => typeof raw[f] === "string" && isEncrypted(raw[f] as string));
    return (anyEncrypted ? decryptTokens(raw) : raw) as T;
  } catch {
    return null;
  }
}

export function saveAuthCache(state: unknown): void {
  try {
    ensureTokenDir();
    const cachePath = getAuthCachePath();
    const encrypted = encryptTokens(state as Record<string, unknown>);
    writeFileSync(cachePath, JSON.stringify(encrypted), { mode: 0o600 });
    chmodSync(cachePath, 0o600);
  } catch (e) {
    console.warn("[token-cache] Failed to write auth cache:", e instanceof Error ? e.message : e);
  }
}

export function removeAuthCache(): void {
  try {
    const cachePath = getAuthCachePath();
    if (existsSync(cachePath)) unlinkSync(cachePath);
  } catch (e) {
    console.warn("[token-cache] Failed to remove auth cache:", e instanceof Error ? e.message : e);
  }
}
