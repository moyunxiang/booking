"""抓取 HKUST 体育设施（fbs.hkust.edu.hk）各场地每小时的可预约情况。

  uv run python facility/scrape.py                 # 所有类型，今天起 8 天（每天 08:00 开放 7 天后）
  uv run python facility/scrape.py --types basketball --days 3

输出：
  docs/facilities/data/<type>.json   各类型 8 天 × 场地 × 时段
  docs/facilities/data/index.json    类型列表 + 更新时间

退出码：0 成功；2 登录失效（需运行 auth.py 重新登录）；1 其他错误。
"""
import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent.parent))
from auth import browser, silent_login  # noqa: E402
from fbs import FBS, SessionExpired, courts, timeslots  # noqa: E402

# 设施类型：key → 系统里的 facility_type id + 显示名
TYPES = {
    "basketball": {"id": "2", "name": "篮球", "en": "Basketball"},
}
HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
PUBLIC_DIR = ROOT / "docs" / "facilities" / "data"
DELAY = 2  # 秒；服务器本身就慢（每个请求约 5 秒），再稍微隔开一点


def scrape_day(ctx, ftype: str, day: str) -> list[dict]:
    """某天某类型的所有场地；有空的场地再点进去拿每小时时段。"""
    # Drupal 表单状态只能用一次：连续搜索 / 连续点场地，从第二次起结果就不对了。
    # 所以每次都重新拿表单令牌：先搜一次拿场地列表，之后每个有空的场地再各自「搜索 → 点进去」。
    f = FBS(ctx)
    time.sleep(DELAY)
    out = []
    first = True
    for c in courts(f.search(ftype, day)):
        slots = None
        if c["available"]:
            if not first:
                f = FBS(ctx)
                time.sleep(DELAY)
                f.search(ftype, day)
            time.sleep(DELAY)
            slots = timeslots(f.select(ftype, day, c["id"]))
            first = False
        out.append({**c, "indoor": "outdoor" not in c["name"].lower(), "slots": slots})
    return out


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1))


def notify(msg: str):
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "HKUST 设施爬虫"'], check=False)


def scrape(types: list[str], ndays: int):
    now = datetime.now(HK)
    days = [(now.date() + timedelta(i)).isoformat() for i in range(ndays)]
    with browser() as ctx:
        relogged = False
        for key in types:
            t = TYPES[key]
            result = []
            for day in days:
                try:
                    cs = scrape_day(ctx, t["id"], day)
                except SessionExpired:
                    if relogged or not silent_login(ctx, "facility"):
                        raise
                    relogged = True
                    print("会话已过期，已自动重新登录", flush=True)
                    cs = scrape_day(ctx, t["id"], day)
                free = sum(1 for c in cs for s in (c["slots"] or []) if s["available"])
                print(f"{key} {day} courts={len(cs)} free_slots={free}", flush=True)
                result.append({"date": day, "courts": cs})
            write_json(PUBLIC_DIR / f"{key}.json", {
                "type": key, **t, "fetched_at": now.isoformat(timespec="seconds"), "days": result,
            })
    write_json(PUBLIC_DIR / "index.json", {
        "updated_at": now.isoformat(timespec="seconds"),
        "types": [{"key": k, **v} for k, v in TYPES.items() if (PUBLIC_DIR / f"{k}.json").exists()],
    })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--types", default=",".join(TYPES))
    ap.add_argument("--days", type=int, default=8)
    args = ap.parse_args()
    try:
        scrape(args.types.split(","), args.days)
    except SessionExpired:
        msg = "设施系统登录已失效，请运行: uv run python auth.py"
        print(msg, file=sys.stderr)
        notify(msg)
        sys.exit(2)


if __name__ == "__main__":
    main()
