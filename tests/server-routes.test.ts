import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { requireAccess, type DashboardAccessConfig } from "../src/server/access.js";
import { addToWatchlist, loadWatchlist, removeFromWatchlist } from "../src/watchlist/store.js";

// ── Shared fixtures ───────────────────────────────────────────────────────────

const ACTION_TOKEN = "testtoken1234567";

const openConfig: DashboardAccessConfig = {
  user: "watcher",
  password: "",
  allowUnauthRemote: false,
  stateChangeHeader: ACTION_TOKEN,
};

const authConfig: DashboardAccessConfig = {
  user: "watcher",
  password: "secret",
  allowUnauthRemote: false,
  stateChangeHeader: ACTION_TOKEN,
};

function basicAuth(user = "watcher", pass = "secret"): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function actionHeaders(token = ACTION_TOKEN) {
  return { authorization: basicAuth(), "x-watcher-action": token };
}

// ── Watchlist store helpers (simulate route logic) ────────────────────────────

function simulatePost(
  config: DashboardAccessConfig,
  headers: Record<string, string>,
  body: unknown
): { status: number; body: unknown } {
  const denied = requireAccess(headers, config, true);
  if (denied) return { status: denied.status, body: null };

  const ticker = body && typeof body === "object" ? (body as Record<string, unknown>).ticker : undefined;
  if (typeof ticker !== "string" || !ticker.trim()) return { status: 400, body: { error: "ticker required" } };

  const clean = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(clean)) return { status: 400, body: { error: "invalid ticker" } };

  const tickers = addToWatchlist(clean);
  return { status: 200, body: { tickers } };
}

function simulateDelete(
  config: DashboardAccessConfig,
  headers: Record<string, string>,
  ticker: string
): { status: number; body: unknown } {
  const denied = requireAccess(headers, config, true);
  if (denied) return { status: denied.status, body: null };

  const clean = ticker.toUpperCase();
  if (!/^[A-Z0-9.\-]{1,10}$/.test(clean)) return { status: 400, body: { error: "invalid ticker" } };

  const tickers = removeFromWatchlist(clean);
  return { status: 200, body: { tickers } };
}

function simulateGet(
  config: DashboardAccessConfig,
  headers: Record<string, string>
): { status: number; body: unknown } {
  const denied = requireAccess(headers, config);
  if (denied) return { status: denied.status, body: null };
  return { status: 200, body: { tickers: loadWatchlist() } };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "watcher-server-routes-"));
  Bun.env.WATCHER_CACHE_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete Bun.env.WATCHER_CACHE_DIR;
});

// ── GET /api/watchlist ────────────────────────────────────────────────────────

describe("GET /api/watchlist", () => {
  test("returns empty list when watchlist is empty", () => {
    const res = simulateGet(openConfig, {});
    expect(res.status).toBe(200);
    expect((res.body as { tickers: string[] }).tickers).toEqual([]);
  });

  test("returns 401 when password required but missing auth", () => {
    const res = simulateGet(authConfig, {});
    expect(res.status).toBe(401);
  });

  test("returns list after tickers have been added", () => {
    addToWatchlist("SCHD");
    addToWatchlist("O");
    const res = simulateGet(openConfig, {});
    expect(res.status).toBe(200);
    const { tickers } = res.body as { tickers: string[] };
    expect(tickers).toContain("SCHD");
    expect(tickers).toContain("O");
  });
});

// ── POST /api/watchlist ───────────────────────────────────────────────────────

describe("POST /api/watchlist", () => {
  test("rejects request missing CSRF action header", () => {
    const res = simulatePost(openConfig, {}, { ticker: "SCHD" });
    expect(res.status).toBe(403);
  });

  test("rejects request with wrong CSRF token", () => {
    const res = simulatePost(openConfig, { "x-watcher-action": "wrongtoken" }, { ticker: "SCHD" });
    expect(res.status).toBe(403);
  });

  test("adds a ticker with valid action header (no auth)", () => {
    const res = simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "SCHD" });
    expect(res.status).toBe(200);
    expect((res.body as { tickers: string[] }).tickers).toContain("SCHD");
  });

  test("adds a ticker with auth + action header", () => {
    const res = simulatePost(authConfig, actionHeaders(), { ticker: "O" });
    expect(res.status).toBe(200);
  });

  test("rejects missing ticker field", () => {
    const res = simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, {});
    expect(res.status).toBe(400);
  });

  test("rejects empty ticker string", () => {
    const res = simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "  " });
    expect(res.status).toBe(400);
  });

  test("rejects ticker with invalid characters", () => {
    const res = simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "../etc" });
    expect(res.status).toBe(400);
  });

  test("rejects ticker longer than 10 characters", () => {
    const res = simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "TOOLONGNAME" });
    expect(res.status).toBe(400);
  });

  test("normalises ticker to uppercase", () => {
    simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "schd" });
    expect(loadWatchlist()).toContain("SCHD");
  });

  test("deduplicates repeated adds", () => {
    simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "SCHD" });
    simulatePost(openConfig, { "x-watcher-action": ACTION_TOKEN }, { ticker: "SCHD" });
    expect(loadWatchlist().filter(t => t === "SCHD").length).toBe(1);
  });
});

// ── DELETE /api/watchlist/:ticker ─────────────────────────────────────────────

describe("DELETE /api/watchlist/:ticker", () => {
  test("rejects request missing CSRF action header", () => {
    const res = simulateDelete(openConfig, {}, "SCHD");
    expect(res.status).toBe(403);
  });

  test("removes a ticker with valid action header", () => {
    addToWatchlist("SCHD");
    addToWatchlist("O");
    const res = simulateDelete(openConfig, { "x-watcher-action": ACTION_TOKEN }, "SCHD");
    expect(res.status).toBe(200);
    expect((res.body as { tickers: string[] }).tickers).not.toContain("SCHD");
    expect((res.body as { tickers: string[] }).tickers).toContain("O");
  });

  test("rejects ticker with path-traversal characters", () => {
    const res = simulateDelete(openConfig, { "x-watcher-action": ACTION_TOKEN }, "../etc");
    expect(res.status).toBe(400);
  });

  test("rejects ticker longer than 10 characters", () => {
    const res = simulateDelete(openConfig, { "x-watcher-action": ACTION_TOKEN }, "TOOLONGNAME");
    expect(res.status).toBe(400);
  });

  test("is a no-op for a ticker not on the list", () => {
    addToWatchlist("SCHD");
    simulateDelete(openConfig, { "x-watcher-action": ACTION_TOKEN }, "AAPL");
    expect(loadWatchlist()).toContain("SCHD");
  });
});
