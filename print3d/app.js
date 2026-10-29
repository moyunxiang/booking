"use strict";
// 3D 打印机：数据和图书馆自习室同一个预约系统（area 14），由 library/scrape.py 写到 print3d/data/
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const hrs = (m) => (m % 60 ? (m / 60).toFixed(1) : m / 60) + "";
const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const DURS = [0, 60, 120, 180, 240];  // 找空档：至少连续多少分钟（0 = 不限，≥ 30 分钟）；每次预约最多 4 小时
const HUES = [200, 320];
// 最远能约到「今天 + 13 天」：2026-10-29 实测 11/11 已有预约、11/12（+14）整天空着（推断，见 log.md）。
// 更远的日子页面上标「未开放预约」，不算空档
const AHEAD = 13;
const addDays = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

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
  return (diff === 0 ? "今天 " : diff === 1 ? "明天 " : "") + `${+d.slice(5, 7)}/${+d.slice(8)} ${wd}`;
};
// 时间轴左栏窄：今天 周四 / 明天 周五 / 11/2 周一
const tlLabel = (d, today) => {
  const wd = WD[new Date(d + "T12:00:00+08:00").getUTCDay()];
  const diff = Math.round((new Date(d) - new Date(today)) / 864e5);
  return `${diff === 0 ? "今天" : diff === 1 ? "明天" : `${+d.slice(5, 7)}/${+d.slice(8)}`} ${wd}`;
};
// 「Printer 1 (Mono-colour)」→ 1 号 · 单色
const short = (name) => {
  const m = name.match(/Printer\s*(\d+)\s*\(([^)]*)\)/i);
  if (!m) return name;
  return `${m[1]} 号 · ${/multi/i.test(m[2]) ? "多色" : /mono/i.test(m[2]) ? "单色" : m[2]}`;
};

const q = new URLSearchParams(location.search);
const state = { index: null, days: [], dur: q.has("d") ? +q.get("d") : 60, pr: +q.get("p") || 0 };

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

// 每天：每台打印机的开放时间和预约（按开始排序），全天不可预约 = 不开放
function buildDay(snap) {
  const a = snap.areas[0];
  const open = toMin(a.open), close = toMin(a.close);
  const printers = a.rooms.map((r, i) => {
    const bks = a.bookings.filter((b) => b.room_id === r.id)
      .map((b) => ({ s: toMin(b.start), e: toMin(b.end), st: b.status })).sort((x, y) => x.s - y.s);
    const closed = bks.some((b) => b.st === "unbookable" && b.s <= open && b.e >= close);
    return { id: r.id, name: r.name, short: short(r.name), h: HUES[i % HUES.length], open, close, bks, closed };
  });
  return { date: snap.date, open, close, printers };
}
function freeBlocks(p, from) {
  const out = []; let t = Math.max(from, p.open);
  for (const b of p.bks) {
    if (b.e <= t) continue;
    if (b.s > t) out.push([t, b.s]);
    t = Math.max(t, b.e);
  }
  if (t < p.close) out.push([t, p.close]);
  return out;
}
const at = (p, m) => p.bks.find((b) => b.s <= m && b.e > m);

function setURL() {
  const p = new URLSearchParams();
  if (state.dur !== 60) p.set("d", state.dur);
  if (state.pr) p.set("p", state.pr);
  history.replaceState(null, "", p.size ? "?" + p : location.pathname);
}

function renderMast() {
  const now = hkNow(), d = now.date;
  $("#wd").textContent = `${+d.slice(5, 7)}月${+d.slice(8)}日 ${WD[new Date(d + "T12:00:00+08:00").getUTCDay()]}`;
  const f = new Date(state.index.updated_at);
  const ageMin = Math.round((Date.now() - f) / 6e4);
  const age = ageMin < 60 ? `${ageMin} 分钟前` : ageMin < 1440 ? `${Math.floor(ageMin / 60)} 小时前` : `${Math.floor(ageMin / 1440)} 天前`;
  const hk = f.toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#fresh").innerHTML = `数据更新 <b>${hk}</b><br>${age}`;
  $("#foot-upd").textContent = `${state.days.length} 天数据`;
  $("#alert").innerHTML = ageMin > 90
    ? `<div class="alert"><b>数据可能过时</b>：已 ${age}更新，实际空闲情况以官网为准。</div>` : "";
}

function renderNow() {
  const now = hkNow();
  const today = state.days.find((d) => d.date === now.date);
  $("#now-sec").hidden = !today;
  if (!today) return;
  $("#now-sub").textContent = `今天 ${fmt(today.open)}–${fmt(today.close)} 开放`;
  $("#now").innerHTML = today.printers.map((p) => {
    let txt, cls = "";
    if (p.closed) { txt = "今天不开放"; cls = "empty-row"; }
    else if (now.min < p.open) {
      const b = at(p, p.open);
      txt = b ? `${fmt(p.open)} 开门，开门时已有预约` : `${fmt(p.open)} 开门，开门起空到 ${fmt(freeBlocks(p, p.open)[0]?.[1] ?? p.close)}`;
    } else if (now.min >= p.close) { txt = "今天已结束"; cls = "empty-row"; }
    else {
      const b = at(p, now.min);
      if (b) {
        const next = freeBlocks(p, b.e)[0];
        txt = `${b.st === "unbookable" ? "不可预约" : "使用中"}，到 ${fmt(b.e)}` + (next ? `；之后 ${fmt(next[0])}–${fmt(next[1])} 空` : "；今天没有空档了");
      } else txt = `<b>空闲</b>，空到 ${fmt(freeBlocks(p, now.min)[0][1])}`;
    }
    return `<div class="nrow hue ${cls}" style="--h:${p.h}"><div class="zl">${esc(p.short)}<small>${esc(p.name)}</small></div>
      <div class="pnow">${txt}</div></div>`;
  }).join("");
}

function renderFind() {
  const now = hkNow();
  const printers = state.days[0]?.printers || [];
  $("#c-dur").innerHTML = DURS.map((d) => `<button data-v="${d}" class="${d === state.dur ? "on" : ""}">${!d ? "不限" : d === 240 ? "4 小时" : "≥ " + hrs(d) + " 小时"}</button>`).join("");
  $("#c-pr").innerHTML = [`<button data-v="0" class="${!state.pr ? "on" : ""}">全部</button>`]
    .concat(printers.map((p) => `<button data-v="${p.id}" class="${state.pr === p.id ? "on" : ""}">${esc(p.short)}</button>`)).join("");
  const min = Math.max(state.dur, 30), list = [];
  const last = addDays(now.date, AHEAD);
  for (const d of state.days) {
    if (d.date < now.date || d.date > last) continue;
    // 今天从下一个半点开始算（预约按 30 分钟一格）
    const from = d.date === now.date ? Math.ceil(now.min / 30) * 30 : 0;
    for (const p of d.printers) {
      if (p.closed || (state.pr && p.id !== state.pr)) continue;
      for (const [a, b] of freeBlocks(p, from)) if (b - a >= min) list.push({ d, p, a, b });
    }
  }
  list.sort((x, y) => x.d.date.localeCompare(y.d.date) || x.a - y.a || x.p.id - y.p.id);
  const n = state.days.filter((d) => d.date >= now.date && d.date <= last).length;
  $("#find-sub").textContent = `能约的 ${n} 天（到 ${dayLabel(last, now.date)}），按时间先后`;
  $("#free").innerHTML = list.slice(0, 24).map(({ d, p, a, b }) =>
    `<li class="hue" style="--h:${p.h}"><span class="bar"></span>
      <div><div class="t">${dayLabel(d.date, now.date)}<small>${esc(p.short)}</small></div>
      <div class="m">${fmt(a)} – ${fmt(b)}</div></div>
      <div class="d">${hrs(b - a)}<small>h</small></div></li>`).join("")
    || `<li class="empty">能约的 ${n} 天里${state.pr ? "这台" : "两台"}都没有连续 ${hrs(min)} 小时以上的空档${min > 30 ? "，可以试试「不限」" : ""}。有人取消的话，今明两天 30 分钟内、更远的日子 1 小时内会更新出来。</li>`;
}

function renderTimeline() {
  const now = hkNow();
  const days = state.days.filter((d) => d.date >= now.date);
  if (!days.length) { $("#tl").innerHTML = `<div class="empty">没有数据</div>`; return; }
  const open = Math.min(...days.map((d) => d.open)), close = Math.max(...days.map((d) => d.close)), span = close - open;
  const pct = (m) => ((Math.min(Math.max(m, open), close) - open) / span * 100).toFixed(3) + "%";
  const ticks = [];
  for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) ticks.push(m);
  const tickHTML = (lbl) => ticks.map((m) => `<div class="tick" style="left:${pct(m)}">${lbl ? `<span>${m / 60}</span>` : ""}</div>`).join("");
  let html = `<div class="tr axis"><div class="lab"></div><div class="trk">${tickHTML(true)}</div></div>`;
  const last = addDays(now.date, AHEAD);
  for (const d of days) {
    const shut = d.printers.every((p) => p.closed), later = d.date > last;
    const note = shut ? "不开放" : later ? "还未开放预约" : "";
    html += `<div class="tr zh"><div class="lab">${tlLabel(d.date, now.date)}</div><div class="trk">${tickHTML(false)}${note ? `<span class="shut">${note}</span>` : ""}</div></div>`;
    if (note) continue;
    const nowHTML = d.date === now.date && now.min >= open && now.min < close ? `<div class="nowline" style="left:${pct(now.min)}"></div>` : "";
    for (const p of d.printers) {
      const bks = p.bks.map((b) => `<div class="bk ${b.st}" style="left:${pct(b.s)};width:calc(${((b.e - b.s) / span * 100).toFixed(3)}% - 2px)"
        title="${esc(p.short)} ${fmt(b.s)}–${fmt(b.e)}${b.st === "unbookable" ? " 不可预约" : ""}">${fmt(b.s)}–${fmt(b.e)}</div>`).join("");
      const freeMin = p.closed ? 0 : freeBlocks(p, p.open).reduce((s, [a, b]) => s + b - a, 0);
      html += `<div class="tr hue" style="--h:${p.h}"><div class="lab">${esc(p.short)}<small>${p.closed ? "不开放" : `空 ${hrs(freeMin)}h`}</small></div>
        <div class="trk">${tickHTML(false)}${bks}${nowHTML}</div></div>`;
    }
  }
  $("#tl").innerHTML = `<div class="tl" style="min-width:${112 + span / 60 * 46}px">${html}</div>`;
}

function renderAll() { setURL(); renderMast(); renderNow(); renderFind(); renderTimeline(); }

function bind() {
  const on = (sel, fn) => $(sel).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (b) fn(b.dataset.v);
  });
  on("#c-dur", (v) => { state.dur = +v; setURL(); renderFind(); });
  on("#c-pr", (v) => { state.pr = +v; setURL(); renderFind(); });
}

async function init() {
  state.index = await getJSON("data/index.json");
  const today = hkNow().date;
  // 只要能约的日子 + 下一天（看它什么时候开放）；更远的旧文件不读
  const snaps = await Promise.all(state.index.dates.filter((d) => d >= today && d <= addDays(today, AHEAD + 1))
    .map((d) => getJSON(`data/${d}.json`)));
  state.days = snaps.filter((s) => s.areas?.[0]?.rooms?.length).map(buildDay);
  bind();
  renderAll();
  setInterval(renderAll, 60_000);
}

init().catch((e) => { $("#free").innerHTML = `<li class="empty">加载失败：${esc(e.message)}</li>`; });
