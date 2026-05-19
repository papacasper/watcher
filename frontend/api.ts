import type { DashboardData } from "./types.js";

const JSON_HEADERS = { "Accept": "application/json" };

function actionToken(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="watcher-action-token"]')?.content ?? "1";
}

function actionHeaders(): Record<string, string> {
  return { ...JSON_HEADERS, "X-Watcher-Action": actionToken() };
}

export type RefreshPhase = "idle" | "fetching" | "approval_needed" | "failed";

export interface ApiStatus {
  refreshing: boolean;
  error: string | null;
  fetchedAt: string | null;
  refreshPhase: RefreshPhase;
  refreshMessage: string | null;
  lastRefreshStartedAt: string | null;
  lastRefreshFinishedAt: string | null;
  sourceErrors?: Record<string, string>;
  sourceWarnings?: Record<string, string>;
  sourceStatus?: Record<string, unknown>;
}

export interface SetupState {
  configured: boolean;
  needsApproval: boolean;
  approvalMessage: string | null;
  dividendTargetDaily: number;
  dailyCost: number;
  dashboardUser: string;
  hasDashboardPassword: boolean;
  server: {
    host: string;
    port: number;
    refreshMs: number;
    refreshTimeoutMs: number;
  };
}

export interface SetupPayload {
  username: string;
  password: string;
  mfaCode?: string;
  dashboardPassword?: string;
  dividendTargetDaily?: number;
  dailyCost?: number;
}

export interface SettingsPayload extends Partial<SetupPayload> {
  host?: string;
  port?: number;
  refreshMs?: number;
  refreshTimeoutMs?: number;
}

function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

export function apiGet(path: string): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(apiUrl(`${path}${sep}_=${Date.now()}`), {
    cache: "no-store",
    credentials: "same-origin",
    headers: JSON_HEADERS,
  });
}

export function apiPost(path: string): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: actionHeaders(),
  });
}

async function apiPostJson(path: string, payload: unknown, action = true): Promise<Response> {
  return fetch(apiUrl(path), {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(action ? actionHeaders() : JSON_HEADERS),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function getDashboardData(): Promise<DashboardData> {
  const response = await apiGet("/api/data");
  const body = await response.json().catch(() => null) as (DashboardData & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error ?? `Data request failed: ${response.status}`);
  if (!body) throw new Error("Empty dashboard response");
  return body;
}

export async function getStatus(): Promise<ApiStatus> {
  const response = await apiGet("/api/status");
  const body = await response.json().catch(() => null) as ApiStatus | null;
  if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
  if (!body) throw new Error("Empty status response");
  return body;
}

export async function getSetup(): Promise<SetupState> {
  const response = await apiGet("/api/setup");
  const body = await response.json().catch(() => null) as SetupState | null;
  if (!response.ok) throw new Error(`Setup request failed: ${response.status}`);
  if (!body) throw new Error("Empty setup response");
  return body;
}

export async function submitSetup(payload: SetupPayload): Promise<void> {
  const response = await apiPostJson("/api/setup", payload, false);
  const body = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Setup failed: ${response.status}`);
}

export async function submitSettings(payload: SettingsPayload): Promise<{ requiresRestart: boolean }> {
  const response = await apiPostJson("/api/settings", payload, true);
  const body = await response.json().catch(() => null) as { error?: string; requiresRestart?: boolean } | null;
  if (!response.ok) throw new Error(body?.error ?? `Settings update failed: ${response.status}`);
  return { requiresRestart: !!body?.requiresRestart };
}

export async function getWatchlist(): Promise<string[]> {
  const response = await apiGet("/api/watchlist");
  const body = await response.json().catch(() => null) as { tickers?: string[] } | null;
  if (!response.ok) throw new Error(`Watchlist fetch failed: ${response.status}`);
  return body?.tickers ?? [];
}

export async function addWatchlistTicker(ticker: string): Promise<string[]> {
  const response = await apiPostJson("/api/watchlist", { ticker });
  const body = await response.json().catch(() => null) as { tickers?: string[]; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Add failed: ${response.status}`);
  return body?.tickers ?? [];
}

export async function removeWatchlistTicker(ticker: string): Promise<string[]> {
  const response = await fetch(apiUrl(`/api/watchlist/${encodeURIComponent(ticker)}`), {
    method: "DELETE",
    cache: "no-store",
    credentials: "same-origin",
    headers: actionHeaders(),
  });
  const body = await response.json().catch(() => null) as { tickers?: string[]; error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `Remove failed: ${response.status}`);
  return body?.tickers ?? [];
}
