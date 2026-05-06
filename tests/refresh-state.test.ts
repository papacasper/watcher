import { describe, expect, test } from "bun:test";
import {
  createRefreshState,
  markRefreshApprovalNeeded,
  markRefreshFailed,
  markRefreshFetching,
  markRefreshFinished,
  shapeRefreshStatus,
} from "../src/server/refresh-state.js";

describe("refresh state", () => {
  test("shapes idle status with timestamps and source state", () => {
    const state = createRefreshState();
    markRefreshFetching(state, new Date("2026-05-06T12:00:00.000Z"));
    markRefreshFinished(state, new Date("2026-05-06T12:01:00.000Z"));

    expect(shapeRefreshStatus(state, {
      error: null,
      fetchedAt: "2026-05-06T12:01:00.000Z",
      sourceErrors: {},
      sourceWarnings: {},
      sourceStatus: {},
    })).toEqual({
      refreshing: false,
      error: null,
      sourceErrors: {},
      sourceWarnings: {},
      sourceStatus: {},
      fetchedAt: "2026-05-06T12:01:00.000Z",
      refreshPhase: "idle",
      refreshMessage: null,
      lastRefreshStartedAt: "2026-05-06T12:00:00.000Z",
      lastRefreshFinishedAt: "2026-05-06T12:01:00.000Z",
    });
  });

  test("keeps refreshing true while Robinhood approval is pending", () => {
    const state = createRefreshState();
    markRefreshFetching(state, new Date("2026-05-06T12:00:00.000Z"));
    markRefreshApprovalNeeded(state, "Open Robinhood and tap Approve to refresh Watcher.");

    const status = shapeRefreshStatus(state, {
      error: null,
      fetchedAt: null,
      sourceErrors: {},
      sourceWarnings: {},
      sourceStatus: {},
    });

    expect(status.refreshing).toBe(true);
    expect(status.refreshPhase).toBe("approval_needed");
    expect(status.refreshMessage).toBe("Open Robinhood and tap Approve to refresh Watcher.");
  });

  test("records failed refresh message and finish time", () => {
    const state = createRefreshState();
    markRefreshFetching(state, new Date("2026-05-06T12:00:00.000Z"));
    markRefreshFailed(state, "Timed out waiting for in-app approval", new Date("2026-05-06T12:02:00.000Z"));

    const status = shapeRefreshStatus(state, {
      error: "Timed out waiting for in-app approval",
      fetchedAt: "2026-05-05T12:00:00.000Z",
      sourceErrors: {},
      sourceWarnings: {},
      sourceStatus: {},
    });

    expect(status.refreshing).toBe(false);
    expect(status.refreshPhase).toBe("failed");
    expect(status.refreshMessage).toBe("Timed out waiting for in-app approval");
    expect(status.lastRefreshFinishedAt).toBe("2026-05-06T12:02:00.000Z");
  });
});
