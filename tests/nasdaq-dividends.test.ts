import { describe, expect, mock, test } from "bun:test";
import { getAnnouncedDividends } from "../src/announcements/nasdaq.ts";

describe("Nasdaq dividend announcements", () => {
  test("fans out one request per day and filters symbols", async () => {
    const seenDates: string[] = [];
    const fetcher = mock(async (date: string) => {
      seenDates.push(date);
      return [
        { symbol: "AAA", payableDate: date, cash: 0.25, exDate: date },
        { symbol: "ZZZ", payableDate: date, cash: 9.99, exDate: date },
      ];
    });

    const rows = await getAnnouncedDividends(["AAA"], "2030-01-01", "2030-01-03", fetcher);

    expect(seenDates).toEqual(["2030-01-01", "2030-01-02", "2030-01-03"]);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.symbol === "AAA")).toBe(true);
    expect(rows[0]).toMatchObject({ cash: 0.25, payableDate: "2030-01-01", exDate: "2030-01-01" });
  });

  test("skips fetching when no symbols are requested", async () => {
    const fetcher = mock(async () => []);
    const rows = await getAnnouncedDividends([], "2030-02-01", "2030-02-01", fetcher);
    expect(rows).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
