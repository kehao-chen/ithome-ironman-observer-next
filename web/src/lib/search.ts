// web/src/lib/search.ts — 純函數、無 DOM、無 window、無 runtime 依賴。

// 全形 ASCII 對應區段（U+FF01–U+FF5E）收斂成半形；U+FF5E（～）→ ~。
// 全形中文標點（如「，」）不在 ASCII 區段，維持原樣。
function fullToHalf(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
}

export function normalize(s: string): string {
  return fullToHalf(s.normalize("NFC").toLowerCase()).replace(/\s/g, "");
}
