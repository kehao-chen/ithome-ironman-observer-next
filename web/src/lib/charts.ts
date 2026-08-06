// web/src/lib/charts.ts — 唯一 SVG 產生來源（SSG 與 client 共用）。
// spec §4.3：外部資料（label/tooltip）必須 XML escaping；不建立泛用 LineChart。
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
  const max = Math.max(...data.map((d) => d.value), 1);
  const gap = 4;
  const bw = (width - gap * (data.length - 1)) / Math.max(data.length, 1);
  const bars = data
    .map((d, i) => {
      const h = (d.value / max) * (height - 20);
      const x = i * (bw + gap);
      const y = height - h;
      const label = `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(d.label)}</text>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" aria-label="${xmlEscape(d.label)}: ${d.value}">${barTitle(d.label, d.value, opts.formatValue)}</rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function horizontalBarSVG(data: { label: string; value: number }[], opts: BarOpts = {}): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const max = Math.max(...data.map((d) => d.value), 1);
  const rowH = 20;
  const rows = data
    .map((d, i) => {
      const w = (d.value / max) * (width - 70);
      const y = i * rowH;
      const label = `<text x="0" y="${y + 13}" font-size="10" fill="var(--text)">${xmlEscape(d.label)}</text>`;
      const rect = `<rect x="65" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 8}" fill="${color}" aria-label="${xmlEscape(d.label)}: ${d.value}">${barTitle(d.label, d.value, opts.formatValue)}</rect>`;
      const val = `<text x="${(65 + w + 4).toFixed(1)}" y="${y + 13}" font-size="9" fill="var(--muted)">${xmlEscape(opts.formatValue ? opts.formatValue(d.value) : String(d.value))}</text>`;
      return label + rect + val;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${rows}</svg>`;
}

export function distributionBarSVG(buckets: { label: string; count: number }[], opts: BarOpts = {}): string {
  // spec §4.3：分桶分佈用長條圖；count 0 仍輸出 rect（高度 0）。
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const max = Math.max(...buckets.map((b) => b.count), 1);
  const gap = 6;
  const bw = (width - gap * (buckets.length - 1)) / Math.max(buckets.length, 1);
  const bars = buckets
    .map((b, i) => {
      const h = (b.count / max) * (height - 24);
      const x = i * (bw + gap);
      const y = height - h;
      const label = `<text x="${(x + bw / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(b.label)}</text>`;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${color}" aria-label="${xmlEscape(b.label)}: ${b.count}">${barTitle(b.label, b.count)}</rect>${label}`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}

export function scatterSVG(
  points: { x: number; y: number; label: string; tooltip: string }[],
  opts: BarOpts & { xLabel?: string; xMax?: number; yMax?: number } = {},
): string {
  const { color, height, width } = { ...DEFAULTS, ...opts };
  const xMax = opts.xMax ?? Math.max(...points.map((p) => p.x), 1);
  const yMax = opts.yMax ?? Math.max(...points.map((p) => p.y), 1);
  const padL = 30, padB = 20, padT = 8;
  const plotW = width - padL;
  const plotH = height - padT - padB;
  const circles = points
    .map((p) => {
      const cx = padL + (p.x / xMax) * plotW;
      const cy = padT + plotH - (p.y / yMax) * plotH;
      // 單一 <title>（完整 tooltip）；aria-label 帶 label（review #6）
      return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${color}" aria-label="${xmlEscape(p.label)}"><title>${xmlEscape(p.tooltip)}</title></circle>`;
    })
    .join("");
  const xLabel = `<text x="${padL + plotW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="var(--muted)">${xmlEscape(opts.xLabel ?? "")}</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" xmlns="http://www.w3.org/2000/svg">${circles}${xLabel}</svg>`;
}
