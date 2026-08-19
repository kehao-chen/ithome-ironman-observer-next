// scripts/parse-article.ts

// 文章頁（/articles/<id>）的官方參賽天數徽章：
//   <div class="ir-article__days">
//     <div class="ir-article__days-word">DAY <span class="ir-article__days-num">12</span></div>
//   </div>
// 數字 = 這篇文章發佈時的官方「參賽天數」＝連續發文天數（streak）。大量補發
// 不會增加 streak：帶刺哥（9128）08-04~08-15 連發 12 天、08-16 斷賽、08-17
// 一口氣補 18 篇到第 30 篇，徽章仍凍結在 12（與系列頁標頭「參賽天數 12 天」
// 一致）。因此「系列最新一篇文章」的徽章 = 系列當前官方參賽天數 —— 判定
// 完賽（≥30）與進度的權威值，勝過系列頁標頭（可能落後）與標題 Day N（作者
// 自填，會超前 streak）。無徽章（非鐵人文章/錯誤頁/0）→ null。
export function parseArticleDay(html: string): number | null {
  const n = Number(html.match(/ir-article__days-num">\s*(\d+)\s*</)?.[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
