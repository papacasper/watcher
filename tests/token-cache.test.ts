import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getAuthCachePath, loadAuthCache, saveAuthCache } from "../src/robinhood/token-cache.js";

let tokenDir: string | null = null;

function useTempTokenDir(): string {
  tokenDir = mkdtempSync(join(tmpdir(), "watcher-token-cache-"));
  Bun.env.RH_TOKEN_DIR = tokenDir;
  return tokenDir;
}

afterEach(() => {
  delete Bun.env.RH_TOKEN_DIR;
  if (tokenDir) rmSync(tokenDir, { recursive: true, force: true });
  tokenDir = null;
});

describe("token cache permissions", () => {
  test("saveAuthCache writes token dir as 0700 and cache as 0600", () => {
    const dir = useTempTokenDir();

    saveAuthCache({ loggedIn: true, accessToken: "token" });

    expect((statSync(dir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(getAuthCachePath()).mode & 0o777).toString(8)).toBe("600");
  });

  test("loadAuthCache tightens existing permissive token dir and cache file", () => {
    const dir = useTempTokenDir();
    const cachePath = getAuthCachePath();

    writeFileSync(cachePath, JSON.stringify({ expiresAt: Date.now() + 60_000 }), { mode: 0o644 });
    chmodSync(dir, 0o755);

    const loaded = loadAuthCache<{ expiresAt: number }>();
    expect(loaded).toEqual({ expiresAt: expect.any(Number) });
    expect((statSync(dir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(cachePath).mode & 0o777).toString(8)).toBe("600");
  });
});
