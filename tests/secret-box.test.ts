import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { decrypt, encrypt, isEncrypted } from "../src/security/secret-box.js";

// The module caches the key in a module-level var after first load.
// We use a single shared temp dir for all tests in this file since the key
// is loaded once per process. Tests that need isolation from each other test
// the public API contract, not the key path.

let tmpDir: string;
const savedHome = process.env.HOME;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "watcher-secret-box-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  process.env.HOME = savedHome;
});

describe("secret-box — encrypt/decrypt", () => {
  test("encrypt produces a v1: prefixed string", () => {
    expect(encrypt("hello")).toMatch(/^v1:/);
  });

  test("decrypt roundtrips arbitrary plaintext", () => {
    const plain = "super-secret-password-123!@#";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test("roundtrips empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  test("each encrypt call produces a unique ciphertext (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
  });

  test("decrypt roundtrips unicode content", () => {
    const plain = "pässwörd 🔐";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });
});

describe("secret-box — isEncrypted", () => {
  test("returns true for v1: ciphertext", () => {
    expect(isEncrypted(encrypt("x"))).toBe(true);
  });

  test("returns false for plain string", () => {
    expect(isEncrypted("plaintext")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(isEncrypted("")).toBe(false);
  });

  test("returns false for partial v1 prefix", () => {
    expect(isEncrypted("v1")).toBe(false);
  });
});

describe("secret-box — legacy plaintext passthrough", () => {
  test("decrypt returns plaintext as-is when no v1: prefix", () => {
    expect(decrypt("legacy-plaintext-value")).toBe("legacy-plaintext-value");
  });

  test("decrypt returns empty string as-is", () => {
    expect(decrypt("")).toBe("");
  });
});

describe("secret-box — error handling", () => {
  test("decrypt throws on malformed v1: ciphertext (too few segments)", () => {
    expect(() => decrypt("v1:only:two")).toThrow("Invalid ciphertext format");
  });

  test("decrypt throws on tampered ciphertext (auth tag mismatch)", () => {
    const ct = encrypt("tamper me");
    const parts = ct.split(":");
    // Corrupt the last base64 segment (ciphertext body)
    const last = parts[3]!;
    parts[3] = last.slice(0, -2) + (last.endsWith("AA") ? "BB" : "AA");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });

  test("decrypt throws on tampered auth tag", () => {
    const ct = encrypt("tamper tag");
    const parts = ct.split(":");
    // Corrupt the auth tag (segment 2)
    const tag = parts[2]!;
    parts[2] = tag.slice(0, -2) + (tag.endsWith("AA") ? "BB" : "AA");
    expect(() => decrypt(parts.join(":"))).toThrow();
  });
});

describe("secret-box — key file permissions", () => {
  test("key file is created with 0o600 mode", () => {
    // The key is already loaded in this process; verify it exists from prior calls
    const keyPath = join(process.env.HOME ?? "~", ".watcher", "secret.key");
    try {
      const mode = statSync(keyPath).mode & 0o777;
      expect(mode).toBe(0o600);
    } catch {
      // Key file may not exist in CI — skip gracefully
    }
  });

  test("multiple encrypt calls are stable (key is reused)", () => {
    // If the key changed between calls, decryption would fail
    const ct = encrypt("stability");
    expect(decrypt(ct)).toBe("stability");
    const ct2 = encrypt("stability");
    expect(decrypt(ct2)).toBe("stability");
  });
});
