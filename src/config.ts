import type { DashboardAccessConfig } from "./server/access.js";

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

export interface AlpacaCredentialsConfig {
  key: string;
  secret: string;
}

export interface ServerConfig {
  port: number;
  host: string;
  refreshMs: number;
  refreshTimeoutMs: number;
  access: DashboardAccessConfig;
}

export function loadDailyCost(env: Env = Bun.env): number {
  return numberEnv("DAILY_COST", 150, env, { min: 0 });
}

export function loadRobinhoodCredentials(env: Env = Bun.env): RobinhoodCredentialsConfig {
  return {
    username: requiredEnv("RH_USERNAME", env),
    password: requiredEnv("RH_PASSWORD", env),
    mfaCode: optionalEnv("RH_MFA_CODE", env) ?? optionalEnv("RH_MFA", env),
  };
}

export function loadOptionalRobinhoodCredentials(env: Env = Bun.env): RobinhoodCredentialsConfig | null {
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

export function loadAlpacaCredentials(env: Env = Bun.env): AlpacaCredentialsConfig {
  return {
    key: requiredEnv("ALPACA_API_KEY", env),
    secret: requiredEnv("ALPACA_API_SECRET", env),
  };
}

export function loadServerConfig(env: Env = Bun.env): ServerConfig {
  return {
    port: numberEnv("PORT", 4242, env, { integer: true, min: 1 }),
    host: optionalEnv("HOST", env) ?? "127.0.0.1",
    refreshMs: numberEnv("REFRESH_MS", 48 * 60 * 60 * 1000, env, { integer: true, min: 1_000 }),
    refreshTimeoutMs: numberEnv("REFRESH_TIMEOUT_MS", 90_000, env, { integer: true, min: 5_000 }),
    access: {
      user: optionalEnv("DASHBOARD_USER", env) ?? "watcher",
      password: optionalEnv("DASHBOARD_PASSWORD", env) ?? "",
      allowUnauthRemote: booleanEnv("ALLOW_UNAUTH_REMOTE", false, env),
      stateChangeHeader: "1",
    },
  };
}
