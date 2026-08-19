# Design: 名人堂（Hall of Fame）

> Status: Approved 2026-08-19（brainstorming 流程）。
> Follows the competition-board design system（`design-system.css`）。
> Scope: 表列少數具公眾知名度的 2026 iThome 鐵人賽作者，附身份介紹、可驗證來源、與其系列文章。

## Problem

iThome 鐵人賽每年都有知名技術人物參賽（如高見龍——Ruby 社群要角、五倍紅寶石創辦人、歷屆研討會講師）。目前 dashboard 把作者當作系列卡片的被動 meta（`user.name` 純文字），讀者無從得知「這個作者是誰、為何值得關注」。`data/2026.json` 已抓取 `series.user = { id, name, profileUrl }`（212 位作者），但**沒有**「知名度」的資訊——名人的身份必須由外部知識建立（研討會議程、社群、開源專案、出版記錄），無法從 ithelp 爬取。

## Goal

新增獨立頁面 `/hall-of-fame/`：表列少數具公眾知名度的作者（初始 3-5 位），每張名人卡含一句話介紹、可驗證的來源連結（身份證明）、與該名人在目前年度的系列文章。目的：辨識價值——「喔，這個人是誰」。零後端、純 client-side join（名單是前端 JSON）、與 teams/insights 同級的獨立頁面。

## Non-Goals

- **不做 scraper 改動**——`user` 欄位已在抓（`scripts/types.ts` 的 `Series.user`），名人堂純 join，`data/` shape 零變動。
- **不做卡片名人標記**（皇冠 icon 等）——名單小、辨識價值在獨立頁，主卡片保持簡潔。
- **不做名人搜尋**——名單 ≤ 十幾人，搜尋無價值（YAGNI）。
- **不收錄無可驗證來源的作者**——「名人」定義由來源連結釘死，不憑記憶收錄、不靠感覺。
- **不做跨年度系列聚合**——系列列表跟隨年度切換器（與 dashboard 一致）；名人身份跨年度一致，但系列列表只顯示目前年度。
- **不改 Insights / Teams / 收藏邏輯 / RSS modal**。

## 1. 資料層（`web/src/data/famous-authors.json` + `web/src/lib/hall-of-fame.ts`）

### 1.1 名人清單（`famous-authors.json`）

Key = ithelp `user.id`（數字，跨年度一致；與收藏分頁同語意）。Value：

```jsonc
{
  "20065770": {
    "name": "高見龍",            // 顯示名（與 user.name 對照，防改名漂移）
    "bio": "五倍紅寶石創辦人、Ruby 社群要角，長期推廣 Ruby / Rails",  // 一句話介紹（為何知名）
    "credentials": [
      { "label": "COSCUP 2019 講師", "url": "https://..." },  // 身份證明 + 來源連結（可多條）
      { "label": "五倍紅寶石", "url": "https://..." }
    ],
    "categories": ["speaker", "community"]   // 命中哪些標準（見 §1.2）
  }
}
```

- `categories` 允許值：`"speaker"`（大型技術研討會講師）/ `"community"`（技術社群核心成員）/ `"oss"`（知名開源專案作者）/ `"book"`（技術書籍作者）。
- 每條 `credentials.url` **必須是 `https://` 或 `http://`**（§3 XSS 白名單），且為可點擊驗證的來源（議程頁 / 講者頁 / 社群頁 / repo / 出版社頁）。
- 初始名單 3-5 位（高見龍必含），擴充另議。

### 1.2 收錄標準（任一符合即可，每條收錄須附可驗證來源連結）

| 類別 | 標準 | 來源形式 |
|---|---|---|
| `speaker` | 大型技術研討會講師（COSCUP / MOPCON / PyCon TW / ModernWeb 等） | 議程頁 / 講者頁 |
| `community` | 技術社群核心成員（Ruby Taiwan / g0v / Taiwan JavaScript 等） | 社群頁 / 組織者名單 |
| `oss` | 知名開源專案作者 / 維護者 | repo（附 star / 採用證據更佳） |
| `book` | 技術書籍作者 | 出版社頁 / 書籍頁 |

### 1.3 Join 函式（`hall-of-fame.ts`，純函式）

```ts
type FamousEntry = {
  name: string;
  bio: string;
  credentials: { label: string; url: string }[];
  categories: FamousCategory[];
};
type FamousSeries = ViewSeries & { user: Series["user"] };  // 或沿用 ViewSeries 既有 shape
type FamousRow = {
  entry: FamousEntry;
  series: Series[];   // 該名人在目前年度的系列（空 → 卡片隱藏，§2.3）
  totalViews: number; // 該名人系列總瀏覽（totalViewsOf 語意）
};

export function loadFamousAuthors(): FamousEntry[];       // 讀 JSON（SSR 靜態 import；client 由 build 注入）
export function matchFamousAuthors(
  entries: FamousEntry[],
  data: YearData,
): FamousRow[];  // user.id ∈ entries → 收集該年度系列；無系列 → 排除
```

- `matchFamousAuthors` 輸入名人清單 + `YearData`，輸出「有系列」的名人列（§2.3：無系列即隱藏，不顯示空卡）。
- 系列 join 鍵 = `series.user.id`（`famous-authors.json` 的 key）。`user.name` 不符（改名）時以 id 為準，但可記錄 warning（defensive）。
- 排序：輸出依 `totalViews` desc（名單小，不需排序器；固定總瀏覽排序即可）。
- 純函式、無 DOM、無副作用——單元測試對象（模式同 `teams.ts` / `filter.ts`）。

## 2. UI 與互動

### 2.1 入口

- 新頁面 `web/src/pages/hall-of-fame.astro`（仿 `teams.astro` / `insights.astro` 模式：SSG frontmatter 載入資料 + 元件）。
- Header 導覽：三頁（`Dashboard.astro` / `Teams.astro` / `Insights.astro`）共用 `header-actions` 的 icon-btn 列（teams / insights / github，目前頁 `is-active`）。名人堂加一支 icon-btn（trophy/star icon，`aria-label="名人堂"`）插在 teams 與 insights 之間，三頁 header 同步加；名人堂頁自身 `is-active`。

### 2.2 頁面內容

名人卡流（grid 或 list，沿用 `design-system.css` tokens，無硬編碼 inline style）。每張卡：

```
[名人名]                          [類別 chips: 講師 / 社群 / OSS / 書籍]
一句話介紹（bio）
┌─ 來源連結 ────────────────────┐
│ ✓ COSCUP 2019 講師        →  │
│ ✓ 五倍紅寶石               →  │
└──────────────────────────────┘
── 2026 系列 ──
[系列卡片 1]（沿用 SeriesCard view-model / card-dom 的渲染欄位）
[系列卡片 2]
```

- 名人名：大字標題 + 該作者 ithelp profile 連結（`user.profileUrl`）。
- 類別 chips：`categories` 對應標籤（speaker→「講師」、community→「社群」、oss→「開源」、book→「書籍」），被動顯示（非 filter）。
- 系列列表：該名人在目前年度的系列卡片，**沿用主卡片同一 view-model**（`card.ts` 的 `cardViewModel` / `card-dom.ts` 的 `renderCard`），欄位一致（title / DAY badge / 瀏覽 / 狀態 chip / 發文時間），零第二套渲染。
- 年度切換：**跟隨年度**（與 dashboard 一致的 year switcher）。名人身份跨年度一致；系列列表依目前年度 join（§2.3 隱藏規則）。

### 2.3 空狀態

- 某年度名人無系列 → **卡片隱藏**（不顯示「今年無系列」空卡）。名單小、年度少，隱藏最簡潔（user 已確認）。
- 整個年度無任何名人系列 → 頁面空狀態：「這個年度沒有名人參賽」（同收藏空狀態風格）。
- 年度切換後重 join；系列列表即時反映。

### 2.4 Client 互動

- 頁面為 SSG 預渲染 + 輕量 client（年度切換需 client，仿 `Dashboard.astro` 的 year-switcher 模式；60s refresh 非必要——名人身份與系列靜態度高，但系列 views 會變。**決策：不做 60s refresh**（名單小、refresh 複雜度 > 價值；用戶刷新頁面即可得最新）。年度切換 client 端重 join。

## 3. XSS 與安全

- 沿用既有契約：**所有使用者/名人資料一律 `textContent` 渲染，禁 `innerHTML`**。
- `credentials[].url` 與 `user.profileUrl` 只放 `href`，且**必須通過 `https?://` 白名單**（`web/src/lib/hall-of-fame.ts` 提供 `isSafeUrl()` 純函式，SSR 與 client 共用；不合規的 url 不渲染連結、只顯示文字）。
- JSON 是 repo 內受信任資料（非外部輸入），但防禦性檢查照做（避免未來引入未驗證來源）。

## 4. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/data/famous-authors.json` | **新增**：名人清單（初始 3-5 位，key = user.id） |
| `web/src/lib/hall-of-fame.ts` | **新增**：`loadFamousAuthors` / `matchFamousAuthors` / `isSafeUrl` / 型別（純函式） |
| `web/src/lib/hall-of-fame.test.ts` | **新增**：單元測試（join / 無系列隱藏 / URL 白名單 / 排序） |
| `web/src/pages/hall-of-fame.astro` | **新增**：頁面（SSG + 年度切換 client） |
| `web/src/lib/card.ts` / `card-dom.ts` | **零改動**（名人系列列表直接沿用 view-model / renderCard） |
| header 導覽（所在檔案確認後） | 加「名人堂」連結 |
| `web/src/styles/design-system.css` | 加名人卡 / 類別 chip / 來源連結列樣式（沿用 token） |
| `README.md` / `PRODUCT.md` | **實作後**同步：Features / roadmap 加名人堂 |

不改：`scripts/`（scraper 零變動）、`data/` shape、`daily-status.ts`、`Dashboard.astro`（除非 header 導覽定義於此）、`.github/workflows/`、Insights / Teams / 收藏。

## 5. 測試策略

### 5.1 單元（`web/src/lib/hall-of-fame.test.ts`，Bun test）

- `matchFamousAuthors`：id 正確 join（高見龍 20065770 → 其系列）；無系列名人 → 排除；系列排序依 totalViews desc。
- `isSafeUrl`：`https://` / `http://` 通過；`javascript:` / 相對路徑 / 空值拒絕。
- JSON 完整性：`famous-authors.json` 每條 entry 有 name / bio / credentials（≥1 條、每條有 label + 合法 url）/ categories（合法值）；name 與 `data/2026.json` 的 `user.name` 相符（防改名斷裂，不符 → 測試失敗、提示更新）。
- 真實資料 sweep（`data/2026.json`）：每個收錄 id 都存在於資料、且至少 1 個系列（防收錄幽靈 id）。

### 5.2 Build / 型別

- `bunx tsc --noEmit` 乾淨；`bun test` 全綠（既有 + 新增）。
- `bun run build` 成功。

### 5.3 手動 headless browser

1. 載入 `/hall-of-fame/`：名人卡出現（高見龍必含）、bio / 類別 chips / 來源連結正確。
2. 來源連結可點擊且為 `https://`（無 `javascript:`）。
3. 系列列表與 dashboard 同欄位（title / DAY badge / 瀏覽 / 狀態 chip / 發文時間）。
4. 年度切換：重 join、無系列名人隱藏、空年度顯示空狀態。
5. 無 console error、無 XSS（檢查 DOM 無 `innerHTML` 注入痕跡）。

## 6. 風險

- **名單維護**：名單是手工 JSON，可能過時（作者改名 / 身份變動）。防禦：測試鎖「id 存在 + name 相符」，改名時測試紅、提示更新 JSON——不會靜默斷裂。
- **收錄爭議**：「誰算名人」由來源連結釘死（§1.2 四類標準），不接受無來源收錄——爭議最小化（user 已確認定義）。
- **XSS**：JSON 是受信任 repo 資料，但仍走 `textContent` + URL 白名單（§3），與全站契約一致。
- **跨年度**：系列列表跟隨年度、名人身份跨年度一致（user.id key）。未來多年度時 join 語意不變。
- **無系列隱藏**：某年度名人沒參賽 → 卡隱藏，可能讓名單「看起來變少」——已確認可接受（user 裁決）。

## 7. 決策記錄

- **名單規模**：初始 3-5 位最確定的人（高見龍必含），擴充另議——先驗證機制，爭議留給日後（user 裁決）。
- **收錄標準**：四類（講師 / 社群核心 / 開源作者 / 書籍作者）+ 可驗證來源連結（user 多選確認）。
- **名單維護層**：前端 JSON（`web/src/data/`）+ client join，不動 scraper / `data/` shape（user 選推薦項）。
- **呈現位置**：獨立頁面 `/hall-of-fame/`（仿 teams / insights，user 選推薦項）。
- **身份對應**：`user.id` 為 key（跨年度一致、防改名；user 選推薦項）。
- **系列列表**：跟隨年度切換（與 dashboard 一致；user 選推薦項）。
- **無系列隱藏**：不顯示「今年無系列」空卡（user 裁決）。
- **不做 60s refresh**：名單小、系列 views 靜態度較高，refresh 複雜度 > 價值；手動刷新即可。
