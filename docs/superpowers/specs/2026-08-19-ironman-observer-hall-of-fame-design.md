# Design: 名人堂（Hall of Fame）擴充與 UI/UX 升級

> Status: Approved 2026-08-19（brainstorming 流程 & review 反饋收斂）。
> Follows the competition-board design system（`design-system.css`、`DESIGN.md` 單一沉穩藍、無 gradient/glass、無 emoji 作為 icon）。
> Scope:
> 1. 本機掃描 2026 既有資料之 213 位作者，嚴謹調查背景後收錄 8 位具公開可驗證憑證之知名技術人物。
> 2. 升級名人堂 UI/UX：尊榮人物卡片（Hero Profile Card）、頂部快速錨點導覽列（Quick Jump Bar）、純色/微調色調之頭像徽章（Avatar Badge）、當前年度影響力數據與身分標籤勳章。

## Problem

iThome 鐵人賽每年皆有知名技術人物參賽（如社群創辦人、研討會講師、開源專案 PMC、技術專書作者、雲原生與架構實踐者等）。原有名人堂僅有單一作者、排版偏陽春且缺乏快速導覽與視覺層次。讀者需要一目了然地認識各領域技術名人的背景、身份證明與參賽系列，並能在多位名人之間快速切換導覽。

## Goal

1. **擴充名人名單（8 位固定收錄）**：收錄高見龍、廖洧杰、卡斯伯、chia7712、kojenchieh、大魔術熊貓工程師、Oberon Lai、雷N。每位皆附一句話介紹、可公開驗證的身份證明外連、與所屬分類。
2. **頂部快速導覽跳轉列（Quick Jump Bar）**：在頁面頂部提供語意化的 `<nav aria-label="名人快速導覽" class="hof-nav">` 膠囊連結 `<a href="#hof-person-{id}" class="hof-nav-item">`（僅列出當前年度有參賽之名人，含該年度系列數量標籤），點擊使用標準錨點跳轉與平滑滾動（支援 `prefers-reduced-motion` 降級與 `scroll-margin-top` 防遮擋，不實作 sticky 或複雜 observer）。
3. **尊榮名人 Profile 卡片（Hero Profile Card）**：
   - 遵循 `DESIGN.md` 之沉穩色系頭像徽章（Avatar Badge，首字元大寫/中文首字，實色 `var(--surface-muted)` + `var(--accent)`，不使用 gradient/glass）。
   - 結構化身份標籤（講師 / 社群 / 開源 / 書籍），以清晰純文字標籤呈現。
   - 名人數據摘要（**當前年度**個人總瀏覽量 `totalViews`、系列數量）。
   - 引用風格個人簡介（Bio）與可點擊的驗證來源按鈕（Verified Source Badges）。
   - 每張卡片底部提供 `<a class="hof-back-top" href="#hof-top">↑ 回到頂部</a>`。
4. **共享 Profile View-Model 與雙層渲染結構契約**：
   - 抽出純函式 `famousProfileViewModel`，供 SSR（`HallOfFame.astro`）與 Client（`hall-of-fame-dom.ts`）共同消費。
   - 以 Structural Signature 測試（`anchorId`, `classes`, `textFields`, `linkHrefs`, `credentialCount`, `seriesCount`, `backTopHref`）鎖定 SSR 與 Client 結構對齊，而非字串 raw HTML 比對。
   - 系列卡保持 read-only（無收藏/RSS 按鈕，零 dead controls）。
5. **穩健的錯誤處理與空狀態**：
   - 狀態列清楚呈現：「名人堂收錄 8 位 · 2026 年共有 N 位名人參賽」。
   - 年度切換若載入失敗，提供友善之 `aria-live` 提示與重試按鈕 `<button id="hof-retry">`，點擊可重試載入該年度。
   - 44px 最小觸控熱區（`.hof-nav-item`, `.hof-cred-btn`, `.hof-back-top`, `.hof-name .meta-author`）。

## Non-Goals

- **不做 Scraper 爬蟲改動**：名人名單屬於開發時人工調查確認之靜態 metadata（`web/src/data/famous-authors.json`），`data/` shape 零變動。
- **不做全站卡片皇冠標記**：名人堂作為獨立頁面存在，主看板系列卡片保持極簡純粹。
- **不做跨年度系列聚合**：系列列表跟隨年度切換器，名人身份跨年度一致；數據統計口徑為「當前所選年度」。

---

## 1. 資料層（`web/src/data/famous-authors.json` + `web/src/lib/hall-of-fame.ts`）

### 1.1 名人清單（`famous-authors.json`）

Key = ithelp `user.id`（數字字串，join 唯一鍵）：

```json
{
  "20065770": {
    "name": "高見龍",
    "bio": "五倍紅寶石創辦人、Ruby 社群要角，長期推廣 Ruby / Rails 與技術寫作",
    "credentials": [
      { "label": "COSCUP 講師", "url": "https://coscup.org/" },
      { "label": "五倍紅寶石", "url": "https://5xruby.tw/" }
    ],
    "categories": ["speaker", "community"]
  },
  "20040221": {
    "name": "廖洧杰",
    "bio": "六角學院創辦人兼校長、前端教育推廣者，多次擔任 MOPCON / ModernWeb 等研討會講師",
    "credentials": [
      { "label": "六角學院", "url": "https://www.hexschool.com/" },
      { "label": "MOPCON 講師", "url": "https://mopcon.org/" }
    ],
    "categories": ["community", "speaker"]
  },
  "20083608": {
    "name": "卡斯伯",
    "bio": "六角學院核心講師、前端開發與教學者，著有《JavaScript 面試力》，長期推廣 Vue.js 與前端技術",
    "credentials": [
      { "label": "《JavaScript 面試力》作者", "url": "https://www.casper.tw/about" },
      { "label": "六角學院講師", "url": "https://www.hexschool.com/" }
    ],
    "categories": ["book", "community"]
  },
  "20109516": {
    "name": "chia7712",
    "bio": "Apache Software Foundation (ASF) Member，Apache Kafka / Apache HBase / Apache YuniKorn PMC 成員與 Committer，致力於國際開源貢獻與人才培育",
    "credentials": [
      { "label": "Apache Kafka PMC & Committer", "url": "https://kafka.apache.org/community/committers" },
      { "label": "GitHub @chia7712", "url": "https://github.com/chia7712" }
    ],
    "categories": ["oss", "community"]
  },
  "20161809": {
    "name": "kojenchieh",
    "bio": "敏捷三叔公（David Ko / 柯仁傑），Agile Summit 與 DevOpsDays Taipei 共同主辦人，著有《軟體測試修練指南》，專精敏捷開發與測試實務",
    "credentials": [
      { "label": "DevOpsDays Taipei 講師", "url": "https://www.devopsdays.tw/" },
      { "label": "《軟體測試修練指南》作者", "url": "https://webconf.tw/speakers/27" }
    ],
    "categories": ["speaker", "community", "book"]
  },
  "20120030": {
    "name": "大魔術熊貓工程師",
    "bio": "連續多年榮獲 Microsoft AI MVP，專注於 Azure OpenAI、AI Agent 與生成式 AI 應用開發，著有多本生成式 AI 實戰專書",
    "credentials": [
      { "label": "Microsoft AI MVP", "url": "https://mvp.microsoft.com/zh-tw/PublicProfile/5003846?fullName=Ko%20Ko" },
      { "label": "大魔術熊貓工程師 Blog", "url": "https://magic-panda-engineer.github.io/" }
    ],
    "categories": ["speaker", "community", "book"]
  },
  "20133765": {
    "name": "Oberon Lai",
    "bio": "WordPress 專案開發者、外掛作者，WordCamp Taipei 講者，長期經營「WP 開發日常」分享 WordPress / WooCommerce 技術實務與接案心得",
    "credentials": [
      { "label": "WordCamp Taipei 講者", "url": "https://oberonlai.blog/" },
      { "label": "WP 開發日常", "url": "https://oberonlai.blog/" }
    ],
    "categories": ["speaker", "community"]
  },
  "20104930": {
    "name": "雷N",
    "bio": "CloudNative / Infra & DevOps 工程師，長期投入雲原生架構、Kubernetes、Observability 與 AI Agent 系統實踐",
    "credentials": [
      { "label": "GitHub @tedmax100", "url": "https://github.com/tedmax100" },
      { "label": "個人技術網站", "url": "https://tedmax100.github.io/" }
    ],
    "categories": ["community", "oss"]
  }
}
```

### 1.2 View-Model 與 AvatarChar 演算法（`hall-of-fame.ts`）

```ts
export type FamousCategory = "speaker" | "community" | "oss" | "book";

export type FamousEntry = {
  id: number;
  name: string;
  bio: string;
  credentials: { label: string; url: string }[];
  categories: FamousCategory[];
};

export type FamousRow = {
  entry: FamousEntry;
  series: ViewSeries[];
  totalViews: number; // 當前所選年度所有參賽系列之瀏覽量加總
};

export type FamousProfileViewModel = {
  id: number;
  anchorId: string;           // "hof-person-{id}"
  name: string;
  avatarChar: string;         // 首字元處理（trim 後首字元，ASCII 字母大寫，fallback "?"）
  profileUrl: string;         // 絕對路徑 https://ithelp.ithome.com.tw/users/{id}
  bio: string;
  categories: { id: FamousCategory; label: string }[];
  credentials: { label: string; url: string | null }[];
  statsText: string;          // 例如 "38,400 總瀏覽 · 1 系列"
  seriesCount: number;
};

export function getAvatarChar(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const first = trimmed[0];
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

export function famousProfileViewModel(row: FamousRow): FamousProfileViewModel;
export function loadFamousAuthors(): FamousEntry[];
export function matchFamousAuthors(
  entries: FamousEntry[],
  data: YearData & { series: ViewSeries[] },
): FamousRow[];
export function isSafeUrl(url: string): boolean;
```

---

## 2. UI/UX 視覺與互動設計

### 2.1 頁面佈局與導覽架構

```
┌────────────────────────────────────────────────────────┐
│ Header: 鐵人觀察家 Next [名人堂]  [Home][Teams][名人堂][Stats] │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│ 狀態列: ● 資料已更新  名人堂收錄 8 位 · 2026 年共有 8 位參賽 │
└────────────────────────────────────────────────────────┘

┌── 頂部快速導覽跳轉列 (Quick Jump Bar) ─────────────────┐
│ <nav aria-label="名人快速導覽" class="hof-nav">        │
│ [高見龍 1]  [廖洧杰 1]  [卡斯伯 1]  [chia7712 1] ...   │
└────────────────────────────────────────────────────────┘

┌── 名人尊榮卡片 (Hero Profile Card - #hof-person-20065770) ┐
│ ┌────┐  高見龍 ↗                [講師] [社群]          │
│ │ 高 │  38,400 總瀏覽 · 1 系列                         │
│ └────┘                                                 │
│ ❝ 五倍紅寶石創辦人、Ruby 社群要角，長期推廣 Ruby... ❞ │
│                                                        │
│ 認證來源：                                             │
│ [✓ COSCUP 講師 ↗]   [✓ 五倍紅寶石 ↗]                  │
│                                                        │
│ ── 2026 參賽系列 ───────────────────────────────────── │
│ ┌────────────────────────────────────────────────────┐ │
│ │ [DAY 1] [更新中]                   1,234 瀏覽      │ │
│ │ 為你自己手刻 Claude Code                           │ │
│ └────────────────────────────────────────────────────┘ │
│                                      [↑ 回到頂部]      │
└────────────────────────────────────────────────────────┘
```

### 2.2 核心互動與無障礙規格
1. **Quick Jump 導覽列與回頂部錨點**：
   - 頂部導覽列為 `<nav aria-label="名人快速導覽" class="hof-nav">`，每個選項為標準 `<a href="#hof-person-{id}" class="hof-nav-item">`。
   - 主容器標記 `id="hof-top"`，每張卡片底部提供 `<a class="hof-back-top" href="#hof-top">↑ 回到頂部</a>`。
   - 每張人物卡設定 `id="hof-person-{id}"` 與 CSS `scroll-margin-top: calc(var(--space-6) + 40px)`。
   - Quick Jump 不實作 sticky 或 IntersectionObserver，維持乾淨極簡之錨點導航。
2. **設計系統嚴格遵循（DESIGN.md 沉穩藍與非漸層原則）**：
   - **Avatar Badge**：使用 `var(--surface-muted)` 實色背景與 `var(--accent)` 字色，圓角統一為 `var(--radius)`，標註 `aria-hidden="true"`，不使用 gradient 或 glass 效果。
   - **身分標籤（Role Badges）**：統一採用 `design-system.css` 之 chip 樣式（`講師`、`社群`、`開源`、`書籍`），保持乾淨純文字。
   - **認證來源按鈕（Verified Source Badges）**：以微調邊框與外連小圖示標示可點擊性。
3. **響應式與觸控尺寸**：
   - 所有新增互動元素（膠囊連結、外連按鈕、回頂部連結、人物 profile 標題連結）保證最小可點擊熱區為 44 × 44px。
   - 支援超長名稱自動適應與換行。

---

## 3. 測試與契約防護

1. **靜態名單 Exact-Set 鎖定測試 (`hall-of-fame.test.ts`)**：
   - 測試驗證：
     ```ts
     expect(new Set(entries.map((entry) => entry.id))).toEqual(
       new Set([20065770, 20040221, 20083608, 20109516, 20161809, 20120030, 20133765, 20104930])
     );
     expect(entries).toHaveLength(8);
     ```
   - 驗證每位作者均具備非空 bio、至少 1 個 category、至少 1 筆 credential 且所有 URL 均通過 `isSafeUrl`。
2. **雙層渲染結構契約測試 (`hall-of-fame-dom.test.ts`)**：
   - 定義 `extractProfileSignature(root: Element): ProfileStructureSignature` 簽名抽取函式，驗證 SSR 與 Client DOM 輸出的節點契約（classes, anchorId, textFields, linkHrefs, credentialCount, seriesCount, backTopHref）一致。
   - 確保系列卡無任何 dead controls（無收藏與 RSS 按鈕）。
3. **型別與構建驗證**：
   - `bunx tsc --noEmit` 零錯誤。
   - `bun run build` 成功建置。
