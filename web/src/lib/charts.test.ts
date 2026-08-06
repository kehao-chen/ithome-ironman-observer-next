import { describe, expect, test } from "bun:test";
import { xmlEscape, barChartSVG, horizontalBarSVG, distributionBarSVG, scatterSVG } from "./charts";

describe("xmlEscape", () => {
  test("五個特殊字元全替換", () => {
    expect(xmlEscape(`<a & "b" 'c'>`)).toBe(`&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;`);
  });
  test("無特殊字元原樣", () => {
    expect(xmlEscape("普通文字 123")).toBe("普通文字 123");
  });
});

describe("barChartSVG", () => {
  const svg = barChartSVG([{ label: "00 時", value: 5 }, { label: "01 時", value: 3 }]);
  test("SVG 外殼", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });
  test("每 bar 有 rect", () => {
    expect(svg.match(/<rect/g)).toHaveLength(2);
  });
  test("每 bar 有 title 含 label + value", () => {
    expect(svg).toContain("<title>00 時: 5</title>");
    expect(svg).toContain("<title>01 時: 3</title>");
  });
  test("label XML escaping（< 不直接出現）", () => {
    const s = barChartSVG([{ label: "a<b", value: 1 }]);
    expect(s).toContain("a&lt;b");
    expect(s).not.toContain("a<b");
  });
});

describe("horizontalBarSVG", () => {
  test("SVG 外殼 + rect 數量", () => {
    const svg = horizontalBarSVG([{ label: "A", value: 33 }, { label: "B", value: 20 }]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<rect/g)).toHaveLength(2);
  });
  test("資料超過預設高度時自動加高（viewBox 用計算後高度）", () => {
    const svg = horizontalBarSVG(
      Array.from({ length: 10 }, (_, i) => ({ label: `S${i}`, value: 10 - i })),
      { height: 180 },
    );
    // 10 列 × 20 = 200 > 180 → viewBox height 應為 216（200 + 16 底部留白）
    expect(svg).toContain('viewBox="0 0 320 216"');
    expect(svg).toContain('height="216"');
  });
  test("高度夠時維持指定 height", () => {
    const svg = horizontalBarSVG([{ label: "A", value: 33 }], { height: 180 });
    expect(svg).toContain('viewBox="0 0 320 180"');
  });
});

describe("distributionBarSVG", () => {
  test("buckets 數量的 rect", () => {
    const svg = distributionBarSVG([
      { label: "1–9", count: 3 }, { label: "10–99", count: 0 }, { label: "100–999", count: 1 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<rect/g)).toHaveLength(3);
  });
  test("count 0 仍輸出 rect（高度 0）", () => {
    const svg = distributionBarSVG([{ label: "1–9", count: 0 }]);
    expect(svg.match(/<rect/g)).toHaveLength(1);
  });
});

describe("scatterSVG", () => {
  test("points 數量的 circle + title", () => {
    const svg = scatterSVG([
      { x: 1, y: 2, label: "Web", tooltip: "Web: 5 系列" },
      { x: 3, y: 4, label: "AI", tooltip: "AI: 3 系列" },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).toContain("<title>Web: 5 系列</title>");
    expect(svg).toContain("<title>AI: 3 系列</title>");
  });
  test("每個 circle 只有一個 <title>（review #6）", () => {
    const svg = scatterSVG([{ x: 1, y: 2, label: "Web", tooltip: "Web: 5 系列" }]);
    expect(svg.match(/<title>/g)).toHaveLength(1);
  });
});

describe("XML escaping 完整性（review #7）", () => {
  test("attribute context：label 含 quote 不逃逸出 attribute", () => {
    const label = `" onclick="alert(1)`;
    const svg = barChartSVG([{ label, value: 1 }]);
    // attribute 內不得出現未 escaped quote —— 否則可注入新 attribute
    expect(svg).not.toContain(`aria-label="${label}`);
    expect(svg).toContain("&quot;");
    // 產生的 SVG 不含可執行的 onclick attribute（label 內文含 onclick 字樣是無害的）
    expect(svg).not.toContain('onclick="');
  });
  test("title context：tooltip 含 & < > \" ' 全 escaping", () => {
    const svg = scatterSVG([{ x: 1, y: 2, label: "L", tooltip: `& < > " '` }]);
    expect(svg).toContain("<title>&amp; &lt; &gt; &quot; &apos;</title>");
    expect(svg).not.toContain("<title>& < >");
  });
  test("color 也 XML escaping（opts.color 是 API 輸入）", () => {
    const evil = `" onmouseover="alert(1)`;
    const svg = barChartSVG([{ label: "A", value: 1 }], { color: evil });
    expect(svg).toContain(`fill="${xmlEscape(evil)}"`);
    expect(svg).not.toContain(`onmouseover="`);
  });
});

describe("數值輸入邊界（review：NaN/Infinity/負數 normalization）", () => {
  test("barChartSVG：NaN / Infinity / 負數 value → 視為 0（有限非負）", () => {
    const svg = barChartSVG([
      { label: "NaN", value: NaN },
      { label: "Inf", value: Infinity },
      { label: "Neg", value: -5 },
      { label: "Ok", value: 10 },
    ]);
    expect(svg).not.toContain('height="NaN"');
    expect(svg).not.toContain('height="Infinity"');
    // NaN/Inf/-5 → 0 高（height="0.0"）；Ok → 10 高 > 0（max 以正規化後最大值 10 計）
    expect(svg).toContain('height="0.0"');
    expect(svg).toContain('height="160.0"');
  });
  test("horizontalBarSVG：width NaN → 0；負數 label 數值同", () => {
    const svg = horizontalBarSVG([{ label: "A", value: NaN }]);
    expect(svg).not.toContain('width="NaN"');
  });
  test("scatterSVG：x/y NaN → 視為 0（不噴 NaN 到 cx/cy）", () => {
    const svg = scatterSVG([{ x: NaN, y: Infinity, label: "L", tooltip: "T" }]);
    expect(svg).not.toContain('cx="NaN"');
    expect(svg).not.toContain('cy="Infinity"');
  });
  test("尺寸 clamp：width/height 0 → 下限 70/24，無負幾何", () => {
    const svg = barChartSVG([{ label: "A", value: 5 }, { label: "B", value: 3 }], { width: 0, height: 0 });
    expect(svg).toContain('viewBox="0 0 70 24"');
    expect(svg).not.toContain('width="-');
    expect(svg).not.toContain('height="-');
  });
  test("horizontalBarSVG：width 0 → clamp 70（bar width 不為負）", () => {
    const svg = horizontalBarSVG([{ label: "A", value: 5 }], { width: 0 });
    expect(svg).toContain('viewBox="0 0 70 180"');
    expect(svg).not.toContain('width="-');
  });
  test("scatterSVG：width/height 0 → clamp 70/24，cx/cy 有限", () => {
    const svg = scatterSVG([{ x: 1, y: 2, label: "L", tooltip: "T" }], { width: 0, height: 0 });
    expect(svg).toContain('viewBox="0 0 70 24"');
    expect(svg).not.toContain('cx="NaN"');
    expect(svg).not.toContain('cy="NaN"');
  });
  test("窄 width + 多 bar（24 小時）：bw guard 不為負", () => {
    const data = Array.from({ length: 24 }, (_, i) => ({ label: `${i} 時`, value: 1 }));
    const svg = barChartSVG(data, { width: 70 });
    expect(svg).not.toContain('width="-');
  });
});
