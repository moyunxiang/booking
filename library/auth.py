"""登录状态管理：用一个持久化的 Chrome profile (.auth/chrome-profile) 保存 MRBS 会话。

  uv run python library/auth.py      # 弹出 Chrome 窗口，手动完成 HKUST 登录

爬虫直接在同一个 profile 里用 Playwright 的 request API 发请求
（导出的 cookie 给 requests 用会被服务器拒绝，所以不导出）。
"""
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent.parent
PROFILE_DIR = ROOT / ".auth" / "library-chrome-profile"
BASE = "https://lbbooking.hkust.edu.hk/calendar/"


@contextmanager
def browser(headless: bool = True):
    PROFILE_DIR.parent.mkdir(mode=0o700, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            PROFILE_DIR, channel="chrome", headless=headless
        )
        try:
            yield ctx
        finally:
            ctx.close()


def _wait_logged_in(page, timeout: int) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if page.url.startswith(BASE) and page.locator("#day_main").count():
            return True
        page.wait_for_timeout(1000)
    return False


def silent_login(ctx, timeout: int = 30) -> bool:
    """会话过期后，靠 Microsoft「保持登录」的 cookie 在后台自动走一遍 SSO；需要人工操作时返回 False。"""
    page = ctx.new_page()
    try:
        page.goto(BASE + "day.php?area=8", wait_until="domcontentloaded")
        return _wait_logged_in(page, timeout)
    except Exception:
        return False
    finally:
        page.close()


def login(timeout: int = 300) -> bool:
    with browser(headless=False) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(BASE + "day.php?area=8", wait_until="domcontentloaded", timeout=60_000)
        except Exception as e:  # 网络慢：窗口留着，手动刷新即可
            print(f"页面加载失败（{type(e).__name__}），可以在窗口里刷新重试")
        print(f"请在弹出的 Chrome 窗口里完成 HKUST 登录（最多等待 {timeout} 秒）...")
        print("Microsoft 问「Stay signed in?」时请选 Yes，以后会话过期可以自动重新登录。")
        return _wait_logged_in(page, timeout)


if __name__ == "__main__":
    ok = login()
    print("登录成功" if ok else "登录超时")
    sys.exit(0 if ok else 1)
