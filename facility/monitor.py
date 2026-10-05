"""盯篮球室内场：出现新的空位就推送到 iPhone（Bark），同时弹 Mac 通知。

  uv run python facility/monitor.py            # 检查一次（launchd 每 5 分钟跑一次）
  uv run python facility/monitor.py --test     # 只发一条测试消息

Bark 推送地址写在 .auth/notify.json：{"bark": "https://api.day.app/<你的 key>"}（不进 git）。
状态（已通知过的空位）存在 logs/monitor_state.json：同一个空位只通知一次，被订走后再空出来会再通知。
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
from auth import browser, silent_login  # noqa: E402
from fbs import SessionExpired  # noqa: E402
from scrape import TYPES, scrape_day  # noqa: E402

HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
STATE = ROOT / "logs" / "monitor_state.json"
CONF = ROOT / ".auth" / "notify.json"
BOOK_URL = "usthing://"  # 点推送打开 USThing App（它不支持直达预约页，进去后自己点进设施预约）
WATCH = "basketball"  # 只通知篮球室内场
EARLIEST = "10:00"    # 只通知这个时间及以后开始的时段（早上来不及去）
WD = "一二三四五六日"

SHORT = {"Basketball Court A (half court)": "A 半场", "Basketball Court B (half court)": "B 半场",
         "Basketball full court": "全场"}


def send(title: str, body: str):
    """弹一条 Mac 通知，再推送到 notify.json 里配置的渠道。"""
    subprocess.run(["osascript", "-e", "on run argv", "-e",
                    'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"',
                    "-e", "end run", title, body], check=False)
    conf = json.loads(CONF.read_text()) if CONF.exists() else {}
    if conf.get("bark"):
        bark(conf["bark"], title, body)


def bark(url: str, title: str, body: str):
    # Bark：POST 到 https://api.day.app/<key>，timeSensitive 在专注模式下也会提醒，点通知打开 USThing
    payload = {"title": title, "body": body, "url": BOOK_URL, "group": "HKUST 篮球场",
               "level": "timeSensitive", "sound": "multiwayinvitation"}
    req = urllib.request.Request(url.rstrip("/"), data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.loads(r.read())
        if res.get("code") != 200:
            print("Bark 推送失败:", res, flush=True)
    except Exception as e:
        print("Bark 推送失败:", e, flush=True)


def load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"free": [], "expired_notified": False}


def check() -> list[dict]:
    """8 天内篮球室内场所有未开始、且不早于 EARLIEST 的空时段。"""
    now = datetime.now(HK)
    days = [(now.date() + timedelta(i)).isoformat() for i in range(8)]
    ftype = TYPES[WATCH]["id"]
    out = []
    with browser() as ctx:
        relogged = False
        for day in days:
            try:
                cs = scrape_day(ctx, ftype, day, detail=lambda c: c["indoor"])
            except SessionExpired:
                if relogged or not silent_login(ctx, "facility"):
                    raise
                relogged = True
                cs = scrape_day(ctx, ftype, day, detail=lambda c: c["indoor"])
            for c in cs:
                for s in c["slots"] or []:
                    start = datetime.fromisoformat(f"{day}T{s['start']}:00").replace(tzinfo=HK)
                    if c["indoor"] and s["available"] and start > now and s["start"] >= EARLIEST:
                        out.append({"key": f"{day}|{c['id']}|{s['start']}", "date": day, "start": s["start"],
                                    "court": SHORT.get(c["name"], c["name"]), "location": c["location"]})
    return out


def fmt(x: dict) -> str:
    d = datetime.fromisoformat(x["date"])
    end = f"{int(x['start'][:2]) + 1:02d}:00"
    return f"{d.month}/{d.day} 周{WD[d.weekday()]} {x['start']}–{end}  {x['court']}（{x['location'].replace('SPORTS - ', '')}）"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()
    if args.test:
        send("🏀 测试通知", f"篮球室内场监控测试 {datetime.now(HK):%H:%M:%S}")
        return
    state = load_state()
    t0 = time.time()
    try:
        free = check()
    except SessionExpired:
        print("登录已失效", flush=True)
        if not state.get("expired_notified"):
            send("🏀 篮球场监控暂停", "HKUST 登录已失效，请在 Mac 上运行 uv run python auth.py 重新登录。")
            state["expired_notified"] = True
            STATE.write_text(json.dumps(state))
        sys.exit(2)
    known = set(state.get("free", []))
    new = [x for x in free if x["key"] not in known]
    print(f"{datetime.now(HK):%F %T} indoor free={len(free)} new={len(new)} ({time.time() - t0:.0f}s)", flush=True)
    if new:
        lines = [fmt(x) for x in sorted(new, key=lambda x: x["key"])]
        send(f"🏀 室内篮球场有 {len(lines)} 个新空位", "\n".join(lines[:10]) + (f"\n…共 {len(lines)} 个" if len(lines) > 10 else ""))
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps({"free": [x["key"] for x in free], "expired_notified": False}))


if __name__ == "__main__":
    main()
