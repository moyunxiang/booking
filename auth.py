"""登录状态管理：用一个持久化的 Chrome profile (.auth/chrome-profile) 保存 MRBS 会话。

  uv run python auth.py      # 弹出 Chrome 窗口，手动完成 HKUST 登录

爬虫直接在同一个 profile 里用 Playwright 的 request API 发请求
（导出的 cookie 给 requests 用会被服务器拒绝，所以不导出）。
"""
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).parent
PROFILE_DIR = ROOT / ".auth" / "chrome-profile"
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


def login(timeout: int = 300) -> bool:
    with browser(headless=False) as ctx:
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(BASE + "day.php?area=8", wait_until="domcontentloaded")
        print(f"请在弹出的 Chrome 窗口里完成 HKUST 登录（最多等待 {timeout} 秒）...")
        deadline = time.time() + timeout
        while time.time() < deadline:
            if page.url.startswith(BASE) and page.locator("#day_main").count():
                return True
            page.wait_for_timeout(1000)
    return False


if __name__ == "__main__":
    ok = login()
    print("登录成功" if ok else "登录超时")
    sys.exit(0 if ok else 1)
