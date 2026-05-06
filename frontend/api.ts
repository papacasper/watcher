import type { DashboardData } from "./types.js";

const JSON_HEADERS = { "Accept": "application/json" };
const ACTION_HEADERS = { ...JSON_HEADERS, "X-Watcher-Action": "1" };

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

export function apiGet(path: string): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${path}${sep}_=${Date.now()}`, {
    cache: "no-store",
    headers: JSON_HEADERS,
  });
}

export function apiPost(path: string): Promise<Response> {
  return fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: ACTION_HEADERS,
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
