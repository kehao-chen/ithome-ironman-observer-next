// worker/src/auth.ts — 純函式，不依賴任何平台型別（Workers / Bun 皆可執行）。
//
// `POST /dispatch` 是特權端點：一次呼叫就會觸發一輪 GitHub Actions 爬蟲。
// 沒有認證的話，任何知道 workers.dev URL 的人都能無限觸發 —— 燒掉 Actions
// 額度、對 ithelp.ithome.com.tw 狂發請求（可能導致來源 IP 被封），並跟排程
// run 搶 `git push`。

/**
 * 定時安全的字串比較。
 *
 * 先把兩邊各自 SHA-256（固定 32 bytes），再逐 byte XOR 累加 —— 這是標準的
 * double-hash 比較法：摘要長度恆定，所以迴圈次數不洩漏原字串長度，逐 byte
 * 累加也不會提早 return 洩漏第幾個 byte 開始不同。
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!;
  return diff === 0;
}

/** 從 `Authorization: Bearer <token>` 取出 token；格式不符回 null。 */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer[ \t]+(.+)$/.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

export type AuthResult = { ok: true } | { ok: false; status: number; message: string };

/**
 * 驗證 `/dispatch` 請求。
 *
 * `expected` 未設定 → 500（fail closed：寧可端點壞掉，也不要變成無認證的
 * 公開觸發器）。空字串同樣視為未設定。
 */
export async function authorizeDispatch(authorizationHeader: string | null, expected: string | undefined): Promise<AuthResult> {
  if (!expected) {
    return { ok: false, status: 500, message: "DISPATCH_SECRET not configured" };
  }
  const presented = bearerToken(authorizationHeader);
  if (presented === null) {
    return { ok: false, status: 401, message: "missing bearer token" };
  }
  if (!(await timingSafeEqual(presented, expected))) {
    return { ok: false, status: 403, message: "forbidden" };
  }
  return { ok: true };
}
