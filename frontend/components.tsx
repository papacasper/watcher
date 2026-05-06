import type { DividendEntry } from "./types.js";
import { fmtS } from "./format.js";

export const META: Record<string, { type: string }> = {
  O: { type: "REIT" },
  JEPI: { type: "ETF" },
  JEPQ: { type: "ETF" },
};

export const TBADGE: Record<string, [string, string]> = {
  Stock: ["var(--border)", "var(--txt)"],
  ETF: ["#dde1e7", "#4b5563"],
  Bond: ["#e5e7eb", "#9ca3af"],
  REIT: ["#dcfce7", "#16a34a"],
};

export const TBAR: Record<string, string> = {
  Stock: "#6366f1",
  ETF: "#3b82f6",
  Bond: "#94a3b8",
  REIT: "#22c55e",
};

const PILL: Record<string, [string, string]> = {
  paid: ["#dcfce7", "#15803d"],
  reinvested: ["#dcfce7", "#15803d"],
  pending: ["#fef9c3", "#854d0e"],
  announced: ["#dbeafe", "#1d4ed8"],
  projected: ["#f3f4f6", "#6b7280"],
};

export function Badge({ type }: { type: string }) {
  const [bg, c] = TBADGE[type] ?? ["#f3f4f6", "#555"];
  return <span className="badge" style={{ background: bg, color: c }}>{type}</span>;
}

export function Pill({ state }: { state: string }) {
  const [bg, c] = PILL[state] ?? ["#f3f4f6", "#6b7280"];
  return <span className="pill" style={{ background: bg, color: c }}>{state}</span>;
}

export function SortArrow({ active, dir }: { active: boolean; dir: number }) {
  return <span style={{ opacity: active ? 1 : 0.2, fontSize: 10, marginLeft: 3 }}>{dir === -1 ? "↓" : "↑"}</span>;
}

export function Chart({ dividends }: { dividends: Pick<DividendEntry, "payableDate" | "amount" | "state">[] }) {
  const byMonth: Record<string, number> = {};
  for (const d of dividends) {
    if (!["paid", "reinvested"].includes(d.state)) continue;
    const k = d.payableDate.slice(0, 7);
    byMonth[k] = (byMonth[k] ?? 0) + d.amount;
  }
  const data = Object.entries(byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ label: new Date(`${k}-02`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }), v }));
  if (!data.length) return <div style={{ color: "var(--muted)", fontSize: 12, padding: "20px" }}>No dividend history yet</div>;

  const W = 900, H = 190, P = { t: 14, r: 16, b: 30, l: 52 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;
  const maxV = Math.max(...data.map(d => d.v));
  const bW = Math.max(6, cW / data.length * 0.6);
  const xS = (i: number) => (i / Math.max(data.length - 1, 1)) * cW;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%", display: "block" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const y = P.t + cH - f * cH;
        return <g key={i}>
          <line x1={P.l} y1={y} x2={P.l + cW} y2={y} stroke="var(--border)" strokeWidth="1" />
          <text x={P.l - 6} y={y + 4} textAnchor="end" fill="var(--dim)" fontSize="10" fontFamily="'Fira Code',monospace">{fmtS(f * maxV)}</text>
        </g>;
      })}
      {data.map((d, i) => {
        const bh = (d.v / maxV) * cH;
        return <g key={i}>
          <rect x={P.l + xS(i) - bW / 2} y={P.t + cH - bh} width={bW} height={bh} fill="#22c55e" opacity=".65" rx="2" />
          <text x={P.l + xS(i)} y={H - 6} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="'DM Sans',sans-serif">{d.label}</text>
        </g>;
      })}
    </svg>
  );
}
