import { describe, expect, test } from "bun:test";
import { loadFavorites, saveFavorites, toggleFavorite, type StorageLike } from "./favorites";

// In-memory StorageLike stub.
function makeStub(init?: string | null): { storage: StorageLike; get: () => string | null } {
  let value: string | null = init ?? null;
  return {
    storage: {
      getItem: () => value,
      setItem: (_k: string, v: string) => { value = v; },
    },
    get: () => value,
  };
}

const throwingStub = (method: "getItem" | "setItem"): StorageLike => ({
  getItem: method === "getItem" ? () => { throw new Error("denied"); } : () => null,
  setItem: method === "setItem" ? () => { throw new Error("quota"); } : () => {},
});

describe("toggleFavorite", () => {
  test("加 / 減 / 再加往返", () => {
    let s = new Set<number>();
    s = toggleFavorite(s, 101);
    expect([...s]).toEqual([101]);
    s = toggleFavorite(s, 101);
    expect(s.size).toBe(0);
    s = toggleFavorite(s, 101);
    expect([...s]).toEqual([101]);
  });
  test("移除已存在的 id", () => {
    const s = new Set([101, 999]);
    expect([...toggleFavorite(s, 999)]).toEqual([101]);
  });
  test("不 mutation 原 Set（純函數）", () => {
    const s = new Set([101]);
    toggleFavorite(s, 202);
    expect([...s]).toEqual([101]);
    const out = toggleFavorite(s, 202);
    expect(out).not.toBe(s);
    expect([...out]).toEqual([101, 202]);
  });
  test("非法 id（0/負數/NaN/小數/Infinity）no-op", () => {
    for (const bad of [0, -5, NaN, 1.5, Infinity]) {
      const s = new Set([101]);
      const out = toggleFavorite(s, bad);
      expect([...out]).toEqual([101]);
      expect(out).not.toBe(s);
    }
  });
});

describe("loadFavorites", () => {
  test("storage 為 null → 空集合、不 throw", () => {
    expect(loadFavorites(null).size).toBe(0);
  });
  test("getItem throw → 空集合、不 throw", () => {
    expect(loadFavorites(throwingStub("getItem")).size).toBe(0);
  });
  test("key 不存在 → 空集合", () => {
    expect(loadFavorites(makeStub(null).storage).size).toBe(0);
  });
  test("JSON 解析失敗（malformed / NaN / Infinity）→ 空集合", () => {
    for (const raw of ["{{{", "[NaN]", "[Infinity]"]) {
      expect(loadFavorites(makeStub(raw).storage).size).toBe(0);
    }
  });
  test("合法 JSON 但不是 array → 空集合", () => {
    for (const raw of ["42", "null", "{}", '"str"']) {
      expect(loadFavorites(makeStub(raw).storage).size).toBe(0);
    }
  });
  test("array 內混入 null/字串/小數/負數 → 逐項過濾", () => {
    const s = loadFavorites(makeStub('[1, "2", null, 3, 4.5, -6]').storage);
    expect([...s].sort()).toEqual([1, 3]);
  });
  test("duplicate IDs 去重", () => {
    const s = loadFavorites(makeStub("[1, 1, 2, 2, 1]").storage);
    expect([...s].sort()).toEqual([1, 2]);
  });
  test("解析失敗不覆寫 localStorage（setItem 未被呼叫）", () => {
    let setCalls = 0;
    const storage: StorageLike = { getItem: () => "{{{", setItem: () => { setCalls++; } };
    loadFavorites(storage);
    expect(setCalls).toBe(0);
  });
});

describe("saveFavorites", () => {
  test("round-trip：save 後 load 得原集合", () => {
    const { storage, get } = makeStub();
    saveFavorites(storage, new Set([101, 202]));
    expect(JSON.parse(get()!)).toEqual([101, 202]);
    expect([...loadFavorites(storage)].sort()).toEqual([101, 202]);
  });
  test("storage 為 null → no-op、不 throw", () => {
    expect(() => saveFavorites(null, new Set([101]))).not.toThrow();
  });
  test("setItem throw → 不拋錯（靜默）", () => {
    expect(() => saveFavorites(throwingStub("setItem"), new Set([101]))).not.toThrow();
  });
});
