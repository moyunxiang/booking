# HKUST Library Booking 爬虫

抓取 https://lbbooking.hkust.edu.hk/calendar/ 每天各房间的预约情况（area 3 / 8 / 20），
生成静态网页，发布在 https://moyunxiang.com/booking/ （GitHub Pages，main 分支 `docs/`）。

```
library/          图书馆爬虫（auth.py 登录，scrape.py 抓取）
docs/index.html   入口页：选 Library / Facility
docs/library/     图书馆视图 → moyunxiang.com/booking/library/
docs/facility/    （以后）篮球场等设施
```

## 用法

```sh
uv run python library/auth.py        # 首次 / 登录失效时：弹出 Chrome 窗口手动登录 HKUST
uv run python library/scrape.py      # 抓今天起 7 天（--days N / --date YYYY-MM-DD / --areas 3,8）
./run.sh                     # 定时任务入口：抓取 + git 提交推送 docs
```

- 登录状态保存在 `.auth/library-chrome-profile`（Chrome profile，已 gitignore）；抓取用同一 profile 的 headless Chrome 发请求。
- 登录失效时 `scrape.py` 以退出码 2 结束，并弹 macOS 通知提示重新运行 `library/auth.py`。
- 服务器有限流（请求太快返回 Apache 403），所以每次请求间隔 15 秒，遇到 403 会退避重试。

## 数据

- `data/library/YYYY-MM-DD.json`：完整数据，含预约人姓名，**只存在本地**
- `docs/library/data/YYYY-MM-DD.json`：去掉姓名的公开版本，供网页展示

每条预约：`date, area, area_name, room_id, room, start, end, type, status, entry_id`（私有版多 `name`）。
`type` 是 MRBS 原始类型码；`H` = Unbookable（`status: unbookable`），其余（U/R/T/S/D…）都是 `status: booked`。

## 定时运行（macOS launchd，每天 7/10/13/16/19/22 点）

```sh
cp com.moyunxiang.hkust-booking.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.moyunxiang.hkust-booking.plist
```

日志在 `logs/run.log`。
