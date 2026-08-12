## 一、專案資訊

- **專案名稱：** 鐵人觀察家 Next
- **專案簡介：**

  這個工具用來看 2026 iThome 鐵人賽的每日動態。它把報名列表、RSS 和系列頁面的資料抓在一起，省去手動在各個頁面切換的時間，可以直接看每支系列寫到第幾天、最新發文與瀏覽數。

  可以切換年度、篩選組別，或是依進度、瀏覽數、最新發文和當篇觀看（今日）排序。目前收錄 2026 年的 180 支系列、17 個組別（2026 年 8 月 12 日抓取）。

- **開發狀態：** 已上線，持續更新中

## 二、必要連結

- **GitHub：** <https://github.com/kehao-chen/ithome-ironman-observer-next>
- **線上網站：** <https://ithome-ironman-observer.happyhacking.ninja/>
- **後備網址：** <https://ironman-observer-next.pages.dev/>

## 三、開發動機

這個專案延續 [qrtt1/ithome-ironman](https://github.com/qrtt1/ithome-ironman) 的「ITHome 鐵人觀察家」概念。原專案停止維護後，我用 Bun + Astro + GitHub Actions + Cloudflare Pages 重新實作了一個版本，讓它可以繼續每天跑。

鐵人賽開始後參賽系列會一直增加。只看官網的文章列表，得自己算每個人寫到第幾天；要確認最新文章或點閱，又要一頁頁點開系列頁。系列一多就很花時間。

我把進度、最新文章、瀏覽數、組別和作者放在同一張卡片上。我自己最常用的是「最新發文」排序，開網站先看今天誰有更新，再瞄一眼誰快完賽或已完賽。

這也是一次低成本 AI 開發實驗。全套爬蟲、前端、測試和 GitHub Actions 部署，是用 Command Code（$1/月）搭配 DeepSeek v4 Flash 完成的。AI 寫 code 很快，但欄位解析、時區計算和零寫入備份邏輯，依然要自己一行行測過。

## 四、技術架構

網站沒有後端與資料庫。由 GitHub Actions 定時執行爬蟲，抓取資料並 commit 成 JSON 檔，再由 Astro 建置為靜態網站部署至 Cloudflare Pages。

```text
iThome 鐵人賽
    │
    │ 報名列表、RSS、系列頁面
    ▼
Cloudflare Worker cron（每 10 分鐘）
    │ 觸發 workflow_dispatch
    ▼
GitHub Actions
    │ Bun + TypeScript
    │ 抓取、解析、合併資料
    ▼
data/{year}.json + data/meta.json
    │ 資料有變更才 commit
    ▼
Astro 靜態建置
    ▼
Cloudflare Pages
```

使用的技術：

- **爬蟲與資料處理：** Bun、TypeScript
- **前端：** Astro 5、原生 TypeScript
- **樣式：** Native CSS、CSS Custom Properties
- **資料：** JSON；每個年度一個資料檔，這裡的 JSON 就是資料庫
- **自動化：** GitHub Actions
- **排程：** Cloudflare Worker Cron
- **部署：** Cloudflare Pages
- **測試：** Bun Test、TypeScript 型別檢查、Astro build

`config/series-manifest.json` 是年度清單的唯一來源。爬蟲照著這份清單逐年處理，輸出 `data/{year}.json` 和 `data/meta.json`。前端年度選單使用 `meta.json` 裡的 `years`；目前清單只有 2026 年，所以網站目前只有這一個年度可以選。

這個網站主要只讀資料，每 10 分鐘更新一次，開後端伺服器或資料庫完全是多餘運算。直接寫進 GitHub 的 JSON，還能當免費的版本變更紀錄。

## 五、網站目前可以做什麼

### 看每個系列寫到哪裡

卡片標示 DAY n / 30 並搭配進度條，長度依 dayCount / 30 等比例計算。

尚未開始的系列顯示「尚未開賽」，完成 30 天的顯示「完賽」。曾發文後來刪掉的系列，保留當時的 DAY 進度，另外標「已刪文」。

### 依組別篩選

頁面上方會列出組別和每組的系列數量。想看 AI、JavaScript 或其他主題時，點一下組別就好，不必在一大串卡片裡慢慢找。

### 依不同目的排序

目前有四種排序：

- **參賽進度：** 看哪些系列走得比較前面
- **最多觀看：** 看文章累計瀏覽數較高的系列
- **最新發文：** 最新發文的系列先出現，同一天再依發布時間排序，沒有文章的系列排在最後
- **當篇觀看（今日）：** 今天有發文的系列依今日文章觀看數排序（同系列多篇時取最高），沒有今日文章的系列依進度排在後面

### 卡片上的資訊

每張卡片放系列標題、作者、組別、團隊、DAY 進度、累計瀏覽數、最新文章和該篇瀏覽數，標題、作者、系列頁、最新文章和 RSS 訂閱都可以直接點。

### 自動更新與錯誤提示

網站雖然是靜態頁面，瀏覽器每 60 秒會重新讀取目前年度的 JSON。使用者不需要一直手動重新整理。

抓取時某一支系列失敗，不會連帶丟掉其他系列。頁面會在狀態列顯示這次有幾支系列失敗，展開後可以看錯誤清單；沒有錯誤時，這個區塊會隱藏。

主題有深色和淺色兩種。預設跟著作業系統設定，也可以手動切換；手動選擇會存在瀏覽器的 `localStorage`。

## 六、資料怎麼抓、怎麼合併

每次抓取一個年度的流程：

1. 從 `config/series-manifest.json` 取得該年度的報名列表網址。
2. 抓完報名列表的所有分頁，取得系列、作者、組別、標題、團隊和報名資料。
3. 讀取每支系列的 RSS，取得文章標題、連結、發布時間和文章清單。
4. 讀取系列頁面，取得文章瀏覽數、Like、留言和訂閱數。
5. 把三邊資料合在一起，轉成前端和爬蟲共用的 `Series` 型別。
6. 計算參賽天數、文章數和最新更新時間。
7. 寫出 `data/{year}.json`，再更新 `data/meta.json`。

解析程式依來源分開放：

- `scripts/parse-signup.ts`：報名列表
- `scripts/parse-rss.ts`：RSS
- `scripts/parse-series.ts`：系列頁面
- `scripts/html-entities.ts`：解碼 HTML entity
- `scripts/scrape.ts`：抓取、重試、合併和寫檔
- `scripts/types.ts`：整個專案共用的資料型別

外部頁面的文字在 parser 階段先處理，例如把 `&amp;` 解成 `&`。前端顯示系列名稱、作者和文章標題時用 `textContent`，不用 `innerHTML`，防止外部文字被當成 HTML 執行或重複跳脫。

## 七、實作時遇到的問題

### 三個來源，三種資料格式

報名列表知道誰參賽、分在哪一組；RSS 知道文章和發布時間；系列頁面才有瀏覽數、Like、留言和訂閱數。沒有一個來源能單獨完成這個網站。

我的做法是各自寫 parser，最後在 `scrape.ts` 合併。這樣 iThome 某一頁改版時，先修對應的 parser 就好，不用把整個抓取流程打掉重寫。

### 一支系列失敗，其他系列還是要留下來

抓 170 支系列時，遇到連線失敗、暫時性 403 或頁面格式改變都很正常。如果任何一支失敗就讓整次程式停止，最後很可能一筆新資料都沒有。

目前的處理方式是：

- 單一請求失敗會重試，等待時間採指數退避
- 單一系列失敗會記錄下來，繼續處理其他系列
- 單一年度失敗不會擋住其他成功年度
- 抓到空資料時保留原本的檔案
- 錯誤會寫入 `scrapeLog`，在網站上提醒使用者

如果所有年度都失敗，程式不會寫入任何新檔案，並以 exit code 1 結束。GitHub Actions 也就不會 commit 或部署，線上網站會繼續使用上一版資料。

### 多個 JSON 不能寫到一半

支援多年度後，一次更新可能會改好幾個檔案。如果第一個檔案已經換掉，第二個檔案卻寫失敗，就會留下不同批次的資料。

因此寫檔分兩階段：先把所有檔案寫到同一個資料夾的 `.tmp` 暫存檔，全部成功後才用 atomic rename 換成正式檔案。正式替換中途若出錯，會用 `.bak` 還原已換掉的檔案，再清理暫存檔。

抓取仍可能出錯，但兩階段寫入確保出錯時舊資料檔完整保留，不會留下寫到一半的破損版本。

### GitHub Actions 的整點排程不夠可靠

一開始使用 GitHub Actions 的 `schedule`，但整點高峰時可能延遲，甚至漏掉觸發。後來改成 Cloudflare Worker 每 10 分鐘呼叫 GitHub Actions 的 `workflow_dispatch`。

Worker 觸發前會先檢查最近一次 workflow 是否還在排隊或執行中。如果上一輪還沒跑完，就跳過這一輪，避免同時抓資料、搶著 push，或對 iThome 發出重複請求。

GitHub Actions 只有在資料真的改變時才 commit、build 和 deploy。沒有變化就停止，省掉不必要的建置和部署。

### 時間要用臺北時間算

「今天有沒有發文」和參賽進度都以臺北時間為準。RSS 日期字串可能帶不同時區，直接把 UTC 數字後面硬接 `+08:00` 不會轉換時間，必須先做時區位移再格式化。

目前會保留 RSS 的原始時區，再用共用函式計算臺北日期。前端同時保留 `<time datetime>` 和可讀文字，瀏覽器端再依使用者的時區顯示時間。

## 八、怎麼自動更新和部署

Cloudflare Worker 的 Cron 每 10 分鐘觸發 `.github/workflows/scheduled-update.yml`：

1. GitHub Actions checkout 專案。
2. 安裝指定版本的 Bun。
3. 執行 `bun run scripts/scrape.ts`。
4. 比對 `data/` 和網站公開資料是否有變化。
5. 有變化就 commit、push、建置 Astro，最後部署到 Cloudflare Pages。
6. 沒有變化就跳過後面的步驟。

一次完整抓取大約會送出 250 個請求。iThome 要求請求帶 Browser User-Agent，否則可能收到 403，所以爬蟲會帶上必要標頭，也會對失敗請求重試。

## 九、開發成本與 AI 實驗

當初的實驗目標很簡單：用最低成本做出一款真正能上線維護的工具。從爬蟲、資料格式、儀表板到 CI/CD 部署全部算在內。

![Command Code usage](https://ithelp.ithome.com.tw/upload/images/20260806/2016828844q0AazYCv.png)

| 項目 | 數值 |
| --- | ---: |
| Total Tokens | 57.5M |
| 執行次數 | 839 runs |
| 費用 | **US$0.04（MVP）** |

以上是 MVP 開發階段的工具費用紀錄。線上網站本身使用 Cloudflare Workers、Pages 和 GitHub 的免費額度維持，網域另計。

AI 可以快速生出腳本，但沒辦法保證業務邏輯正確。包含爬蟲欄位對齊、臺北時區運算、全失敗備份機制與防範 XSS 的 DOM 渲染，都需要人來設定規則與驗證。

## 十、本地執行

安裝根目錄依賴：

```bash
bun install
```

抓取最新資料：

```bash
bun run scripts/scrape.ts
```

啟動前端開發伺服器：

```bash
cd web
bun install
bun run dev
```

執行測試：

```bash
bun test
```

執行型別檢查和正式建置：

```bash
bunx tsc --noEmit
cd web && bun run build
```

本地抓取會連線到 iThome 的公開頁面。如果只是想修改前端，可以直接使用 repository 裡現成的 `data/`，不需要先跑爬蟲。
