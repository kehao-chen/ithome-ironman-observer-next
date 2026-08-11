// 時間顯示格式：統一 ISO 時間戳的顯示（相對時間 / 絕對時間 / 完整 title）。
// 供 SSR（SeriesCard.astro 的 data-ts 初始內容）與 client（Dashboard.astro humanizeAll）
// 共用，兩處渲染格式必須一致。
// 輸入全部為 +08:00 牆鐘 ISO（updatedAt / publishedAt），`new Date(iso)` 由瀏覽器
// 解析為本地時刻；`toLocaleString` 直接輸出本地時區（臺北使用者即 +08:00，與資料牆鐘一致）。

export function tzTime(iso: string) {
  const d = new Date(iso);
  // 資料 ISO 是 +08:00 牆鐘；`toLocaleString` 明確指定 Asia/Taipei，
  // 讓絕對時間在所有時區（含 bun test 的 UTC 環境）都顯示臺北牆鐘。
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
  const abs = d.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });
  const full = d.toLocaleString(undefined, { ...opts, timeZoneName: "short", timeZone: "Asia/Taipei" });
  const diff = (Date.now() - d.getTime()) / 1000;
  let rel: string;
  if (diff < 60) rel = "剛剛";
  else if (diff < 3600) rel = `${Math.floor(diff / 60)} 分鐘前`;
  else if (diff < 86400) rel = `${Math.floor(diff / 3600)} 小時前`;
  else if (diff < 172800) rel = "昨天";
  else rel = abs;
  return { abs, full, rel };
}

// `<time>` 的初始顯示：`YYYY-MM-DD HH:mm`（無秒、無 offset），與 `datetime`/`data-ts` 的 ISO 一致地精確到分鐘。
export function isoInitial(iso: string | null | undefined): string {
  return iso ? iso.replace("T", " ").slice(0, 16) : "";
}
