/**
 * accounts.ts
 * Account and portfolio data - mirrors robin_stocks.account
 */

import { auth } from "./auth.js";
import { filterData, paginationRequest } from "./helper.js";
import { fetchWithRetry } from "../utils/http.js";

export interface AccountProfile {
  url: string;
  portfolioCash: string;
  canDowngradeToCash: boolean;
  user: string;
  accountNumber: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  deactivated: boolean;
  depositHalted: boolean;
  onlyPositionClosingTrades: boolean;
  buyingPower: string;
  cashAvailableForWithdrawal: string;
  cash: string;
  portfolio: string;
  uninvestedCapital: string;
}

export interface PortfolioSummary {
  accountNumber: string;
  equity: string;
  cash: string;
  portfolioValue: string;
  buyingPower: string;
  lastEquity: string;
  todayEquityChange: string;
  dayPercentageChange: string;
}

export interface Position {
  instrument: string;
  quantity: string;
  costBasis: string;
  price: string;
  updatedAt: string;
}

export interface DividendRecord {
  id: string;
  url: string;
  account: string;
  instrument: string;
  amount: string;
  rate: string;
  position: string;
  withholding: string;
  recordDate: string;
  payableDate: string;
  paidAt: string;
  state: string;
  nraWithholding: string;
  dripEnabled: boolean;
}

const BASE_URL = "https://api.robinhood.com";
const MINERVA_URL = "https://minerva.robinhood.com";
const BONFIRE_URL = "https://bonfire.robinhood.com";

export type CardTransactionType = "pending" | "settled";

export interface CardTransaction {
  id: string;
  type: CardTransactionType;
  direction: "debit" | "credit";
  amount: string;
  currency_code: string;
  description: string;
  merchant: {
    name: string;
    category: string;
  } | null;
  created_at: string;
  updated_at: string;
  state: string;
}

export interface UnifiedTransfer {
  id: string;
  direction: "debit" | "credit";
  amount: string;
  currency_code: string;
  state: string;
  created_at: string;
  updated_at: string;
}

function getHeaders(): Record<string, string> {
  return auth.getHeaders();
}

export async function loadAccountProfile(
  accountNumber?: string,
  info?: string
): Promise<unknown> {
  const url = accountNumber
    ? `${ BASE_URL }/accounts/${ accountNumber }/`
    : `${ BASE_URL }/accounts/?default_to_all_accounts=true`;

  const resp = await fetchWithRetry(url, { headers: getHeaders() }, { retries: 2, label: "Robinhood account profile" });
  if (!resp.ok) throw new Error(`Account fetch failed: ${ resp.status }`);

  const data = await resp.json();
  return info ? filterData(data, info) : data;
}

export async function loadPortfolioProfile(
  accountNumber?: string,
  info?: string
): Promise<unknown> {
  const url = accountNumber
    ? `${ BASE_URL }/accounts/${ accountNumber }/portfolio/`
    : `${ BASE_URL }/accounts/`;

  const resp = await fetchWithRetry(url, { headers: getHeaders() }, { retries: 2, label: "Robinhood portfolio profile" });
  if (!resp.ok) throw new Error(`Portfolio fetch failed: ${ resp.status }`);

  const data = await resp.json();
  return info ? filterData(data, info) : data;
}

export async function getDividends(
  info?: string
): Promise<DividendRecord[]> {
  const data = await paginationRequest(`${ BASE_URL }/dividends/`) as DividendRecord[];
  return info ? filterData(data, info) as DividendRecord[] : data;
}

export async function getTotalDividends(
  info?: string
): Promise<number | unknown> {
  const data = await paginationRequest(`${ BASE_URL }/dividends/`) as DividendRecord[] | { results?: DividendRecord[] };
  const results = Array.isArray(data) ? data : ((data as { results?: DividendRecord[] }).results ?? []);

  let total = 0;
  for (const d of results as DividendRecord[]) {
    total += parseFloat(d.amount);
  }

  return info ? filterData({ total }, info) : total;
}

export async function getOpenStockPositions(
  accountNumber?: string,
  info?: string
): Promise<unknown[]> {
  const url = accountNumber
    ? `${ BASE_URL }/accounts/${ accountNumber }/positions/`
    : `${ BASE_URL }/positions/?nonzero=true`;

  const resp = await fetchWithRetry(url, { headers: getHeaders() }, { retries: 2, label: "Robinhood positions" });
  if (!resp.ok) throw new Error(`Positions fetch failed: ${ resp.status }`);

  const data = await resp.json() as { results?: unknown[] } | unknown[];
  const results = Array.isArray(data) ? data : ((data as { results?: unknown[] }).results ?? []);
  return info ? filterData(results, info) as unknown[] : results;
}

export async function getAllPositions(
  info?: string
): Promise<unknown> {
  const data = await paginationRequest(`${ BASE_URL }/positions/`);
  return info ? filterData(data, info) : data;
}

export async function getAccountInfo(): Promise<AccountProfile | null> {
  try {
    const data = await loadAccountProfile() as {
      results?: AccountProfile[];
      account_number?: string;
      portfolio_cash?: string;
      buying_power?: string;
    };

    if (Array.isArray(data.results) && data.results.length > 0) {
      return data.results[0] as AccountProfile;
    }
    return null;
  } catch {
    return null;
  }
}

export interface SpendingAccountBalance {
  portfolio_cash: string;
  buying_power: string;
  cash_available_for_withdrawal: string;
  cash: string;
  cash_held_for_orders: string;
  unsettled_funds: string;
}

export async function getSpendingAccountBalance(): Promise<SpendingAccountBalance | null> {
  const resp = await fetchWithRetry(`${BASE_URL}/accounts/`, { headers: getHeaders() }, { retries: 2, label: "Robinhood spending balance" });
  if (!resp.ok) throw new Error(`Accounts fetch failed: ${resp.status}`);
  const data = await resp.json() as { results?: SpendingAccountBalance[] };
  return data.results?.[0] ?? null;
}

export async function getCardTransactions(
  cardType?: CardTransactionType
): Promise<CardTransaction[]> {
  const url = new URL(`${MINERVA_URL}/history/transactions/`);
  if (cardType) url.searchParams.set("type", cardType);
  return paginationRequest<CardTransaction[]>(url.toString());
}

export async function getUnifiedTransfers(): Promise<UnifiedTransfer[]> {
  return paginationRequest<UnifiedTransfer[]>(
    `${BONFIRE_URL}/paymenthub/unified_transfers/`
  );
}

export async function getPortfolioSummary(): Promise<PortfolioSummary | null> {
  try {
    const profile = await loadAccountProfile() as {
      results?: Array<{
        account_number: string;
        portfolio: string;
        portfolio_cash: string;
        buying_power: string;
      }>;
    };

    const account = Array.isArray(profile.results) ? profile.results[0] : undefined;

    if (!account) return null;

    return {
      accountNumber: account.account_number ?? "unknown",
      equity: "0",
      cash: account.portfolio_cash ?? "0",
      portfolioValue: "0",
      buyingPower: account.buying_power ?? "0",
      lastEquity: "0",
      todayEquityChange: "0",
      dayPercentageChange: "0"
    };
  } catch {
    return null;
  }
}

export default {
  loadAccountProfile,
  loadPortfolioProfile,
  getDividends,
  getTotalDividends,
  getOpenStockPositions,
  getAllPositions,
  getAccountInfo,
  getPortfolioSummary,
  getSpendingAccountBalance,
  getCardTransactions,
  getUnifiedTransfers,
};
