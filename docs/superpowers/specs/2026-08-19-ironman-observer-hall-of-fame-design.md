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
    "name": "高見龍",            // 顯示名（與 user.name 對照；不符 → warning 非失敗，§5.1）
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
- 每條 `credentials.url` **必須通過 `isSafeUrl`**（§3，解析後 protocol 檢查），且為可點擊驗證的來源（議程頁 / 講者頁 / 社群頁 / repo / 出版社頁）。
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
type FamousCategory = "speaker" | "community" | "oss" | "book";
type FamousEntry = {
  id: number;               // ithelp user.id（JSON object key 轉 number，join 唯一鍵）
  name: string;             // 顯示名（與 user.name 對照；不符 → warning 非失敗，§5.1C）
  bio: string;
  credentials: { label: string; url: string }[];
  categories: FamousCategory[];
};
type FamousSeries = ViewSeries;  // 沿用 ViewSeries（sumViews/todayMaxViews 語意一致）
type FamousRow = {
  entry: FamousEntry;
  series: FamousSeries[];   // 該名人在目前年度的系列（空 → 卡片隱藏，§2.3）
  totalViews: number;       // 該名人系列總瀏覽（totalViewsOf 語意）
};

export function loadFamousAuthors(): FamousEntry[];   // 讀 JSON，key 轉 number 放入 id
export function matchFamousAuthors(
  entries: FamousEntry[],
  data: YearData,
): FamousRow[];  // entry.id ∈ series.user.id → 收集該年度系列；無系列 → 排除
export function isSafeUrl(url: string): boolean;       // 見 §3
```

- **`id` 是 join 唯一鍵**：`loadFamousAuthors` 把 JSON object key 轉 `number` 放入 `entry.id`——JSON key 不遺失，`matchFamousAuthors` 以 `series.user.id === entry.id` join。
- `matchFamousAuthors` 輸入名人清單 + `YearData`，輸出「有系列」的名人列（§2.3：無系列即隱藏，不顯示空卡）。
- `user.name` 不符（改名）時以 id 為準，記錄 warning（defensive，非失敗——§5.1C）。
- **資料流程（compact/full 一致）**：`matchFamousAuthors` 接受 `ViewSeries[]`（`sumViews`/`todayMaxViews` 可選）。名人堂 client 年度切換沿用 Dashboard 的 compact transformation（`sumViews` + 最新文章 + `todayMaxViews`），與主卡片 views 語意一致；SSR 初始年度輸出完整 Series（無 sumViews → `totalViewsOf` 退回 articles 求和）。兩種輸入結果一致。
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

- 名人名：大字標題 + 該作者 ithelp profile 連結（**統一用 `cardViewModel.profileUrl` 產生的絕對 URL `https://ithelp.ithome.com.tw/users/{id}`**，§3——與系列卡 profile 連結同格式，`user.profileUrl` 不直接作 href）。
- 類別 chips：`categories` 對應標籤（speaker→「講師」、community→「社群」、oss→「開源」、book→「書籍」），被動顯示（非 filter）。
- **系列列表（read-only card）**：該名人在目前年度的系列卡片，**共用 `cardViewModel`（`card.ts`）產生全部顯示決定**（title / DAY badge / 瀏覽 / 狀態 chip / 發文時間 / 最新文章 / profile 連結），**欄位與主卡片契約一致**；但**不復用 `buildCard`/`buildRow`**（它們固定產出收藏星號與 RSS 按鈕，事件處理在 Dashboard 的 client state / RSS modal——名人堂無此 infrastructure，直接復用 = dead controls）。改用新增的 **`buildReadOnlyCard`（`card-dom.ts` 或新 `hall-of-fame-dom.ts`）**：同一 view-model 驅動、同一卡片欄位骨架，但**移除收藏按鈕與 RSS 按鈕**（保留 stat「N 瀏覽」與 profile 連結）。此為單一 renderer，SSR 與 client 共用，非「第二套渲染」——顯示決定仍 100% 來自 `cardViewModel`。
- 年度切換：**跟隨年度**（與 dashboard 一致的 year switcher）。名人身份跨年度一致；系列列表依目前年度 join（§2.3 隱藏規則）。

### 2.3 空狀態

- 某年度名人無系列 → **卡片隱藏**（不顯示「今年無系列」空卡）。名單小、年度少，隱藏最簡潔（user 已確認）。
- 整個年度無任何名人系列 → 頁面空狀態：「這個年度沒有名人參賽」（同收藏空狀態風格）。
- 年度切換後重 join；系列列表即時反映。

### 2.4 SSR 初始畫面與 client render 責任

- **SSR 初始輸出完整卡片**（首載即見，無 JS 也可見）：frontmatter 以 build 時點資料跑 `matchFamousAuthors` + `buildReadOnlyCard`，輸出名人卡 + 系列卡完整 DOM（含 `today` 以 build 時點計算）。
- **client 接管**：掛載後以 runtime `today` 重跑同一 renderer 重新 render（修正 build→load 期間的跨日 / views 變化），並綁年度切換。client 與 SSR 用**同一 `buildReadOnlyCard` renderer**，無第二套 DOM 骨架。
- **today / humanize 差異**：SSR 用 `taipeiToday()`（build 時點）、client 用 runtime `taipeiToday()`——與 Dashboard 同模式（`cardViewModel(s, today)` 接受 today 參數，SSR/client 各自傳入）。跨日由 client 首次 render 自動校正。

## 3. XSS 與安全

- 沿用既有契約：**所有使用者/名人資料一律 `textContent` 渲染，禁 `innerHTML`**。
- **URL 驗證（`isSafeUrl`，SSR 與 client 共用）**：所有外連（`credentials[].url`、名人 profile 連結、`cardViewModel` 產生的 `profileUrl`/`seriesUrl`/`latest.url`/`rssUrl`）一律**解析後檢查 protocol**，非 `startsWith` 字串比對：
  - 通過：`https:` / `http:`
  - 拒絕：`javascript:` / `data:` / `vbscript:`、**protocol-relative**（`//evil.example`）、**case 變體**（`HTTPS://` / `Javascript:`）、**省略斜線**（`https:example.com`）、相對路徑、空值、空白前後綴
  - 實作：`new URL(url)` try/catch，檢查 `parsed.protocol ∈ {"https:","http:"}`（URL parser 天然正規化大小寫與 protocol-relative）。**不含 scheme 的相對路徑（如 `/users/20065770/profile`）在此判定為不安全**——名人 profile 一律用完整 `https://ithelp.ithome.com.tw` 絕對 URL 建構（`cardViewModel` 的 `profileUrl` 同樣以絕對 URL 輸出，兩處格式統一為 `/users/{id}` 絕對路徑）。
- **格式統一**：`cardViewModel.profileUrl`（`/users/{id}`）與 `Series.user.profileUrl`（`/users/{id}/profile`）兩格式並存——**統一為**：名人標題 profile 連結與系列卡 profile 連結都使用 `cardViewModel` 產生的 `/users/{id}` 絕對 URL（`https://ithelp.ithome.com.tw/users/{id}`），`user.profileUrl` 不再直接用作 href（僅作 fallback 資料保留）。避免同頁兩種 URL 格式。
- JSON 是 repo 內受信任資料（非外部輸入），但防禦性檢查照做（避免未來引入未驗證來源）。

## 4. 檔案變更清單

| 檔案 | 變更 |
|---|---|
| `web/src/data/famous-authors.json` | **新增**：名人清單（初始 3-5 位，key = user.id）。**位置 rationale**：名人堂名單是前端專用、非 scraper 產出的 metadata，因此放 `web/src/data/`（Astro static import 進 bundle），**不進入頂層 `data/` 年度資料與 scraper pipeline**（頂層 `data/` 是 scraper 產物，`web/public/data/` 是 build 複製的 runtime 資料——此清單兩者皆非） |
| `web/src/lib/hall-of-fame.ts` | **新增**：`loadFamousAuthors`（JSON key → `entry.id`）/ `matchFamousAuthors`（`entry.id` join）/ `isSafeUrl` / 型別（純函式） |
| `web/src/lib/hall-of-fame.test.ts` | **新增**：單元測試（join / 無系列隱藏 / URL 白名單 / 排序 / JSON 完整性） |
| `web/src/lib/card-dom.ts`（或 `hall-of-fame-dom.ts`） | **新增** `buildReadOnlyCard`：同 `buildCard` 骨架、`cardViewModel` 驅動，**移除 fav + RSS 按鈕**（保留 stat / profile 連結） |
| `web/src/pages/hall-of-fame.astro` | **新增**：頁面（SSR 完整輸出 + client 年度切換重 render，§2.4） |
| `web/src/components/HallOfFame.astro` | **新增**：名人卡區塊元件（仿 Teams.astro / Insights.astro 模式） |
| `web/src/components/Dashboard.astro` | header-actions 加「名人堂」icon-btn |
| `web/src/components/Teams.astro` | header-actions 加「名人堂」icon-btn |
| `web/src/components/Insights.astro` | header-actions 加「名人堂」icon-btn |
| `web/src/styles/design-system.css` | 加名人卡 / 類別 chip / 來源連結列 / read-only 卡片樣式（沿用 token） |
| `README.md` / `PRODUCT.md` | **實作後**同步：Features / roadmap 加名人堂 |

> **Header 導覽**：repo 無共用 header component——markup 分散在 3 個既有元件（Dashboard / Teams / Insights）+ 新 HallOfFame。四頁 icon 順序統一為：`[teams] [名人堂(新)] [insights] [github]`；目前頁 `is-active`（HallOfFame 自身 `is-active`）。icon：trophy/star SVG，`aria-label="名人堂"`、`title="名人堂"`。

不改：`scripts/`（scraper 零變動）、`data/` shape、`daily-status.ts`、`card.ts`（`cardViewModel` 既有）、`.github/workflows/`、Insights / Teams 邏輯、RSS modal、收藏。

## 5. 測試策略

### 5.1 單元（`web/src/lib/hall-of-fame.test.ts`，Bun test）

- `matchFamousAuthors`：`entry.id` 正確 join（高見龍 20065770 → 其系列）；無系列名人 → 排除；系列排序依 `totalViews` desc；compact（`sumViews`）與 full（articles 求和）輸入 `totalViews` 一致。
- `loadFamousAuthors`：JSON key 正確轉 `number` 進 `entry.id`；每條 entry 有 name / bio / credentials（≥1 條、每條有 label + 合法 url）/ categories（合法值）。
- `isSafeUrl` 邊界：`https://` / `http://` 通過；**`HTTPS://` / `Javascript:` / `//evil.example` / `https:example.com` / `data:` / `javascript:` / 相對路徑 / 空值 / 前後空白** 全拒絕（驗證「解析後 protocol」，非 startsWith）。
- JSON 完整性：**id 必須存在於 `data/2026.json`**（防幽靈 id）；**name 不符 → 測試輸出明確 warning**（console.warn + 列出不符者）但**不 fail**（合法改名不該斷 join——review 建議採納，與 §1.1「防改名漂移」改為「偵測改名、提示人工確認」）。<sup>註：若維持「改名必同步 JSON」為 intentional invariant，則此測試應 fail——本 spec 採「warning 不 fail」。</sup>
- 真實資料 sweep（`data/2026.json`）：每個收錄 id 都存在且至少 1 個系列。

### 5.2 DOM 契約（read-only card）

- `buildReadOnlyCard` 結構：卡片骨架與 `buildCard` 一致（badge / chip / progress / title / meta / latest / updated），**且不含 fav 按鈕與 RSS 按鈕**（`querySelector('.card-fav, [data-rss]')` 為 null）；stat「N 瀏覽」保留；profile 連結 href 為絕對 `https://ithelp.ithome.com.tw/users/{id}`。

### 5.3 Build / 型別

- `bunx tsc --noEmit` 乾淨；`bun test` 全綠（既有 + 新增）。
- `bun run build` 成功。

### 5.4 手動 headless browser

1. 載入 `/hall-of-fame/`：名人卡出現（高見龍必含）、bio / 類別 chips / 來源連結正確。
2. 來源連結可點擊且為 `https://`（無 `javascript:` / `//` / 大小寫變體）。
3. **系列卡無收藏 / RSS 按鈕**（dead controls 不存在）；欄位與 dashboard 一致（title / DAY badge / 瀏覽 / 狀態 chip / 發文時間 / profile 連結）。
4. 年度切換：重 join、無系列名人隱藏、空年度顯示空狀態。
5. 無 console error、無 XSS（檢查 DOM 無 `innerHTML` 注入痕跡）。

## 6. 風險

- **名單維護**：名單是手工 JSON，可能過時（作者改名 / 身份變動）。防禦：測試鎖「id 存在於資料」防幽靈 id；name 不符 → warning（§5.1）提示人工確認，不靜默斷裂、不阻擋合法改名。
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
- **read-only 卡片**（spec review 修正）：名人堂系列卡不復用 `buildCard`（會帶無事件的收藏/RSS 按鈕 = dead controls），改用 `buildReadOnlyCard`——同一 `cardViewModel` 驅動、移除 fav/RSS 按鈕。顯示決定仍 100% 來自 view-model，非第二套渲染。
- **`entry.id` 為 join 鍵**（spec review 修正）：`loadFamousAuthors` 把 JSON object key 轉 `number` 存入 `entry.id`——JSON key 不遺失，`matchFamousAuthors` 可 join。
- **URL 解析後驗證**（spec review 修正）：`isSafeUrl` 檢查 `new URL().protocol`，非 `startsWith`——拒絕 case 變體 / protocol-relative / 省略斜線；profile URL 統一為 `cardViewModel` 產生的絕對 URL（消除 `/users/{id}` vs `/users/{id}/profile` 並存）。
- **name 不符 = warning 非失敗**（spec review 修正）：合法改名不該斷 join；測試輸出 warning 提示人工確認。
- **SSR 完整輸出 + client 同一 renderer 重 render**（spec review 補）：首載即見、無第二套 DOM 骨架、跨日由 client 首次 render 校正。
