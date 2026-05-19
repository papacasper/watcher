import React from "react";
import type { DividendEntry } from "./types.js";
import type { DividendIncomeMode } from "./dividends.js";
import { monthlyDividendBuckets } from "./dividends.js";
import { fmtS } from "./format.js";

export const META: Record<string, { type: string }> = {};

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

export function Chart({ dividends, mode }: { dividends: Pick<DividendEntry, "payableDate" | "amount" | "state">[]; mode: DividendIncomeMode }) {
  const [tooltip, setTooltip] = React.useState<{ i: number; x: number; y: number } | null>(null);
  const data = monthlyDividendBuckets(dividends, mode);
  if (!data.length) return <div style={{ color: "var(--muted)", fontSize: 12, padding: "20px" }}>No dividend history yet</div>;

  const W = 900, H = 220, P = { t: 20, r: 20, b: 36, l: 68 };
  const cW = W - P.l - P.r, cH = H - P.t - P.b;
  const rawMax = Math.max(...data.map(d => d.value));
  const n = data.length;

  if (rawMax === 0) return <div style={{ color: "var(--muted)", fontSize: 12, padding: "20px" }}>No dividend history yet</div>;

  // Nice step size so grid lines land on clean dollar/cent amounts
  function niceStep(max: number, targetLines = 7): number {
    const rough = max / targetLines;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 2.5, 5, 10].map(f => f * magnitude);
    return candidates.find(c => c >= rough) ?? candidates[candidates.length - 1]!;
  }
  const step = niceStep(rawMax);
  const maxV = Math.ceil(rawMax / step) * step;
  const gridVals = Array.from({ length: Math.round(maxV / step) + 1 }, (_, i) => i * step);

  const xS = (i: number) => P.l + (i / Math.max(n - 1, 1)) * cW;
  const yS = (v: number) => P.t + cH - (v / maxV) * cH;

  // Smooth cubic bezier path through points
  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length < 2) return `M ${pts[0]!.x},${pts[0]!.y}`;
    const tension = 0.35;
    let d = `M ${pts[0]!.x},${pts[0]!.y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[Math.min(i + 2, pts.length - 1)]!;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }
  const coordPts = n === 1
    ? [{ x: P.l + cW / 2, y: yS(data[0]!.value) }]
    : data.map((d, i) => ({ x: xS(i), y: yS(d.value) }));
  const linePath = smoothPath(coordPts);
  const areaPath = n === 1
    ? ""
    : `${linePath} L ${xS(n - 1)},${P.t + cH} L ${xS(0)},${P.t + cH} Z`;

  // Label every Nth bar so they don't overlap
  const labelEvery = n > 24 ? 6 : n > 12 ? 3 : 1;

  const hovered = tooltip !== null ? data[tooltip.i] : null;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <linearGradient id="chart-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.28" />
            <stop offset="60%" stopColor="#4ade80" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid */}
        {gridVals.map((v, i) => {
          const y = yS(v);
          return (
            <g key={i}>
              <line x1={P.l} y1={y} x2={P.l + cW} y2={y} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 0.75} strokeDasharray={v === 0 ? "" : "4 5"} strokeOpacity={v === 0 ? 1 : 0.6} />
              <text x={P.l - 8} y={y + 4} textAnchor="end" fill="var(--dim)" fontSize="10" fontFamily="'Fira Code',monospace">{fmtS(v)}</text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#chart-area-grad)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" />

        {/* Data points + hover targets */}
        {data.map((d, i) => {
          const cx = xS(i), cy = yS(d.value);
          const isHovered = tooltip?.i === i;
          return (
            <g key={i}>
              {/* Invisible wide hit target */}
              <rect
                x={cx - cW / n / 2} y={P.t} width={cW / n} height={cH}
                fill="transparent"
                onMouseEnter={e => setTooltip({ i, x: cx, y: cy })}
              />
              {/* Dot */}
              <circle
                cx={cx} cy={cy} r={isHovered ? 5 : 3}
                fill={isHovered ? "#4ade80" : "var(--surface)"}
                stroke="#4ade80" strokeWidth="2"
                style={{ transition: "r .1s" }}
              />
              {/* Vertical hover line */}
              {isHovered && <line x1={cx} y1={P.t} x2={cx} y2={P.t + cH} stroke="#4ade80" strokeWidth="1" strokeDasharray="3 3" />}
              {/* X labels */}
              {i % labelEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="'DM Sans',sans-serif">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hovered && tooltip && (
        <div
          style={{
            position: "absolute",
            left: `${(tooltip.x / W) * 100}%`,
            top: `${(tooltip.y / H) * 100}%`,
            transform: "translate(-50%, -130%)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            pointerEvents: "none",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 2, fontFamily: "'DM Sans',sans-serif" }}>{hovered.label}</div>
          <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Fira Code',monospace", color: "var(--green)" }}>{fmtS(hovered.value)}</div>
        </div>
      )}
    </div>
  );
}
