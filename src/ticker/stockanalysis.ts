import { fetchWithRetry } from "../utils/http.js";

export interface TickerDividendEntry {
  exDate: string;
  payDate: string;
  amount: number;
}

export interface TickerDividendInfo {
  symbol: string;
  yield: string;
  annual: string;
  frequency: string;
  exDiv: string;
  history: TickerDividendEntry[];
}

export interface TickerOverview {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  price: number;
  change: number;
  changePct: number;
  high52: number;
  low52: number;
  volume: number;
  avgVolume: number;
  marketCap: string;
  dividend: string;
  dividendYield: string;
  exDividendDate: string;
  beta: string;
  peRatio: string;
  forwardPE: string;
  pbRatio: string;
  paysRatio: string;
  payoutRatio: string;
  nextEarnings: string;
  eps: string;
  analysts: string;
  analystTarget: string;
  description: string;
}

export interface PricePoint {
  date: string;
  close: number;
  volume: number;
}

export interface TickerPriceHistory {
  symbol: string;
  points: PricePoint[];
}

// ── Shared ────────────────────────────────────────────────────────────────────

type SvelteData = (string | number | boolean | null | Record<string, number> | number[])[];

const BASE = "https://stockanalysis.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json",
};

// ── Clean JSON API (/api/) ────────────────────────────────────────────────────

interface QuoteData {
  p: number;   // price
  c: number;   // change
  cp: number;  // change percent
  h52: number; // 52-week high
  l52: number; // 52-week low
  v: number;   // volume
}

async function fetchQuote(symbol: string): Promise<(QuoteData & { assetType: "stock" | "etf" }) | null> {
  const s = symbol.toLowerCase();
  for (const kind of ["s", "e"] as const) {
    const url = `${BASE}/api/quotes/${kind}/${s}`;
    const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, label: url });
    if (!res.ok) continue;
    const json = await res.json() as { status: string | number; data: QuoteData };
    if ((json.status === "success" || json.status === 200) && json.data?.p) {
      return { ...json.data, assetType: kind === "s" ? "stock" : "etf" };
    }
  }
  return null;
}

async function fetchPriceHistory(symbol: string): Promise<PricePoint[] | null> {
  const s = symbol.toLowerCase();
  for (const kind of ["s", "e"] as const) {
    const url = `${BASE}/api/symbol/${kind}/${s}/history?type=chart`;
    const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, label: url });
    if (!res.ok) continue;
    const json = await res.json() as { status: string | number; data: [number, number][] };
    if ((json.status !== "success" && json.status !== 200) || !Array.isArray(json.data) || json.data.length < 5) continue;
    return json.data.map(([ts, close]) => ({
      date: new Date(ts).toISOString().slice(0, 10),
      close,
      volume: 0,
    }));
  }
  return null;
}

// ── SvelteKit __data.json (dividends + fundamentals) ─────────────────────────

async function fetchSvelteData(url: string): Promise<SvelteData[] | null> {
  const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, label: url });
  if (!res.ok) return null;
  const json = await res.json() as { nodes?: { type: string; data: SvelteData }[] };
  return json.nodes?.filter(n => n.type === "data" && Array.isArray(n.data)).map(n => n.data) ?? null;
}

async function fetchSvelteWithFallback(symbol: string, path: string): Promise<SvelteData[] | null> {
  const s = symbol.toLowerCase();
  const qs = "?x-sveltekit-trailing-slash=1";
  const stock = await fetchSvelteData(`${BASE}/stocks/${s}/${path}__data.json${qs}`);
  if (stock?.length) return stock;
  const etf = await fetchSvelteData(`${BASE}/etf/${s}/${path}__data.json${qs}`);
  return etf?.length ? etf : null;
}

function str(data: SvelteData, idx: number | undefined): string {
  if (idx === undefined) return "";
  return typeof data[idx] === "string" ? data[idx] as string : "";
}

function num(data: SvelteData, idx: number | undefined): number {
  if (idx === undefined) return 0;
  return typeof data[idx] === "number" ? data[idx] as number : 0;
}

function findDataNode(nodes: SvelteData[], key: string): SvelteData | null {
  return nodes.find(data => {
    const root = data[0];
    return typeof root === "object" && root !== null && key in (root as Record<string, unknown>);
  }) ?? null;
}

// ── Dividends ─────────────────────────────────────────────────────────────────

function parseDividendNode(data: SvelteData): TickerDividendInfo | null {
  const root = data[0] as Record<string, number>;
  if (!("history" in root)) return null;

  const infoTable = data[root.infoTable ?? 0] as Record<string, number>;
  const histIndices = data[root.history ?? 0] as number[];

  const history: TickerDividendEntry[] = [];
  for (const idx of histIndices) {
    const schema = data[idx] as Record<string, number>;
    const amt = str(data, schema.amt).replace(/[$,]/g, "");
    const parsed = parseFloat(amt);
    if (!Number.isFinite(parsed) || parsed <= 0) continue;
    history.push({
      exDate: str(data, schema.dt),
      payDate: str(data, schema.pay),
      amount: parsed,
    });
  }

  return {
    symbol: "",
    yield: str(data, infoTable.yield),
    annual: str(data, infoTable.annual),
    frequency: str(data, infoTable.frequency),
    exDiv: str(data, infoTable.exdiv),
    history,
  };
}

export async function getTickerDividends(symbol: string): Promise<TickerDividendInfo | null> {
  const s = symbol.toUpperCase();
  const nodes = await fetchSvelteWithFallback(s, "dividend/");
  if (!nodes) return null;
  const node = findDataNode(nodes, "history");
  if (!node) return null;
  const result = parseDividendNode(node);
  if (!result) return null;
  result.symbol = s;
  return result;
}

// ── Overview: clean API quote + SvelteKit fundamentals ───────────────────────

function parseFundamentals(nodes: SvelteData[]): Partial<TickerOverview> | null {
  const infoNode = findDataNode(nodes, "info");
  if (!infoNode) return null;
  const infoRoot = infoNode[0] as Record<string, number>;
  const info = infoNode[infoRoot.info ?? 0] as Record<string, number>;

  const base = {
    name: str(infoNode, info.nameFull) || str(infoNode, info.name),
    exchange: str(infoNode, info.exchange),
  };

  const stockNode = findDataNode(nodes, "marketCap");
  if (stockNode) {
    const r = stockNode[0] as Record<string, number>;
    return {
      ...base,
      type: "stock",
      marketCap: str(stockNode, r.marketCap),
      dividend: str(stockNode, r.dividend),
      dividendYield: "",
      exDividendDate: str(stockNode, r.exDividendDate),
      beta: str(stockNode, r.beta),
      peRatio: str(stockNode, r.peRatio),
      forwardPE: str(stockNode, r.forwardPE),
      pbRatio: str(stockNode, r.pbRatio),
      paysRatio: str(stockNode, r.ps),
      payoutRatio: str(stockNode, r.payoutRatio),
      nextEarnings: str(stockNode, r.nextEarnings),
      eps: str(stockNode, r.eps),
      analysts: str(stockNode, r.analysts),
      analystTarget: str(stockNode, r.target),
      description: str(stockNode, r.description),
    };
  }

  const etfNode = findDataNode(nodes, "aum");
  if (etfNode) {
    const r = etfNode[0] as Record<string, number>;
    return {
      ...base,
      type: "etf",
      marketCap: str(etfNode, r.aum),
      dividend: str(etfNode, r.dps),
      dividendYield: str(etfNode, r.dividendYield),
      exDividendDate: str(etfNode, r.exDivDate),
      beta: str(etfNode, r.beta),
      peRatio: String(etfNode[r.peRatio ?? 0] ?? ""),
      forwardPE: "",
      pbRatio: "",
      paysRatio: "",
      payoutRatio: str(etfNode, r.payoutRatio),
      nextEarnings: "",
      eps: str(etfNode, r.eps),
      analysts: "",
      analystTarget: "",
      description: str(etfNode, r.description),
    };
  }

  return null;
}

export async function getTickerOverview(symbol: string): Promise<TickerOverview | null> {
  const s = symbol.toUpperCase();

  // Fetch in parallel: clean API for live price, SvelteKit for fundamentals.
  const [quote, nodes] = await Promise.all([
    fetchQuote(s),
    fetchSvelteWithFallback(s, ""),
  ]);

  if (!quote && !nodes) return null;

  const f = nodes ? parseFundamentals(nodes) : null;

  return {
    symbol: s,
    name: f?.name ?? "",
    exchange: f?.exchange ?? "",
    type: f?.type ?? (quote?.assetType ?? "stock"),
    price: quote?.p ?? 0,
    change: quote?.c ?? 0,
    changePct: quote?.cp ?? 0,
    high52: quote?.h52 ?? 0,
    low52: quote?.l52 ?? 0,
    volume: quote?.v ?? 0,
    avgVolume: f?.avgVolume ?? 0,
    marketCap: f?.marketCap ?? "",
    dividend: f?.dividend ?? "",
    dividendYield: f?.dividendYield ?? "",
    exDividendDate: f?.exDividendDate ?? "",
    beta: f?.beta ?? "",
    peRatio: f?.peRatio ?? "",
    forwardPE: f?.forwardPE ?? "",
    pbRatio: f?.pbRatio ?? "",
    paysRatio: f?.paysRatio ?? "",
    payoutRatio: f?.payoutRatio ?? "",
    nextEarnings: f?.nextEarnings ?? "",
    eps: f?.eps ?? "",
    analysts: f?.analysts ?? "",
    analystTarget: f?.analystTarget ?? "",
    description: f?.description ?? "",
  };
}

// ── Symbol search ─────────────────────────────────────────────────────────────

export interface TickerSearchResult {
  symbol: string
  name: string
  type: string
}

export async function searchTickers(query: string): Promise<TickerSearchResult[]> {
  const url = `${BASE}/api/search/?q=${encodeURIComponent(query)}&type=stocks`;
  const res = await fetchWithRetry(url, { headers: HEADERS }, { retries: 1, label: "search" });
  if (!res.ok) return [];
  try {
    const json = await res.json() as { data?: Array<{ s: string; n: string; type?: string }> };
    if (!Array.isArray(json.data)) return [];
    return json.data.slice(0, 8).map(item => ({
      symbol: item.s.toUpperCase(),
      name: item.n,
      type: item.type ?? "stock",
    }));
  } catch {
    return [];
  }
}

// ── Price history (clean API) ─────────────────────────────────────────────────

export async function getTickerPriceHistory(symbol: string): Promise<TickerPriceHistory | null> {
  const s = symbol.toUpperCase();
  const points = await fetchPriceHistory(s);
  if (!points) return null;
  return { symbol: s, points };
}
