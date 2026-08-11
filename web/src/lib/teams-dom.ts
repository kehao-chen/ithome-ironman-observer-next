// 團隊計分板榜單列 DOM 建構（client 專用，happy-dom 可測）。
// 顯示決定（警示摘要文字、狀態 chip）來自 teams.ts / daily-status.ts——此處只做骨架。
// 成員狀態 chip 直接複用 card-dom.ts 的 buildChip（view-model 產生 class/text/title）。
import type { TeamMemberRow, TeamRow } from "./teams";
import { cardViewModel } from "./card";
import { buildChip } from "./card-dom";

// Trusted static SVG icons（同 card-dom.ts 模式：無 innerHTML、屬性 mirror）。
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag: string, attrs: Record<string, string>, children: SVGElement[] = []): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.appendChild(c);
  return el;
}
function chevronIcon(): SVGElement {
  return svgEl("svg", { viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M6 9l6 6 6-6" }),
  ]);
}

// 成員列：作者 + 組別·進度 + 瀏覽 + 狀態 chip（buildChip 複用 view-model 判定）。
function buildMemberRow(m: TeamMemberRow, today: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "team-member";
  const v = cardViewModel(m.series, today);
  const name = document.createElement("a");
  name.className = "team-member-name";
  name.href = v.profileUrl;
  name.target = "_blank";
  name.rel = "noopener";
  name.textContent = m.series.user?.name ?? "";
  const meta = document.createElement("span");
  meta.className = "team-member-meta";
  meta.textContent = `${m.series.group ?? ""} · ${v.progressLabel}`;
  const views = document.createElement("span");
  views.className = "team-member-views tabular-nums";
  views.textContent = `${m.views.toLocaleString()} 瀏覽`;
  const chip = buildChip(v);
  row.append(name, meta, views);
  if (chip) row.append(chip);
  return row;
}

export function buildTeamRow(row: TeamRow, today: string): HTMLElement {
  const el = document.createElement("article");
  el.className = "team-row";
  if (row.hasAlert) el.classList.add("team-row--alert");
  el.dataset.teamName = row.name;

  // 列頭：展開 toggle + 團隊名 + 計數
  const head = document.createElement("div");
  head.className = "team-row-head";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "team-expand";
  toggle.dataset.expand = "";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", `展開 ${row.name} 成員`);
  toggle.title = "展開成員";
  toggle.appendChild(chevronIcon());
  const name = document.createElement("span");
  name.className = "team-name";
  name.textContent = row.name;
  const stats = document.createElement("div");
  stats.className = "team-stats";
  const stat = (label: string, value: string) => {
    const s = document.createElement("span");
    s.className = "team-stat";
    const v = document.createElement("span");
    v.className = "tabular-nums";
    v.textContent = value;
    const l = document.createElement("span");
    l.className = "team-stat-label";
    l.textContent = label;
    s.append(v, l);
    return s;
  };
  stats.append(
    stat("成員", String(row.memberCount)),
    stat("總瀏覽", row.totalViews.toLocaleString()),
    stat("人均", row.avgViews.toLocaleString()),
    stat("進度", `${row.avgProgress.toFixed(1)}/30`),
    stat("今日", `${row.postedToday}/${row.memberCount}`),
  );
  head.append(toggle, name, stats);
  if (row.alertSummary) {
    const alert = document.createElement("span");
    alert.className = "team-alert";
    alert.textContent = row.alertSummary;
    head.append(alert);
  }

  // 展開區：成員清單 + 看該隊系列
  const body = document.createElement("div");
  body.className = "team-body";
  body.hidden = true;
  for (const m of row.members) body.appendChild(buildMemberRow(m, today));
  const go = document.createElement("button");
  go.type = "button";
  go.className = "team-go";
  go.dataset.teamName = row.name;
  go.textContent = "看該隊系列 →";
  body.appendChild(go);

  el.append(head, body);
  return el;
}
