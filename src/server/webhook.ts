import type { DashboardData } from "../dashboard/types.js";

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "::1") return true;
  if (/^127\./.test(hostname)) return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  if (/^169\.254\./.test(hostname)) return true;
  if (/^fc[0-9a-f]{2}:/i.test(hostname)) return true;
  return false;
}

let _webhookUrlValidated: string | null | undefined;
export function getValidatedWebhookUrl(): string | null {
  if (_webhookUrlValidated !== undefined) return _webhookUrlValidated;
  const raw = Bun.env.WEBHOOK_URL?.trim();
  if (!raw) { _webhookUrlValidated = null; return null; }
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      console.warn(`[webhook] WEBHOOK_URL rejected: must use https:// (got ${u.protocol})`);
      _webhookUrlValidated = null; return null;
    }
    if (u.protocol === "http:" && !isPrivateOrLoopbackHost(u.hostname)) {
      console.warn("[webhook] WEBHOOK_URL rejected: http:// only allowed for loopback destinations");
      _webhookUrlValidated = null; return null;
    }
    if (!isPrivateOrLoopbackHost(u.hostname)) {
      // non-private host is fine on https
    } else if (u.protocol !== "https:") {
      console.warn(`[webhook] WEBHOOK_URL rejected: target ${u.hostname} is a private/loopback address`);
      _webhookUrlValidated = null; return null;
    }
    _webhookUrlValidated = raw;
    return raw;
  } catch {
    console.warn("[webhook] WEBHOOK_URL rejected: invalid URL");
    _webhookUrlValidated = null; return null;
  }
}

export async function fireWebhookIfNeeded(
  data: DashboardData,
  state: { lastGoalProgressPct: number; lastDangerGuardrailKeys: Set<string> },
): Promise<void> {
  const webhookUrl = getValidatedWebhookUrl();
  if (!webhookUrl) return;

  const goalPct = data.summary?.dividendGoalProgressPct ?? 0;
  const prevGoalBucket = Math.floor(state.lastGoalProgressPct / 5);
  const newGoalBucket  = Math.floor(goalPct / 5);
  const goalCrossed = newGoalBucket > prevGoalBucket;
  state.lastGoalProgressPct = goalPct;

  const dangerGuardrails = (data.guardrails ?? []).filter(g => g.severity === "danger");
  const newDangerKeys = new Set(dangerGuardrails.map(g => g.title));
  const newDangers = dangerGuardrails.filter(g => !state.lastDangerGuardrailKeys.has(g.title));
  state.lastDangerGuardrailKeys = newDangerKeys;

  if (!goalCrossed && newDangers.length === 0) return;

  const payload = {
    event: goalCrossed && newDangers.length === 0 ? "goal_progress"
         : newDangers.length > 0 && !goalCrossed   ? "guardrail_triggered"
         : "goal_and_guardrail",
    goalProgressPct: goalPct.toFixed(1),
    ...(goalCrossed ? { goalMilestone: `${newGoalBucket * 5}%` } : {}),
    ...(newDangers.length > 0 ? { newGuardrails: newDangers.map(g => ({ title: g.title, detail: g.detail })) } : {}),
    fetchedAt: data.fetchedAt,
  };

  try {
    await Promise.race([
      fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("webhook timeout")), 5_000)),
    ]);
    console.log(`[${new Date().toLocaleTimeString()}] Webhook fired: ${payload.event}`);
  } catch (e) {
    console.warn(`[${new Date().toLocaleTimeString()}] Webhook failed:`, e instanceof Error ? e.message : e);
  }
}
