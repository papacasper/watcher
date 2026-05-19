import { createHash, randomBytes } from "crypto";
import type { DashboardAccessConfig } from "./server/access.js";
import { loadConfig, saveConfig } from "./config-store.js";

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function value(name: string, env: Env): string | undefined {
  const raw = env[name];
  return raw && raw.trim() ? raw.trim() : undefined;
}

export function requiredEnv(name: string, env: Env = Bun.env): string {
  const raw = value(name, env);
  if (!raw) throw new ConfigError(`Missing required environment variable ${name}`);
  return raw;
}

export function optionalEnv(name: string, env: Env = Bun.env): string | undefined {
  return value(name, env);
}

export function numberEnv(
  name: string,
  fallback: number,
  env: Env = Bun.env,
  opts: { integer?: boolean; min?: number } = {}
): number {
  const raw = value(name, env);
  if (!raw) return fallback;

  const parsed = opts.integer ? parseInt(raw, 10) : parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`${name} must be a valid number`);
  }
  if (opts.min !== undefined && parsed < opts.min) {
    throw new ConfigError(`${name} must be >= ${opts.min}`);
  }
  return parsed;
}

export function booleanEnv(name: string, fallback = false, env: Env = Bun.env): boolean {
  const raw = value(name, env);
  if (!raw) return fallback;
  if (["true", "1", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["false", "0", "no", "off"].includes(raw.toLowerCase())) return false;
  throw new ConfigError(`${name} must be true or false`);
}

export interface RobinhoodCredentialsConfig {
  username: string;
  password: string;
  mfaCode?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  refreshMs: number;
  refreshTimeoutMs: number;
  access: DashboardAccessConfig;
}

export function loadDailyCost(env: Env = Bun.env): number {
  if (env !== Bun.env) return numberEnv("DAILY_COST", 150, env, { min: 0 });
  const config = loadConfig();
  return numberEnv("DAILY_COST", config.dailyCost, env, { min: 0 });
}

export function loadDividendTargetDaily(env: Env = Bun.env): number {
  if (env !== Bun.env) return numberEnv("DIVIDEND_TARGET_DAILY", 280, env, { min: 0 });
  const config = loadConfig();
  return numberEnv("DIVIDEND_TARGET_DAILY", config.dividendTargetDaily, env, { min: 0 });
}

export function loadRobinhoodCredentials(env: Env = Bun.env): RobinhoodCredentialsConfig {
  if (env !== Bun.env) {
    return {
      username: requiredEnv("RH_USERNAME", env),
      password: requiredEnv("RH_PASSWORD", env),
      mfaCode: optionalEnv("RH_MFA_CODE", env) ?? optionalEnv("RH_MFA", env),
    };
  }
  const optional = loadOptionalRobinhoodCredentials(env);
  if (!optional) throw new ConfigError("Robinhood credentials are not configured");
  return optional;
}

export function loadOptionalRobinhoodCredentials(env: Env = Bun.env): RobinhoodCredentialsConfig | null {
  if (env !== Bun.env) {
    const username = optionalEnv("RH_USERNAME", env);
    const password = optionalEnv("RH_PASSWORD", env);
    if (!username && !password) return null;
    if (!username || !password) {
      throw new ConfigError("Set both RH_USERNAME and RH_PASSWORD, or neither");
    }
    return {
      username,
      password,
      mfaCode: optionalEnv("RH_MFA_CODE", env) ?? optionalEnv("RH_MFA", env),
    };
  }

  migrateEnvCredentialsOnce(env);
  const config = loadConfig();
  const username = optionalEnv("RH_USERNAME", env) ?? config.robinhood?.username;
  const password = optionalEnv("RH_PASSWORD", env) ?? config.robinhood?.password;
  if (!username && !password) return null;
  if (!username || !password) {
    throw new ConfigError("Set both RH_USERNAME and RH_PASSWORD, or neither");
  }
  return {
    username,
    password,
    mfaCode: optionalEnv("RH_MFA_CODE", env) ?? optionalEnv("RH_MFA", env),
  };
}

// Per-process nonce: token changes on every restart so it can't be pre-computed
const PROCESS_NONCE = randomBytes(16).toString("hex");

function deriveActionToken(password: string): string {
  return createHash("sha256").update(`watcher-action:${password}:${PROCESS_NONCE}`).digest("hex").slice(0, 16);
}

export function loadServerConfig(env: Env = Bun.env): ServerConfig {
  if (env !== Bun.env) {
    const password = optionalEnv("DASHBOARD_PASSWORD", env) ?? "";
    return {
      port: numberEnv("PORT", 4242, env, { integer: true, min: 1 }),
      host: optionalEnv("HOST", env) ?? "127.0.0.1",
      refreshMs: numberEnv("REFRESH_MS", 48 * 60 * 60 * 1000, env, { integer: true, min: 1_000 }),
      refreshTimeoutMs: numberEnv("REFRESH_TIMEOUT_MS", 90_000, env, { integer: true, min: 5_000 }),
      access: {
        user: optionalEnv("DASHBOARD_USER", env) ?? "watcher",
        password,
        allowUnauthRemote: booleanEnv("ALLOW_UNAUTH_REMOTE", false, env),
        stateChangeHeader: deriveActionToken(password),
      },
    };
  }

  const config = loadConfig();
  const password = optionalEnv("DASHBOARD_PASSWORD", env) ?? config.access.password;
  return {
    port: numberEnv("PORT", config.server.port, env, { integer: true, min: 1 }),
    host: optionalEnv("HOST", env) ?? config.server.host,
    refreshMs: numberEnv("REFRESH_MS", config.server.refreshMs, env, { integer: true, min: 1_000 }),
    refreshTimeoutMs: numberEnv("REFRESH_TIMEOUT_MS", config.server.refreshTimeoutMs, env, { integer: true, min: 5_000 }),
    access: {
      user: optionalEnv("DASHBOARD_USER", env) ?? config.access.user,
      password,
      allowUnauthRemote: booleanEnv("ALLOW_UNAUTH_REMOTE", config.access.allowUnauthRemote, env),
      stateChangeHeader: deriveActionToken(password),
    },
  };
}

function migrateEnvCredentialsOnce(env: Env): void {
  const config = loadConfig();
  if (config.robinhood?.username && config.robinhood.password) return;
  const username = optionalEnv("RH_USERNAME", env);
  const password = optionalEnv("RH_PASSWORD", env);
  if (!username || !password) return;
  try {
    saveConfig({
      robinhood: {
        username,
        password,
        mfaCode: optionalEnv("RH_MFA_CODE", env) ?? optionalEnv("RH_MFA", env),
      },
    });
    console.log("Migrated Robinhood credentials from environment to ~/.watcher/config.json");
  } catch {
    // Environment credentials remain valid when config migration is not writable.
  }
}
