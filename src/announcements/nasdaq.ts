import { fetchWithRetry } from "../utils/http.js";

export interface AnnouncedDividend {
  symbol: string;
  payableDate: string;
  cash: number;
  exDate: string;
}

interface NasdaqDividendRow {
  symbol?: string;
  payment_Date?: string;
  paymentDate?: string;
  dividend_Rate?: string | number;
  dividendRate?: string | number;
  ex_Date?: string;
  dividend_Ex_Date?: string;
  exDate?: string;
}

interface NasdaqDividendResponse {
  data?: {
    calendar?: {
      rows?: NasdaqDividendRow[];
    };
  };
}

const BASE = "https://api.nasdaq.com/api/calendar/dividends";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { fetchedAt: number; rows: AnnouncedDividend[] }>();

function dateRange(since: string, until: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${until}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function parseCash(value: string | number | undefined): number {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = parseFloat(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: string | undefined): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

async function fetchDate(date: string): Promise<AnnouncedDividend[]> {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rows;

  const url = new URL(BASE);
  url.searchParams.set("date", date);
  const response = await fetchWithRetry(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "application/json,text/plain,*/*",
    },
  }, { retries: 1, label: `Nasdaq dividends ${date}` });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Nasdaq dividends ${date} failed: ${response.status}${body ? ` ${body.slice(0, 200)}` : ""}`);
  }

  const data = await response.json() as NasdaqDividendResponse;
  const rows = data.data?.calendar?.rows ?? [];
  const dividends = rows
    .map(row => ({
      symbol: (row.symbol ?? "").trim().toUpperCase(),
      payableDate: normalizeDate(row.payment_Date ?? row.paymentDate),
      cash: parseCash(row.dividend_Rate ?? row.dividendRate),
      exDate: normalizeDate(row.dividend_Ex_Date ?? row.ex_Date ?? row.exDate),
    }))
    .filter(row => row.symbol && row.payableDate && row.cash > 0);

  cache.set(date, { fetchedAt: Date.now(), rows: dividends });
  return dividends;
}

export async function getAnnouncedDividends(
  symbols: string[],
  since: string,
  until: string,
  fetcher: (date: string) => Promise<AnnouncedDividend[]> = fetchDate,
): Promise<AnnouncedDividend[]> {
  const wanted = new Set(symbols.map(symbol => symbol.toUpperCase()));
  if (wanted.size === 0) return [];
  const rows = (await Promise.all(dateRange(since, until).map(fetcher))).flat();
  return rows.filter(row => wanted.has(row.symbol));
}
