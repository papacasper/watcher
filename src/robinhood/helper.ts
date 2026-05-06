/**
 * helper.ts
 * Utility functions mirroring robin_stocks helper module
 */

import { fetchWithRetry } from "../utils/http.js";

export function filterData<T>(data: T, info?: string): unknown {
  if (!info) return data;

  const results = (data as unknown as { results?: unknown[] }).results;
  if (!results) return data;

  if (Array.isArray(results)) {
    return results.map(item =>
      (item as Record<string, unknown>)[info]
    );
  }

  return (results as Record<string, unknown>)[info];
}

export async function paginationRequest<T>(
  url: string,
  payload?: Record<string, string>
): Promise<T> {
  const { auth } = await import("./auth.js");
  const results: unknown[] = [];
  let nextUrl: string | null = url;

  const headers = auth.getHeaders();

  while (nextUrl) {
    const resp = await fetchWithRetry(nextUrl, {
      headers,
      ...(payload ? { body: JSON.stringify(payload) } : {})
    }, { retries: 2, label: `Robinhood pagination ${nextUrl}` });

    if (!resp.ok) {
      throw new Error(`Pagination request failed: ${ resp.status }`);
    }

    const data = await resp.json() as {
      results: unknown[];
      next?: string | null;
    };

    results.push(...data.results);

    // Handle next URL - robin_stocks uses 'next' field
    nextUrl = data.next ?? null;
  }

  return results as unknown as T;
}

export function roundPrice(price: number, decimals = 2): number {
  return Math.round(price * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function inputsToSet(inputSymbols?: string | string[]): string[] {
  if (!inputSymbols) return [];
  if (typeof inputSymbols === "string") {
    return inputSymbols.split(",").map(s => s.trim().toUpperCase());
  }
  return inputSymbols.map(s => s.trim().toUpperCase());
}

export function errorTickerDoesNotExist(ticker: string): Error {
  return new Error(`Ticker "${ ticker }" does not exist`);
}

export function errorMustBeNonzero(keyword: string): Error {
  return new Error(`"${ keyword }" must be non-zero`);
}

export function errorArgumentNotKeyInDictionary(
  arg: string,
  dict: string
): Error {
  return new Error(`"${ arg }" is not a key in ${ dict }`);
}

export function convertNoneToString<T extends (...args: unknown[]) => unknown>(
  func: T
): T {
  return ((...args: unknown[]) => {
    const result = func(...args);
    return result === null ? "" : result;
  }) as T;
}

export default {
  filterData,
  paginationRequest,
  roundPrice,
  inputsToSet,
  errorTickerDoesNotExist,
  errorMustBeNonzero,
  errorArgumentNotKeyInDictionary,
  convertNoneToString
};
