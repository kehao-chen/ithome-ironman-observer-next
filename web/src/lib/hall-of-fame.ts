// web/src/lib/hall-of-fame.ts — 名人堂資料層（純函式、無 DOM、無副作用、可單元測試）。
// 名人身份資料來自 web/src/data/famous-authors.json（key = ithelp user.id），
// 與 YearData.series.user.id join —— scraper / data/ shape 零變動。
// URL 安全：所有外連一律過 isSafeUrl（嚴格前置檢查 + parser protocol 驗證）。
import type { YearData } from "../../../scripts/types";
import { totalViewsOf, type ViewSeries } from "./card";
import famousAuthors from "../data/famous-authors.json";

export type FamousCategory = "speaker" | "community" | "oss" | "book";
export type FamousEntry = {
  id: number;               // ithelp user.id（JSON object key 轉 number，join 唯一鍵）
  name: string;
  bio: string;
  credentials: { label: string; url: string }[];
  categories: FamousCategory[];
};
export type FamousSeries = ViewSeries;
export type FamousRow = {
  entry: FamousEntry;
  series: FamousSeries[];
  totalViews: number;
};

export function getAvatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = [...trimmed][0] ?? "?";
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

export type FamousProfileViewModel = {
  id: number;
  anchorId: string;
  name: string;
  avatarChar: string;
  profileUrl: string;
  bio: string;
  categories: { id: FamousCategory; label: string }[];
  credentials: { label: string; url: string | null }[];
  statsText: string;
  seriesCount: number;
};

const CATEGORY_LABELS: Record<FamousCategory, string> = {
  speaker: "講師",
  community: "社群",
  oss: "開源",
  book: "書籍",
};

export function famousProfileViewModel(row: FamousRow): FamousProfileViewModel {
  const name = row.entry.name.trim();
  const avatarChar = getAvatarChar(name);
  const profileUrl = `https://ithelp.ithome.com.tw/users/${row.entry.id}`;
  const seriesCount = row.series.length;
  const statsText = `${row.totalViews.toLocaleString()} 總瀏覽 · ${seriesCount} 系列`;

  return {
    id: row.entry.id,
    anchorId: `hof-person-${row.entry.id}`,
    name,
    avatarChar,
    profileUrl,
    bio: row.entry.bio,
    categories: row.entry.categories.map((c) => ({
      id: c,
      label: CATEGORY_LABELS[c] ?? c,
    })),
    credentials: row.entry.credentials.map((c) => ({
      label: c.label,
      url: safeHref(c.url),
    })),
    statsText,
    seriesCount,
  };
}

// URL 驗證：strict 前置檢查 + 解析後 protocol 驗證。
// new URL() 會正規化大寫 scheme / 省略斜線 / 前後空白，單靠 parser 無法拒絕這些案例。
export function isSafeUrl(url: string): boolean {
  if (typeof url !== "string" || url.trim() !== url) return false;   // 拒絕前後空白
  if (!/^https?:\/\//i.test(url)) return false;                       // 必須 https:// 或 http:// 開頭（scheme 大小寫接受）
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;   // 拒絕 protocol-relative（無 base 即 throw）與 malformed
  }
}

// renderer 共用：不合法 URL → null（不產生 href，改純文字）。
export function safeHref(url: string): string | null {
  return isSafeUrl(url) ? url : null;
}

// 讀 JSON 名單，object key（string）轉 number 進 entry.id。
export function loadFamousAuthors(): FamousEntry[] {
  const raw = famousAuthors as Record<string, Omit<FamousEntry, "id">>;
  return Object.entries(raw).map(([key, v]) => ({ id: Number(key), ...v }));
}

// 依 entry.id join 年度系列；無系列 → 排除；依 totalViews desc 排序。
// 輸入含 ViewSeries[]（完整 SSR Series 或 client compact ViewSeries 皆可），
// totalViews 由 totalViewsOf 決定（sumViews ?? articles 求和）——兩者語意一致。
export function matchFamousAuthors(
  entries: FamousEntry[],
  data: YearData & { series: ViewSeries[] },
): FamousRow[] {
  return entries
    .map((entry) => {
      const series = data.series.filter((s) => s.user.id === entry.id);
      if (series.length === 0) return null;   // 該年度無系列 → 隱藏
      const totalViews = series.reduce((n, s) => n + totalViewsOf(s), 0);
      return { entry, series, totalViews };
    })
    .filter((r): r is FamousRow => r !== null)
    .sort((a, b) => b.totalViews - a.totalViews);
}
