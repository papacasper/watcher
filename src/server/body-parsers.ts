import type { WatcherConfigPatch } from "../config-store.js";

const ALLOWED_BIND_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0"]);

export function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberField(value: unknown, name: string, min = 0): number | string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(parsed) || parsed < min) return `${name} must be a number >= ${min}`;
  return parsed;
}

export function parseSetupBody(body: unknown): { patch: WatcherConfigPatch } | { error: string } {
  const obj = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const username = stringField(obj.username);
  const password = stringField(obj.password);
  if (!username || !password) return { error: "Robinhood username and password are required" };
  const dividendTargetDaily = numberField(obj.dividendTargetDaily, "dividendTargetDaily");
  if (typeof dividendTargetDaily === "string") return { error: dividendTargetDaily };
  const dailyCost = numberField(obj.dailyCost, "dailyCost");
  if (typeof dailyCost === "string") return { error: dailyCost };
  return {
    patch: {
      robinhood: { username, password, mfaCode: stringField(obj.mfaCode) },
      ...(dividendTargetDaily !== undefined ? { dividendTargetDaily } : {}),
      ...(dailyCost !== undefined ? { dailyCost } : {}),
      access: { password: typeof obj.dashboardPassword === "string" ? obj.dashboardPassword : "" },
    },
  };
}

export function parseSettingsBody(body: unknown): { patch: WatcherConfigPatch } | { error: string } {
  const obj = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const patch: WatcherConfigPatch = {};
  const username = stringField(obj.username);
  const password = stringField(obj.password);
  const mfaCode = typeof obj.mfaCode === "string" ? obj.mfaCode.trim() : undefined;
  if (username || password || mfaCode !== undefined) {
    patch.robinhood = {};
    if (username) patch.robinhood.username = username;
    if (password) patch.robinhood.password = password;
    if (mfaCode !== undefined) patch.robinhood.mfaCode = mfaCode;
  }
  const dividendTargetDaily = numberField(obj.dividendTargetDaily, "dividendTargetDaily");
  if (typeof dividendTargetDaily === "string") return { error: dividendTargetDaily };
  if (dividendTargetDaily !== undefined) patch.dividendTargetDaily = dividendTargetDaily;
  const dailyCost = numberField(obj.dailyCost, "dailyCost");
  if (typeof dailyCost === "string") return { error: dailyCost };
  if (dailyCost !== undefined) patch.dailyCost = dailyCost;
  if (typeof obj.dashboardPassword === "string") {
    patch.access = { ...(patch.access ?? {}), password: obj.dashboardPassword };
  }
  const hostRaw = stringField(obj.host);
  if (hostRaw && !ALLOWED_BIND_HOSTS.has(hostRaw)) {
    return { error: `host must be one of: ${[...ALLOWED_BIND_HOSTS].join(", ")}` };
  }
  const port = numberField(obj.port, "port", 1);
  const refreshMs = numberField(obj.refreshMs, "refreshMs", 1_000);
  const refreshTimeoutMs = numberField(obj.refreshTimeoutMs, "refreshTimeoutMs", 5_000);
  if (typeof port === "string") return { error: port };
  if (typeof refreshMs === "string") return { error: refreshMs };
  if (typeof refreshTimeoutMs === "string") return { error: refreshTimeoutMs };
  if (hostRaw || port !== undefined || refreshMs !== undefined || refreshTimeoutMs !== undefined) {
    patch.server = {};
    if (hostRaw) patch.server.host = hostRaw;
    if (port !== undefined) patch.server.port = port;
    if (refreshMs !== undefined) patch.server.refreshMs = refreshMs;
    if (refreshTimeoutMs !== undefined) patch.server.refreshTimeoutMs = refreshTimeoutMs;
  }
  return { patch };
}
