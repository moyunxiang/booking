"""抓取 HKUST Library Booking 每日各房间预约情况。

  uv run python library/scrape.py              # 自习室从今天起 7 天 + 3D 打印机 15 天
  uv run python library/scrape.py --days 3 --print3d-days 2
  uv run python library/scrape.py --date 2026-09-30
  uv run python library/scrape.py --sites print3d

同一个预约系统里的几块分开存（SITES），网页 / 小组件各读各的：
  library   自习室 area 3/8/20 → data/library/、docs/library/data/
  print3d   3D 打印机 area 14  → data/print3d/、docs/print3d/data/
            （可提前两周预约、常常一周内全满，所以默认抓今天起 15 天）
每块输出：
  data/<site>/YYYY-MM-DD.json          含预约人姓名，仅本地（已 gitignore）
  docs/<site>/data/YYYY-MM-DD.json     去掉姓名，供网页展示
  docs/<site>/data/index.json          可用日期 + 更新时间

退出码：0 成功；2 登录失效（需运行 auth.py 重新登录）；1 其他错误。
"""
import argparse
import json
import re
import subprocess
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).parent.parent))
from auth import LIBRARY as BASE, browser, silent_login  # noqa: E402

SITES = {
    "library": {3: "Group Study Rooms", 8: "LC Study Rooms", 20: "Study Pods"},
    "print3d": {14: "3D Printers"},
}
AREAS = {a: n for areas in SITES.values() for a, n in areas.items()}
TYPE_STATUS = {"H": "unbookable"}  # 其余类型码 (U/R/T/S/D...) 均为正常预约
HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
DELAY = 15  # 秒；服务器有限流，连续快速请求会返回 403


class SessionExpired(Exception):
    pass


def hhmm(sec: int) -> str:
    return f"{sec // 3600:02d}:{sec % 3600 // 60:02d}"


def parse_day(html: str, day: date, area: int) -> dict:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", id="day_main")
    if table is None:
        raise ValueError("页面中没有 #day_main")
    res = int(table["data-resolution"])

    rooms = []
    for th in table.thead.find_all("th", attrs={"data-room": True}):
        label = th.a.get_text(strip=True)
        m = re.fullmatch(r"(.*?)\s*\((\d+)\)", label)
        rooms.append({
            "id": int(th["data-room"]),
            "name": m.group(1) if m else label,
            "capacity": int(m.group(2)) if m else None,
        })

    rows = table.tbody.find_all("tr", recursive=False)
    slots = [int(tr.find("td", class_="row_labels")["data-seconds"]) for tr in rows]
    busy = [0] * len(rooms)  # 每列还被上方 rowspan 占用的行数
    bookings = []
    for r, tr in enumerate(rows):
        cells = [td for td in tr.find_all("td", recursive=False)
                 if "row_labels" not in td.get("class", [])]
        it = iter(cells)
        for c in range(len(rooms)):
            if busy[c]:
                busy[c] -= 1
                continue
            td = next(it)
            span = int(td.get("rowspan", 1))
            busy[c] = span - 1
            div = td.find("div", attrs={"data-type": True})
            if div is None:
                continue  # 空闲格
            start = slots[r]
            end_row = r + span
            end = slots[end_row] if end_row < len(slots) else slots[-1] + res
            code = div["data-type"]
            bookings.append({
                "date": day.isoformat(),
                "area": area,
                "area_name": AREAS.get(area, str(area)),
                "room_id": rooms[c]["id"],
                "room": rooms[c]["name"],
                "start": hhmm(start),
                "end": hhmm(end),
                "type": code,
                "status": TYPE_STATUS.get(code, "booked"),
                "entry_id": int(div["data-id"]),
                "name": div.get_text(strip=True),
            })
        if next(it, None) is not None:
            raise ValueError(f"第 {r} 行单元格数与房间数不符")

    return {
        "date": day.isoformat(),
        "area": area,
        "area_name": AREAS.get(area, str(area)),
        "resolution": res,
        "open": hhmm(slots[0]),
        "close": hhmm(slots[-1] + res),
        "rooms": rooms,
        "bookings": bookings,
    }


def fetch(ctx, day: date, area: int) -> str:
    url = f"{BASE}day.php?year={day.year}&month={day.month}&day={day.day}&area={area}"
    for attempt in range(4):
        r = ctx.request.get(url)
        if not r.url.startswith(BASE) or "cas/login" in r.url:
            raise SessionExpired
        if r.status == 200:
            if 'id="day_main"' not in (text := r.text()):
                raise SessionExpired
            return text
        if r.status == 403:  # 限流，退避后重试
            wait = 120 * (attempt + 1)
            print(f"  403 限流，{wait}s 后重试", flush=True)
            time.sleep(wait)
            continue
        raise RuntimeError(f"HTTP {r.status}: {url}")
    raise RuntimeError(f"多次 403: {url}")


def notify(msg: str):
    subprocess.run(["osascript", "-e",
                    f'display notification "{msg}" with title "HKUST Booking 爬虫"'],
                   check=False)


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1))


def scrape(plan: dict[str, list[date]]):
    """plan：{site: 要抓的日期}。按日期顺序抓，每个请求之间隔 DELAY。"""
    now = datetime.now(HK).isoformat(timespec="seconds")
    first = True
    with browser() as ctx:
        relogged = False

        def get(day, area):
            nonlocal relogged
            try:
                return fetch(ctx, day, area)
            except SessionExpired:
                # 会话过期：先试一次后台静默登录（需要 Microsoft「保持登录」），成功就重试
                if relogged or not silent_login(ctx, "library"):
                    raise
                relogged = True
                print("会话已过期，已自动重新登录", flush=True)
                time.sleep(DELAY)
                return fetch(ctx, day, area)

        for day in sorted({d for ds in plan.values() for d in ds}):
            for site in [s for s in plan if day in plan[s]]:
                results = []
                for area in SITES[site]:
                    if not first:
                        time.sleep(DELAY)
                    first = False
                    d = parse_day(get(day, area), day, area)
                    print(f"{day} area={area:<3} rooms={len(d['rooms']):<3} bookings={len(d['bookings'])}",
                          flush=True)
                    results.append(d)
                snap = {"date": day.isoformat(), "fetched_at": now, "areas": results}
                write_json(ROOT / "data" / site / f"{day}.json", snap)
                public = json.loads(json.dumps(snap))
                for a in public["areas"]:
                    for b in a["bookings"]:
                        b.pop("name")
                write_json(public_dir(site) / f"{day}.json", public)

    for site in plan:
        write_index(now, site)


def public_dir(site: str) -> Path:
    return ROOT / "docs" / site / "data"


def closed_areas(snap: dict) -> list[int]:
    """全天都是 Unbookable 的 area（公众假期等）。"""
    out = []
    for a in snap["areas"]:
        full = {b["room_id"] for b in a["bookings"]
                if b["status"] == "unbookable" and b["start"] == a["open"] and b["end"] == a["close"]}
        if a["rooms"] and full >= {r["id"] for r in a["rooms"]}:
            out.append(a["area"])
    return out


def write_index(now: str, site: str):
    files = sorted(public_dir(site).glob("????-??-??.json"))
    dates = [p.stem for p in files]
    closed = {p.stem: c for p in files if (c := closed_areas(json.loads(p.read_text())))}
    write_json(public_dir(site) / "index.json", {
        "updated_at": now,
        "dates": dates,
        "closed": closed,
        "areas": [{"id": a, "name": n} for a, n in SITES[site].items()],
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7, help="自习室抓几天")
    ap.add_argument("--print3d-days", type=int, default=15, help="3D 打印机抓几天（可提前两周预约）")
    ap.add_argument("--date", help="只抓某一天 YYYY-MM-DD")
    ap.add_argument("--sites", default=",".join(SITES), help="逗号分隔：" + " / ".join(SITES))
    args = ap.parse_args()
    today = datetime.now(HK).date()
    n = {"library": args.days, "print3d": args.print3d_days}
    plan = {s: [date.fromisoformat(args.date)] if args.date else [today + timedelta(i) for i in range(n[s])]
            for s in args.sites.split(",")}
    try:
        scrape(plan)
    except SessionExpired:
        msg = "登录已失效，请在本目录运行: make update"
        print(msg, file=sys.stderr)
        notify(msg)
        sys.exit(2)


if __name__ == "__main__":
    main()
