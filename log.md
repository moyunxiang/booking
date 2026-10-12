# 项目日志

> 追加记录，不删除。2026-10-12 之前的过程见 git 历史（main 分支提交信息）与 README。

#### 2026-10-12 16:15 HKT — 建立 plan.md / log.md，开始羽毛球订阅通知

**背景**：用户要求给羽毛球做一个订阅链接，所有订阅者都能收到空场通知（早上 8–10 点不算）。仓库此前没有 plan.md / log.md，按全局规则补建。  
**操作**：
- 查看羽毛球数据：`docs/facilities/data/badminton.json`（2026-10-12 15:15 抓取），8 天内空位 3–9 个/天，全部早于 10:00。
- 查看设施抓取耗时：`grep -E "^=== .*facility|facility scrape exit" logs/run.log`，近几轮约 30 分钟/轮。
- 导出 fbs 表单字段：只有 `filters[facility_type]` / `filters[location]` / `filters[facility]` / `filters[date]`，无时间过滤。
- 检查 ntfy.sh：`curl https://ntfy.sh/v1/health` 直连 200（0.9s），走 shell 代理超时；Python urllib 可达。
- ntfy iOS App：https://apps.apple.com/hk/app/ntfy/id1625396347  
**结果**：羽毛球 ≥10:00 空位稀缺，通知量会很小；但逐个场地查时段很慢，需要缓存。  
**决策 / 假设**：
- 推送渠道选 ntfy.sh 公共话题：订阅者装 ntfy App 订阅话题即可，无需后台、无需注册。
- 假设 A1：已确认场地的时段 30 分钟内基本不变；对「有空」场地的时段缓存 30 分钟，「满→有空」每轮都能立刻发现。验证：观察 monitor.log 的耗时与通知延迟。  
**下一步**：改 `facility/monitor.py` 支持多类型 + ntfy；新增订阅页；本地验证后发布。

#### 2026-10-12 16:25 HKT — 羽毛球订阅通知：monitor 改造 + 订阅页上线

**背景**：P0 羽毛球空场订阅通知。  
**操作**：
- 重写 `facility/monitor.py`：`WATCHES` 同时监控 basketball（仅室内，推 Bark 给我）和 badminton（推 ntfy 公开话题 `hkust-badminton-2cd292`）；同一个 Chrome 会话里依次查；羽毛球「有空」场地的时段缓存 `CACHE_TTL=1800` 秒；状态文件兼容旧格式（`free` 列表 → `{"basketball": [...]}`）。
- 新增 `docs/facilities/subscribe.html`（订阅步骤、话题名、规则说明）；设施页切到羽毛球时显示「🔔 订阅空场通知」，页脚加链接。
- `Makefile` 的 `make log` 改为匹配新日志格式 `free=`。
- 冒烟测试：`short()` / `fmt()` / `load_state()` 输出符合预期；本地 Playwright 截图订阅页与设施页，无 JS 报错，订阅链接仅羽毛球显示。
- `./run.sh publish` → gh-pages `af29f02`，含 `facilities/subscribe.html`。  
**结果**：订阅页已发布；监控第一轮（无缓存）16:15 左右开始，仍在运行中，耗时待记录。  
**决策 / 假设**：未改 launchd 频率（仍 5 分钟）。稳态每轮耗时预计约 4–5 分钟（假设：8 次 GET+search ≈ 80s，加每轮约 1/6 有空场地重新点进 ≈ 100s，加篮球约 110s），**未验证**；若超过 5 分钟，改为羽毛球每 10–15 分钟查一次。  
**下一步**：等用户装好 ntfy 后发测试推送；记录第一轮与稳态耗时；main 代码提交。

#### 2026-10-12 16:40 HKT — ntfy 点击改开 USThing；设施页大按钮

**背景**：用户反馈点 ntfy 通知打开的是网页，希望直接打开 USThing；并要求「订阅空场通知」「去官网预约」做成大按钮。  
**操作**：
- `facility/monitor.py` 的 `ntfy()`：`click` 改为 `usthing://`，按钮改为「打开预约网页」→ fbs。发测试 #3（16:28:19）。
- `docs/facilities/index.html` / `docs/style.css`：类型标签下新增 `.cta` 一排大按钮（去官网预约：实心；订阅空场通知：琥珀色描边，仅羽毛球显示），移除标题旁的小链接。
- Playwright 截图 390px 浅色 / 1100px 深色，无 JS 报错；篮球页不显示订阅按钮。
- `./run.sh publish` 发布 gh-pages。  
**结果**：已发布。测试 #1/#2 用户收到；测试 #3 是否打开 USThing 待用户确认。  
**下一步**：提交 main；记录监控首轮和稳态耗时。

#### 2026-10-12 16:50 HKT — 修复 CSS 缓存导致新按钮显示为纯文字

**背景**：用户反馈设施页没显示大按钮，只有纯文字。  
**操作**：`curl -sI https://moyunxiang.com/booking/style.css` → `cache-control: max-age=14400`（Cloudflare），线上 CSS 已含 `.cta`，判断为浏览器缓存旧 CSS；HTML 为 `max-age=600`。`run.sh publish` 增加：按 `shasum` 给页面里的 `style.css` / `app.js` 引用加 `?v=<8位哈希>`。重复运行验证为 `no changes`（幂等）。  
**结果**：已发布 gh-pages；HTML 缓存 10 分钟内过期后，浏览器会拉取新 CSS。  
**下一步**：等用户刷新确认。

#### 2026-10-12 16:55 HKT — ntfy 话题改名

**背景**：用户要求订阅话题改为 `hkust-badminton-moyunxiang`。  
**操作**：`sed -i '' 's/hkust-badminton-2cd292/hkust-badminton-moyunxiang/g' facility/monitor.py docs/facilities/subscribe.html plan.md`；`./run.sh publish`。  
**结果**：订阅页与监控都改用新话题；旧话题 `hkust-badminton-2cd292` 不再推送，已订阅旧话题的人需重新订阅（目前只有用户本人）。  
**下一步**：用户订阅新话题后发测试推送。
