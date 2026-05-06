export interface FetchRetryOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  retryStatuses?: number[];
  label?: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const DEFAULT_RETRY_STATUSES = [408, 429, 500, 502, 503, 504];

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelay(response: Response, fallbackMs: number, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  return fallbackMs * Math.pow(2, attempt);
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 300;
  const retryStatuses = new Set(options.retryStatuses ?? DEFAULT_RETRY_STATUSES);
  const url = inputUrl(input);
  const label = options.label ?? url;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timeout);

      if (attempt < retries && retryStatuses.has(response.status)) {
        await response.text().catch(() => "");
        await sleep(retryDelay(response, retryDelayMs, attempt));
        continue;
      }

      return response;
    } catch (e) {
      clearTimeout(timeout);
      if (attempt < retries) {
        await sleep(retryDelayMs * Math.pow(2, attempt));
        continue;
      }
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`${label} request failed: ${message}`);
    }
  }

  throw new Error(`${label} request failed`);
}

export async function fetchJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: FetchRetryOptions = {}
): Promise<T> {
  const response = await fetchWithRetry(input, init, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const url = inputUrl(input);
    throw new HttpError(
      `${options.label ?? url} failed: ${response.status}${body ? ` ${body.slice(0, 300)}` : ""}`,
      response.status,
      url,
      body
    );
  }
  return response.json() as Promise<T>;
}
