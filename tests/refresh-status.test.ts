import { describe, expect, test } from "bun:test";
import type { ApiStatus } from "../frontend/api.js";
import { refreshBannerText, refreshHeaderText } from "../frontend/refresh-status.js";

function status(overrides: Partial<ApiStatus>): ApiStatus {
  return {
    refreshing: false,
    error: null,
    fetchedAt: null,
    refreshPhase: "idle",
    refreshMessage: null,
    lastRefreshStartedAt: null,
    lastRefreshFinishedAt: null,
    ...overrides,
  };
}

const now = new Date("2026-05-06T15:00:00.000Z");

describe("refresh status labels", () => {
  test("labels fresh data from today", () => {
    expect(refreshHeaderText(status({ fetchedAt: "2026-05-06T14:00:00.000Z" }), now)).toBe("Refreshed today");
    expect(refreshBannerText(status({ fetchedAt: "2026-05-06T14:00:00.000Z" }), now)).toBeNull();
  });

  test("labels data older than 24 hours as stale", () => {
    const s = status({ fetchedAt: "2026-05-03T14:00:00.000Z" });

    expect(refreshHeaderText(s, now)).toBe("Stale since May 3");
    expect(refreshBannerText(s, now)).toBe("Data is stale since May 3.");
  });

  test("labels Robinhood approval needed", () => {
    const s = status({
      refreshing: true,
      refreshPhase: "approval_needed",
      refreshMessage: "Open Robinhood and tap Approve to refresh Watcher.",
    });

    expect(refreshHeaderText(s, now)).toBe("Approval needed");
    expect(refreshBannerText(s, now)).toBe("Open Robinhood and tap Approve to refresh Watcher.");
  });

  test("labels failed refresh", () => {
    const s = status({
      error: "Token refresh failed",
      refreshPhase: "failed",
      refreshMessage: "Token refresh failed",
    });

    expect(refreshHeaderText(s, now)).toBe("Refresh failed");
    expect(refreshBannerText(s, now)).toBe("Token refresh failed");
  });

  test("labels in-progress refresh", () => {
    const s = status({ refreshing: true, refreshPhase: "fetching" });

    expect(refreshHeaderText(s, now)).toBe("Refreshing...");
    expect(refreshBannerText(s, now)).toBeNull();
  });
});
