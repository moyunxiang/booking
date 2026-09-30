# HKUST Booking 爬虫

抓取 https://lbbooking.hkust.edu.hk/calendar/ 每天各房间的预约情况（area 3 / 8 / 20），
生成静态网页，发布在 https://moyunxiang.com/booking/ （GitHub Pages，main 分支 `docs/`）。

```
library/          图书馆爬虫（auth.py 登录，scrape.py 抓取）
docs/index.html   入口页：选 Library / Facility
docs/library/     图书馆视图 → moyunxiang.com/booking/library/
facility/         体育设施爬虫（fbs.py 客户端，scrape.py 抓取）
docs/facilities/  体育设施视图 → moyunxiang.com/booking/facilities/
```

## 用法

```sh
uv run python auth.py        # 首次 / 登录失效时：弹出 Chrome 窗口手动登录 HKUST
uv run python library/scrape.py      # 抓今天起 7 天（--days N / --date YYYY-MM-DD / --areas 3,8）
./run.sh                     # 定时任务入口：抓取 + git 提交推送 docs
```

- 登录状态保存在 `.auth/library-chrome-profile`（Chrome profile，已 gitignore）；抓取用同一 profile 的 headless Chrome 发请求。
- 登录失效时 `scrape.py` 以退出码 2 结束，并弹 macOS 通知提示重新运行 `auth.py`。
- 服务器有限流（请求太快返回 Apache 403），所以每次请求间隔 15 秒，遇到 403 会退避重试。

## 数据

- `data/library/YYYY-MM-DD.json`：完整数据，含预约人姓名，**只存在本地**
- `docs/library/data/YYYY-MM-DD.json`：去掉姓名的公开版本，供网页展示

每条预约：`date, area, area_name, room_id, room, start, end, type, status, entry_id`（私有版多 `name`）。
`type` 是 MRBS 原始类型码；`H` = Unbookable（`status: unbookable`），其余（U/R/T/S/D…）都是 `status: booked`。

## 定时运行（macOS launchd，Mac 醒着时）

| launchd 任务 | 频率 | 做什么 |
|---|---|---|
| `com.moyunxiang.hkust-booking` | 07:00–23:30 每 30 分钟 | `run.sh library`：图书馆（每天首次抓 7 天，其余抓今明两天） |
| `com.moyunxiang.hkust-booking-facility` | 07:15–23:15 每小时 | `run.sh facility`：篮球 + 羽毛球 8 天 |
| `com.moyunxiang.hkust-booking-monitor` | 每 5 分钟 | `facility/monitor.py`：篮球室内场 10:00 后出现新空位 → Bark 推送 |

```sh
cp com.moyunxiang.hkust-booking*.plist ~/Library/LaunchAgents/
for p in ~/Library/LaunchAgents/com.moyunxiang.hkust-booking*.plist; do launchctl load "$p"; done
```

三个任务共用一个 Chrome profile，`auth.py` 里用文件锁排队；日志在 `logs/`。
Bark 地址写在 `.auth/notify.json`：`{"bark": "https://api.day.app/<key>"}`。
