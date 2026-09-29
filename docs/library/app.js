const $ = (s) => document.querySelector(s);
const min = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const WD = ["日", "一", "二", "三", "四", "五", "六"];

const hkNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
};

const state = { index: null, date: null, area: null, day: null };
const params = new URLSearchParams(location.search);

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

function setURL() {
  history.replaceState(null, "", `?date=${state.date}&area=${state.area}`);
}

function renderNav() {
  const today = hkNow().date;
  $("#dates").innerHTML = state.index.dates.map((d) => {
    const dt = new Date(d + "T00:00:00+08:00");
    const lbl = d === today ? "今天" : `${+d.slice(5, 7)}/${+d.slice(8)} 周${WD[dt.getUTCDay()]}`;
    return `<button data-d="${d}" class="${d === state.date ? "on" : ""}">${lbl}</button>`;
  }).join("");
  $("#areas").innerHTML = state.index.areas.map((a) =>
    `<button data-a="${a.id}" class="${a.id === state.area ? "on" : ""}">${a.name}</button>`).join("");
  $("#dates .on")?.scrollIntoView({ inline: "center", block: "nearest" });
}

function freeRanges(bookings, open, close) {
  const out = []; let t = open;
  for (const b of [...bookings].sort((x, y) => min(x.start) - min(y.start))) {
    const s = min(b.start), e = min(b.end);
    if (s > t) out.push([t, s]);
    t = Math.max(t, e);
  }
  if (t < close) out.push([t, close]);
  return out;
}

function render() {
  const area = state.day?.areas.find((a) => a.area === state.area);
  if (!area) { $("#grid").innerHTML = `<div class="empty">没有数据</div>`; $("#summary").innerHTML = ""; return; }
  const open = min(area.open), close = min(area.close), span = close - open;
  const pct = (m) => ((m - open) / span * 100).toFixed(3) + "%";
  const now = hkNow();
  const isToday = state.date === now.date;
  const byRoom = new Map(area.rooms.map((r) => [r.id, []]));
  area.bookings.forEach((b) => byRoom.get(b.room_id)?.push(b));

  // 摘要
  const total = area.rooms.length;
  const openNow = isToday && now.min >= open && now.min < close;
  let freeNow = [];
  if (openNow) {
    freeNow = area.rooms.filter((r) => !byRoom.get(r.id).some((b) => min(b.start) <= now.min && now.min < min(b.end)))
      .map((r) => {
        const next = byRoom.get(r.id).map((b) => min(b.start)).filter((s) => s > now.min).sort((a, b) => a - b)[0];
        return `${r.name}${next ? `（至 ${fmt(next)}）` : ""}`;
      });
  }
  const slotsTotal = total * span, slotsBooked = area.bookings.reduce((s, b) => s + min(b.end) - min(b.start), 0);
  $("#summary").innerHTML =
    (openNow
      ? `现在 ${fmt(now.min)} 空闲 <b>${freeNow.length}</b> / ${total} 间<div class="free-list">${freeNow.join("、") || "—"}</div>`
      : `${total} 间房，开放 ${area.open}–${area.close}`) +
    `<div class="free-list">全天占用率 ${(slotsBooked / slotsTotal * 100).toFixed(0)}%，共 ${area.bookings.length} 条预约</div>`;

  // 时间轴
  const ticks = [];
  for (let m = Math.ceil(open / 60) * 60; m < close; m += 60) ticks.push(m);
  const tickHTML = (lbl) => ticks.map((m) => `<div class="tick" style="left:${pct(m)}">${lbl ? `<span>${m / 60}</span>` : ""}</div>`).join("");
  const nowHTML = openNow ? `<div class="nowline" style="left:${pct(now.min)}"></div>` : "";
  const rows = area.rooms.map((r) => {
    const bks = byRoom.get(r.id).map((b) => {
      const s = min(b.start), e = min(b.end);
      return `<div class="bk ${b.status}" style="left:${pct(s)};width:calc(${((e - s) / span * 100).toFixed(3)}% - 1px)"
        title="${r.name} ${b.start}–${b.end}${b.status === "unbookable" ? " 不可预约" : ""}">${b.start}–${b.end}</div>`;
    }).join("");
    const freeMin = freeRanges(byRoom.get(r.id), open, close).reduce((s, [a, b]) => s + b - a, 0);
    return `<div class="row"><div class="label" title="${r.name}">${r.name}<small>${r.capacity ?? ""}人 · 空${(freeMin / 60).toFixed(1)}h</small></div>
      <div class="track">${tickHTML(false)}${bks}${nowHTML}</div></div>`;
  }).join("");
  $("#grid").innerHTML = `<div class="tl" style="min-width:${112 + span / 60 * 44}px"><div class="row axis"><div class="label"></div><div class="track">${tickHTML(true)}</div></div>${rows}</div>`;
}

function scrollToNow() {
  const g = $("#grid"), line = g.querySelector(".nowline");
  g.scrollLeft = line ? Math.max(0, line.offsetLeft - (g.clientWidth - 112) / 3) : 0;
}

async function loadDay() {
  setURL(); renderNav();
  state.day = await getJSON(`data/${state.date}.json`).catch(() => null);
  render(); scrollToNow();
}

async function init() {
  state.index = await getJSON("data/index.json");
  const upd = new Date(state.index.updated_at);
  $("#updated").textContent = `数据更新于 ${upd.toLocaleString("zh-CN", { timeZone: "Asia/Hong_Kong", hour12: false })}（HKT）`;
  const today = hkNow().date;
  const dates = state.index.dates;
  state.date = dates.includes(params.get("date")) ? params.get("date")
    : dates.includes(today) ? today : dates[dates.length - 1];
  state.area = +(params.get("area") || state.index.areas[0].id);
  $("#dates").onclick = (e) => { const d = e.target.dataset.d; if (d) { state.date = d; loadDay(); } };
  $("#areas").onclick = (e) => { const a = e.target.dataset.a; if (a) { state.area = +a; setURL(); renderNav(); render(); scrollToNow(); } };
  await loadDay();
  setInterval(render, 60_000);
}

init().catch((e) => { $("#grid").innerHTML = `<div class="empty">加载失败：${e.message}</div>`; });
