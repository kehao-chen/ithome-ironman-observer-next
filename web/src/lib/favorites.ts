// Favorites: localStorage 收藏（系列 ID 跨年度共用）。
// 可測試函式：storage 以參數注入（StorageLike | null），不直接碰 window.localStorage；
// toggleFavorite 是純函數（回傳新 Set，不 mutation 傳入集合）。

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const KEY = "ironman-observer:favorites";

// 合法收藏 ID：正的 safe integer（排除 NaN / Infinity / 小數 / 負數 / 0 / 非數字）。
export function isValidFavoriteId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

// storage 不可用（null）或 getItem throw → 空集合；JSON 非 array → 空集合（不修復/覆寫）；
// array 內逐項過濾（元素錯誤不拖垮整體）；重複 ID 由 Set 自然去重。
export function loadFavorites(storage: StorageLike | null): Set<number> {
  if (!storage) return new Set();
  let raw: string | null;
  try {
    raw = storage.getItem(KEY);
  } catch {
    return new Set();
  }
  if (raw === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set();
  }
  if (!Array.isArray(parsed)) return new Set();
  const ids = new Set<number>();
  for (const item of parsed) {
    if (typeof item === "number" && isValidFavoriteId(item)) ids.add(item);
  }
  return ids;
}

// storage 不可用（null）或 setItem throw → 靜默 no-op。
// 預期接收由 toggleFavorite／loadFavorites 產生的合法 ID 集合；不負責重新驗證資料。
export function saveFavorites(storage: StorageLike | null, ids: Iterable<number>): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // 靜默降級：星號仍可點，但刷新後不保留。
  }
}

// 純函數：回傳新 Set；非法 id（非正 safe integer）no-op（回傳內容不變的副本）。
export function toggleFavorite(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (!isValidFavoriteId(id)) return next;
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
