// FACILITY_WIDGET · 体育设施空位小组件（Scriptable）
// 由手机上的加载器（scriptable.txt）从网站拉取后运行；改这里 + push，手机端下次刷新自动更新。
// 支持：桌面 小 / 中 / 大，锁屏 矩形 / 单行 / 圆形。
// 小组件参数（长按 → 编辑小组件 → Parameter）：basketball / badminton，默认 basketball。
const SITE = "https://moyunxiang.com/booking/facilities/";
const fm = FileManager.local();
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const TYPES = { basketball: { name: "篮球", icon: "🏀" }, badminton: { name: "羽毛球", icon: "🏸" } };

// ---------- 时间（按香港时间） ----------
function hkNow() {
  const h = new Date(Date.now() + 8 * 36e5);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${h.getUTCFullYear()}-${p(h.getUTCMonth() + 1)}-${p(h.getUTCDate())}`, min: h.getUTCHours() * 60 + h.getUTCMinutes() };
}
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
function dayLabel(d, today) {
  const diff = Math.round((new Date(d) - new Date(today)) / 864e5);
  const wd = WD[new Date(d + "T12:00:00+08:00").getUTCDay()];
  return diff === 0 ? "今天" : diff === 1 ? "明天" : `${+d.slice(5, 7)}/${+d.slice(8)} 周${wd}`;
}

// ---------- 数据 ----------
async function load(type) {
  const cache = fm.joinPath(fm.documentsDirectory(), `booking-facility-${type}.json`);
  try {
    const d = await new Request(`${SITE}data/${type}.json?t=${Date.now()}`).loadJSON();
    if (d && d.days) { fm.writeString(cache, JSON.stringify(d)); return { d, offline: false }; }
  } catch (e) {}
  if (fm.fileExists(cache)) return { d: JSON.parse(fm.readString(cache)), offline: true };
  return { d: null, offline: true };
}

// 场地名缩写：Basketball Court A (half court) → A 半场
function courtName(c) {
  const n = c.name.replace(/^(Basketball|Badminton)\s*/i, "");
  if (/outdoor/i.test(n)) return "室外场";
  if (/full court/i.test(n)) return "全场";
  const m = n.match(/Court\s+([A-Z0-9]+)/i);
  if (m) {
    if (/half/i.test(n)) return `${m[1]}半场`;
    return `${m[1]}号场${/singles/i.test(n) ? "单打" : ""}`;
  }
  return n;
}
const place = (c) => c.location.replace(/^SPORTS\s*-\s*/i, "");

// 所有未开始的空时段，按时间排序
function freeSlots(d, now) {
  const out = [];
  for (const day of d.days) {
    if (day.date < now.date) continue;
    for (const c of day.courts) for (const s of c.slots || []) {
      if (!s.available) continue;
      if (day.date === now.date && toMin(s.start) + 60 <= now.min) continue;  // 已经结束
      out.push({ date: day.date, start: s.start, indoor: c.indoor, court: courtName(c), place: place(c) });
    }
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

// ---------- 颜色 / 字体 ----------
const C = {
  bg: Color.dynamic(new Color("#f3efe6"), new Color("#171614")),
  ink: Color.dynamic(new Color("#1c1a16"), new Color("#eeeae1")),
  ink2: Color.dynamic(new Color("#4a463e"), new Color("#c9c3b6")),
  muted: Color.dynamic(new Color("#8a8478"), new Color("#8e877a")),
  red: Color.dynamic(new Color("#b8321f"), new Color("#ff8a73")),
  blue: Color.dynamic(new Color("#2f6690"), new Color("#8ec0e8")),
  green: Color.dynamic(new Color("#2f6b3a"), new Color("#86c78f")),
};
const serif = (n) => new Font("Georgia-Bold", n);
function txt(stack, s, font, color, lines = 1) {
  const t = stack.addText(s); t.font = font; t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = 0.6; return t;
}
function cell(stack, s, width, font, color) {
  const c = stack.addStack(); c.size = new Size(width, 0); c.layoutHorizontally();
  c.addSpacer(); txt(c, s, font, color);
}
function freshness(d, offline) {
  const m = Math.round((Date.now() - new Date(d.fetched_at)) / 6e4);
  const t = m < 60 ? `${m} 分钟前更新` : `${Math.floor(m / 60)} 小时前更新`;
  return { text: [t, offline ? "离线" : ""].filter(Boolean).join(" · "), stale: m > 150 || offline };
}
const slotText = (x, today) => `${dayLabel(x.date, today)} ${x.start} ${x.court}`;

// ---------- 各尺寸 ----------
function small(w, v) {
  txt(w, `${v.t.icon} ${v.t.name} · ${v.mixed ? "室内空位" : "空位"}`, Font.boldSystemFont(11), C.muted);
  w.addSpacer(4);
  const r = w.addStack(); r.layoutHorizontally(); r.bottomAlignContent();
  txt(r, String(v.hl.length), serif(40), v.hl.length ? C.blue : C.red);
  r.addSpacer(4);
  const lab = r.addStack(); lab.layoutVertically();
  txt(lab, `${v.days} 天内`, Font.systemFont(10), C.muted); lab.addSpacer(6);
  w.addSpacer(2);
  if (v.hl[0]) txt(w, slotText(v.hl[0], v.now.date), Font.semiboldSystemFont(11.5), C.ink, 2);
  else txt(w, "全部订满", Font.semiboldSystemFont(12), C.ink2);
  w.addSpacer();
  if (v.mixed) txt(w, `今天室外还有 ${v.outToday} 个时段`, Font.mediumSystemFont(10), v.outToday ? C.green : C.muted);
  else txt(w, v.fresh.text, Font.systemFont(9.5), v.fresh.stale ? C.red : C.muted);
}

function header(w, v, label) {
  const hd = w.addStack(); hd.layoutHorizontally(); hd.centerAlignContent();
  txt(hd, label, Font.boldSystemFont(11), C.muted);
  hd.addSpacer();
  txt(hd, v.fresh.text, Font.systemFont(9.5), v.fresh.stale ? C.red : C.muted);
}

// 每天：室内 / 室外（或 空位）
function dayTable(stack, v, n, big) {
  const COLS = v.mixed ? [34, 34] : [40];
  const hr = stack.addStack(); hr.layoutHorizontally();
  hr.addSpacer();
  (v.mixed ? ["室内", "室外"] : ["空位"]).forEach((h, i) => cell(hr, h, COLS[i], Font.mediumSystemFont(9), C.muted));
  stack.addSpacer(2);
  for (const day of v.perDay.slice(0, n)) {
    const r = stack.addStack(); r.layoutHorizontally(); r.centerAlignContent();
    txt(r, dayLabel(day.date, v.now.date), Font.semiboldSystemFont(big ? 12 : 11.5), C.ink);
    r.addSpacer();
    if (v.mixed) {
      cell(r, String(day.indoor), COLS[0], Font.boldSystemFont(12), day.indoor ? C.blue : C.muted);
      cell(r, String(day.outdoor), COLS[1], Font.mediumSystemFont(11.5), day.outdoor ? C.green : C.muted);
    } else cell(r, String(day.indoor), COLS[0], Font.boldSystemFont(12), day.indoor ? C.blue : C.muted);
    stack.addSpacer(big ? 3 : 1.5);
  }
}

function medium(w, v) {
  header(w, v, `${v.t.icon} ${v.t.name}空位`);
  w.addSpacer(8);
  const body = w.addStack(); body.layoutHorizontally();
  const L = body.addStack(); L.layoutVertically(); L.size = new Size(150, 0);
  const r = L.addStack(); r.layoutHorizontally(); r.bottomAlignContent();
  txt(r, String(v.hl.length), serif(32), v.hl.length ? C.blue : C.red);
  r.addSpacer(4);
  const lab = r.addStack(); lab.layoutVertically();
  txt(lab, v.mixed ? "室内空位" : "个空位", Font.boldSystemFont(11), C.ink2);
  txt(lab, `${v.days} 天内`, Font.systemFont(10), C.muted); lab.addSpacer(4);
  L.addSpacer(4);
  if (!v.hl.length) txt(L, "全部订满，有人取消会出现在这里", Font.systemFont(10.5), C.muted, 2);
  for (const x of v.hl.slice(0, 2)) { txt(L, slotText(x, v.now.date), Font.semiboldSystemFont(11), C.ink); L.addSpacer(1); }
  body.addSpacer(12);
  const R = body.addStack(); R.layoutVertically();
  dayTable(R, v, 5, false);
}

function large(w, v) {
  const hd = w.addStack(); hd.layoutHorizontally(); hd.centerAlignContent();
  txt(hd, `${v.t.icon} ${v.t.name}空位`, serif(17), C.ink);
  hd.addSpacer();
  txt(hd, v.fresh.text, Font.systemFont(9.5), v.fresh.stale ? C.red : C.muted);
  w.addSpacer(8);
  const sh = w.addStack(); sh.layoutHorizontally();
  txt(sh, v.mixed ? "室内场" : "所有场地", Font.boldSystemFont(11), C.muted);
  sh.addSpacer();
  txt(sh, `${v.hl.length} 个空位`, Font.boldSystemFont(11), v.hl.length ? C.blue : C.muted);
  w.addSpacer(4);
  if (!v.hl.length) txt(w, `未来 ${v.days} 天全部订满，有人取消会出现在这里`, Font.systemFont(11), C.muted, 2);
  const MAX = 6;
  for (const x of v.hl.slice(0, MAX)) {
    const r = w.addStack(); r.layoutHorizontally(); r.centerAlignContent();
    const bar = r.addStack(); bar.size = new Size(3, 12); bar.cornerRadius = 1.5; bar.backgroundColor = C.blue;
    r.addSpacer(6);
    txt(r, `${dayLabel(x.date, v.now.date)}  ${x.start}–${fmt(toMin(x.start) + 60)}`, Font.semiboldSystemFont(11.5), C.ink);
    r.addSpacer();
    txt(r, `${x.court} · ${x.place}`, Font.systemFont(11), C.ink2);
    w.addSpacer(3);
  }
  if (v.hl.length > MAX) txt(w, `还有 ${v.hl.length - MAX} 个 →`, Font.mediumSystemFont(10), C.muted);
  w.addSpacer(10);
  dayTable(w, v, 8, true);
  w.addSpacer();
}

// ---------- 主程序 ----------
const param = String(args.widgetParameter || "basketball").trim().toLowerCase();
const type = TYPES[param] ? param : "basketball";
const fam = config.widgetFamily || (config.runsInWidget ? "medium" : "large");
const { d, offline } = await load(type);
const w = new ListWidget();
w.url = `${SITE}?t=${type}`;
w.refreshAfterDate = new Date(Date.now() + 15 * 6e4);

if (!d) {
  txt(w, "连不上 moyunxiang.com", Font.boldSystemFont(13), C.red);
} else {
  const now = hkNow();
  const all = freeSlots(d, now);
  const mixed = d.days.some((x) => x.courts.some((c) => !c.indoor));   // 篮球有室外场；羽毛球全是室内
  const perDay = d.days.filter((x) => x.date >= now.date).map((x) => {
    const s = all.filter((y) => y.date === x.date);
    return { date: x.date, indoor: s.filter((y) => y.indoor).length, outdoor: s.filter((y) => !y.indoor).length };
  });
  const v = {
    t: TYPES[type], now, mixed, perDay, days: perDay.length,
    hl: all.filter((x) => x.indoor),                                     // 突出显示：室内空位
    outToday: all.filter((x) => !x.indoor && x.date === now.date).length,
    fresh: freshness(d, offline),
  };
  const lbl = v.mixed ? "室内" : "空位";
  if (fam === "accessoryInline") {
    w.addText(`${v.t.icon} ${lbl} ${v.hl.length}${v.mixed ? ` · 今天室外 ${v.outToday}` : ""}`);
  } else if (fam === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(String(v.hl.length)); t.font = Font.boldRoundedSystemFont(22); t.centerAlignText();
    const s = w.addText(`${v.t.icon}${lbl}`); s.font = Font.systemFont(9); s.centerAlignText();
  } else if (fam === "accessoryRectangular") {
    const a = w.addText(`${v.t.icon} ${lbl} ${v.hl.length}${v.mixed ? ` · 今天室外 ${v.outToday}` : ""}`); a.font = Font.boldSystemFont(13);
    const b = w.addText(v.hl[0] ? slotText(v.hl[0], now.date) : `${v.days} 天内全部订满`); b.font = Font.systemFont(12); b.lineLimit = 1;
    const c = w.addText(v.fresh.text); c.font = Font.systemFont(10.5); c.textOpacity = 0.7;
  } else {
    w.backgroundColor = C.bg;
    w.setPadding(14, 15, 12, 15);
    if (fam === "small") small(w, v);
    else if (fam === "large" || fam === "extraLarge") large(w, v);
    else medium(w, v);
  }
}

if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(w);
else if (fam === "small") await w.presentSmall();
else if (fam === "medium") await w.presentMedium();
else await w.presentLarge();
Script.complete();
