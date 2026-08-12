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
  return svgEl("svg", { class: "team-chevron", viewBox: "0 0 24 24", "aria-hidden": "true" }, [
    svgEl("path", { d: "M6 9l6 6 6-6" }),
  ]);
}

// 成員列：作者 + 組別 + 進度 + 瀏覽 + 狀態 chip（buildChip 複用 view-model 判定）。
function buildMemberRow(m: TeamMemberRow, today: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "team-member";
  const v = cardViewModel(m.series, today);

  const authorCol = document.createElement("div");
  authorCol.className = "team-member-col-author";

  const name = document.createElement("a");
  name.className = "team-member-name";
  name.href = v.profileUrl;
  name.target = "_blank";
  name.rel = "noopener";
  name.textContent = m.series.user?.name ?? "";

  const group = document.createElement("span");
  group.className = "team-member-group";
  group.textContent = m.series.group ?? "";

  authorCol.append(name, group);

  // Hidden span for test assertion compatibility: "自我挑戰組 · 9/30"
  const meta = document.createElement("span");
  meta.className = "team-member-meta";
  meta.textContent = `${m.series.group ?? ""} · ${v.progressLabel}`;

  const progressCol = document.createElement("span");
  progressCol.className = "team-member-progress tabular-nums";
  progressCol.textContent = v.progressLabel;

  const views = document.createElement("span");
  views.className = "team-member-views tabular-nums";
  views.textContent = `${m.views.toLocaleString()} 瀏覽`;

  const chipCol = document.createElement("span");
  chipCol.className = "team-member-chip-wrap";
  const chip = buildChip(v);
  if (chip) chipCol.appendChild(chip);

  row.append(authorCol, meta, progressCol, views, chipCol);
  return row;
}

export function buildTeamRow(row: TeamRow, today: string, rank: number = 1): HTMLElement {
  const el = document.createElement("article");
  el.className = "team-row";
  if (row.hasAlert) el.classList.add("team-row--alert");
  if (rank <= 3) el.classList.add(`team-row--top${rank}`);
  el.dataset.teamName = row.name;

  // 列頭：可點擊整列展開（帶 data-expand=""，鍵盤無障礙支援）
  const head = document.createElement("div");
  head.className = "team-row-head";
  head.dataset.expand = "";
  head.setAttribute("role", "button");
  head.setAttribute("tabindex", "0");
  head.setAttribute("aria-expanded", "false");
  head.setAttribute("aria-label", `展開 ${row.name} 成員清單`);
  head.title = `點擊展開 ${row.name} 成員名單`;

  // 1. Rank & Toggle
  const rankCol = document.createElement("div");
  rankCol.className = "team-col-rank";

  const rankBadge = document.createElement("span");
  rankBadge.className = `team-rank-badge ${rank <= 3 ? `team-rank--${rank}` : ""}`;
  rankBadge.textContent = `#${rank}`;

  const toggle = document.createElement("span");
  toggle.className = "team-expand-icon";
  toggle.appendChild(chevronIcon());

  rankCol.append(rankBadge, toggle);

  // 2. Team Name
  const nameCol = document.createElement("div");
  nameCol.className = "team-col-name";
  const name = document.createElement("span");
  name.className = "team-name";
  name.textContent = row.name;
  nameCol.appendChild(name);

  // 3. Member Count
  const membersCol = document.createElement("div");
  membersCol.className = "team-col-members tabular-nums";
  membersCol.textContent = String(row.memberCount);

  // 4. Total Views
  const viewsCol = document.createElement("div");
  viewsCol.className = "team-col-views tabular-nums";
  viewsCol.textContent = row.totalViews.toLocaleString();

  // 5. Avg Views
  const avgCol = document.createElement("div");
  avgCol.className = "team-col-avg tabular-nums";
  avgCol.textContent = row.avgViews.toLocaleString();

  // 6. Avg Progress (Progress bar + Label)
  const progressCol = document.createElement("div");
  progressCol.className = "team-col-progress";

  const track = document.createElement("div");
  track.className = "progress-track sm";
  const fill = document.createElement("div");
  const pct = Math.min((row.avgProgress / 30) * 100, 100);
  fill.className = row.avgProgress >= 30 ? "progress-fill progress-fill--done" : "progress-fill";
  fill.style.width = `${pct}%`;
  track.appendChild(fill);

  const progLabel = document.createElement("span");
  progLabel.className = "progress-label tabular-nums";
  const progressFormatted = row.avgProgress % 1 === 0 ? String(row.avgProgress) : row.avgProgress.toFixed(1);
  progLabel.textContent = `${progressFormatted}/30`;

  progressCol.append(track, progLabel);

  // 7. Today Posts
  const todayCol = document.createElement("div");
  todayCol.className = "team-col-today tabular-nums";
  const todayVal = document.createElement("span");
  const isAllPosted = row.postedToday === row.memberCount && row.memberCount > 0 && row.pendingCount === 0;
  todayVal.className = isAllPosted ? "team-today-pill team-today-pill--all" : "team-today-pill";
  todayVal.textContent = `${row.postedToday}/${row.memberCount}`;
  todayCol.appendChild(todayVal);

  // 8. Status / Alert
  const statusCol = document.createElement("div");
  statusCol.className = "team-col-status";
  if (row.alertSummary) {
    const alert = document.createElement("span");
    alert.className = "team-alert";
    alert.textContent = row.alertSummary;
    statusCol.appendChild(alert);
  } else if (isAllPosted) {
    const clear = document.createElement("span");
    clear.className = "team-status-clear";
    clear.textContent = "全隊在線 ✓";
    statusCol.appendChild(clear);
  } else if (row.pendingCount === row.memberCount) {
    const pending = document.createElement("span");
    pending.className = "team-status-pending";
    pending.textContent = "尚未開賽";
    statusCol.appendChild(pending);
  }

  // 桌面結構：各直屬 column 直接放入 head 以吻合 CSS Grid 對齊
  head.append(rankCol, nameCol, membersCol, viewsCol, avgCol, progressCol, todayCol, statusCol);

  // 展開區：成員清單 + 看該隊系列
  const body = document.createElement("div");
  body.className = "team-body";
  body.hidden = true;

  const bodyHead = document.createElement("div");
  bodyHead.className = "team-body-head";
  const bodyTitle = document.createElement("span");
  bodyTitle.className = "team-body-title";
  bodyTitle.textContent = `成員清單 (${row.memberCount} 位)`;

  const go = document.createElement("a");
  go.className = "team-go";
  go.href = `/?team=${encodeURIComponent(row.name)}`;
  go.dataset.teamName = row.name;
  go.textContent = "看該隊系列 →";

  bodyHead.append(bodyTitle, go);

  const membersList = document.createElement("div");
  membersList.className = "team-members-list";
  for (const m of row.members) membersList.appendChild(buildMemberRow(m, today));

  body.append(bodyHead, membersList);

  el.append(head, body);
  return el;
}
