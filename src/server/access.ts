import { timingSafeEqual } from "crypto";

export interface DashboardAccessConfig {
  user: string;
  password: string;
  allowUnauthRemote: boolean;
  stateChangeHeader: string;
}

export type HeaderBag = Record<string, string | undefined>;

const DENY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function assertSafeBind(host: string, config: DashboardAccessConfig): void {
  if (!config.password && !config.allowUnauthRemote && !isLoopbackHost(host)) {
    throw new Error(
      `Refusing to bind unauthenticated dashboard to ${host}. ` +
      "Set DASHBOARD_PASSWORD or ALLOW_UNAUTH_REMOTE=true."
    );
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function requireDashboardAuth(
  headers: HeaderBag,
  config: DashboardAccessConfig
): Response | null {
  if (!config.password) return null;

  const expected = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`;
  if (safeEqual(headers.authorization ?? "", expected)) return null;

  return new Response("Authentication required", {
    status: 401,
    headers: {
      ...DENY_HEADERS,
      "WWW-Authenticate": 'Basic realm="Watcher", charset="UTF-8"',
    },
  });
}

export function requireAccess(
  headers: HeaderBag,
  config: DashboardAccessConfig,
  stateChanging = false
): Response | null {
  const denied = requireDashboardAuth(headers, config);
  if (denied) return denied;

  if (stateChanging && !safeEqual(headers["x-watcher-action"] ?? "", config.stateChangeHeader)) {
    return new Response("Missing action header", { status: 403, headers: DENY_HEADERS });
  }

  return null;
}
