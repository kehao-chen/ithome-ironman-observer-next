# STATUS

Project: ithome-ironman-observer-next

Notebook: .agentflow/devlog.md — root.

Current commit: fa71cd724e41fe01da3dea89fd769d49b658e2a2.

Tests/scenarios: Live fetch via scripts/fetch-html.ts; parseSignupList over all signup pages; raw list-card counts on pages 1, 54, and 55; local data/2026.json summary; gh run list and in_progress check; agf review.

Configuration: ag.json — schema v8; validated for default this round.

Proven: Upstream flipped the signup list to a finisher list (all 534 listed series dayCount>=30) at posting-window close; finishers semantics retains the full 929 roster with inUpstreamList flags; CI green and deployed..
Open: inUpstreamList is recorded but not yet surfaced in the web UI (e.g., a finisher badge or filter could use it)..
Next: Optional UI surfacing of inUpstreamList; otherwise routine monitoring — if upstream ever restores the full roster, flip manifest semantics back to roster..
Artifacts: GitHub Actions run 38674094887; deployed https://ironman-observer-next.happyhacking.workers.dev/data/2026.json.

Archived eras: none.

Streams: none.
---

# → Ask / A-001 (Kehao Chen)

+ 看一下最新 CI 運行情況

---

## [RUN-001] Event — 2026-10-15 08:55:44 +0800 (A-001)

- Latest scheduled-update run 38657479036 on main at commit f7e3471f58684c4c233ac34cf5e5f829a9acffde failed in Scrape (Incremental).

## [RUN-002] Event — 2026-10-15 08:55:44 +0800 (A-001)

- The scraper circuit breaker detected the series count falling from 929 to 534 (-395, 42.5%), above the 2.0% limit; it aborted writes and kept previous data.

## [RUN-003] Event — 2026-10-15 08:55:44 +0800 (A-001)

- Commit, build, and deploy steps were skipped; no GitHub Actions run is currently in progress.

## [RUN-004] Event — 2026-10-15 08:55:44 +0800 (A-001)

- deep-calibrate run 38650757900 failed with the same circuit-breaker condition; the latest five scheduled-update runs failed after the previous successful run 38576667148.

# ← Reply / A-001

* _2026-10-15 08:55:44 +0800 (default/unknown)_

## [SUMMARY]

- 最新 CI 不是通過狀態：`scheduled-update` 在抓取階段因資料序列數大幅下降觸發 circuit breaker，寫入、建置與部署都被跳過；目前沒有執行中的 CI。

## [FINAL REPORT]

1. "看一下最新 CI 運行情況"

   - 最新執行：`scheduled-update` run [38657479036](https://github.com/kehao-chen/ithome-ironman-observer-next/actions/runs/38657479036)，`main`、commit `f7e3471f58684c4c233ac34cf5e5f829a9acffde`，2026-10-15 08:00:27–08:01:24（台灣時間），結果為 **failure**。

   - 失敗步驟：`Scrape (Incremental)`。circuit breaker 偵測到 series count 從 `929` 降到 `534`，減少 `395`（`42.5%`，超過允許的 `2.0%`），因此中止寫入並保留既有資料。

   - 後續 `Commit data if changed`、`Build site`、`Deploy to Cloudflare Workers` 全部 skipped，所以這次沒有產生新部署。

   - 近期趨勢：最近五次 `scheduled-update` 都失敗；上一個成功執行是 [38576667148](https://github.com/kehao-chen/ithome-ironman-observer-next/actions/runs/38576667148)。`deep-calibrate` run [38650757900](https://github.com/kehao-chen/ithome-ironman-observer-next/actions/runs/38650757900) 也因同一個 circuit breaker 失敗。

   - 目前沒有 `in_progress` 的 GitHub Actions。下一步應先查明來源資料為何少了約 42.5%，再重跑更新；直接放寬 2.0% 閾值會掩蓋資料異常。

## Questions (batched — each with a suggested default)

- None.


---

# → Ask / A-002 (Kehao Chen)

+ 繼續？

---

## [RUN-001] Event — 2026-10-15 09:03:26 +0800 (A-002)

- Live fetch of the upstream signup list followed 54 pages: pages 1–53 had 10 cards each and page 54 had 4, for 534 parsed cards; page 55 was empty.

## [RUN-002] Event — 2026-10-15 09:03:26 +0800 (A-002)

- The raw HTML card count matched parseSignupList on the sampled pages, so the 534 result is not parser loss. The same upstream HTML still displays 報名數 929.

## [RUN-003] Event — 2026-10-15 09:03:26 +0800 (A-002)

- Existing data/2026.json contains 929 series and data/meta.json was last updated 2026-09-30; the source list and stored data are therefore inconsistent.

## [RUN-004] Event — 2026-10-15 09:03:26 +0800 (A-002)

- The latest GitHub Actions run is still 38657479036 failure and no run is in progress; no rerun or code change was made.

# ← Reply / A-002

* _2026-10-15 09:03:26 +0800 (default/unknown)_

## [SUMMARY]

- 查到根因方向：上游報名列表目前實際只提供 `534` 個 `list-card`，但頁面仍顯示「報名數 929」；scraper 解析結果與原始 HTML 一致，不是本地 parser 漏資料。circuit breaker 阻止寫入是正確的保護行為，本輪沒有重跑 CI 或修改程式。

## [FINAL REPORT]

1. "繼續？"

   - 我直接重現了上游 [報名列表](https://ithelp.ithome.com.tw/2026ironman/signup/list)：共 54 頁，page 1–53 各 10 筆、page 54 有 4 筆，合計 **534 筆**；page 55 沒有資料。

   - 同一份 HTML 的頁面標示仍是「報名數 **929**」。抽樣頁面的原始 `<div class="list-card">` 數量與 `parseSignupList` 結果相同，因此目前證據指向 **上游列表內容與上游總數欄位不一致**，不是 scraper 把 929 筆漏解析成 534 筆。

   - 本地 `data/2026.json` 仍有 929 個 series，`data/meta.json` 的最後更新時間是 2026-09-30；CI 的 `929 → 534` circuit breaker 正是偵測到這個上游落差，並保留舊資料、阻止 commit/build/deploy。

   - 最新 CI 沒有變化：`scheduled-update` run [38657479036](https://github.com/kehao-chen/ithome-ironman-observer-next/actions/runs/38657479036) 仍為 failure，沒有 `in_progress` 執行。

   - 結論：目前不應直接放寬 2.0% 閾值或強制重跑；那會把上游列表縮減當成正常資料寫入。安全選項是等待上游列表恢復，或另行確認 iThome 是否有包含完整 929 筆的替代 endpoint/查詢條件後，再改 scraper。

   - 本輪未修改產品程式、資料檔或 CI 設定。

## Questions (batched — each with a suggested default)

- None.


---

# → Ask / A-003 (Kehao Chen)

+
 請協助處理

---

## [RUN-001] Event — 2026-10-15 11:05:00 +0800 (A-003)

- Root cause confirmed with the fresh 10-14 cache (local clone had been stale at 9/30): all 534 currently listed series have dayCount>=30 — the upstream signup list became a FINISHER list (完賽名單) when the posting window closed; 7 dayCount=30 finishers are additionally absent with their series pages returning 403 (self-deleted or DQ).

## [RUN-002] Event — 2026-10-15 11:05:00 +0800 (A-003)

- Implemented Manifest.signupListSemantics ("roster" default | "finishers") + Series.inUpstreamList flag; finishers mode retains absent roster series with inUpstreamList=false so the 929-series roster never shrinks with upstream curation, while page-1-empty and stale/failed guards still catch outages. 2026 manifest switched to finishers.

## [RUN-003] Event — 2026-10-15 11:05:00 +0800 (A-003)

- Verified: 21 scrape-cli tests (2 new) + full `bun run check` green; live scrape on top of the 10-14 cache → 929/534/395 flags, article totals preserved; pushed and dispatched CI run 38674094887 → all steps success incl. deploy; deployed /data/2026.json serves 929 series with 534 flagged.

# ← Reply / A-003

* _2026-10-15 11:05:00 +0800 (default/unknown)_

## [SUMMARY]

- 證實使用者假設：上游報名列表已切成完賽名單（534 筆全部 dayCount≥30）。新增 finishers 語意保留完整 929 名冊並以 inUpstreamList 標記上游完賽名單；CI 已全綠並部署。

## [FINAL REPORT]

1. "請協助處理"

   - 根因（修正先前以過期本地資料的誤判）：抓遠端 10-14 最新快取交叉比對後，上游列表 534 筆**全部 dayCount≥30** —— 貼文期於 10-14 深夜結束後，上游在 10-15 00:00 將報名列表換成完賽名單。另有 7 筆 dayCount=30 完賽者不在名單且系列頁 403（自刪或 DQ）。使用者「僅顯示完賽名單」的假設完全正確。

   - 修正（commit `3e7fd706`）：`Manifest.signupListSemantics`（`roster` 預設／`finishers`）+ `Series.inUpstreamList`。finishers 模式下名冊中缺席者保留既有資料並標 `false`，名單內標 `true`；斷路器比較保留後總數不再誤觸，名單整頁掛掉仍由 page-1 零卡與 stale/failed 防護把關。`config/series-manifest.json` 2026 切為 `finishers`。

   - 驗證：21 tests（含 2 新測試）與 `bun run check` 全綠；本地真實抓取輸出 929（534 true / 395 false / 0 null），文章總數僅反映賽後新增；CI run [38674094887](https://github.com/kehao-chen/ithome-ironman-observer-next/actions/runs/38674094887) 全步驟成功並部署，線上 `/data/2026.json` 已供新資料。

   - 資料語意：`inUpstreamList=true` = 上游完賽名單成員（官方認定），`=false` = 名冊保留但不在上游名單（395 筆，含 7 筆已 403 的完賽者）。文件已更新（DEPLOYMENT-HANDOFF.md、my-project.md）。

## Questions (batched — each with a suggested default)

- None.
