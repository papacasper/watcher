import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "fs";
import { tmpdir } from "os";
import { getConfigPath, isConfigured, loadConfig, saveConfig } from "../src/config-store.js";

const originalCacheDir = Bun.env.WATCHER_CACHE_DIR;
let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalCacheDir === undefined) delete Bun.env.WATCHER_CACHE_DIR;
  else Bun.env.WATCHER_CACHE_DIR = originalCacheDir;
});

function useTempConfigDir() {
  tempDir = mkdtempSync(`${tmpdir()}/watcher-config-`);
  Bun.env.WATCHER_CACHE_DIR = tempDir;
}

describe("config store", () => {
  test("loads defaults when config is missing", () => {
    useTempConfigDir();
    const config = loadConfig();
    expect(config.server.port).toBe(4242);
    expect(config.access.user).toBe("watcher");
    expect(isConfigured()).toBe(false);
  });

  test("saves merged config with restrictive permissions", () => {
    useTempConfigDir();
    const config = saveConfig({
      robinhood: { username: "user", password: "pass" },
      dividendTargetDaily: 321,
      access: { password: "dashboard" },
    });

    expect(config.robinhood?.username).toBe("user");
    expect(loadConfig().dividendTargetDaily).toBe(321);
    expect(isConfigured()).toBe(true);
    expect((statSync(getConfigPath()).mode & 0o777).toString(8)).toBe("600");
  });
});
