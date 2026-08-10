// Card view-model: 一張系列卡片的「所有顯示決定」的純函式。
// 供 SSR（SeriesCard.astro）與 client（Dashboard.astro renderCard/renderRow）共用，
// 兩處渲染必須一致（交接文件警告：drift 會造成 SSR/client 顯示不一）。
// 無 DOM、無 window、無 runtime 依賴（僅 daily-status 的純函式）——可單元測試。
import type { Article, Series } from "../../../scripts/types";
import {
  isDeletedSeries,
  statusChip,
  statusChipText,
  statusChipTitle,
  taipeiToday,
  type StatusChip,
} from "./daily-status";

// client compact 資料在 Series 上附加 sumViews（總瀏覽，避免帶全部 articles）；
// SSR 完整資料沒有此欄位 → 由 articles 求和。兩種輸入都支援。
export type ViewSeries = Series & { sumViews?: number };

// 總瀏覽數：sumViews ?? articles 求和（排序器與 view-model 共用）。
export function totalViewsOf(s: ViewSeries): number {
  return typeof s.sumViews === "number" ? s.sumViews : s.articles.reduce((n, a) => n + a.views, 0);
}

export type CardView = {
  badgeClass: string;
  badgeText: string;
  chipClass: string;   // "" = 不顯示 chip
  chipText: string;    // "" = 不顯示 chip
  chipTitle: string | null;
  progressFillClass: string;
  progressPct: number;     // 0–100（clamped，真實 encode dayCount/30）
  progressLabel: string;   // "n/30"
  seriesUrl: string;
  profileUrl: string;
  rssUrl: string;
  totalViews: number;      // sumViews ?? articles 求和
  latest: Article | null;  // 最後一篇文章（無文章 = null）
  emptySlotText: string;   // 無文章時「最新」欄位的文字（尚未開賽 / 報名於… / 文章已全數刪除）
  updatedIso: string | null; // 上次發布時間（latest?.publishedAt）
};

export function chipClassOf(chip: StatusChip): string {
  if (!chip) return "";
  switch (chip.kind) {
    case "today": return "status-chip";
    case "yesterday": return "status-chip status-chip--yesterday";
    case "done": return "status-chip status-chip--done";
    case "deleted": return "status-chip status-chip--deleted";
    case "long-stale": return "status-chip status-chip--long";
    case "stale": return "status-chip status-chip--stale";
  }
}

// signupDate 來源格式「2026/08/01T12:07:01+08:00」（斜線日期）→ 顯示用「2026/08/01」；
// 也接受「2026-08-01…」橫線格式（測試 fixture 用過）——兩種都保留來源分隔符。
// 空字串／格式不符 → null（防缺陷資料）。
export function signupDateText(signupDate: string): string | null {
  const d = signupDate.slice(0, 10);
  return /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(d) ? d : null;
}

// 所有卡片顯示決定集中在此。today 必須由呼叫端傳入：
// SSR 用 build 時點、client 用 runtime（兩者可能不同，各自有校正機制）。
export function cardViewModel(s: ViewSeries, today: string = taipeiToday()): CardView {
  const isDeleted = isDeletedSeries(s.dayCount, s.articleCount);
  const isPending = !isDeleted && s.dayCount === 0;
  const isDone = s.dayCount >= 30;

  // 刪文案例保留歷史進度（他奮鬥到哪天）；狀態由 chip「已刪文」標示，badge 以 danger 色暗示異常。
  const badgeClass = isDeleted ? "day-badge day-badge--deleted"
    : isDone ? "day-badge day-badge--done"
    : isPending ? "day-badge day-badge--pending"
    : "day-badge";
  const badgeText = isDeleted ? `DAY ${s.dayCount}`
    : isPending ? "尚未開賽"
    : isDone ? "完賽"
    : `DAY ${s.dayCount}`;

  const progressFillClass = isDone ? "progress-fill progress-fill--done"
    : isPending ? "progress-fill progress-fill--pending"
    : "progress-fill";
  const progressPct = Math.min((s.dayCount / 30) * 100, 100);
  const progressLabel = `${Math.min(s.dayCount, 30)}/30`;

  const latest = s.articles.length ? s.articles[s.articles.length - 1] : null;
  const chip = statusChip(latest?.publishedAt, s.dayCount, today, s.articleCount);
  const totalViews = totalViewsOf(s);

  // 無文章時「最新」欄位的文字（C2）：尚未開賽系列顯示報名日；已刪文顯示明確狀態。
  const signup = isPending ? signupDateText(s.signupDate) : null;
  const emptySlotText = isDeleted ? "文章已全數刪除"
    : signup ? `報名於 ${signup}`
    : "尚未開賽";

  return {
    badgeClass,
    badgeText,
    chipClass: chipClassOf(chip),
    chipText: statusChipText(chip),
    chipTitle: statusChipTitle(chip),
    progressFillClass,
    progressPct,
    progressLabel,
    seriesUrl: `https://ithelp.ithome.com.tw/users/${s.user.id}/ironman/${s.id}`,
    profileUrl: `https://ithelp.ithome.com.tw/users/${s.user.id}`,
    rssUrl: `https://ithelp.ithome.com.tw/rss/series/${s.id}`,
    totalViews,
    latest,
    emptySlotText,
    updatedIso: latest?.publishedAt ?? null,
  };
}
