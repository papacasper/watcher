import { describe, expect, test } from "bun:test";
import {
  assertSafeBind,
  requireAccess,
  requireDashboardAuth,
  type DashboardAccessConfig,
} from "../src/server/access.js";

const baseConfig: DashboardAccessConfig = {
  user: "watcher",
  password: "",
  allowUnauthRemote: false,
  stateChangeHeader: "1",
};

function authHeader(user = "watcher", password = "secret"): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

describe("server access guard", () => {
  test("rejects unauthenticated non-loopback bind by default", () => {
    expect(() => assertSafeBind("0.0.0.0", baseConfig)).toThrow("Refusing to bind");
    expect(() => assertSafeBind("127.0.0.1", baseConfig)).not.toThrow();
  });

  test("allows non-loopback bind when password is set", () => {
    expect(() => assertSafeBind("0.0.0.0", { ...baseConfig, password: "secret" })).not.toThrow();
  });

  test("requires Basic auth when password is configured", () => {
    const config = { ...baseConfig, password: "secret" };

    const denied = requireDashboardAuth({}, config);
    expect(denied?.status).toBe(401);
    expect(denied?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(requireDashboardAuth({ authorization: authHeader("watcher", "wrong") }, config)?.status).toBe(401);
    expect(requireDashboardAuth({ authorization: authHeader() }, config)).toBeNull();
  });

  test("state-changing access requires action header", () => {
    const config = { ...baseConfig, password: "secret" };
    const headers = { authorization: authHeader() };

    expect(requireAccess(headers, config, true)?.status).toBe(403);
    expect(requireAccess({ ...headers, "x-watcher-action": "1" }, config, true)).toBeNull();
  });
});
