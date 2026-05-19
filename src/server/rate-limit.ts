const RATE_WINDOWS = new Map<string, number[]>();

export function clientIp(
  request: Request,
  server: { requestIP(req: Request): { address: string } | null } | null | undefined
): string | null {
  return server?.requestIP(request)?.address ?? null;
}

export function isRateLimited(key: string, maxPerMinute: number): boolean {
  const now = Date.now();
  const cutoff = now - 60_000;
  const hits = (RATE_WINDOWS.get(key) ?? []).filter(t => t > cutoff);
  hits.push(now);
  RATE_WINDOWS.set(key, hits);
  return hits.length > maxPerMinute;
}

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, hits] of RATE_WINDOWS) {
    const fresh = hits.filter(t => t > cutoff);
    if (fresh.length === 0) RATE_WINDOWS.delete(key); else RATE_WINDOWS.set(key, fresh);
  }
}, 5 * 60_000);
