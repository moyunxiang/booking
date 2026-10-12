"""盯稀缺场地：出现新的空位（10:00 及以后）就推送，同时弹 Mac 通知。

  uv run python facility/monitor.py            # 检查一次（launchd 每 5 分钟跑一次）
  uv run python facility/monitor.py --test     # 每个渠道发一条测试消息

监控对象（WATCHES）：
  basketball  只看室内场 → Bark，只发给我（.auth/notify.json：{"bark": "https://api.day.app/<key>"}，不进 git）
  badminton   所有场地   → ntfy 公开话题 NTFY_TOPIC，任何人订阅都能收到（订阅页 docs/facilities/subscribe.html）

羽毛球每个「有空」的场地都要单独点进去才能看时段（3 个请求，约 15–40 秒/个），而早上 8–10 点的空位
让 30+ 个场地都显示「有空」，所以羽毛球用 scrape.py 的共用缓存（logs/fbs_cache.json）：
「满 → 有空」的场地每轮都会立刻点进去；已经有空的场地每轮只轮换刷新最旧的 3 个（超过 30 分钟的）。
篮球不用缓存（ttl=0, refresh=None），室内场每轮都点进去。网页抓取（scrape.py）也会复用这些结果。

状态存在 logs/monitor_state.json：同一个空位只通知一次，被订走后再空出来会再通知。
状态和缓存都在 profile 锁里读写：排队等锁的进程不会拿到旧状态。
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).parent.parent))
from auth import auto_login, browser, silent_login  # noqa: E402
from fbs import SessionExpired  # noqa: E402
from scrape import load_cache, save_cache, scrape_day_cached, stale  # noqa: E402

HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
STATE = ROOT / "logs" / "monitor_state.json"
CONF = ROOT / ".auth" / "notify.json"
EARLIEST = "10:00"  # 只通知这个时间及以后开始的时段（早上来不及去）
NTFY = "https://ntfy.sh"
NTFY_TOPIC = "hkust-badminton-moyunxiang"  # 公开话题：订阅页上写着，谁都能订阅
FBS_URL = "https://fbs.hkust.edu.hk/facilities"
WD = "一二三四五六日"

WATCHES = {
    "basketball": {"emoji": "🏀", "label": "室内篮球场", "indoor_only": True, "ttl": 0, "refresh": None, "to": "bark"},
    "badminton": {"emoji": "🏸", "label": "羽毛球场", "indoor_only": False, "ttl": 1800, "refresh": 3, "to": "ntfy"},
}


def mac_notify(title: str, body: str):
    subprocess.run(["osascript", "-e", "on run argv", "-e",
                    'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"',
                    "-e", "end run", title, body], check=False)


def post_json(url: str, payload: dict, ok) -> bool:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.loads(r.read())
        if ok(res):
            return True
        print("推送失败:", url.split("/")[2], res, flush=True)
    except Exception as e:
        print("推送失败:", url.split("/")[2], e, flush=True)
    return False


def bark(title: str, body: str):
    """推给我自己（Bark）。timeSensitive 在专注模式下也会提醒，点通知打开 USThing。"""
    key = json.loads(CONF.read_text()).get("bark") if CONF.exists() else None
    if key:
        post_json(key.rstrip("/"), {"title": title, "body": body, "url": "usthing://", "group": "HKUST 场地",
                                    "level": "timeSensitive", "sound": "multiwayinvitation"},
                  lambda r: r.get("code") == 200)


def ntfy(title: str, body: str):
    """推到公开话题：priority 5（最高），点通知打开 USThing，另带一个「打开预约网页」按钮。"""
    post_json(NTFY, {"topic": NTFY_TOPIC, "title": title, "message": body, "priority": 5,
                     "tags": ["badminton"], "click": "usthing://",
                     "actions": [{"action": "view", "label": "打开预约网页", "url": FBS_URL}]},
              lambda r: r.get("id") is not None)


def send(to: str, title: str, body: str):
    mac_notify(title, body)
    (bark if to == "bark" else ntfy)(title, body)


def load_state() -> dict:
    try:
        s = json.loads(STATE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        s = {}
    if isinstance(s.get("free"), list):  # 旧格式：只有篮球
        s["free"] = {"basketball": s["free"]}
    return {"free": s.get("free", {}), "expired_notified": s.get("expired_notified", False)}


def save_state(state: dict):
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(state))


def check_type(ctx, key: str, cfg: dict, cache: dict, now: datetime) -> list[dict]:
    """某类型 8 天内所有未开始、且不早于 EARLIEST 的空时段。"""
    want = (lambda c: c["indoor"]) if cfg["indoor_only"] else (lambda c: True)
    before = {k: v["t"] for k, v in cache.get(key, {}).items()}
    refresh = stale(cache, key, cfg["refresh"], cfg["ttl"])
    out = []
    for i in range(8):
        day = (now.date() + timedelta(i)).isoformat()
        for c in scrape_day_cached(ctx, key, day, cache, refresh, want=want):
            if not want(c):
                continue
            for s in c["slots"] or []:
                start = datetime.fromisoformat(f"{day}T{s['start']}:00").replace(tzinfo=HK)
                if s["available"] and start > now and s["start"] >= EARLIEST:
                    out.append({"key": f"{day}|{c['id']}|{s['start']}", "date": day, "start": s["start"],
                                "court": c["name"], "location": c["location"]})
    fresh = sum(1 for k, v in cache.get(key, {}).items() if before.get(k) != v["t"])
    print(f"  {key}: 点进 {fresh} 个场地", flush=True)
    return out


def check_and_notify(state: dict):
    """拿到 profile 锁后再读状态和缓存，查完、发完通知、写完状态再放锁。"""
    t0 = time.time()
    with browser() as ctx:
        now = datetime.now(HK)  # 拿到锁之后再取时间：排队期间开始的时段不算空位
        waited = time.time() - t0
        state.update(load_state())
        cache = load_cache()
        free, relogged = {}, False
        for key, cfg in WATCHES.items():
            try:
                free[key] = check_type(ctx, key, cfg, cache, now)
            except SessionExpired:
                if relogged or not silent_login(ctx, "facility"):
                    raise
                relogged = True
                free[key] = check_type(ctx, key, cfg, cache, now)
        save_cache(cache)
        summary = []
        for key, cfg in WATCHES.items():
            known = set(state["free"].get(key, []))
            new = sorted((x for x in free[key] if x["key"] not in known), key=lambda x: x["key"])
            summary.append(f"{key} free={len(free[key])} new={len(new)}")
            if new:
                lines = [fmt(x) for x in new]
                send(cfg["to"], f"{cfg['emoji']} {cfg['label']}有 {len(lines)} 个新空位",
                     "\n".join(lines[:10]) + (f"\n…共 {len(lines)} 个" if len(lines) > 10 else ""))
            state["free"][key] = [x["key"] for x in free[key]]
        state["expired_notified"] = False
        save_state(state)
    print(f"{datetime.now(HK):%F %T} {' | '.join(summary)} (等锁 {waited:.0f}s + 查询 {time.time() - t0 - waited:.0f}s)", flush=True)


def short(name: str) -> str:
    """和网页一样的场地简称：A 半场 / 全场 / 5 号场·单打。"""
    n = name.removeprefix("Basketball ").removeprefix("Badminton ")
    if "full court" in n.lower():
        return "全场"
    parts = n.split()
    if len(parts) >= 2 and parts[0] == "Court":
        c = parts[1]
        if "half" in n.lower():
            return f"{c} 半场"
        return f"{c}{' 号场' if c.isdigit() else ' 场'}{'·单打' if 'singles' in n.lower() else ''}"
    return n


def fmt(x: dict) -> str:
    d = datetime.fromisoformat(x["date"])
    end = f"{int(x['start'][:2]) + 1:02d}:00"
    return f"{d.month}/{d.day} 周{WD[d.weekday()]} {x['start']}–{end}  {short(x['court'])}（{x['location'].replace('SPORTS - ', '')}）"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()
    if args.test:
        t = f"{datetime.now(HK):%H:%M:%S}"
        send("bark", "🏀 测试通知", f"篮球室内场监控测试 {t}")
        send("ntfy", "🏸 测试通知", f"羽毛球空场订阅测试 {t}。以后有 10:00 及以后的空场会推送到这里。")
        return
    state = load_state()
    try:
        check_and_notify(state)
    except SessionExpired:
        print("登录已失效，打开 Chrome 等待登录", flush=True)
        if not state["expired_notified"]:
            send("bark", "🏀 场地监控暂停", "HKUST 登录已失效，Mac 上已弹出 Chrome 登录窗口，登录后自动恢复。")
            state["expired_notified"] = True
            save_state(state)
        if not auto_login(interactive=sys.stdout.isatty()):
            sys.exit(2)
        check_and_notify(state)


if __name__ == "__main__":
    main()
