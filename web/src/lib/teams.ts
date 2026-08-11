// web/src/lib/teams.ts
// 團隊計分板資料層：把 iThome 鐵人賽的組團現象聚合為參賽單位（純函式、無 DOM、可單元測試）。
// 警示判定與主卡片共用 daily-status.ts 的 statusChip / stalenessDays——無第二套邏輯。
import { stalenessDays, statusChip, type StatusChip } from "./daily-status";
import { totalViewsOf, type ViewSeries } from "./card";
import type { YearData } from "../../../scripts/types";

export type TeamMemberRow = {
  series: ViewSeries;
  views: number;            // 成員總瀏覽（totalViewsOf 語意）
  status: StatusChip;       // 既有 daily-status 判定（今日/昨日/停更/長時間停更/已刪文/完賽/尚未開賽）
  staleDays: number | null; // 停更天數（stalenessDays：null = 無文章或缺陷日期 → 不落入警示類別）
  isPending: boolean;       // dayCount === 0（尚未開賽）
};

export type TeamRow = {
  name: string;
  members: TeamMemberRow[];
  memberCount: number;
  totalViews: number;
  avgViews: number;         // 總瀏覽 ÷ 人數（無條件捨去，與 plan fixture 一致）
  avgProgress: number;      // 成員 dayCount 平均（cap 30）
  postedToday: number;      // 今日發文成員數
  staleCount: number;       // 停更（≥2 天）成員數
  pendingCount: number;     // 未開賽成員數
  alertSummary: string | null; // 警示摘要（全健康 = null）
  hasAlert: boolean;        // alertSummary !== null
};

export type TeamSortKey = "totalViews" | "avgViews" | "avgProgress" | "postedToday";

export function teamNames(data: YearData): string[] {
  const seen = new Set<string>();
  for (const s of data.series) if (s.team) seen.add(s.team);
  return [...seen];
}

export function aggregateTeams(data: YearData, today: string): TeamRow[] {
  const byName = new Map<string, TeamMemberRow[]>();
  for (const s of data.series) {
    if (!s.team) continue;
    const members = byName.get(s.team) ?? [];
    const latest = s.articles.length ? s.articles[s.articles.length - 1] : null;
    members.push({
      series: s,
      views: totalViewsOf(s),
      status: statusChip(latest?.publishedAt, s.dayCount, today, s.articleCount),
      staleDays: stalenessDays(latest?.publishedAt, today),
      isPending: s.dayCount === 0, // 已刪文（dayCount>0 且 0 篇）天然排除
    });
    byName.set(s.team, members);
  }
  const rows: TeamRow[] = [];
  for (const [name, members] of byName) {
    const memberCount = members.length;
    const totalViews = members.reduce((n, m) => n + m.views, 0);
    let postedToday = 0, staleCount = 0, pendingCount = 0, missedToday = 0;
    // 警示分類互斥（spec §1.3）：未開賽 → 停更（≥2 天）→ 今日缺發（staleDays === 1，昨日有發今日未發）。
    // postedToday（spec §1.1「今日發文成員數」）= staleDays === 0 的成員；今日缺發獨立計數（missedToday）。
    // 任一成員只落入一類。
    for (const m of members) {
      if (m.isPending) { pendingCount++; continue; }
      if (m.staleDays !== null && m.staleDays >= 2) { staleCount++; continue; }
      if (m.staleDays === 0) postedToday++;
      else if (m.staleDays === 1) missedToday++;
    }
    const parts: string[] = [];
    if (missedToday > 0) parts.push(`今日缺發 ${missedToday} 人`);
    if (staleCount > 0) parts.push(`停更 ${staleCount} 人`);
    if (pendingCount > 0) parts.push(`未開賽 ${pendingCount} 人`);
    const alertSummary = parts.length > 0 ? parts.join(" · ") : null;
    rows.push({
      name, members, memberCount,
      totalViews,
      avgViews: Math.floor(totalViews / memberCount),
      avgProgress: members.reduce((n, m) => n + Math.min(m.series.dayCount, 30), 0) / memberCount,
      postedToday, staleCount, pendingCount,
      alertSummary,
      hasAlert: alertSummary !== null,
    });
  }
  return sortTeamRows(rows, "totalViews");
}

export function sortTeamRows(rows: TeamRow[], key: TeamSortKey): TeamRow[] {
  return [...rows].sort((a, b) => {
    const d = b[key] - a[key]; // desc（四鍵皆為數字）
    if (d !== 0) return d;
    return a.name.localeCompare(b.name, "zh-Hant"); // 平手 → 隊名穩定序
  });
}
