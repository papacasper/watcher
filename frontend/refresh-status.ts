import type { ApiStatus } from "./api.js";

export const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function isStale(fetchedAt: string | null | undefined, now = new Date()): boolean {
  if (!fetchedAt) return false;
  const fetched = new Date(fetchedAt).getTime();
  return Number.isFinite(fetched) && now.getTime() - fetched > STALE_THRESHOLD_MS;
}

export function refreshHeaderText(status: Pick<ApiStatus, "refreshPhase" | "fetchedAt">, now = new Date()): string {
  if (status.refreshPhase === "fetching") return "Refreshing...";
  if (status.refreshPhase === "approval_needed") return "Approval needed";
  if (status.refreshPhase === "failed") return "Refresh failed";
  if (!status.fetchedAt) return "";
  if (isStale(status.fetchedAt, now)) return `Stale since ${formatShortDate(status.fetchedAt)}`;

  const fetched = new Date(status.fetchedAt);
  if (
    fetched.getFullYear() === now.getFullYear() &&
    fetched.getMonth() === now.getMonth() &&
    fetched.getDate() === now.getDate()
  ) {
    return "Refreshed today";
  }

  return `Refreshed ${formatShortDate(status.fetchedAt)}`;
}

export function refreshBannerText(status: Pick<ApiStatus, "refreshPhase" | "refreshMessage" | "error" | "fetchedAt">, now = new Date()): string | null {
  if (status.refreshPhase === "approval_needed") {
    return status.refreshMessage ?? "Open Robinhood and tap Approve to refresh Watcher.";
  }
  if (status.refreshPhase === "failed") {
    return status.refreshMessage ?? status.error ?? "Refresh failed.";
  }
  if (status.fetchedAt && isStale(status.fetchedAt, now)) {
    return `Data is stale since ${formatShortDate(status.fetchedAt)}.`;
  }
  return null;
}

export function refreshBannerClass(status: Pick<ApiStatus, "refreshPhase" | "fetchedAt">, now = new Date()): string {
  if (status.refreshPhase === "approval_needed") return "approval";
  if (status.refreshPhase === "failed") return "failed";
  if (status.fetchedAt && isStale(status.fetchedAt, now)) return "stale";
  return "";
}
