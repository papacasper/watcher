import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { getCacheDir } from "./dashboard/cache.js";
import { decrypt, encrypt, isEncrypted } from "./security/secret-box.js";

export interface WatcherConfig {
  robinhood?: {
    username: string;
    password: string;
    mfaCode?: string;
  };
  dividendTargetDaily: number;
  dailyCost: number;
  server: {
    host: string;
    port: number;
    refreshMs: number;
    refreshTimeoutMs: number;
  };
  access: {
    user: string;
    password: string;
    allowUnauthRemote: boolean;
  };
}

export type WatcherConfigPatch = Partial<{
  robinhood: Partial<NonNullable<WatcherConfig["robinhood"]>>;
  dividendTargetDaily: number;
  dailyCost: number;
  server: Partial<WatcherConfig["server"]>;
  access: Partial<WatcherConfig["access"]>;
}>;

const DEFAULT_CONFIG: WatcherConfig = {
  dividendTargetDaily: 280,
  dailyCost: 150,
  server: {
    host: "127.0.0.1",
    port: 4242,
    refreshMs: 48 * 60 * 60 * 1000,
    refreshTimeoutMs: 90_000,
  },
  access: {
    user: "watcher",
    password: "",
    allowUnauthRemote: false,
  },
};

export function getConfigPath(): string {
  return `${getCacheDir()}/config.json`;
}

function finiteNumber(value: unknown, fallback: number, min = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeConfig(raw: unknown): WatcherConfig {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const robinhoodRaw = obj.robinhood && typeof obj.robinhood === "object"
    ? obj.robinhood as Record<string, unknown>
    : undefined;
  const serverRaw = obj.server && typeof obj.server === "object"
    ? obj.server as Record<string, unknown>
    : {};
  const accessRaw = obj.access && typeof obj.access === "object"
    ? obj.access as Record<string, unknown>
    : {};

  const config: WatcherConfig = {
    dividendTargetDaily: finiteNumber(obj.dividendTargetDaily, DEFAULT_CONFIG.dividendTargetDaily),
    dailyCost: finiteNumber(obj.dailyCost, DEFAULT_CONFIG.dailyCost),
    server: {
      host: stringValue(serverRaw.host, DEFAULT_CONFIG.server.host),
      port: finiteNumber(serverRaw.port, DEFAULT_CONFIG.server.port, 1),
      refreshMs: finiteNumber(serverRaw.refreshMs, DEFAULT_CONFIG.server.refreshMs, 1_000),
      refreshTimeoutMs: finiteNumber(serverRaw.refreshTimeoutMs, DEFAULT_CONFIG.server.refreshTimeoutMs, 5_000),
    },
    access: {
      user: stringValue(accessRaw.user, DEFAULT_CONFIG.access.user),
      password: typeof accessRaw.password === "string" ? accessRaw.password : DEFAULT_CONFIG.access.password,
      allowUnauthRemote: booleanValue(accessRaw.allowUnauthRemote, DEFAULT_CONFIG.access.allowUnauthRemote),
    },
  };

  const username = optionalStringValue(robinhoodRaw?.username);
  const password = optionalStringValue(robinhoodRaw?.password);
  if (username && password) {
    config.robinhood = {
      username,
      password,
      ...(optionalStringValue(robinhoodRaw?.mfaCode) ? { mfaCode: optionalStringValue(robinhoodRaw?.mfaCode) } : {}),
    };
  }

  return config;
}

function mergeConfig(base: WatcherConfig, patch: WatcherConfigPatch): WatcherConfig {
  const robinhoodPatch = patch.robinhood;
  const merged: WatcherConfig = {
    ...base,
    dividendTargetDaily: patch.dividendTargetDaily ?? base.dividendTargetDaily,
    dailyCost: patch.dailyCost ?? base.dailyCost,
    server: { ...base.server, ...(patch.server ?? {}) },
    access: { ...base.access, ...(patch.access ?? {}) },
  };

  if (robinhoodPatch) {
    const existing = base.robinhood ?? { username: "", password: "" };
    const username = robinhoodPatch.username ?? existing.username;
    const password = robinhoodPatch.password ?? existing.password;
    if (username && password) {
      merged.robinhood = {
        username,
        password,
        ...(robinhoodPatch.mfaCode !== undefined
          ? (robinhoodPatch.mfaCode ? { mfaCode: robinhoodPatch.mfaCode } : {})
          : (existing.mfaCode ? { mfaCode: existing.mfaCode } : {})),
      };
    }
  }

  return normalizeConfig(merged);
}

function decryptField(value: string | undefined): string | undefined {
  if (!value) return value;
  return decrypt(value);
}

function decryptRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const result = { ...obj };
  if (result.robinhood && typeof result.robinhood === "object") {
    const rh = result.robinhood as Record<string, unknown>;
    result.robinhood = {
      ...rh,
      password: typeof rh.password === "string" ? decryptField(rh.password) : rh.password,
      mfaCode: typeof rh.mfaCode === "string" ? decryptField(rh.mfaCode) : rh.mfaCode,
    };
  }
  if (result.access && typeof result.access === "object") {
    const ac = result.access as Record<string, unknown>;
    result.access = {
      ...ac,
      password: typeof ac.password === "string" ? decryptField(ac.password) : ac.password,
    };
  }
  return result;
}

function needsMigration(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const obj = raw as Record<string, unknown>;
  const rh = obj.robinhood as Record<string, unknown> | undefined;
  const ac = obj.access as Record<string, unknown> | undefined;
  if (rh?.password && typeof rh.password === "string" && !isEncrypted(rh.password)) return true;
  if (ac?.password && typeof ac.password === "string" && !isEncrypted(ac.password)) return true;
  return false;
}

function encryptForDisk(config: WatcherConfig): unknown {
  return {
    ...config,
    robinhood: config.robinhood ? {
      ...config.robinhood,
      password: encrypt(config.robinhood.password),
      ...(config.robinhood.mfaCode ? { mfaCode: encrypt(config.robinhood.mfaCode) } : {}),
    } : undefined,
    access: {
      ...config.access,
      password: config.access.password ? encrypt(config.access.password) : config.access.password,
    },
  };
}

export function loadConfig(): WatcherConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG, server: { ...DEFAULT_CONFIG.server }, access: { ...DEFAULT_CONFIG.access } };

  chmodSync(path, 0o600);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (needsMigration(raw)) {
    // Re-encrypt legacy plaintext credentials in place
    const config = normalizeConfig(raw);
    writeToDisk(path, config);
    return config;
  }
  return normalizeConfig(decryptRaw(raw));
}

function writeToDisk(path: string, config: WatcherConfig): void {
  const tmp = `${path}.tmp`;
  mkdirSync(getCacheDir(), { recursive: true, mode: 0o700 });
  chmodSync(getCacheDir(), 0o700);
  writeFileSync(tmp, `${JSON.stringify(encryptForDisk(config), null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}

export function saveConfig(patch: WatcherConfigPatch): WatcherConfig {
  const config = mergeConfig(loadConfig(), patch);
  writeToDisk(getConfigPath(), config);
  return config;
}

export function isConfigured(): boolean {
  const config = loadConfig();
  return !!(config.robinhood?.username && config.robinhood.password);
}
