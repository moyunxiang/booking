// BOOKING_WIDGET · 图书馆空房小组件（Scriptable）
// 由手机上的加载器（scriptable.txt）从网站拉取后运行；改这里 + push，手机端下次刷新自动更新。
// 支持：桌面 小 / 中 / 大，锁屏 矩形 / 单行 / 圆形。
// 小组件参数（长按 → 编辑小组件 → Parameter）：lc / group / pods，决定圆形锁屏和小尺寸主数字显示哪一类，默认 lc。
const SITE = "https://moyunxiang.com/booking/library/";
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "booking-library-data.json");

// 与网页相同的楼层分组和色相
const ZONES = [
  { name: "1/F", h: 32, area: 3, test: (n) => /^1-/.test(n) },
  { name: "LG1", h: 205, area: 3, test: (n) => n.startsWith("LG1") },
  { name: "LG3", h: 150, area: 3, test: (n) => n.startsWith("LG3") },
  { name: "LG4", h: 275, area: 3, test: (n) => n.startsWith("LG4") },
  { name: "LG5", h: 340, area: 3, test: (n) => n.startsWith("LG5") },
  { name: "其他", h: 60, area: 3, test: () => true },
  { name: "LC", h: 12, area: 8, test: () => true },
  { name: "Pods", h: 180, area: 20, test: () => true },
];
const KINDS = { lc: { area: 8, label: "LC" }, group: { area: 3, label: "Group" }, pods: { area: 20, label: "Pods" } };

// ---------- 时间（按香港时间） ----------
function hkNow() {
  const h = new Date(Date.now() + 8 * 36e5);
  const p = (n) => String(n).padStart(2, "0");
  return { date: `${h.getUTCFullYear()}-${p(h.getUTCMonth() + 1)}-${p(h.getUTCDate())}`, min: h.getUTCHours() * 60 + h.getUTCMinutes() };
}
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---------- 数据 ----------
async function load(date) {
  try {
    const d = await new Request(`${SITE}data/${date}.json?t=${Date.now()}`).loadJSON();
    if (d && d.areas) { fm.writeString(CACHE, JSON.stringify(d)); return { d, offline: false }; }
  } catch (e) {}
  if (fm.fileExists(CACHE)) {
    const d = JSON.parse(fm.readString(CACHE));
    if (d.date === date) return { d, offline: true };
  }
  return { d: null, offline: true };
}

function buildRooms(day) {
  const rooms = [];
  for (const a of day.areas) {
    const open = toMin(a.open), close = toMin(a.close);
    for (const r of a.rooms) {
      const bks = a.bookings.filter((b) => b.room_id === r.id).map((b) => ({ s: toMin(b.start), e: toMin(b.end), un: b.status === "unbookable" }));
      const zone = ZONES.find((z) => z.area === a.area && z.test(r.name)) || { name: a.area_name, h: 90, area: a.area };
      rooms.push({ name: r.name, cap: r.capacity, area: a.area, zone, open, close, bks });
    }
  }
  return rooms;
}
const isFree = (r, s, e) => s >= r.open && e <= r.close && !r.bks.some((b) => b.s < e && b.e > s);
const freeUntil = (r, s) => Math.min(r.close, ...r.bks.filter((b) => b.s >= s).map((b) => b.s));
// 这一类房间在 [s, e) 是否全部不开放（闭馆 / 假期 / 全是 Unbookable）
const shut = (rs, s, e) => rs.every((r) => s < r.open || e > r.close || r.bks.some((b) => b.un && b.s <= s && b.e >= e));

function summarize(rooms, s, e) {
  const byArea = {};
  for (const k of Object.keys(KINDS)) {
    const rs = rooms.filter((r) => r.area === KINDS[k].area);
    byArea[k] = { total: rs.length, free: rs.filter((r) => isFree(r, s, e)), shut: rs.length > 0 && shut(rs, s, e) };
  }
  const zones = [];
  for (const r of rooms) if (!zones.includes(r.zone)) zones.push(r.zone);
  const byZone = zones.map((z) => {
    const rs = rooms.filter((r) => r.zone === z);
    return { z, total: rs.length, free: rs.filter((r) => isFree(r, s, e)), shut: shut(rs, s, e) };
  });
  return { byArea, byZone };
}

// ---------- 颜色 / 字体 ----------
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
const zc = (h) => Color.dynamic(new Color(hsl(h, 48, 40)), new Color(hsl(h, 62, 72)));
const C = {
  bg: Color.dynamic(new Color("#f3efe6"), new Color("#171614")),
  ink: Color.dynamic(new Color("#1c1a16"), new Color("#eeeae1")),
  ink2: Color.dynamic(new Color("#4a463e"), new Color("#c9c3b6")),
  muted: Color.dynamic(new Color("#8a8478"), new Color("#8e877a")),
  red: Color.dynamic(new Color("#b8321f"), new Color("#ff8a73")),
};
const serif = (n) => new Font("Georgia-Bold", n);
function txt(stack, s, font, color, lines = 1) {
  const t = stack.addText(s); t.font = font; t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = 0.6; return t;
}
const countText = (x) => (x.shut ? "闭" : String(x.free.length));

// ---------- 页脚：更新时间 ----------
function freshness(d, offline) {
  const m = Math.round((Date.now() - new Date(d.fetched_at)) / 6e4);
  const t = m < 60 ? `${m} 分钟前更新` : `${Math.floor(m / 60)} 小时前更新`;
  return { text: [t, offline ? "离线" : ""].filter(Boolean).join(" · "), stale: m > 90 || offline };
}

// ---------- 桌面：小 ----------
function small(w, cur, nxt, win, kind) {
  txt(w, `图书馆 · ${win.label}`, Font.boldSystemFont(11), C.muted);
  w.addSpacer(6);
  const order = [kind, ...["lc", "group"].filter((k) => k !== kind)].slice(0, 2);
  for (const k of order) {
    const x = cur.byArea[k];
    const r = w.addStack(); r.layoutHorizontally(); r.bottomAlignContent();
    txt(r, countText(x), serif(k === kind ? 34 : 26), x.free.length ? C.ink : C.red);
    r.addSpacer(4);
    const lab = r.addStack(); lab.layoutVertically();
    txt(lab, KINDS[k].label, Font.boldSystemFont(11), C.ink2);
    txt(lab, `/ ${x.total} 间`, Font.systemFont(10), C.muted);
    lab.addSpacer(3);
  }
  w.addSpacer();
  txt(w, `${win.nextLabel} 起  LC ${countText(nxt.byArea.lc)} · Group ${countText(nxt.byArea.group)}`, Font.mediumSystemFont(10), C.ink2);
}

// ---------- 桌面：中 ----------
function medium(w, cur, nxt, win, fresh) {
  const hd = w.addStack(); hd.layoutHorizontally(); hd.centerAlignContent();
  txt(hd, `图书馆空房 · ${win.label}`, Font.boldSystemFont(11), C.muted);
  hd.addSpacer();
  txt(hd, fresh.text, Font.systemFont(9.5), fresh.stale ? C.red : C.muted);
  w.addSpacer(8);
  const body = w.addStack(); body.layoutHorizontally();
  // 左：LC / Group 大数字
  const L = body.addStack(); L.layoutVertically();
  for (const k of ["lc", "group"]) {
    const x = cur.byArea[k];
    const r = L.addStack(); r.layoutHorizontally(); r.bottomAlignContent();
    txt(r, countText(x), serif(30), x.free.length ? C.ink : C.red);
    r.addSpacer(4);
    const lab = r.addStack(); lab.layoutVertically();
    txt(lab, KINDS[k].label, Font.boldSystemFont(11), C.ink2);
    txt(lab, `/ ${x.total}`, Font.systemFont(10), C.muted);
    lab.addSpacer(3);
    L.addSpacer(2);
  }
  body.addSpacer(16);
  // 右：各楼层 现在 / 下一段
  const R = body.addStack(); R.layoutVertically();
  const hr = R.addStack(); hr.layoutHorizontally();
  hr.addSpacer(); txt(hr, `现在  ${win.nextLabel}`, Font.mediumSystemFont(9), C.muted);
  R.addSpacer(2);
  cur.byZone.filter((z) => z.z.name !== "LG5").forEach((zz, i) => {
    const r = R.addStack(); r.layoutHorizontally(); r.centerAlignContent();
    const bar = r.addStack(); bar.size = new Size(3, 11); bar.cornerRadius = 1.5; bar.backgroundColor = zc(zz.z.h);
    r.addSpacer(5);
    txt(r, zz.z.name, Font.semiboldSystemFont(11.5), C.ink);
    r.addSpacer();
    const n = nxt.byZone.find((y) => y.z === zz.z);
    txt(r, `${countText(zz)}`, Font.boldSystemFont(12), zz.free.length ? C.ink : C.muted);
    r.addSpacer(4);
    txt(r, `/ ${zz.total}`, Font.systemFont(9.5), C.muted);
    r.addSpacer(10);
    txt(r, countText(n), Font.mediumSystemFont(11), C.ink2);
    R.addSpacer(1.5);
  });
}

// ---------- 桌面：大 ----------
function large(w, cur, nxt, win, fresh) {
  const hd = w.addStack(); hd.layoutHorizontally(); hd.centerAlignContent();
  txt(hd, "图书馆空房", serif(17), C.ink);
  hd.addSpacer();
  txt(hd, fresh.text, Font.systemFont(9.5), fresh.stale ? C.red : C.muted);
  for (const [sum, label] of [[cur, win.label], [nxt, `${win.nextLabel}–${win.next2Label}`]]) {
    w.addSpacer(8);
    const sh = w.addStack(); sh.layoutHorizontally();
    txt(sh, label, Font.boldSystemFont(11), C.muted);
    sh.addSpacer();
    txt(sh, `LC ${countText(sum.byArea.lc)} · Group ${countText(sum.byArea.group)} · Pods ${countText(sum.byArea.pods)}`, Font.boldSystemFont(11), C.ink2);
    w.addSpacer(4);
    for (const zz of sum.byZone) {
      if (zz.shut || !zz.free.length) continue;
      const r = w.addStack(); r.layoutHorizontally(); r.topAlignContent();
      const bar = r.addStack(); bar.size = new Size(3, 12); bar.cornerRadius = 1.5; bar.backgroundColor = zc(zz.z.h);
      r.addSpacer(5);
      const nm = r.addStack(); nm.size = new Size(34, 0);
      txt(nm, zz.z.name, Font.semiboldSystemFont(11), zc(zz.z.h));
      r.addSpacer(4);
      const s = sum === cur ? win.now : win.next;
      const names = zz.free.map((x) => `${x.name}→${fmt(freeUntil(x, s))}`).join("  ");
      txt(r, names, Font.systemFont(10.5), C.ink, 2);
      w.addSpacer(3);
    }
    if (sum.byZone.every((zz) => zz.shut || !zz.free.length)) txt(w, "没有空房", Font.systemFont(11), C.muted);
  }
  w.addSpacer();
}

// ---------- 主程序 ----------
const now = hkNow();
const param = String(args.widgetParameter || "lc").trim().toLowerCase();
const kind = KINDS[param] ? param : "lc";
const fam = config.widgetFamily || (config.runsInWidget ? "medium" : "large");
const { d, offline } = await load(now.date);
const w = new ListWidget();
w.url = SITE;
// 数据每 30 分钟（:00 / :30）抓一次，大约 2 分钟后上线；下一个 :05 / :35 刷新
const nextRefresh = (Math.floor((now.min - 5) / 30) + 1) * 30 + 5 - now.min;
w.refreshAfterDate = new Date(Date.now() + Math.max(nextRefresh, 5) * 6e4);

if (!d) {
  txt(w, offline ? "连不上 moyunxiang.com" : "今天没有数据", Font.boldSystemFont(13), C.red);
} else {
  const rooms = buildRooms(d);
  const cut = Math.floor(now.min / 30) * 30 + 30;
  const win = { now: now.min, next: cut, label: `现在–${fmt(cut)}`, nextLabel: fmt(cut), next2Label: fmt(cut + 30) };
  const cur = summarize(rooms, now.min, cut);
  const nxt = summarize(rooms, cut, cut + 30);
  const fresh = freshness(d, offline);
  if (fam === "accessoryInline") {
    w.addText(`空房 LC ${countText(cur.byArea.lc)} · Group ${countText(cur.byArea.group)}`);
  } else if (fam === "accessoryCircular") {
    const x = cur.byArea[kind];
    w.addAccessoryWidgetBackground = true;
    const t = w.addText(countText(x)); t.font = Font.boldRoundedSystemFont(22); t.centerAlignText();
    const s = w.addText(KINDS[kind].label); s.font = Font.systemFont(9); s.centerAlignText();
  } else if (fam === "accessoryRectangular") {
    const a = w.addText(`现在  LC ${countText(cur.byArea.lc)} · Group ${countText(cur.byArea.group)}`); a.font = Font.boldSystemFont(13);
    const b = w.addText(`${win.nextLabel} 起  LC ${countText(nxt.byArea.lc)} · Group ${countText(nxt.byArea.group)}`); b.font = Font.systemFont(12);
    const c = w.addText(fresh.text); c.font = Font.systemFont(10.5); c.textOpacity = 0.7;
  } else {
    w.backgroundColor = C.bg;
    w.setPadding(14, 15, 12, 15);
    if (fam === "small") small(w, cur, nxt, win, kind);
    else if (fam === "large" || fam === "extraLarge") large(w, cur, nxt, win, fresh);
    else medium(w, cur, nxt, win, fresh);
  }
}

if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(w);
else if (fam === "small") await w.presentSmall();
else if (fam === "medium") await w.presentMedium();
else await w.presentLarge();
Script.complete();
