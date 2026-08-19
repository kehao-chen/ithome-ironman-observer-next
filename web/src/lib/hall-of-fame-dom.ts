// web/src/lib/hall-of-fame-dom.ts — 名人堂 read-only 系列卡 DOM 建構（client 專用，happy-dom 可測）。
// 顯示決定一律來自 cardViewModel（card.ts），與 SSR 的 HallOfFameSeriesCard.astro 共用同一 view-model；
// 結構（class / 欄位順序 / 無 fav-RSS controls）由 hall-of-fame-dom.test.ts 鎖成契約，防兩層 drift。
// 無 module-load 副作用：呼叫時才需要 document（與 card-dom.ts 同模式）。
import type { ViewSeries } from "./card";
import { cardViewModel } from "./card";
import { buildChip } from "./card-dom";
import { isoInitial } from "./format";
import { safeHref } from "./hall-of-fame";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag: string, attrs: Record<string, string>, children: SVGElement[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}

function eyeIcon(): SVGElement {
  return svgEl("svg", { class: "ico-eye", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M1 12s4-7.5 11-7.5S23 12 23 12s-4 7.5-11 7.5S1 12 1 12z" }),
    svgEl("circle", { cx: "12", cy: "12", r: "3", fill: "currentColor", stroke: "none" }),
  ]);
}

// Grid card（read-only）：與 buildCard 同骨架，但 card-head-right 只保留 stat，
// 無收藏星號（.card-fav）與 RSS 按鈕（[data-rss]）——名人堂無 Dashboard 的 fav/RSS infrastructure。
export function buildReadOnlyCard(s: ViewSeries, today: string): HTMLElement {
  const v = cardViewModel(s, today);
  const art = document.createElement("article");
  art.className = "series-card";
  const head = document.createElement("header");
  head.className = "card-head";
  const day = document.createElement("span");
  day.className = v.badgeClass; day.textContent = v.badgeText;
  const chip = buildChip(v);
  const headLeft = document.createElement("span");
  headLeft.className = "card-head-left";
  headLeft.append(day);
  if (chip) headLeft.append(chip);
  const right = document.createElement("div");
  right.className = "card-head-right";
  const stat = document.createElement("span");
  stat.className = "card-stat tabular-nums";
  stat.textContent = `${v.totalViews.toLocaleString()} 瀏覽`;
  right.appendChild(stat);   // 只保留 stat；無 fav / rss
  head.append(headLeft, right);

  const prog = document.createElement("div"); prog.className = "progress";
  const track = document.createElement("div"); track.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = v.progressFillClass;
  fill.style.width = `${v.progressPct}%`;
  track.appendChild(fill);
  const pl = document.createElement("span");
  pl.className = "progress-label tabular-nums"; pl.textContent = v.progressLabel;
  prog.append(track, pl);

  const h = document.createElement("h2"); h.className = "card-title";
  const href = safeHref(v.seriesUrl);
  if (href) {
    const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = s.title;
    h.appendChild(a);
  } else {
    const span = document.createElement("span"); span.className = "card-title-plain"; span.textContent = s.title;
    h.appendChild(span);
  }

  const meta = document.createElement("p"); meta.className = "meta";
  const auHref = safeHref(v.profileUrl);
  if (auHref) {
    const au = document.createElement("a"); au.className = "meta-author"; au.href = auHref; au.target = "_blank"; au.rel = "noopener"; au.textContent = s.user.name;
    meta.appendChild(au);
  } else {
    const span = document.createElement("span"); span.className = "meta-author"; span.textContent = s.user.name;
    meta.appendChild(span);
  }
  meta.append(" · ", s.group, s.team ? ` · 團隊 ${s.team}` : "");

  const lat = document.createElement(v.latest ? "div" : "p"); lat.className = "latest";
  if (v.latest) {
    const laHref = safeHref(v.latest.url);
    if (laHref) {
      const la = document.createElement("a"); la.className = "latest-link"; la.href = laHref; la.target = "_blank"; la.rel = "noopener";
      const tag = document.createElement("span"); tag.className = "latest-tag"; tag.textContent = "最新";
      la.append(tag, v.latest.title);
      lat.appendChild(la);
    } else {
      const span = document.createElement("span"); span.className = "latest-link muted"; span.textContent = v.latest.title;
      lat.appendChild(span);
    }
    const lv = document.createElement("span"); lv.className = "latest-views tabular-nums";
    lv.appendChild(eyeIcon());
    lv.appendChild(document.createTextNode(`${v.latest.views.toLocaleString()} 當篇觀看`));
    lat.append(lv);
  } else {
    const span = document.createElement("span"); span.className = "latest-link muted"; span.textContent = v.emptySlotText;
    lat.appendChild(span);
  }

  art.append(head, prog, h, meta, lat);
  if (v.updatedIso) {
    const upd = document.createElement("p"); upd.className = "updated"; upd.textContent = "上次發布 ";
    const tm = document.createElement("time"); tm.dateTime = v.updatedIso; tm.dataset.ts = v.updatedIso;
    tm.textContent = isoInitial(v.updatedIso);
    upd.appendChild(tm); art.appendChild(upd);
  }
  return art;
}
