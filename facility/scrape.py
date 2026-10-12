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
    "badminton": {"id": "3", "name": "羽毛球", "en": "Badminton"},
}
HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
PUBLIC_DIR = ROOT / "docs" / "facilities" / "data"
CACHE = ROOT / "logs" / "fbs_cache.json"  # 场地时段缓存，网页抓取和监控共用（都在 profile 锁里读写）
CACHE_TTL = 1800  # 秒；缓存超过这个时间才有资格被重新点进去
REFRESH = 6  # 网页抓取每个类型每次最多重新点几个旧场地（监控也在轮换刷新）
DELAY = 2  # 秒；服务器本身就慢（每个请求约 5 秒），再稍微隔开一点


def scrape_day(ctx, ftype: str, day: str, detail=lambda c: True) -> list[dict]:
    """某天某类型的所有场地；有空的场地（且 detail(场地) 为真）再点进去拿每小时时段。"""
    # Drupal 表单状态只能用一次：连续搜索 / 连续点场地，从第二次起结果就不对了。
    # 所以每次都重新拿表单令牌：先搜一次拿场地列表，之后每个有空的场地再各自「搜索 → 点进去」。
    f = FBS(ctx)
    time.sleep(DELAY)
    out = []
    first = True
    for c in courts(f.search(ftype, day)):
        c["indoor"] = "outdoor" not in c["name"].lower()
        slots = None
        if c["available"] and detail(c):
            if not first:
                f = FBS(ctx)
                time.sleep(DELAY)
                f.search(ftype, day)
            time.sleep(DELAY)
            slots = timeslots(f.select(ftype, day, c["id"]))
            first = False
        out.append({**c, "slots": slots})
    return out


def load_cache() -> dict:
    try:
        return json.loads(CACHE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(cache: dict):
    today = datetime.now(HK).date().isoformat()
    for tc in cache.values():  # 过去的日期不要了
        for ck in [k for k in tc if k.split("|")[0] < today]:
            tc.pop(ck)
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache))


def stale(cache: dict, key: str, n: int | None, ttl: int = CACHE_TTL) -> set[str]:
    """缓存里超过 ttl 的场地中最旧的 n 个（n=None 表示全部）：这一轮要重新点进去的。
    fbs 每个请求约 5–10 秒，点一个场地要 3 个请求；早上 8–10 点空位多时「有空」的羽毛球场有 30+ 个，
    一次全刷要 20 多分钟，所以每轮只轮换刷新几个最旧的。"""
    ts = time.time()
    old = sorted((v["t"], k) for k, v in cache.get(key, {}).items() if ts - v["t"] >= ttl)
    return {k for _, k in old[:n]}


def scrape_day_cached(ctx, key: str, day: str, cache: dict, refresh: set[str], want=lambda c: True) -> list[dict]:
    """同 scrape_day，但缓存里有的「有空」场地直接用缓存的时段，只重新点 refresh 里的。
    「满 → 有空」的场地不在缓存里，总会立刻点进去。cache 原地更新：{类型: {"日期|场地id": {"t", "slots"}}}"""
    tc = cache.setdefault(key, {})
    ts = time.time()

    def detail(c):
        ck = f"{day}|{c['id']}"
        return want(c) and (ck not in tc or ck in refresh)

    cs = scrape_day(ctx, TYPES[key]["id"], day, detail)
    for c in cs:
        ck = f"{day}|{c['id']}"
        if not c["available"]:
            tc.pop(ck, None)
        elif c["slots"] is not None:
            tc[ck] = {"t": ts, "slots": c["slots"]}
        elif ck in tc:
            c["slots"] = tc[ck]["slots"]
    return cs


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1))


def notify(msg: str):
    subprocess.run(["osascript", "-e", f'display notification "{msg}" with title "HKUST 设施爬虫"'], check=False)


def scrape(types: list[str], ndays: int):
    now = datetime.now(HK)
    days = [(now.date() + timedelta(i)).isoformat() for i in range(ndays)]
    with browser() as ctx:
        cache = load_cache()
        relogged = False
        for key in types:
            t = TYPES[key]
            refresh = stale(cache, key, REFRESH)
            result = []
            for day in days:
                try:
                    cs = scrape_day_cached(ctx, key, day, cache, refresh)
                except SessionExpired:
                    if relogged or not silent_login(ctx, "facility"):
                        raise
                    relogged = True
                    print("会话已过期，已自动重新登录", flush=True)
                    cs = scrape_day_cached(ctx, key, day, cache, refresh)
                free = sum(1 for c in cs for s in (c["slots"] or []) if s["available"])
                print(f"{key} {day} courts={len(cs)} free_slots={free}", flush=True)
                result.append({"date": day, "courts": cs})
            write_json(PUBLIC_DIR / f"{key}.json", {
                "type": key, **t, "fetched_at": now.isoformat(timespec="seconds"), "days": result,
            })
        save_cache(cache)
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
        msg = "设施系统登录已失效，请在本目录运行: make update"
        print(msg, file=sys.stderr)
        notify(msg)
        sys.exit(2)


if __name__ == "__main__":
    main()
