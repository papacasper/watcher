import { afterEach, describe, expect, test } from "bun:test";
import { fetchJson, fetchWithRetry, HttpError } from "../src/utils/http.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("fetchWithRetry", () => {
  test("retries retryable HTTP statuses", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? new Response("try again", { status: 503 })
        : new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;

    const response = await fetchWithRetry("https://example.test", {}, { retries: 1, retryDelayMs: 1 });

    expect(response.status).toBe(200);
    expect(calls).toBe(2);
  });

  test("fetchJson throws HttpError with response details", async () => {
    globalThis.fetch = (async () => new Response("bad", { status: 429 })) as unknown as typeof fetch;

    await expect(fetchJson("https://example.test", {}, { retries: 0 })).rejects.toThrow(HttpError);
  });
});
