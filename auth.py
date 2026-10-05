"""HKUST 登录状态管理（所有站点共用）。

一个持久化的 Chrome profile (.auth/hkust-chrome-profile) 同时保存各站点的会话：
登录时你只需在 CAS 登录一次，脚本会在同一次浏览器会话里依次进入各站点，让每个站点都拿到自己的会话。

  uv run python auth.py           # 弹出 Chrome 窗口，手动完成 HKUST 登录
  uv run python auth.py --check   # 后台检查各站点是否还登录着（不弹窗口）

爬虫在同一个 profile 里用 Playwright 发请求（导出的 cookie 给 requests 用会被服务器拒绝）。
"""
import fcntl
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
PROFILE_DIR = ROOT / ".auth" / "hkust-chrome-profile"
LIBRARY = "https://lbbooking.hkust.edu.hk/calendar/"
FACILITY = "https://fbs.hkust.edu.hk/"

# 每个站点：进入地址 + 判断「已登录」的方法
SITES = {
    "library": {
        "url": LIBRARY + "day.php?area=8",
        "ok": lambda page: page.url.startswith(LIBRARY) and page.locator("#day_main").count() > 0,
    },
    "facility": {
        "url": FACILITY + "facilities",
        "ok": lambda page: page.url.startswith(FACILITY) and "casservice" not in page.url,
    },
}


@contextmanager
def browser(headless: bool = True):
    """打开共用的 Chrome profile。同一时间只能有一个进程用它，所以先拿文件锁排队（图书馆抓取 / 篮球场监控）。"""
    PROFILE_DIR.parent.mkdir(mode=0o700, exist_ok=True)
    with open(PROFILE_DIR.parent / "profile.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with _launch(headless) as ctx:
            yield ctx


@contextmanager
def _launch(headless: bool):
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE_DIR, channel="chrome", headless=headless
        )
        try:
            yield ctx
        finally:
            ctx.close()


def _enter(page, site: str, timeout: int) -> bool:
    """打开站点并等待进入登录后的页面。"""
    s = SITES[site]
    try:
        page.goto(s["url"], wait_until="domcontentloaded", timeout=60_000)
    except Exception as e:  # 网络慢：窗口留着，手动刷新即可
        print(f"{site} 页面加载失败（{type(e).__name__}），可以在窗口里刷新重试")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            if s["ok"](page):
                return True
        except Exception:
            pass
        page.wait_for_timeout(1000)
    return False


def silent_login(ctx, site: str, timeout: int = 30) -> bool:
    """会话过期后在后台自动走一遍 SSO（需要 Microsoft「保持登录」）；需要人工操作时返回 False。"""
    page = ctx.new_page()
    try:
        return _enter(page, site, timeout)
    finally:
        page.close()


def login(timeout: int = 300) -> bool:
    with browser(headless=False) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        print(f"请在弹出的 Chrome 窗口里完成 HKUST 登录（最多等待 {timeout} 秒）...")
        print("Microsoft 问「Stay signed in?」时请选 Yes，以后会话过期可以自动重新登录。")
        ok = True
        for site in SITES:
            # 已登录的站点会直接通过；需要登录的站点等你在窗口里操作（CAS 登录一次后，其余站点一般自动跳转）
            good = _enter(page, site, timeout)
            print(f"  {site}: {'已登录' if good else '失败'}")
            ok &= good
        return ok


def check() -> bool:
    with browser() as ctx:
        ok = True
        for site in SITES:
            good = silent_login(ctx, site)
            print(f"  {site}: {'已登录' if good else '已失效'}")
            ok &= good
        return ok


if __name__ == "__main__":
    if "--check" in sys.argv:
        ok = check()
        print("登录有效" if ok else "需要重新登录：make login")
    else:
        ok = login()
        print("登录成功" if ok else "登录未全部成功")
    sys.exit(0 if ok else 1)
