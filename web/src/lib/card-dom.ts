// Client 卡片 DOM 建構：renderCard/renderRow 從 Dashboard.astro 抽出，讓結構可以被單元測試。
// 顯示決定一律來自 cardViewModel（與 SeriesCard.astro SSR 共用同一來源）。
// 注意：此處的 DOM 結構（元素順序、class 名稱、data-* 屬性）是 SSR 模板
// web/src/components/SeriesCard.astro 的 mirror——兩邊必須一致，
// 契約由 card-dom.test.ts 鎖住（改一邊就要改另一邊 + 測試）。
// 無 module-load 副作用：icons 每次呼叫新建（不依賴 document 於 import 時存在）。
import type { CardView, ViewSeries } from "./card";
import { cardViewModel } from "./card";

const SVG_NS = "http://www.w3.org/2000/svg";

// Trusted static icons built via DOM APIs (no innerHTML sinks); attributes
// mirror the SSR markup in SeriesCard.astro exactly.
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
function rssIcon(): SVGElement {
  return svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M4 11a9 9 0 0 1 9 9" }),
    svgEl("path", { d: "M4 4a16 16 0 0 1 16 16" }),
    svgEl("circle", { cx: "5", cy: "19", r: "1.5", fill: "currentColor", stroke: "none" }),
  ]);
}
function favIcon(): SVGElement {
  return svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.4l6.1-.9z" }),
  ]);
}
function openIcon(): SVGElement {
  return svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }),
    svgEl("polyline", { points: "15 3 21 3 21 9" }),
    svgEl("line", { x1: "10", y1: "14", x2: "21", y2: "3" }),
  ]);
}

// 動態狀態 chip（view-model 決定 class/text/title；無 chip 時回傳 null）。
export function buildChip(view: CardView): HTMLElement | null {
  if (!view.chipText) return null;
  const el = document.createElement("span");
  el.className = view.chipClass;
  el.textContent = view.chipText;
  if (view.chipTitle) el.title = view.chipTitle;
  return el;
}

// Grid card。isFav = 目前是否已收藏（aria-pressed 與填色狀態）。
// 結構 = SeriesCard.astro 的 mirror：card-head（badge + chip | stat + fav + rss）→ progress → title → meta → latest → updated。
export function buildCard(s: ViewSeries, today: string, isFav: boolean): HTMLElement {
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
  const rss = document.createElement("button");
  rss.className = "card-action"; rss.type = "button";
  rss.dataset.rss = v.rssUrl; rss.dataset.title = s.title;
  rss.setAttribute("aria-label", "RSS 訂閱"); rss.title = "RSS 訂閱";
  rss.appendChild(rssIcon());
  const fav = document.createElement("button");
  fav.className = "card-action card-fav"; fav.type = "button";
  fav.dataset.favId = String(s.id);
  fav.setAttribute("aria-pressed", String(isFav));
  fav.setAttribute("aria-label", isFav ? "取消收藏" : "收藏系列"); fav.title = isFav ? "取消收藏" : "收藏系列";
  fav.appendChild(favIcon());
  // 順序必須與 SeriesCard.astro SSR 相同（stat → fav → rss），否則 SSR→client 重渲染時星號會跳位。
  right.append(stat, fav, rss); head.append(headLeft, right);

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
  const a = document.createElement("a"); a.href = v.seriesUrl; a.target = "_blank"; a.rel = "noopener"; a.textContent = s.title;
  h.appendChild(a);

  const meta = document.createElement("p"); meta.className = "meta";
  const au = document.createElement("a"); au.className = "meta-author"; au.href = v.profileUrl; au.target = "_blank"; au.rel = "noopener"; au.textContent = s.user.name;
  meta.append(au, " · ", s.group, s.team ? ` · 團隊 ${s.team}` : "");

  const lat = document.createElement(v.latest ? "div" : "p"); lat.className = "latest";
  if (v.latest) {
    const la = document.createElement("a"); la.className = "latest-link"; la.href = v.latest.url; la.target = "_blank"; la.rel = "noopener";
    const tag = document.createElement("span"); tag.className = "latest-tag"; tag.textContent = "最新";
    la.append(tag, v.latest.title);
    const lv = document.createElement("span"); lv.className = "latest-views tabular-nums";
    lv.appendChild(eyeIcon());
    lv.appendChild(document.createTextNode(`${v.latest.views.toLocaleString()} 當篇觀看`));
    lat.append(la, lv);
  } else {
    const span = document.createElement("span"); span.className = "latest-link muted"; span.textContent = v.emptySlotText;
    lat.appendChild(span);
  }

  art.append(head, prog, h, meta, lat);
  if (v.updatedIso) {
    const upd = document.createElement("p"); upd.className = "updated"; upd.textContent = "上次發布 ";
    const tm = document.createElement("time"); tm.dateTime = v.updatedIso; tm.dataset.ts = v.updatedIso;
    tm.textContent = v.updatedIso.replace("T", " ").slice(0, 16);
    upd.appendChild(tm); art.appendChild(upd);
  }
  return art;
}

// List row（compact）。結構：row-left（badge + chip）→ row-main（title + meta）→ row-views → row-actions（fav + rss + open）。
export function buildRow(s: ViewSeries, today: string, isFav: boolean): HTMLElement {
  const v = cardViewModel(s, today);
  const row = document.createElement("article");
  row.className = "series-row";
  const day = document.createElement("span");
  day.className = v.badgeClass; day.textContent = v.badgeText;
  const chip = buildChip(v);
  const left = document.createElement("div"); left.className = "row-left";
  left.append(day);
  if (chip) left.append(chip);

  const main = document.createElement("div"); main.className = "row-main";
  const t = document.createElement("a"); t.className = "row-title"; t.href = v.seriesUrl; t.target = "_blank"; t.rel = "noopener"; t.textContent = s.title;
  const m = document.createElement("span"); m.className = "row-meta";
  const au = document.createElement("a"); au.className = "meta-author"; au.href = v.profileUrl; au.target = "_blank"; au.rel = "noopener"; au.textContent = s.user.name;
  m.append(au, " · ", s.group, s.team ? ` · 團隊 ${s.team}` : "");
  main.append(t, m);

  const views = document.createElement("span"); views.className = "row-views tabular-nums";
  views.appendChild(eyeIcon());
  views.appendChild(document.createTextNode(v.totalViews.toLocaleString()));

  const actions = document.createElement("div"); actions.className = "row-actions";
  const rss = document.createElement("button"); rss.className = "card-action"; rss.type = "button";
  rss.dataset.rss = v.rssUrl; rss.dataset.title = s.title; rss.setAttribute("aria-label", "RSS 訂閱"); rss.title = "RSS 訂閱";
  rss.appendChild(rssIcon());
  const open = document.createElement("a"); open.className = "card-action"; open.href = v.seriesUrl; open.target = "_blank"; open.rel = "noopener";
  open.setAttribute("aria-label", "開啟系列"); open.title = "開啟系列"; open.appendChild(openIcon());
  const fav = document.createElement("button");
  fav.className = "card-action card-fav"; fav.type = "button";
  fav.dataset.favId = String(s.id);
  fav.setAttribute("aria-pressed", String(isFav));
  fav.setAttribute("aria-label", isFav ? "取消收藏" : "收藏系列"); fav.title = isFav ? "取消收藏" : "收藏系列";
  fav.appendChild(favIcon());
  actions.append(fav, rss, open);

  row.append(left, main, views, actions);
  return row;
}
