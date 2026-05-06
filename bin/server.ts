#!/usr/bin/env bun
import { Elysia } from "elysia";
import { fetchDashboardData, type DashboardData } from "../src/dashboard/data.js";
import { loadDataCache, saveDataCache } from "../src/dashboard/cache.js";
import { assertSafeBind, requireAccess } from "../src/server/access.js";
import { loadServerConfig } from "../src/config.js";
import {
  createRefreshState,
  markRefreshApprovalNeeded,
  markRefreshFailed,
  markRefreshFetching,
  markRefreshFinished,
  shapeRefreshStatus,
} from "../src/server/refresh-state.js";

const SERVER_CONFIG = loadServerConfig();
const PORT = SERVER_CONFIG.port;
const HOST = SERVER_CONFIG.host;
const REFRESH_MS = SERVER_CONFIG.refreshMs;
const REFRESH_TIMEOUT_MS = SERVER_CONFIG.refreshTimeoutMs;
const ACCESS_CONFIG = SERVER_CONFIG.access;
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

assertSafeBind(HOST, ACCESS_CONFIG);

let cache: DashboardData | null = loadDataCache();
const refreshState = createRefreshState();
let lastError: string | null = null;
let lastSourceErrors: Record<string, string> = cache?.sourceErrors ?? {};
let lastSourceWarnings: Record<string, string> = cache?.sourceWarnings ?? {};

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
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    markRefreshFailed(refreshState, lastError);
    console.error("Refresh failed:", lastError);
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

refresh(); // non-blocking; stale cache (if any) is served immediately
setInterval(refresh, REFRESH_MS);

new Elysia()
  .get("/api/data", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG);
    if (denied) return denied;
    if (!cache) return jsonResponse({ error: lastError ?? "loading" }, 503);
    return jsonResponse(cache);
  })
  .get("/api/status", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG);
    if (denied) return denied;
    return jsonResponse(shapeRefreshStatus(refreshState, {
      error: lastError,
      sourceErrors: lastSourceErrors,
      sourceWarnings: lastSourceWarnings,
      sourceStatus: cache?.sourceStatus ?? {},
      fetchedAt: cache?.fetchedAt ?? null,
    }));
  })
  .post("/api/refresh", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG, true);
    if (denied) return denied;
    refresh();
    return jsonResponse({ queued: true, refreshing: refreshState.refreshPhase === "fetching" || refreshState.refreshPhase === "approval_needed" });
  })
  .post("/api/restart", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG, true);
    if (denied) return denied;
    setTimeout(() => process.exit(0), 100);
    return jsonResponse({ restarting: true });
  })
  .get("/styles.css", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG);
    if (denied) return denied;
    return new Response(Bun.file("frontend/styles.css"), {
      headers: secureHeaders({
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": "no-store",
      }),
    });
  })
  .get("/bundle.js", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG);
    if (denied) return denied;
    return new Response(Bun.file("dist/bundle.js"), {
      headers: secureHeaders({
        "Content-Type": "application/javascript",
        "Cache-Control": "no-store",
      }),
    });
  })
  .get("/", ({ headers }) => {
    const denied = requireAccess(headers, ACCESS_CONFIG);
    if (denied) return denied;
    return new Response(html(), {
      headers: secureHeaders({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      }),
    });
  })
  .listen({ port: PORT, hostname: HOST });

console.log(`Watcher dashboard → http://${HOST}:${PORT}  (refresh every ${REFRESH_MS / 3600_000}h, auth ${ACCESS_CONFIG.password ? "enabled" : "disabled"})`);

function html() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Watcher</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600&family=Fira+Code:wght@300;400;500&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css" crossorigin="anonymous" />
<link rel="stylesheet" href="/styles.css?v=${Date.now()}" />
</head>
<body>
<div id="root"></div>
<script src="/bundle.js?v=${Date.now()}"></script>
</body>
</html>`;
}
