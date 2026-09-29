"""抓取 HKUST Library Booking 每日各房间预约情况。

  uv run python library/scrape.py              # 从今天起抓 7 天
  uv run python library/scrape.py --days 3
  uv run python library/scrape.py --date 2026-09-30

输出：
  data/library/YYYY-MM-DD.json   含预约人姓名，仅本地（已 gitignore）
  docs/library/data/YYYY-MM-DD.json      去掉姓名，供网页展示
  docs/library/data/index.json           可用日期 + 更新时间

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

from auth import BASE, browser

AREAS = {3: "Group Study Rooms", 8: "LC Study Rooms", 20: "Study Pods"}
TYPE_STATUS = {"H": "unbookable"}  # 其余类型码 (U/R/T/S/D...) 均为正常预约
HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
PRIVATE_DIR = ROOT / "data" / "library"
PUBLIC_DIR = ROOT / "docs" / "library" / "data"
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


def scrape(days: list[date], areas: list[int]):
    now = datetime.now(HK).isoformat(timespec="seconds")
    with browser() as ctx:
        for i, day in enumerate(days):
            results = []
            for j, area in enumerate(areas):
                if i or j:
                    time.sleep(DELAY)
                d = parse_day(fetch(ctx, day, area), day, area)
                print(f"{day} area={area:<3} rooms={len(d['rooms']):<3} bookings={len(d['bookings'])}",
                      flush=True)
                results.append(d)
            snap = {"date": day.isoformat(), "fetched_at": now, "areas": results}
            write_json(PRIVATE_DIR / f"{day}.json", snap)
            public = json.loads(json.dumps(snap))
            for a in public["areas"]:
                for b in a["bookings"]:
                    b.pop("name")
            write_json(PUBLIC_DIR / f"{day}.json", public)

    dates = sorted(p.stem for p in PUBLIC_DIR.glob("????-??-??.json"))
    write_json(PUBLIC_DIR / "index.json", {
        "updated_at": now,
        "dates": dates,
        "areas": [{"id": a, "name": AREAS.get(a, str(a))} for a in areas],
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--date", help="只抓某一天 YYYY-MM-DD")
    ap.add_argument("--areas", default=",".join(map(str, AREAS)))
    args = ap.parse_args()
    today = datetime.now(HK).date()
    days = ([date.fromisoformat(args.date)] if args.date
            else [today + timedelta(i) for i in range(args.days)])
    try:
        scrape(days, [int(a) for a in args.areas.split(",")])
    except SessionExpired:
        msg = "登录已失效，请运行: uv run python library/auth.py"
        print(msg, file=sys.stderr)
        notify(msg)
        sys.exit(2)


if __name__ == "__main__":
    main()
