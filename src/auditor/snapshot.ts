import { getDividends, getOpenStockPositions } from "../robinhood/accounts.js";
import { auth } from "../robinhood/auth.js";

export interface AuditHolding {
  symbol: string;
  shares: number;
  costBasis: number;
}

export interface AuditDividend {
  symbol: string;
  amount: number;
  date: string;
  reinvested: boolean;
  rate?: string;
  position?: string;
}

type RawRecord = Record<string, unknown>;

const DIVIDEND_STATES = new Set(["paid", "pending", "reinvested"]);

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function asNumber(value: unknown): number {
  const parsed = parseFloat(asString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function instrumentIdFromUrl(url: unknown): string {
  return asString(url).split("/").filter(Boolean).pop() ?? "";
}

async function fetchInstrumentSymbol(url: string): Promise<string | null> {
  if (!url) return null;

  try {
    const resp = await fetch(url, { headers: auth.getHeaders() });
    if (!resp.ok) return null;
    const data = await resp.json() as RawRecord;
    const symbol = asString(data.symbol).trim();
    return symbol ? symbol.toUpperCase() : null;
  } catch {
    return null;
  }
}

async function resolvePositionSymbol(
  position: RawRecord,
  symbolCache: Map<string, string | null>
): Promise<string | null> {
  const directSymbol = asString(position.symbol).trim();
  if (directSymbol) return directSymbol.toUpperCase();

  const instrumentUrl = asString(position.instrument);
  if (!instrumentUrl) return null;

  if (!symbolCache.has(instrumentUrl)) {
    symbolCache.set(instrumentUrl, await fetchInstrumentSymbol(instrumentUrl));
  }

  return symbolCache.get(instrumentUrl) ?? null;
}

function costBasisForPosition(position: RawRecord, shares: number): number {
  const directCostBasis = asString(position.cost_basis ?? position.costBasis);
  if (directCostBasis) return asNumber(directCostBasis);

  return asNumber(position.average_buy_price ?? position.averageBuyPrice) * shares;
}

export async function normalizeAuditSnapshot(
  rawPositions: unknown[],
  rawDividends: unknown[]
): Promise<{ holdings: AuditHolding[]; dividends: AuditDividend[] }> {
  const symbolCache = new Map<string, string | null>();
  const instrToSymbol = new Map<string, string>();
  const holdings: AuditHolding[] = [];

  for (const rawPosition of rawPositions) {
    const position = rawPosition as RawRecord;
    const symbol = await resolvePositionSymbol(position, symbolCache);
    if (!symbol) continue;

    const instrumentId = asString(position.instrument_id) || instrumentIdFromUrl(position.instrument);
    if (instrumentId) instrToSymbol.set(instrumentId, symbol);

    const shares = asNumber(position.quantity);
    holdings.push({
      symbol,
      shares,
      costBasis: costBasisForPosition(position, shares),
    });
  }

  const dividends: AuditDividend[] = [];

  for (const rawDividend of rawDividends) {
    const dividend = rawDividend as RawRecord;
    const state = asString(dividend.state);
    if (state && !DIVIDEND_STATES.has(state)) continue;

    const instrumentId = instrumentIdFromUrl(dividend.instrument);
    const symbol = instrToSymbol.get(instrumentId);
    if (!symbol) continue;

    const date = asString(dividend.paid_at || dividend.payable_date || dividend.payableDate);
    if (!date) continue;

    dividends.push({
      symbol,
      amount: asNumber(dividend.amount),
      date,
      reinvested: asBoolean(dividend.drip_enabled) || state === "reinvested",
      rate: asString(dividend.rate) || undefined,
      position: asString(dividend.position) || undefined,
    });
  }

  return { holdings, dividends };
}

export async function fetchAuditSnapshot(): Promise<{
  holdings: AuditHolding[];
  dividends: AuditDividend[];
}> {
  const [positions, dividends] = await Promise.all([
    getOpenStockPositions(),
    getDividends(),
  ]);

  return normalizeAuditSnapshot(positions, dividends);
}
