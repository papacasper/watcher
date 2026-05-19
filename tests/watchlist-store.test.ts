import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { addToWatchlist, loadWatchlist, removeFromWatchlist } from "../src/watchlist/store.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "watcher-watchlist-"));
  Bun.env.WATCHER_CACHE_DIR = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete Bun.env.WATCHER_CACHE_DIR;
});

describe("watchlist store", () => {
  test("loadWatchlist returns empty array when file does not exist", () => {
    expect(loadWatchlist()).toEqual([]);
  });

  test("addToWatchlist persists and returns the new list", () => {
    const result = addToWatchlist("SCHD");
    expect(result).toContain("SCHD");
    expect(loadWatchlist()).toContain("SCHD");
  });

  test("addToWatchlist normalises to uppercase", () => {
    addToWatchlist("schd");
    expect(loadWatchlist()).toContain("SCHD");
  });

  test("addToWatchlist trims whitespace", () => {
    addToWatchlist("  O  ");
    expect(loadWatchlist()).toContain("O");
  });

  test("addToWatchlist deduplicates", () => {
    addToWatchlist("SCHD");
    addToWatchlist("SCHD");
    const list = loadWatchlist();
    expect(list.filter(t => t === "SCHD").length).toBe(1);
  });

  test("addToWatchlist preserves existing tickers", () => {
    addToWatchlist("SCHD");
    addToWatchlist("O");
    const list = loadWatchlist();
    expect(list).toContain("SCHD");
    expect(list).toContain("O");
  });

  test("removeFromWatchlist removes the ticker and persists", () => {
    addToWatchlist("SCHD");
    addToWatchlist("O");
    removeFromWatchlist("SCHD");
    const list = loadWatchlist();
    expect(list).not.toContain("SCHD");
    expect(list).toContain("O");
  });

  test("removeFromWatchlist is a no-op for unknown ticker", () => {
    addToWatchlist("SCHD");
    const before = loadWatchlist();
    removeFromWatchlist("AAPL");
    expect(loadWatchlist()).toEqual(before);
  });

  test("removeFromWatchlist normalises to uppercase", () => {
    addToWatchlist("SCHD");
    removeFromWatchlist("schd");
    expect(loadWatchlist()).not.toContain("SCHD");
  });

  test("writes are atomic — file is never left as .tmp on success", () => {
    addToWatchlist("SCHD");
    const tmpPath = join(tmpDir, "watchlist.json.tmp");
    expect(existsSync(tmpPath)).toBe(false);
  });

  test("written file has 0o600 permissions", () => {
    const { statSync } = require("fs") as typeof import("fs");
    addToWatchlist("SCHD");
    const path = join(tmpDir, "watchlist.json");
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("loadWatchlist survives a corrupt JSON file", () => {
    writeFileSync(join(tmpDir, "watchlist.json"), "{ not valid json", { mode: 0o600 });
    expect(loadWatchlist()).toEqual([]);
  });

  test("loadWatchlist ignores non-string entries in JSON", () => {
    writeFileSync(join(tmpDir, "watchlist.json"), JSON.stringify(["SCHD", 42, null, "O"]), { mode: 0o600 });
    expect(loadWatchlist()).toEqual(["SCHD", "O"]);
  });

  test("multiple add/remove cycles stay consistent", () => {
    addToWatchlist("SCHD");
    addToWatchlist("O");
    addToWatchlist("AGNC");
    removeFromWatchlist("O");
    addToWatchlist("VYM");
    removeFromWatchlist("SCHD");
    const list = loadWatchlist();
    expect(list).toEqual(["AGNC", "VYM"]);
  });
});
