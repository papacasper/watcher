#!/usr/bin/env bun
import { Elysia } from "elysia";
import { fetchDashboardData, type DashboardData } from "../src/dashboard/data.js";
import { loadDataCache, saveDataCache } from "../src/dashboard/cache.js";
import { auth } from "../src/robinhood/auth.js";
import { getTickerDividends, getTickerOverview, getTickerPriceHistory, searchTickers } from "../src/ticker/stockanalysis.js";
import { getResearch } from "../src/advisor/research.js";
import { assertSafeBind, requireAccess } from "../src/server/access.js";
import { loadServerConfig } from "../src/config.js";
import { addToWatchlist, loadWatchlist, removeFromWatchlist } from "../src/watchlist/store.js";
import { isConfigured, loadConfig, saveConfig } from "../src/config-store.js";
import {
  createRefreshState,
  markRefreshApprovalNeeded,
  markRefreshFailed,
  markRefreshFetching,
  markRefreshFinished,
  shapeRefreshStatus,
} from "../src/server/refresh-state.js";
import { clientIp, isRateLimited } from "../src/server/rate-limit.js";
import { tickerCacheGet, tickerCacheSet, advisorCacheStale, getAdvisorCache, isAdvisorRunning, runAdvisorBackground, resetAdvisorCache } from "../src/server/ticker-cache.js";
import { parseSetupBody, parseSettingsBody } from "../src/server/body-parsers.js";
import { buildHtml, bundleJs, stylesCss } from "../src/server/html.js";
import { fireWebhookIfNeeded, isPrivateOrLoopbackHost } from "../src/server/webhook.js";

const SERVER_CONFIG = loadServerConfig();
const PORT = SERVER_CONFIG.port;
const HOST = SERVER_CONFIG.host;
const REFRESH_MS = SERVER_CONFIG.refreshMs;
const REFRESH_TIMEOUT_MS = SERVER_CONFIG.refreshTimeoutMs;
let accessConfig = SERVER_CONFIG.access;
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com data:",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
};

assertSafeBind(HOST, accessConfig);

let cache: DashboardData | null = loadDataCache();
const refreshState = createRefreshState();
let lastError: string | null = null;
let lastSourceErrors: Record<string, string> = cache?.sourceErrors ?? {};
let lastSourceWarnings: Record<string, string> = cache?.sourceWarnings ?? {};
let setupRefreshInProgress = false;
let setupStatusPublicUntil = 0;
const webhookState = {
  lastGoalProgressPct: cache?.summary?.dividendGoalProgressPct ?? 0,
  lastDangerGuardrailKeys: new Set<string>((cache?.guardrails ?? []).filter(g => g.severity === "danger").map(g => g.title)),
};

function getAccessConfig() { return accessConfig; }
function reloadAccessConfig() { accessConfig = loadServerConfig().access; }

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

if (cache) {
  console.log(`[${new Date().toLocaleTimeString()}] Loaded cached data from ${cache.fetchedAt}, fetching fresh data…`);
}

async function refresh() {
  if (refreshState.refreshPhase === "fetching" || refreshState.refreshPhase === "approval_needed") return;
  markRefreshFetching(refreshState);
  lastError = null;
  console.log(`[${new Date().toLocaleTimeString()}] Fetching Robinhood data…`);
  try {
    cache = await withTimeout(fetchDashboardData({
      previous: cache,
      onAuthMilestone(event) {
        if (event.milestone === "approval_needed") markRefreshApprovalNeeded(refreshState, event.message);
      },
    }), REFRESH_TIMEOUT_MS, "Dashboard refresh");
    lastSourceErrors = cache.sourceErrors ?? {};
    lastSourceWarnings = cache.sourceWarnings ?? {};
    saveDataCache(cache);
    markRefreshFinished(refreshState);
    console.log(`[${new Date().toLocaleTimeString()}] Done. Next refresh in ${REFRESH_MS / 3600_000}h`);
    fireWebhookIfNeeded(cache, webhookState).catch(() => {});
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    markRefreshFailed(refreshState, lastError);
    console.error("Refresh failed:", lastError);
  } finally {
    const wasSetup = setupRefreshInProgress;
    setupRefreshInProgress = false;
    if (wasSetup && setupStatusPublicUntil > 0) setupStatusPublicUntil = Date.now() + 30_000;
  }
}

function secureHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ ...SECURITY_HEADERS, ...extra });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: secureHeaders({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    }),
  });
}

if (isConfigured()) {
  refresh().catch(e => { lastError = e instanceof Error ? e.message : String(e); });
} else {
  lastError = "setup required";
}
setInterval(() => { refresh().catch(e => { lastError = e instanceof Error ? e.message : String(e); }); }, REFRESH_MS);

new Elysia()
  .get("/api/setup", ({ headers }) => {
    const config = loadConfig();
    const configured = !!(config.robinhood?.username && config.robinhood.password);
    const publicShape = {
      configured,
      needsApproval: refreshState.refreshPhase === "approval_needed",
      approvalMessage: refreshState.refreshMessage,
      hasDashboardPassword: !!config.access.password,
    };
    // Full shape only for authenticated callers — avoids leaking financial targets and server config
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return jsonResponse(publicShape);
    return jsonResponse({
      ...publicShape,
      dividendTargetDaily: config.dividendTargetDaily,
      dailyCost: config.dailyCost,
      dashboardUser: config.access.user,
      server: config.server,
    });
  })
  .post("/api/setup", async ({ body, request, server }) => {
    const setupIp = clientIp(request, server);
    if (!setupIp) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`setup:${setupIp}`, 5)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    if (isConfigured() && !isLoopbackRequest(request, server)) {
      return jsonResponse({ error: "setup is already complete" }, 403);
    }
    const parsed = parseSetupBody(body);
    if ("error" in parsed) return jsonResponse({ error: parsed.error }, 400);

    saveConfig(parsed.patch);
    reloadAccessConfig();
    auth.logout();
    setupRefreshInProgress = true;
    setupStatusPublicUntil = Date.now() + 5 * 60_000;
    refresh().catch(e => { lastError = e instanceof Error ? e.message : String(e); });
    return jsonResponse({ ok: true, queued: true });
  })
  .post("/api/settings", async ({ headers, body }) => {
    const denied = requireAccess(headers, getAccessConfig(), true);
    if (denied) return denied;
    const parsed = parseSettingsBody(body);
    if ("error" in parsed) return jsonResponse({ error: parsed.error }, 400);
    const before = loadConfig();
    saveConfig(parsed.patch);
    reloadAccessConfig();
    const after = loadConfig();
    if (
      parsed.patch.robinhood &&
      (before.robinhood?.username !== after.robinhood?.username ||
        before.robinhood?.password !== after.robinhood?.password ||
        before.robinhood?.mfaCode !== after.robinhood?.mfaCode)
    ) {
      auth.logout();
    }
    return jsonResponse({ ok: true, requiresRestart: !!parsed.patch.server });
  })
  .get("/api/data", ({ headers }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    if (!cache) return jsonResponse({ error: lastError ?? "loading" }, 503);
    return jsonResponse(cache);
  })
  .get("/api/status", ({ headers }) => {
    const inSetupWindow = setupRefreshInProgress || Date.now() < setupStatusPublicUntil;
    const denied = inSetupWindow ? null : requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    if (inSetupWindow && requireAccess(headers, getAccessConfig())) {
      // Unauthenticated caller during setup window: return minimal shape only
      const status = shapeRefreshStatus(refreshState, { error: lastError, sourceErrors: {}, sourceWarnings: {}, sourceStatus: {}, fetchedAt: null });
      return jsonResponse({ refreshPhase: status.refreshPhase, refreshMessage: status.refreshMessage, configured: isConfigured() });
    }
    return jsonResponse(shapeRefreshStatus(refreshState, {
      error: lastError,
      sourceErrors: lastSourceErrors,
      sourceWarnings: lastSourceWarnings,
      sourceStatus: cache?.sourceStatus ?? {},
      fetchedAt: cache?.fetchedAt ?? null,
    }));
  })
  .get("/api/search", async ({ headers, query, request, server }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    const ip = clientIp(request, server);
    if (!ip) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`search:${ip}`, 20)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    const q = String(query?.q ?? "").trim();
    if (!q || q.length < 1) return jsonResponse({ results: [] });
    const results = await searchTickers(q);
    return jsonResponse({ results });
  })
  .get("/api/ticker/:symbol/history", async ({ headers, params, request, server }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    const ip = clientIp(request, server);
    if (!ip) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`ticker:${ip}`, 30)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    const symbol = sanitizeSymbol(params.symbol);
    if (!symbol) return jsonResponse({ error: "invalid symbol" }, 400);
    const cacheKey = `history:${symbol}`;
    const cached = tickerCacheGet(cacheKey);
    if (cached) return jsonResponse(cached);
    const data = await getTickerPriceHistory(symbol);
    if (!data) return jsonResponse({ error: `no history found for ${symbol}` }, 404);
    tickerCacheSet(cacheKey, data);
    return jsonResponse(data);
  })
  .get("/api/ticker/:symbol/dividends", async ({ headers, params, request, server }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    const ip = clientIp(request, server);
    if (!ip) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`ticker:${ip}`, 30)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    const symbol = sanitizeSymbol(params.symbol);
    if (!symbol) return jsonResponse({ error: "invalid symbol" }, 400);
    const cacheKey = `dividends:${symbol}`;
    const cached = tickerCacheGet(cacheKey);
    if (cached) return jsonResponse(cached);
    const data = await getTickerDividends(symbol);
    if (!data) return jsonResponse({ error: `no dividend data found for ${symbol}` }, 404);
    tickerCacheSet(cacheKey, data);
    return jsonResponse(data);
  })
  .get("/api/ticker/:symbol", async ({ headers, params, request, server }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    const ip = clientIp(request, server);
    if (!ip) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`ticker:${ip}`, 30)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    const symbol = sanitizeSymbol(params.symbol);
    if (!symbol) return jsonResponse({ error: "invalid symbol" }, 400);
    const cacheKey = `overview:${symbol}`;
    const cached = tickerCacheGet(cacheKey);
    if (cached) return jsonResponse(cached);
    const data = await getTickerOverview(symbol);
    if (!data) return jsonResponse({ error: `no data found for ${symbol}` }, 404);
    tickerCacheSet(cacheKey, data);
    return jsonResponse(data);
  })
  .get("/api/ticker/:symbol/research", async ({ headers, params, request, server }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    const ip = clientIp(request, server);
    if (!ip) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`ticker:${ip}`, 30)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    const symbol = sanitizeSymbol(params.symbol);
    if (!symbol) return jsonResponse({ error: "invalid symbol" }, 400);
    const cacheKey = `research:${symbol}`;
    const cached = tickerCacheGet(cacheKey);
    if (cached) return jsonResponse(cached);
    // Get live price first so upside % in research is accurate
    const overview = await getTickerOverview(symbol);
    const price = overview?.price ?? 0;
    const research = await getResearch(symbol, price);
    const data = { price, ...research };
    tickerCacheSet(cacheKey, data);
    return jsonResponse(data);
  })
  .get("/api/advisor", ({ headers, query }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    const advisorCache = getAdvisorCache();
    if (advisorCacheStale() || !advisorCache) {
      runAdvisorBackground();
      if (!advisorCache) return jsonResponse({ status: "running", message: "Advisor is building recommendations, check back in ~2 minutes." }, 202);
    }
    const top = Math.min(parseInt(String(query?.top ?? "20"), 10) || 20, 100);
    return jsonResponse({
      generatedAt: advisorCache!.generatedAt,
      candidates: advisorCache!.candidates,
      stale: advisorCacheStale(),
      running: isAdvisorRunning(),
      results: advisorCache!.results.slice(0, top),
    });
  })
  .post("/api/advisor/refresh", ({ headers }) => {
    const denied = requireAccess(headers, getAccessConfig(), true);
    if (denied) return denied;
    resetAdvisorCache();
    runAdvisorBackground();
    return jsonResponse({ queued: true, running: isAdvisorRunning() });
  })
  .get("/api/watchlist", ({ headers }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    return jsonResponse({ tickers: loadWatchlist() });
  })
  .post("/api/watchlist", async ({ headers, body }) => {
    const denied = requireAccess(headers, getAccessConfig(), true);
    if (denied) return denied;
    const { ticker } = body as { ticker?: unknown };
    if (typeof ticker !== "string" || !ticker.trim()) return jsonResponse({ error: "ticker required" }, 400);
    const clean = ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.\-]{1,10}$/.test(clean)) return jsonResponse({ error: "invalid ticker" }, 400);
    const tickers = addToWatchlist(clean);
    return jsonResponse({ tickers });
  })
  .delete("/api/watchlist/:ticker", ({ headers, params }) => {
    const denied = requireAccess(headers, getAccessConfig(), true);
    if (denied) return denied;
    const ticker = (params as { ticker: string }).ticker.toUpperCase();
    if (!/^[A-Z0-9.\-]{1,10}$/.test(ticker)) return jsonResponse({ error: "invalid ticker" }, 400);
    const tickers = removeFromWatchlist(ticker);
    return jsonResponse({ tickers });
  })
  .post("/api/refresh", ({ headers, request, server }) => {
    const denied = requireAccess(headers, getAccessConfig(), true);
    if (denied) return denied;
    const ip = clientIp(request, server);
    if (!ip) return jsonResponse({ error: "client ip unavailable" }, 503);
    if (isRateLimited(`refresh:${ip}`, 5)) return jsonResponse({ error: "rate limit exceeded" }, 429);
    refresh().catch(e => { lastError = e instanceof Error ? e.message : String(e); });
    return jsonResponse({ queued: true, refreshing: refreshState.refreshPhase === "fetching" || refreshState.refreshPhase === "approval_needed" });
  })
  .post("/api/restart", ({ headers }) => {
    const denied = requireAccess(headers, getAccessConfig(), true);
    if (denied) return denied;
    setTimeout(() => process.exit(0), 100);
    return jsonResponse({ restarting: true });
  })
  .get("/api/export/holdings.csv", ({ headers }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    if (!cache) return jsonResponse({ error: "no data" }, 503);
    const rows = [
      ["Symbol", "Name", "Shares", "Avg Cost", "Cost Basis", "Price", "Value", "P&L", "P&L %", "Forward Annual Income", "Yield on Cost", "Yield on Value", "Held Since"].join(","),
      ...cache.holdings.map(h => [
        h.symbol, `"${h.name.replace(/"/g, '""')}"`, h.shares, h.avgCost.toFixed(4), h.costBasis.toFixed(2),
        h.price.toFixed(4), h.value.toFixed(2), h.pnl.toFixed(2), h.pnlPct.toFixed(4),
        (h.forwardAnnualIncome ?? 0).toFixed(2), (h.forwardYieldOnCost ?? 0).toFixed(4),
        (h.forwardYieldOnValue ?? 0).toFixed(4), h.heldSince ?? "",
      ].join(",")),
    ].join("\r\n");
    return new Response(rows, { headers: secureHeaders({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"holdings.csv\"", "Cache-Control": "no-store" }) });
  })
  .get("/api/export/dividends.csv", ({ headers }) => {
    const denied = requireAccess(headers, getAccessConfig());
    if (denied) return denied;
    if (!cache) return jsonResponse({ error: "no data" }, 503);
    const rows = [
      ["Symbol", "Payable Date", "Amount", "Shares", "Rate", "State"].join(","),
      ...cache.dividends.map(d => [
        d.symbol, d.payableDate, d.amount.toFixed(2), d.shares, d.rate.toFixed(4), d.state,
      ].join(",")),
    ].join("\r\n");
    return new Response(rows, { headers: secureHeaders({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"dividends.csv\"", "Cache-Control": "no-store" }) });
  })
  .get("/styles.css", ({ headers }) => {
    const denied = isConfigured() ? requireAccess(headers, getAccessConfig()) : null;
    if (denied) return denied;
    return new Response(stylesCss, {
      headers: secureHeaders({
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store",
      }),
    });
  })
  .get("/bundle.js", ({ headers }) => {
    const denied = isConfigured() ? requireAccess(headers, getAccessConfig()) : null;
    if (denied) return denied;
    return new Response(bundleJs, {
      headers: secureHeaders({
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      }),
    });
  })
  .get("/", ({ headers }) => {
    const denied = isConfigured() ? requireAccess(headers, getAccessConfig()) : null;
    if (denied) return denied;
    return new Response(buildHtml(getAccessConfig().stateChangeHeader), {
      headers: secureHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      }),
    });
  })
  .listen({ port: PORT, hostname: HOST });

console.log(`Watcher dashboard → http://${HOST}:${PORT}  (refresh every ${REFRESH_MS / 3600_000}h, auth ${getAccessConfig().password ? "enabled" : "disabled"})`);

function isLoopbackRequest(request: Request, server: { requestIP(req: Request): { address: string } | null } | null | undefined): boolean {
  const addr = server?.requestIP(request)?.address;
  if (!addr) return false;
  return isPrivateOrLoopbackHost(addr);
}

function sanitizeSymbol(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9.]/g, "");
  return s.length > 0 && s.length <= 10 ? s : null;
}

