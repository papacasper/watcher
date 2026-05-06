export type RefreshPhase = "idle" | "fetching" | "approval_needed" | "failed";

export interface RefreshState {
  refreshPhase: RefreshPhase;
  refreshMessage: string | null;
  lastRefreshStartedAt: string | null;
  lastRefreshFinishedAt: string | null;
}

export function createRefreshState(): RefreshState {
  return {
    refreshPhase: "idle",
    refreshMessage: null,
    lastRefreshStartedAt: null,
    lastRefreshFinishedAt: null,
  };
}

export function markRefreshFetching(state: RefreshState, now = new Date()): void {
  state.refreshPhase = "fetching";
  state.refreshMessage = null;
  state.lastRefreshStartedAt = now.toISOString();
}

export function markRefreshApprovalNeeded(state: RefreshState, message = "Waiting for Robinhood app approval"): void {
  state.refreshPhase = "approval_needed";
  state.refreshMessage = message;
}

export function markRefreshFinished(state: RefreshState, now = new Date()): void {
  state.refreshPhase = "idle";
  state.refreshMessage = null;
  state.lastRefreshFinishedAt = now.toISOString();
}

export function markRefreshFailed(state: RefreshState, message: string, now = new Date()): void {
  state.refreshPhase = "failed";
  state.refreshMessage = message;
  state.lastRefreshFinishedAt = now.toISOString();
}

export function shapeRefreshStatus(
  state: RefreshState,
  input: {
    error: string | null;
    fetchedAt: string | null;
    sourceErrors: Record<string, string>;
    sourceWarnings: Record<string, string>;
    sourceStatus: Record<string, unknown>;
  }
) {
  return {
    refreshing: state.refreshPhase === "fetching" || state.refreshPhase === "approval_needed",
    error: input.error,
    sourceErrors: input.sourceErrors,
    sourceWarnings: input.sourceWarnings,
    sourceStatus: input.sourceStatus,
    fetchedAt: input.fetchedAt,
    refreshPhase: state.refreshPhase,
    refreshMessage: state.refreshMessage,
    lastRefreshStartedAt: state.lastRefreshStartedAt,
    lastRefreshFinishedAt: state.lastRefreshFinishedAt,
  };
}
