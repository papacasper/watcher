import { fetchWithRetry } from "../utils/http.js";

export interface MarketCalendarEvent {
  date: string;
  label: string;
  type: string;
  days_away: number;
}

const BASE = "https://feargreedchart.com/api";

export async function getMarketCalendar(): Promise<MarketCalendarEvent[]> {
  const today = new Date();
  const res = await fetchWithRetry(`${BASE}/?action=calendar`, {}, { retries: 1, timeoutMs: 10_000, label: "feargreed/calendar" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error("feargreed/calendar: unexpected response shape");
  const events: MarketCalendarEvent[] = [];
  for (const ev of raw) {
    if (
      typeof ev?.date !== "string" ||
      typeof ev?.label !== "string" ||
      typeof ev?.type !== "string" ||
      Number.isNaN(new Date(ev.date).valueOf())
    ) {
      console.warn("feargreed/calendar: skipping invalid entry", ev);
      continue;
    }
    events.push({
      date:      ev.date,
      label:     ev.label,
      type:      ev.type,
      days_away: Math.round((new Date(ev.date).getTime() - today.getTime()) / 86_400_000),
    });
  }
  return events;
}
