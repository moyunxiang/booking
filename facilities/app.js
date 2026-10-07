"use strict";
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const hkNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
};
const wd = (d) => WD[new Date(d + "T12:00:00+08:00").getUTCDay()];
const dayLabel = (d, today) => {
  const diff = Math.round((new Date(d) - new Date(today)) / 864e5);
  return `${diff === 0 ? "今天" : diff === 1 ? "明天" : `${+d.slice(5, 7)}/${+d.slice(8)}`} ${wd(d)}`;
};
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// 场地名缩写：Basketball Court A (half court) → A 半场
function courtName(c) {
  const n = c.name.replace(/^(Basketball|Badminton)\s*/i, "");
  if (/outdoor/i.test(n)) return "室外场";
  if (/full court/i.test(n)) return "全场";
  const m = n.match(/Court\s+([A-Z0-9]+)/i);
  if (m) {
    if (/half/i.test(n)) return `${m[1]} 半场`;
    return `${m[1]}${/^\d+$/.test(m[1]) ? " 号场" : " 场"}${/singles/i.test(n) ? "·单打" : ""}`;
  }
  return n;
}
const place = (c) => c.location.replace(/^SPORTS\s*-\s*/i, "");

const q = new URLSearchParams(location.search);
const state = { index: null, type: q.get("t"), data: null };

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

function renderMast() {
  const now = hkNow();
  const t = state.index.types.find((x) => x.key === state.type);
  $("#wd").textContent = t ? t.name : "";
  document.title = `${t ? t.name : "体育设施"}空位`;
  const f = new Date(state.data.fetched_at);
  const ageMin = Math.round((Date.now() - f) / 6e4);
  const age = ageMin < 60 ? `${ageMin} 分钟前` : ageMin < 1440 ? `${Math.floor(ageMin / 60)} 小时前` : `${Math.floor(ageMin / 1440)} 天前`;
  const hk = f.toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong", hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  $("#fresh").innerHTML = `数据更新 <b>${hk}</b><br>${age}`;
  $("#alert").innerHTML = ageMin > 90
    ? `<div class="alert"><b>数据可能过时</b>：已 ${age}更新，实际情况以官网为准。</div>` : "";
  $("#c-type").innerHTML = state.index.types.map((x) =>
    `<button data-v="${x.key}" class="${x.key === state.type ? "on" : ""}">${esc(x.name)}</button>`).join("")
;
  const last = state.data.days.at(-1)?.date;
  $("#rule").textContent = last ? `每天 08:00 开放 7 天后的预约（目前到 ${+last.slice(5, 7)}/${+last.slice(8)}）` : "";
  $("#foot-upd").textContent = `${state.data.days.length} 天数据`;
}

// 某场地某时段是否已过（今天已经开始的时段不算空位）
const past = (day, start) => { const n = hkNow(); return day < n.date || (day === n.date && toMin(start) + 60 <= n.min); };

function renderIndoor() {
  const rows = [];
  for (const d of state.data.days) for (const c of d.courts) {
    if (!c.indoor || !c.slots) continue;
    for (const s of c.slots) if (s.available && !past(d.date, s.start)) rows.push({ d: d.date, c, s });
  }
  const today = hkNow().date;
  // 有室外场的类型（篮球）只突出室内场；全是室内的（羽毛球）就列所有空位
  const mixed = state.data.days.some((d) => d.courts.some((c) => !c.indoor));
  $("#hl-title").textContent = mixed ? "室内场空位" : "空位";
  if (!rows.length) {
    $("#indoor").innerHTML = `<div class="zcard hue none" style="--h:25"><div class="top"><span class="zn">全部订满</span>
      <span class="cnt"><b>0</b> 个空位</span></div><div class="next">未来 ${state.data.days.length} 天的${mixed ? "室内场" : "场地"}都被订完了。有人取消时这里会出现。</div></div>`;
    return;
  }
  $("#indoor").innerHTML = `<ul class="lf">${rows.map(({ d, c, s }) =>
    `<li class="hue" style="--h:205"><span class="bar"></span>
      <div><div class="t">${esc(courtName(c))}<small>${esc(place(c))}${mixed ? " · 室内" : ""}</small></div>
      <div class="m">${dayLabel(d, today)}</div></div>
      <div class="d">${s.start}<small>–${fmt(toMin(s.start) + 60)}</small></div></li>`).join("")}</ul>`;
}

function renderDays() {
  const today = hkNow().date;
  const starts = [...new Set(state.data.days.flatMap((d) => d.courts.flatMap((c) => (c.slots || []).map((s) => s.start))))].sort();
  const hours = starts.length ? starts : Array.from({ length: 15 }, (_, i) => fmt((7 + i) * 60));
  $("#days").innerHTML = state.data.days.map((d) => {
    const free = d.courts.reduce((n, c) => n + (c.slots || []).filter((s) => s.available && !past(d.date, s.start)).length, 0);
    const indoorFree = d.courts.filter((c) => c.indoor).reduce((n, c) => n + (c.slots || []).filter((s) => s.available && !past(d.date, s.start)).length, 0);
    const head = `<div class="fh"><b>${dayLabel(d.date, today)}</b><span>${free} 个空时段${indoorFree ? ` · <em>室内 ${indoorFree}</em>` : ""}</span></div>`;
    const axis = `<div class="fr axis"><span class="fl"></span>${hours.map((h) => `<i>${+h.slice(0, 2)}</i>`).join("")}</div>`;
    const rows = [...d.courts].sort((a, b) => b.indoor - a.indoor).map((c) => {  // 室内在前，室外最后
      const by = new Map((c.slots || []).map((s) => [s.start, s.available]));
      const cells = hours.map((h) => {
        const ok = by.get(h) && !past(d.date, h);
        return `<i class="${ok ? "ok" : ""}" title="${esc(courtName(c))} ${h}${ok ? " 可预约" : ""}"></i>`;
      }).join("");
      return `<div class="fr hue" style="--h:${c.indoor ? 205 : 150}"><span class="fl">${esc(courtName(c))}<small>${esc(place(c))}${c.indoor ? "" : " · 室外"}</small></span>${cells}</div>`;
    }).join("");
    return `<div class="fday ${indoorFree ? "hot" : ""}">${head}<div class="fgrid" style="--n:${hours.length}">${axis}${rows}</div></div>`;
  }).join("");
}

async function load() {
  state.data = await getJSON(`data/${state.type}.json`);
  history.replaceState(null, "", `?t=${state.type}`);
  renderMast(); renderIndoor(); renderDays();
}

async function init() {
  state.index = await getJSON("data/index.json");
  if (!state.index.types.some((x) => x.key === state.type)) state.type = state.index.types[0].key;
  $("#c-type").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (b) { state.type = b.dataset.v; load(); }
  });
  await load();
  setInterval(() => { renderMast(); renderIndoor(); renderDays(); }, 60_000);
}

init().catch((e) => { $("#days").innerHTML = `<div class="empty">加载失败：${esc(e.message)}</div>`; });
