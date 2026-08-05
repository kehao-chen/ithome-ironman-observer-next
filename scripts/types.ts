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
  publishedAt: string; views: number; likes: number; comments: number;
};
export type SeriesStats = {
  dayCount: number; articleCount: number; subscriptions: number;
  articles: Article[];
};
export type Series = {
  id: number; user: { id: number; name: string; profileUrl: string };
  group: string; title: string; description: string; team: string | null;
  signupDate: string; lastUpdated: string | null; // RSS lastBuildDate (spec: 更新時間 card field)
  dayCount: number; articleCount: number; subscriptions: number;
  articles: Article[];
};
export type YearData = { year: number; updatedAt: string; groups: string[]; series: Series[]; scrapeLog: string[] };
export type Manifest = { year: number; signupListUrl: string };
