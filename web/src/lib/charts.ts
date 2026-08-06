// web/src/lib/charts.ts — 唯一 SVG 產生來源（SSG 與 client 共用）。
// spec §4.3：外部資料（label/tooltip）必須 XML escaping；不建立泛型 LineChart。
// 數值輸入邊界（review）：所有數值（value/x/y/width/height）只接受有限非負數，
// NaN/Infinity/負數一律視為 0（normalization）——單筆異常資料不破壞整張圖。
// opts.color 同屬 API 輸入，一律 xmlEscape（不允許注入 attribute）。

// 有限非負數：否則視為 0（NaN/Infinity/負數）。
function finite(v: number): number {
  return Number.isFinite(v) && v >= 0 ? v : 0;
}
// 尺寸 clamp：width 至少 70、height 至少 24（小於繪圖 padding 會產生負幾何；review round）。
const MIN_WIDTH = 70;
const MIN_HEIGHT = 24;
function finiteWidth(v: number): number {
  return Math.max(finite(v), MIN_WIDTH);
}
function finiteHeight(v: number): number {
  return Math.max(finite(v), MIN_HEIGHT);
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

type BarOpts = { color?: string; height?: number; width?: number; formatValue?: (v: number) => string };
const DEFAULTS = { color: "var(--accent)", height: 180, width: 320 };

function barTitle(label: string, value: number, fmt?: (v: number) => string): string {
  return `<title>${xmlEscape(label)}: ${xmlEscape(fmt ? fmt(value) : String(value))}</title>`;
}

export function barChartSVG(data: { label: string; value: number }[], opts: BarOpts = {}): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const h = finiteHeight(height);
  const w = finiteWidth(width);
  const values = data.map((d) => finite(d.value));
  const max = Math.max(...values, 1);
  const gap = 4;
  const bw = Math.max((w - gap * (data.length - 1)) / Math.max(data.length, 1), 0); // 窄 width 時不為負（review round）
  const bars = data
    .map((d, i) => {
      const v = finite(d.value);
      const bh = (v / max) * (h - 20);
      const x = i * (bw + gap);
      const y = h - bh;
      const label = `<text x="${(x + bw / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(d.label)}</text>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${xmlEscape(color)}" aria-label="${xmlEscape(d.label)}: ${v}">${barTitle(d.label, v, opts.formatValue)}</rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function horizontalBarSVG(data: { label: string; value: number }[], opts: BarOpts = {}): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const w = finiteWidth(width);
  const values = data.map((d) => finite(d.value));
  const max = Math.max(...values, 1);
  const rowH = 20;
  // 自動加高：資料列超過指定 height 時以資料量為準（review：top 10 不再被裁切）。
  // 底部留 16px（值文字最底行 y+13 + 餘裕）；rowH = 20 → 10 列 = 216。
  const chartHeight = Math.max(finiteHeight(height), data.length * rowH + 16);
  const rows = data
    .map((d, i) => {
      const v = finite(d.value);
      const bw = (v / max) * (w - 70);
      const y = i * rowH;
      const label = `<text x="0" y="${y + 13}" font-size="10" fill="var(--text)">${xmlEscape(d.label)}</text>`;
      const rect = `<rect x="65" y="${y + 3}" width="${bw.toFixed(1)}" height="${rowH - 8}" fill="${xmlEscape(color)}" aria-label="${xmlEscape(d.label)}: ${v}">${barTitle(d.label, v, opts.formatValue)}</rect>`;
      const val = `<text x="${(65 + bw + 4).toFixed(1)}" y="${y + 13}" font-size="9" fill="var(--muted)">${xmlEscape(opts.formatValue ? opts.formatValue(v) : String(v))}</text>`;
      return label + rect + val;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${chartHeight}" width="100%" height="${chartHeight}" role="img" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
}

export function distributionBarSVG(buckets: { label: string; count: number }[], opts: BarOpts = {}): string {
  // spec §4.3：分桶分佈用長條圖；count 0 仍輸出 rect（高度 0）。
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const h = finiteHeight(height);
  const w = finiteWidth(width);
  const counts = buckets.map((b) => finite(b.count));
  const max = Math.max(...counts, 1);
  const gap = 6;
  const bw = Math.max((w - gap * (buckets.length - 1)) / Math.max(buckets.length, 1), 0); // 窄 width 時不為負（review round）
  const bars = buckets
    .map((b, i) => {
      const bh = (counts[i] / max) * (h - 24);
      const x = i * (bw + gap);
      const y = h - bh;
      const label = `<text x="${(x + bw / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(b.label)}</text>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${xmlEscape(color)}" aria-label="${xmlEscape(b.label)}: ${counts[i]}">${barTitle(b.label, counts[i])}</rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function scatterSVG(
  points: { x: number; y: number; label: string; tooltip: string }[],
  opts: BarOpts & { xLabel?: string; xMax?: number; yMax?: number } = {},
): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const h = finiteHeight(height);
  const w = finiteWidth(width);
  const xs = points.map((p) => finite(p.x));
  const ys = points.map((p) => finite(p.y));
  const xMax = finite(opts.xMax ?? Math.max(...xs, 1));
  const yMax = finite(opts.yMax ?? Math.max(...ys, 1));
  const padL = 30, padB = 20, padT = 8;
  const plotW = w - padL;
  const plotH = h - padT - padB;
  const circles = points
    .map((p, i) => {
      const cx = padL + (xs[i] / xMax) * plotW;
      const cy = padT + plotH - (ys[i] / yMax) * plotH;
      // 單一 <title>（完整 tooltip）；aria-label 帶 label（review #6）
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${xmlEscape(color)}" aria-label="${xmlEscape(p.label)}"><title>${xmlEscape(p.tooltip)}</title></circle>`;
    })
    .join("");
  const xLabel = `<text x="${padL + plotW / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(opts.xLabel ?? "")}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" xmlns="http://www.w3.org/2000/svg">${circles}${xLabel}</svg>`;
}
