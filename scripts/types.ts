// scripts/types.ts
export type SignupCard = {
  seriesId: number; userId: number; name: string;
  group: string; title: string; description: string;
  team: string | null; signupDate: string; day: number;
};

export type RssItem = { title: string; link: string; pubDate: string; description: string };
export type RssChannel = {
  title: string; link: string; description: string;
  lastBuildDate: string | null; items: RssItem[];
};

export type Article = {
  id: number; day: number; title: string; url: string;
  publishedAt: string; views?: number; likes?: number; comments?: number;
};
export type SeriesStats = {
  dayCount: number; articleCount: number; subscriptions?: number;
  articles: Article[];
};
export type Series = {
  id: number; user: { id: number; name: string; profileUrl: string };
  group: string; title: string; description: string; team: string | null;
  signupDate: string; lastUpdated: string | null; // RSS lastBuildDate (spec: 更新時間 card field)
  dayCount: number; articleCount: number; subscriptions?: number;
  articles: Article[];
  rssFallback?: boolean;
  inUpstreamList?: boolean; // 上游報名列表是否仍列出（finishers 語意：賽後列表僅列完賽/達標者，見 Manifest.signupListSemantics）
};
export type YearData = { year: number; updatedAt: string; groups: string[]; series: Series[]; scrapeLog: string[] };
export type Manifest = {
  year: number; signupListUrl: string;
  // roster（預設）：報名列表 = 完整名冊，系列消失視為資料異常（circuit breaker 防護）。
  // finishers：賽後上游把報名列表換成完賽/達標名單（2026-10-15 起 929→534），
  // 名單僅代表「上游仍列出」；缺席者保留既有資料並標 inUpstreamList=false。
  signupListSemantics?: "roster" | "finishers";
};
export type MetaJson = {
  latestYear: number;   // years[0]（成功年度 desc 的第一個 = 最新）
  years: number[];      // 成功寫檔年度 desc 排序 —— UI 年度選項的唯一權威來源
  updatedAt: string;    // latestYear 年度資料的 updatedAt
  seriesCount: number;  // latestYear 年度資料的 seriesCount
};

export type SeriesResult =
  | { status: "fresh"; series: Series; warnings?: string[] }
  | { status: "stale"; series: Series; error: string }
  | { status: "failed"; seriesId: number; error: string };

export type OfficialDayCountResult = {
  dayCount: number;
  warning?: string;
};
