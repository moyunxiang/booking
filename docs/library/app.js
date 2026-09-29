"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hrs = (m) => (m % 60 ? (m / 60).toFixed(1) : m / 60) + "";
const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

// 区域：按房间名前缀分组，每组一个色相
const ZONES = [
  { id: "1F", name: "1/F", sub: "Group", h: 32, area: 3, test: (n) => /^1-/.test(n) },
  { id: "LG1", name: "LG1", sub: "Group", h: 205, area: 3, test: (n) => n.startsWith("LG1") },
  { id: "LG3", name: "LG3", sub: "Group", h: 150, area: 3, test: (n) => n.startsWith("LG3") },
  { id: "LG4", name: "LG4", sub: "Group", h: 275, area: 3, test: (n) => n.startsWith("LG4") },
  { id: "LG5", name: "LG5", sub: "Group", h: 340, area: 3, test: (n) => n.startsWith("LG5") },
  { id: "G", name: "其他", sub: "Group", h: 60, area: 3, test: () => true },
  { id: "LC", name: "LC", sub: "Learning Commons", h: 12, area: 8, test: () => true },
  { id: "POD", name: "Pods", sub: "Study Pods", h: 180, area: 20, test: () => true },
];
const AREA_SHORT = { 3: "Group Rooms", 8: "LC Rooms", 20: "Study Pods" };
const BLOCKS = [8, 10, 12, 14, 16, 18, 20, 22];  // 两小时时段的起点（小时）
const CAPS = [0, 4, 6, 8, 10];

const hkNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
};
const dayLabel = (d, today) => {
  const wd = WD[new Date(d + "T12:00:00+08:00").getUTCDay()];
  const diff = Math.round((new Date(d) - new Date(today)) / 864e5);
  return diff === 0 ? "今天" : diff === 1 ? "明天" : `${+d.slice(5, 7)}/${+d.slice(8)} ${wd}`;
};

const q = new URLSearchParams(location.search);
const state = {
  index: null, day: null, rooms: [],
  date: q.get("date"), blk: q.has("b") ? +q.get("b") : null,  // null = 自动（今天取当前时段）
  cap: +q.get("p") || 0, area: +q.get("a") || 3, nowTab: +q.get("n") || 0,
};

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// ——— 数据模型 ———
function buildRooms(day) {
  const rooms = [];
  for (const a of day.areas) {
    const open = toMin(a.open), close = toMin(a.close);
    const by = new Map(a.rooms.map((r) => [r.id, []]));
    for (const b of a.bookings) by.get(b.room_id)?.push({ s: toMin(b.start), e: toMin(b.end), st: b.status });
    for (const r of a.rooms) {
      const zone = ZONES.find((z) => z.area === a.area && z.test(r.name))
        || { id: "A" + a.area, name: a.area_name, sub: "", h: 90, area: a.area };
      const bks = by.get(r.id).sort((x, y) => x.s - y.s);
      let eo = open, ec = close;  // 实际开放时间：去掉开头/结尾的不可预约段（周末、假期）
      for (const b of bks) if (b.st === "unbookable" && b.s <= eo && b.e > eo) eo = b.e;
      for (const b of [...bks].reverse()) if (b.st === "unbookable" && b.e >= ec && b.s < ec) ec = b.s;
      rooms.push({ ...r, area: a.area, zone, open, close, eo, ec, closed: eo >= ec, bks });
    }
  }
  return rooms;
}
const isFree = (r, s, e) => s >= r.open && e <= r.close && !r.bks.some((b) => b.s < e && b.e > s);
const freeUntil = (r, s) => Math.min(r.close, ...r.bks.filter((b) => b.s >= s).map((b) => b.s));
function freeBlocks(r, from) {
  const out = []; let t = Math.max(from, r.open);
  for (const b of r.bks) {
    if (b.e <= t) continue;
    if (b.s > t) out.push([t, b.s]);
    t = Math.max(t, b.e);
  }
  if (t < r.close) out.push([t, r.close]);
  return out;
}

// ——— 当前选择 ———
const floor30 = (m) => Math.floor(m / 30) * 30;
function autoBlk(now, isToday) {
  if (!isToday) return 10;
  // 当前时段剩余不到 1 小时就看下一段（「现在有空」已经覆盖眼前）
  const cur = BLOCKS.filter((b) => b * 60 <= now.min).pop() ?? BLOCKS[0];
  const next = BLOCKS[BLOCKS.indexOf(cur) + 1];
  return (cur + 2) * 60 - now.min < 60 && next != null ? next : cur;
}
function ctx() {
  const now = hkNow();
  const isToday = state.date === now.date;
  const blk = state.blk ?? autoBlk(now, isToday);
  const S = blk * 60, E = S + 120;
  // 今天的当前时段：只看剩下的部分
  const S0 = isToday && now.min > S && now.min < E ? now.min : S;
  return { now, isToday, blk, S, E, S0 };
}
const capOK = (r) => !state.cap || (r.capacity ?? 0) >= state.cap;
const zonesOf = (rooms) => [...new Set(rooms.map((r) => r.zone))]
  .sort((a, b) => ZONES.indexOf(a) - ZONES.indexOf(b));

function setURL() {
  const p = new URLSearchParams({ date: state.date });
  if (state.blk != null) p.set("b", state.blk);
  if (state.cap) p.set("p", state.cap);
  if (state.area !== 3) p.set("a", state.area);
  if (state.nowTab) p.set("n", state.nowTab);
  history.replaceState(null, "", "?" + p);
}

// ——— 渲染 ———
function renderMast() {
  const { now } = ctx();
  const d = state.date;
  $("#wd").textContent = `${+d.slice(5, 7)}月${+d.slice(8)}日 ${WD[new Date(d + "T12:00:00+08:00").getUTCDay()]}`;
  const f = new Date(state.day?.fetched_at || state.index.updated_at);
  const ageMin = Math.round((Date.now() - f) / 6e4);
  const age = ageMin < 60 ? `${ageMin} 分钟前` : ageMin < 1440 ? `${Math.floor(ageMin / 60)} 小时前` : `${Math.floor(ageMin / 1440)} 天前`;
  const hk = f.toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#fresh").innerHTML = `数据更新 <b>${hk}</b><br>${age}`;
  $("#foot-upd").textContent = `${state.index.dates.length} 天数据`;
  $("#alert").innerHTML = state.date === now.date && ageMin > 90
    ? `<div class="alert"><b>数据可能过时</b>：已 ${age}更新，实际空闲情况以官网为准。</div>` : "";
}

const roomChip = (r, text, cls = "") =>
  `<span class="room ${cls}" title="${esc(r.name)}"><b>${esc(r.name)}</b><span>${r.capacity ?? "?"}人 · ${text}</span></span>`;

// 现在 / 下一个 30 分钟：按楼层列出所有空房
function renderNow() {
  const { now, isToday } = ctx();
  $("#now-sec").hidden = !isToday;
  if (!isToday) return;
  const cut = floor30(now.min) + 30;
  // 现在 + 之后 7 个 30 分钟（约 4 小时，不跨过午夜）
  const slots = [[now.min, cut, `现在–${fmt(cut)}`]];
  for (let t = cut; slots.length < 8 && t < 1440; t += 30) slots.push([t, t + 30, `${fmt(t)}–${fmt(t + 30)}`]);
  if (state.nowTab >= slots.length) state.nowTab = 0;
  const c = $("#c-now"), keep = c.scrollLeft;
  c.innerHTML = slots.map(([s, e, lbl], i) => {
    const n = state.rooms.filter((r) => isFree(r, s, e)).length;
    return `<button data-v="${i}" class="${i === state.nowTab ? "on" : ""}">${lbl} <span class="n">${n}</span></button>`;
  }).join("");
  c.scrollLeft = keep;
  const [s, e] = slots[state.nowTab];
  $("#nowlist").innerHTML = zonesOf(state.rooms).map((z) => {
    const rs = state.rooms.filter((r) => r.zone === z);
    const free = rs.filter((r) => isFree(r, s, e));
    const shut = rs.every((r) => r.closed || s < r.eo || e > r.ec);
    const body = free.length
      ? `<div class="rlist">${free.map((r) => roomChip(r, `至 ${fmt(freeUntil(r, s))}`, freeUntil(r, s) - s >= 120 ? "long" : "")).join("")}</div>`
      : `<div class="none">${shut ? "不开放" : "没有空房"}</div>`;
    return `<div class="nrow hue ${free.length ? "" : "empty-row"}" style="--h:${z.h}">
      <div class="zl">${esc(z.name)}<small>${free.length} / ${rs.length} 间</small></div>${body}</div>`;
  }).join("");
}

function renderControls() {
  const { now, blk } = ctx();
  $("#c-date").innerHTML = state.index.dates.filter((d) => d >= now.date).map((d) =>
    `<button data-v="${d}" class="${d === state.date ? "on" : ""}">${dayLabel(d, now.date)}${(state.index.closed?.[d] || []).includes(3) ? ` <span class="cl">闭</span>` : ""}</button>`).join("");
  $("#c-blk").innerHTML = BLOCKS.map((b) =>
    `<button data-v="${b}" class="${b === blk ? "on" : ""}">${String(b).padStart(2, "0")}–${String(b + 2).padStart(2, "0")}</button>`).join("");
  $("#c-cap").innerHTML = CAPS.map((c) => `<button data-v="${c}" class="${c === state.cap ? "on" : ""}">${c ? "≥ " + c + " 人" : "不限"}</button>`).join("");
  $("#c-area").innerHTML = [3, 8, 20].filter((a) => state.rooms.some((r) => r.area === a)).map((a) =>
    `<button data-v="${a}" class="${a === state.area ? "on" : ""}">${AREA_SHORT[a]}</button>`).join("");
  for (const sel of ["#c-date", "#c-blk"]) {
    const c = $(sel), on = c.querySelector(".on");
    if (on) c.scrollLeft = on.offsetLeft - c.offsetLeft - 40;
  }
}

// 某个时段内：整段空 / 部分空（列出空的区间，至少 30 分钟）
function blockStatus(r, S, E) {
  // 截到实际开放时间：21:30 关门时 20–22 空到 21:30 也算整段空
  const s = Math.max(S, r.eo), e = Math.min(E, r.ec);
  if (e - s >= 30 && isFree(r, s, e)) return { full: true };
  const parts = freeBlocks(r, S).filter(([a]) => a < E).map(([a, b]) => [a, Math.min(b, E)]).filter(([a, b]) => b - a >= 30);
  return { full: false, parts };
}

function renderZones() {
  const { S, E, S0, blk } = ctx();
  $("#find-sub").textContent = S0 > S ? `剩余 ${fmt(S0)}–${fmt(E)}` : `${fmt(S)}–${fmt(E)}`;
  $("#zones").innerHTML = zonesOf(state.rooms.filter(capOK)).map((z) => {
    const rs = state.rooms.filter((r) => r.zone === z && capOK(r));
    const act = rs.filter((r) => !r.closed);
    const head = (cnt) => `<div class="top"><span class="zn">${esc(z.name)}<small>${esc(z.sub)}</small></span><span class="cnt">${cnt}</span></div>`;
    if (!act.length)
      return `<div class="zcard hue none" style="--h:${z.h}">${head("<b>闭</b>")}<div class="next">当天不开放</div></div>`;
    const eo = Math.min(...act.map((r) => r.eo)), ec = Math.max(...act.map((r) => r.ec));
    if (E <= eo || S0 >= ec)
      return `<div class="zcard hue none" style="--h:${z.h}">${head("<b>—</b>")}<div class="next">此时段不开放（当天 ${fmt(eo)}–${fmt(ec)}）</div></div>`;
    const st = act.map((r) => ({ r, ...blockStatus(r, S0, E) }));
    const full = st.filter((x) => x.full), part = st.filter((x) => !x.full && x.parts.length);
    let body = "";
    if (full.length) body += `<div class="sub">整段空</div><div class="rlist">${full.map(({ r }) =>
      roomChip(r, `至 ${fmt(freeUntil(r, S0))}`, freeUntil(r, S0) - S0 >= 180 ? "long" : "")).join("")}</div>`;
    if (part.length) body += `<div class="sub">部分空</div><div class="rlist">${part.map(({ r, parts }) =>
      roomChip(r, parts.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join("，"), "part")).join("")}</div>`;
    if (!body) {
      const nb = BLOCKS.find((b) => b > blk && act.some((r) => isFree(r, b * 60, b * 60 + 120)));
      const n = nb != null ? act.filter((r) => isFree(r, nb * 60, nb * 60 + 120)).length : 0;
      body = `<div class="next">这个时段全满${nb != null ? `；<em>${nb}–${nb + 2}</em> 有 ${n} 间整段空` : ""}</div>`;
    }
    return `<div class="zcard hue ${full.length ? "" : "none"}" style="--h:${z.h}">
      ${head(`<b>${full.length}</b>整段 · ${part.length} 部分 / ${act.length} 间`)}${body}</div>`;
  }).join("");
}

function renderLong() {
  const { S0 } = ctx();
  const MIN = 120;
  const list = [];
  for (const r of state.rooms.filter(capOK)) {
    for (const [a, b] of freeBlocks(r, S0)) if (b - a >= MIN) list.push({ r, a, b });
  }
  list.sort((x, y) => (y.b - y.a) - (x.b - x.a) || x.a - y.a);
  $("#long-sub").textContent = `${fmt(S0)} 之后，连续 ≥ ${MIN / 60} 小时`;
  $("#long").innerHTML = list.slice(0, 12).map(({ r, a, b }) =>
    `<li class="hue" style="--h:${r.zone.h}"><span class="bar"></span>
      <div><div class="t">${esc(r.name)}<small>${esc(r.zone.name)} · ${r.capacity ?? "?"}人</small></div>
      <div class="m">${fmt(a)} – ${fmt(b)}</div></div>
      <div class="d">${hrs(b - a)}<small>h</small></div></li>`).join("")
    || `<li class="empty">没有连续 ${MIN / 60} 小时以上的空档</li>`;
}

function renderTimeline() {
  const { now, isToday, S, E } = ctx();
  const rs = state.rooms.filter((r) => r.area === state.area);
  if (!rs.length) { $("#tl").innerHTML = `<div class="empty">没有数据</div>`; return; }
  const open = Math.min(...rs.map((r) => r.open)), close = Math.max(...rs.map((r) => r.close)), span = close - open;
  const pct = (m) => ((Math.min(Math.max(m, open), close) - open) / span * 100).toFixed(3) + "%";
  const ticks = [];
  for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) ticks.push(m);
  const tickHTML = (lbl) => ticks.map((m) => `<div class="tick" style="left:${pct(m)}">${lbl ? `<span>${m / 60}</span>` : ""}</div>`).join("");
  const nowHTML = isToday && now.min >= open && now.min < close ? `<div class="nowline" style="left:${pct(now.min)}"></div>` : "";
  const win = E > open && S < close ? `<div class="winband" style="left:${pct(S)};width:calc(${pct(E)} - ${pct(S)})"></div>` : "";
  let html = `<div class="tr axis"><div class="lab"></div><div class="trk">${tickHTML(true)}</div></div>`;
  let zone = null;
  for (const r of rs) {
    if (r.zone !== zone) {
      zone = r.zone;
      html += `<div class="tr zh hue" style="--h:${zone.h}"><div class="lab">${esc(zone.name)}</div><div class="trk">${tickHTML(false)}</div></div>`;
    }
    const bks = r.bks.map((b) => `<div class="bk ${b.st}" style="left:${pct(b.s)};width:calc(${((b.e - b.s) / span * 100).toFixed(3)}% - 2px)"
      title="${esc(r.name)} ${fmt(b.s)}–${fmt(b.e)}${b.st === "unbookable" ? " 不可预约" : ""}">${fmt(b.s)}–${fmt(b.e)}</div>`).join("");
    const freeMin = freeBlocks(r, r.open).reduce((s, [a, b]) => s + b - a, 0);
    html += `<div class="tr hue" style="--h:${r.zone.h}"><div class="lab" title="${esc(r.name)}">${esc(r.name)}<small>${r.capacity ?? "?"}人 · 空 ${hrs(freeMin)}h</small></div>
      <div class="trk">${tickHTML(false)}${win}${bks}${nowHTML}</div></div>`;
  }
  $("#tl").innerHTML = `<div class="tl" style="min-width:${112 + span / 60 * 46}px">${html}</div>`;
  const g = $("#tl"), anchor = g.querySelector(".nowline") || g.querySelector(".winband");
  if (anchor) g.scrollLeft = Math.max(0, anchor.offsetLeft - (g.clientWidth - 112) / 3);
}

function renderAll() {
  setURL(); renderMast(); renderNow(); renderControls(); renderZones(); renderLong(); renderTimeline();
}

async function loadDay() {
  state.day = await getJSON(`data/${state.date}.json`);
  state.rooms = buildRooms(state.day);
  renderAll();
}

function bind() {
  const on = (sel, fn) => $(sel).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (b) fn(b.dataset.v);
  });
  on("#c-now", (v) => { state.nowTab = +v; setURL(); renderNow(); });
  on("#c-date", (v) => { state.date = v; loadDay(); });
  on("#c-blk", (v) => { state.blk = +v; renderAll(); });
  on("#c-cap", (v) => { state.cap = +v; renderAll(); });
  on("#c-area", (v) => { state.area = +v; setURL(); renderControls(); renderTimeline(); });
}

async function init() {
  state.index = await getJSON("data/index.json");
  const today = hkNow().date, dates = state.index.dates;
  if (!dates.includes(state.date)) state.date = dates.includes(today) ? today : dates[dates.length - 1];
  bind();
  await loadDay();
  setInterval(() => { renderMast(); renderNow(); if (state.blk == null) { renderControls(); renderZones(); renderLong(); } }, 60_000);
}

init().catch((e) => { $("#zones").innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; });
