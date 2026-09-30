"""盯篮球室内场：出现新的空位就发 iMessage（没配置收件人时只弹 Mac 通知）。

  uv run python facility/monitor.py            # 检查一次（launchd 每 5 分钟跑一次）
  uv run python facility/monitor.py --test     # 只发一条测试消息

收件人写在 .auth/notify.json：{"imessage": "你的手机号或 Apple ID"}（不进 git）。
状态（已通知过的空位）存在 logs/monitor_state.json：同一个空位只通知一次，被订走后再空出来会再通知。
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
from fbs import SessionExpired  # noqa: E402
from scrape import TYPES, scrape_day  # noqa: E402

HK = ZoneInfo("Asia/Hong_Kong")
ROOT = Path(__file__).parent.parent
STATE = ROOT / "logs" / "monitor_state.json"
CONF = ROOT / ".auth" / "notify.json"
BOOK_URL = "https://fbs.hkust.edu.hk/facilities"
WATCH = "basketball"  # 只通知篮球室内场
EARLIEST = "10:00"    # 只通知这个时间及以后开始的时段（早上来不及去）
WD = "一二三四五六日"

SHORT = {"Basketball Court A (half court)": "A 半场", "Basketball Court B (half court)": "B 半场",
         "Basketball full court": "全场"}


def send(msg: str):
    """iMessage 给自己配置的收件人；同时弹一条 Mac 通知。"""
    subprocess.run(["osascript", "-e", 'on run argv', "-e",
                    'display notification (item 1 of argv) with title "🏀 室内篮球场" sound name "Glass"',
                    "-e", "end run", msg.split("\n", 1)[-1]], check=False)
    to = json.loads(CONF.read_text()).get("imessage") if CONF.exists() else None
    if not to:
        return
    r = subprocess.run(["osascript", "-e", "on run argv", "-e", 'tell application "Messages"',
                        "-e", "set s to 1st account whose service type = iMessage",
                        "-e", "send (item 2 of argv) to participant (item 1 of argv) of s",
                        "-e", "end tell", "-e", "end run", to, msg], capture_output=True, text=True)
    if r.returncode:
        print("iMessage 发送失败:", r.stderr.strip(), flush=True)


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
        send("🏀 测试：篮球室内场监控的 iMessage 通知\n如果你在手机上收到并且有提醒，就说明设置好了。")
        return
    state = load_state()
    t0 = time.time()
    try:
        free = check()
    except SessionExpired:
        print("登录已失效", flush=True)
        if not state.get("expired_notified"):
            send("🏀 篮球场监控暂停：HKUST 登录已失效\n请在 Mac 上运行 uv run python auth.py 重新登录。")
            state["expired_notified"] = True
            STATE.write_text(json.dumps(state))
        sys.exit(2)
    known = set(state.get("free", []))
    new = [x for x in free if x["key"] not in known]
    print(f"{datetime.now(HK):%F %T} indoor free={len(free)} new={len(new)} ({time.time() - t0:.0f}s)", flush=True)
    if new:
        lines = [fmt(x) for x in sorted(new, key=lambda x: x["key"])]
        send("🏀 室内篮球场有空位！\n" + "\n".join(lines[:10]) + (f"\n…共 {len(lines)} 个" if len(lines) > 10 else "")
             + f"\n预约：{BOOK_URL}")
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps({"free": [x["key"] for x in free], "expired_notified": False}))


if __name__ == "__main__":
    main()
