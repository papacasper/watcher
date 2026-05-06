import { describe, expect, test } from "bun:test";
import { ConfigError, loadOptionalRobinhoodCredentials, loadServerConfig, numberEnv } from "../src/config.js";

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

  test("requires Robinhood username and password together", () => {
    expect(loadOptionalRobinhoodCredentials({})).toBeNull();
    expect(() => loadOptionalRobinhoodCredentials({ RH_USERNAME: "user" })).toThrow(ConfigError);
  });
});
