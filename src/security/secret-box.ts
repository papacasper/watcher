import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const KEY_PATH = join(process.env.HOME ?? "~", ".watcher", "secret.key");
const ALGO = "aes-256-gcm";

let _key: Buffer | undefined;

function getKey(): Buffer {
  if (_key) return _key;
  const dir = join(process.env.HOME ?? "~", ".watcher");
  if (!existsSync(KEY_PATH)) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fresh = randomBytes(32);
    writeFileSync(KEY_PATH, fresh.toString("hex"), { mode: 0o600 });
    _key = fresh;
  } else {
    _key = Buffer.from(readFileSync(KEY_PATH, "utf8").trim(), "hex");
    if (_key.length !== 32) throw new Error("secret.key is corrupt — delete it and restart");
  }
  return _key;
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext.startsWith("v1:")) {
    // Treat as legacy plaintext — return as-is so callers can migrate on save
    return ciphertext;
  }
  const parts = ciphertext.split(":");
  if (parts.length !== 4) throw new Error("Invalid ciphertext format");
  const [, ivB64, tagB64, ctB64] = parts as [string, string, string, string];
  const key = getKey();
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct).toString("utf8") + decipher.final("utf8");
}

export function isEncrypted(value: string): boolean {
  return value.startsWith("v1:");
}
