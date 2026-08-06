import { describe, expect, test } from "bun:test";
import { normalize } from "./search";

describe("normalize", () => {
  test("全形→半形（字母、數字、空格）", () => {
    expect(normalize("ＶＵＥ")).toBe("vue");
    expect(normalize("２０２６")).toBe("2026");
    expect(normalize("ｖｕｅ 前端")).toBe("vue前端");
  });
  test("大小寫歸一", () => {
    expect(normalize("Vue")).toBe("vue");
    expect(normalize("VUE")).toBe("vue");
  });
  test("前後空白與內部空白移除", () => {
    expect(normalize("  VUE  ")).toBe("vue");
    expect(normalize("V u e")).toBe("vue");
    expect(normalize("vue\t前端")).toBe("vue前端");
  });
  test("繁中原文保留（不轉換）", () => {
    expect(normalize("前端")).toBe("前端");
    expect(normalize("鐵人賽")).toBe("鐵人賽");
  });
  test("全形中文標點收斂成對應半形（U+FF0C → ,）", () => {
    expect(normalize("前端，你好")).toBe("前端,你好");
  });
});
