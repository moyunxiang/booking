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
const DURS = [30, 60, 90, 120, 180, 240];
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
  date: q.get("date"), start: q.get("t") || "now",
  dur: +q.get("d") || 60, cap: +q.get("p") || 0, area: +q.get("a") || 3,
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
function ctx() {
  const now = hkNow();
  const isToday = state.date === now.date;
  let S;
  if (state.start === "now") S = isToday ? now.min : 600;
  else S = toMin(state.start);
  return { now, isToday, S, E: S + state.dur, useNow: state.start === "now" && isToday };
}
const capOK = (r) => !state.cap || (r.capacity ?? 0) >= state.cap;

function setURL() {
  const p = new URLSearchParams({ date: state.date, t: state.start, d: state.dur, p: state.cap, a: state.area });
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

function renderControls() {
  const { now, isToday } = ctx();
  $("#c-date").innerHTML = state.index.dates.filter((d) => d >= now.date).map((d) =>
    `<button data-v="${d}" class="${d === state.date ? "on" : ""}">${dayLabel(d, now.date)}${(state.index.closed?.[d] || []).includes(3) ? ` <span class="cl">闭</span>` : ""}</button>`).join("");
  const open = Math.min(...state.rooms.map((r) => r.open)), close = Math.max(...state.rooms.map((r) => r.close));
  const opts = [];
  if (isToday) opts.push(`<option value="now">现在</option>`);
  for (let m = open; m < close; m += 30) if (!isToday || m + 30 > now.min) opts.push(`<option value="${fmt(m)}">${fmt(m)}</option>`);
  const val = state.start === "now" && !isToday ? "10:00" : state.start;
  $("#c-start").innerHTML = `<select id="s-start" class="on" aria-label="开始时间">${opts.join("")}</select>`
    + (isToday && state.start !== "now" ? `<button data-v="now">回到现在</button>` : "");
  $("#s-start").value = val;
  $("#c-dur").innerHTML = DURS.map((d) => `<button data-v="${d}" class="${d === state.dur ? "on" : ""}">${d < 60 ? d + " 分钟" : hrs(d) + " 小时"}</button>`).join("");
  $("#c-cap").innerHTML = CAPS.map((c) => `<button data-v="${c}" class="${c === state.cap ? "on" : ""}">${c ? "≥ " + c + " 人" : "不限"}</button>`).join("");
  $("#c-area").innerHTML = [3, 8, 20].filter((a) => state.rooms.some((r) => r.area === a)).map((a) =>
    `<button data-v="${a}" class="${a === state.area ? "on" : ""}">${AREA_SHORT[a]}</button>`).join("");
  $("#c-date .on")?.scrollIntoView({ inline: "nearest", block: "nearest" });
}

function renderStats() {
  const { S, E, useNow } = ctx();
  const when = `${useNow ? "现在起" : fmt(S) + " 起"} ${state.dur < 60 ? state.dur + " 分钟" : hrs(state.dur) + " 小时"}`;
  const cells = [3, 8, 20].map((a) => {
    const rs = state.rooms.filter((r) => r.area === a && capOK(r));
    const n = rs.filter((r) => isFree(r, S, E)).length;
    if (rs.length && rs.every((r) => r.closed))
      return `<div class="stat"><div class="k">${AREA_SHORT[a]}</div><div class="v zero">闭<small>当天不开放</small></div><div class="s">&nbsp;</div></div>`;
    const act = rs.filter((r) => !r.closed);
    const hours = act.length ? `${fmt(Math.min(...act.map((r) => r.eo)))}–${fmt(Math.max(...act.map((r) => r.ec)))}` : "";
    return `<div class="stat"><div class="k">${AREA_SHORT[a]}${hours && hours !== "00:00–24:00" ? ` · ${hours}` : ""}</div>
      <div class="v ${n ? "" : "zero"}">${n}<small>/ ${rs.length} 间空</small></div><div class="s">${when}</div></div>`;
  });
  // 占用率：只算开放时段内的真实预约
  const act = state.rooms.filter((r) => !r.closed);
  const span = act.reduce((s, r) => s + r.ec - r.eo, 0);
  const used = act.reduce((s, r) => s + r.bks.filter((b) => b.st !== "unbookable")
    .reduce((t, b) => t + Math.max(0, Math.min(b.e, r.ec) - Math.max(b.s, r.eo)), 0), 0);
  const nb = state.rooms.reduce((s, r) => s + r.bks.filter((b) => b.st !== "unbookable").length, 0);
  cells.push(`<div class="stat"><div class="k">全天占用率</div><div class="v">${span ? Math.round(used / span * 100) : 0}<small>%</small></div>
    <div class="s">共 ${nb} 条预约</div></div>`);
  $("#stats").innerHTML = cells.join("");
}

function renderZones() {
  const { S, E, useNow } = ctx();
  $("#find-sub").textContent = `${useNow ? "现在" : fmt(S)} – ${fmt(E)} 全程空闲`;
  const zones = [];
  for (const z of [...ZONES, ...new Set(state.rooms.map((r) => r.zone))]) {
    if (zones.includes(z)) continue;
    const rs = state.rooms.filter((r) => r.zone === z && capOK(r));
    if (rs.length) zones.push(z);
  }
  $("#zones").innerHTML = zones.map((z) => {
    const rs = state.rooms.filter((r) => r.zone === z && capOK(r));
    const free = rs.filter((r) => isFree(r, S, E)).map((r) => ({ r, until: freeUntil(r, S) }));
    const closed = rs.every((r) => r.closed);
    let body;
    if (closed) body = `<div class="next">当天不开放</div>`;
    else if (free.length) {
      body = `<div class="rlist">${free.map(({ r, until }) =>
        `<span class="room ${until - S >= 180 ? "long" : ""}" title="${esc(r.name)}"><b>${esc(r.name)}</b><span>${r.capacity ?? "?"}人 · 至 ${fmt(until)}</span></span>`).join("")}</div>`;
    } else {
      const act = rs.filter((r) => !r.closed);
      const open = Math.min(...act.map((r) => r.eo)), close = Math.max(...act.map((r) => r.ec));
      let msg = "";
      for (let t = Math.max(open, Math.ceil((S + 1) / 30) * 30); t + state.dur <= close; t += 30) {
        const ok = rs.filter((r) => isFree(r, t, t + state.dur));
        if (ok.length) { msg = `最早 <em>${fmt(t)}</em> 起：${ok.slice(0, 4).map((r) => esc(r.name)).join("、")}${ok.length > 4 ? ` 等 ${ok.length} 间` : ""}`; break; }
      }
      msg ||= E > close ? `当天开放 ${fmt(open)}–${fmt(close)}，所选时段已超出` : "当天没有这么长的空档了";
      body = `<div class="next">${msg}</div>`;
    }
    return `<div class="zcard hue ${free.length ? "" : "none"}" style="--h:${z.h}">
      <div class="top"><span class="zn">${esc(z.name)}<small>${esc(z.sub)}</small></span>
      <span class="cnt">${closed ? "<b>闭</b>" : `<b>${free.length}</b>/ ${rs.length} 间`}</span></div>${body}</div>`;
  }).join("");
}

function renderLong() {
  const { S, useNow } = ctx();
  const MIN = 120;
  const list = [];
  for (const r of state.rooms.filter(capOK)) {
    for (const [a, b] of freeBlocks(r, S)) if (b - a >= MIN) list.push({ r, a, b });
  }
  list.sort((x, y) => (y.b - y.a) - (x.b - x.a) || x.a - y.a);
  $("#long-sub").textContent = `${useNow ? "现在之后" : fmt(S) + " 之后"}，连续 ≥ ${MIN / 60} 小时`;
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
  setURL(); renderMast(); renderControls(); renderStats(); renderZones(); renderLong(); renderTimeline();
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
  on("#c-date", (v) => { state.date = v; loadDay(); });
  on("#c-start", (v) => { state.start = v; renderAll(); });
  on("#c-dur", (v) => { state.dur = +v; renderAll(); });
  on("#c-cap", (v) => { state.cap = +v; renderAll(); });
  on("#c-area", (v) => { state.area = +v; setURL(); renderControls(); renderTimeline(); });
  $("#c-start").addEventListener("change", (e) => { state.start = e.target.value; renderAll(); });
}

async function init() {
  state.index = await getJSON("data/index.json");
  const today = hkNow().date, dates = state.index.dates;
  if (!dates.includes(state.date)) state.date = dates.includes(today) ? today : dates[dates.length - 1];
  bind();
  await loadDay();
  setInterval(() => { if (state.start === "now") renderAll(); else renderMast(); }, 60_000);
}

init().catch((e) => { $("#zones").innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; });
