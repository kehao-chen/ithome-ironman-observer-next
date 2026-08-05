// Daily status: 臺北日曆日為準的「今日發文 / 停更 N 天」判定。
// 供 SSR（SeriesCard.astro）與 client（Dashboard.astro renderCard/renderRow）共用，
// 兩處渲染必須一致（設計 spec: 2026-08-05-ironman-observer-daily-status-design.md）。

// publishedAt 全為 +08:00 牆鐘（RSS parse 保留來源 offset），
// 視 +08:00 為固定 offset，純字串層級取臺北日曆日，不解析時區。
// null（無文章）→ ""，讓空系列在「今日發文」排序中永遠沉底。
export function taipeiDay(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

// 現時刻的臺北日（與 scripts/scrape.ts 的 taipeiTimestamp 同邏輯：先 shift 再取日期）。
export function taipeiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 最新文章臺北日距 today 的天數（今天=0、昨天=1、…）；無法判定回傳 null。
export function stalenessDays(iso: string | null | undefined, today: string): number | null {
  if (!iso) return null; // 無文章
  const day = taipeiDay(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null; // 非臺北日格式（缺陷資料）→ 不判定
  const diff = (Date.parse(today) - Date.parse(day)) / 86_400_000;
  return Number.isFinite(diff) && diff >= 0 ? Math.floor(diff) : null;
}

// 動態狀態 chip：null = 不顯示；"today" = 今日發文；"stale" = 停更。
export type StatusChip = { kind: "today" } | { kind: "stale"; days: number } | null;

export function statusChip(iso: string | null | undefined, dayCount: number, today: string): StatusChip {
  const days = stalenessDays(iso, today);
  if (days === null) return null; // 無文章或缺陷資料
  if (days === 0) return { kind: "today" };
  // 完賽系列：已完成，停更不是異常 → 不顯示停更 chip。
  if (dayCount >= 30) return null;
  // 昨天發文（N=1）是正常節奏 → 不顯示。
  if (days < 2) return null;
  return { kind: "stale", days };
}

export function statusChipText(chip: StatusChip): string {
  if (!chip) return "";
  return chip.kind === "today" ? "今日發文" : `停更 ${chip.days} 天`;
}
