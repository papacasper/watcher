import { describe, expect, test } from "bun:test";
import { parseSetupBody, parseSettingsBody, stringField, numberField } from "../src/server/body-parsers.js";

describe("stringField", () => {
  test("returns trimmed string for non-empty input", () => {
    expect(stringField("  hello  ")).toBe("hello");
  });
  test("returns undefined for empty string", () => {
    expect(stringField("")).toBeUndefined();
  });
  test("returns undefined for whitespace-only string", () => {
    expect(stringField("   ")).toBeUndefined();
  });
  test("returns undefined for non-string types", () => {
    expect(stringField(42)).toBeUndefined();
    expect(stringField(null)).toBeUndefined();
    expect(stringField(undefined)).toBeUndefined();
  });
});

describe("numberField", () => {
  test("parses valid number", () => {
    expect(numberField(5, "x")).toBe(5);
  });
  test("parses numeric string", () => {
    expect(numberField("3.14", "x")).toBe(3.14);
  });
  test("returns undefined for empty / null / undefined", () => {
    expect(numberField("", "x")).toBeUndefined();
    expect(numberField(null, "x")).toBeUndefined();
    expect(numberField(undefined, "x")).toBeUndefined();
  });
  test("returns error string when below min", () => {
    expect(typeof numberField(-1, "x", 0)).toBe("string");
  });
  test("returns error string for NaN input", () => {
    expect(typeof numberField("abc", "x")).toBe("string");
  });
  test("respects custom min", () => {
    expect(numberField(1000, "port", 1)).toBe(1000);
    expect(typeof numberField(0, "port", 1)).toBe("string");
  });
});

describe("parseSetupBody", () => {
  test("accepts valid body", () => {
    const result = parseSetupBody({ username: "u", password: "p" });
    expect("patch" in result).toBe(true);
    if ("patch" in result) {
      expect(result.patch.robinhood?.username).toBe("u");
      expect(result.patch.robinhood?.password).toBe("p");
    }
  });
  test("rejects missing username", () => {
    const result = parseSetupBody({ password: "p" });
    expect("error" in result).toBe(true);
  });
  test("rejects missing password", () => {
    const result = parseSetupBody({ username: "u" });
    expect("error" in result).toBe(true);
  });
  test("rejects invalid dividendTargetDaily", () => {
    const result = parseSetupBody({ username: "u", password: "p", dividendTargetDaily: "bad" });
    expect("error" in result).toBe(true);
  });
  test("rejects negative dailyCost", () => {
    const result = parseSetupBody({ username: "u", password: "p", dailyCost: -1 });
    expect("error" in result).toBe(true);
  });
  test("sets dashboard password from dashboardPassword field", () => {
    const result = parseSetupBody({ username: "u", password: "p", dashboardPassword: "secret" });
    expect("patch" in result && result.patch.access?.password).toBe("secret");
  });
  test("non-string body returns error", () => {
    const result = parseSetupBody(null);
    expect("error" in result).toBe(true);
  });
});

describe("parseSettingsBody", () => {
  test("empty body returns empty patch", () => {
    const result = parseSettingsBody({});
    expect("patch" in result).toBe(true);
    if ("patch" in result) expect(Object.keys(result.patch).length).toBe(0);
  });
  test("partial robinhood update", () => {
    const result = parseSettingsBody({ username: "newuser" });
    expect("patch" in result && result.patch.robinhood?.username).toBe("newuser");
  });
  test("rejects invalid host", () => {
    const result = parseSettingsBody({ host: "evil.com" });
    expect("error" in result).toBe(true);
  });
  test("accepts valid hosts", () => {
    for (const host of ["127.0.0.1", "::1", "localhost", "0.0.0.0"]) {
      const result = parseSettingsBody({ host });
      expect("patch" in result).toBe(true);
    }
  });
  test("rejects port below 1", () => {
    const result = parseSettingsBody({ port: 0 });
    expect("error" in result).toBe(true);
  });
  test("rejects refreshMs below 1000", () => {
    const result = parseSettingsBody({ refreshMs: 500 });
    expect("error" in result).toBe(true);
  });
  test("rejects refreshTimeoutMs below 5000", () => {
    const result = parseSettingsBody({ refreshTimeoutMs: 100 });
    expect("error" in result).toBe(true);
  });
  test("accepts valid server settings", () => {
    const result = parseSettingsBody({ host: "127.0.0.1", port: 8080, refreshMs: 3_600_000, refreshTimeoutMs: 30_000 });
    if (!("patch" in result)) throw new Error("expected patch");
    expect(result.patch.server?.host).toBe("127.0.0.1");
    expect(result.patch.server?.port).toBe(8080);
  });
  test("sets dashboard password", () => {
    const result = parseSettingsBody({ dashboardPassword: "newpass" });
    expect("patch" in result && result.patch.access?.password).toBe("newpass");
  });
  test("mfaCode empty string is included", () => {
    const result = parseSettingsBody({ mfaCode: "" });
    expect("patch" in result && result.patch.robinhood?.mfaCode).toBe("");
  });
});
