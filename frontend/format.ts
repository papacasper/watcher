export const fmtPositive = (n: number) => n >= 1e6
  ? `$${(n / 1e6).toFixed(3)}M`
  : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmt = (n: number | null | undefined) =>
  n == null ? "-" : `${n < 0 ? "-" : ""}${fmtPositive(Math.abs(n))}`;

export const fmtS = (n: number) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`;
