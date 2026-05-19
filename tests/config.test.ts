import { describe, expect, test } from "bun:test";
import { ConfigError, loadDividendTargetDaily, loadOptionalRobinhoodCredentials, loadServerConfig, numberEnv } from "../src/config.js";

describe("config parsing", () => {
  test("parses server config with defaults and booleans", () => {
    const config = loadServerConfig({ ALLOW_UNAUTH_REMOTE: "true", PORT: "4243" });

    expect(config.port).toBe(4243);
    expect(config.host).toBe("127.0.0.1");
    expect(config.refreshTimeoutMs).toBe(90_000);
    expect(config.access.allowUnauthRemote).toBe(true);
  });

  test("rejects invalid numeric config", () => {
    expect(() => numberEnv("PORT", 4242, { PORT: "nope" }, { integer: true })).toThrow(ConfigError);
  });

  test("loads default dividend target daily goal", () => {
    expect(loadDividendTargetDaily({})).toBe(280);
  });

  test("loads custom dividend target daily goal", () => {
    expect(loadDividendTargetDaily({ DIVIDEND_TARGET_DAILY: "325.50" })).toBe(325.50);
  });

  test("rejects invalid dividend target daily goal", () => {
    expect(() => loadDividendTargetDaily({ DIVIDEND_TARGET_DAILY: "-1" })).toThrow(ConfigError);
    expect(() => loadDividendTargetDaily({ DIVIDEND_TARGET_DAILY: "nope" })).toThrow(ConfigError);
  });

  test("requires Robinhood username and password together", () => {
    expect(loadOptionalRobinhoodCredentials({})).toBeNull();
    expect(() => loadOptionalRobinhoodCredentials({ RH_USERNAME: "user" })).toThrow(ConfigError);
  });
});
