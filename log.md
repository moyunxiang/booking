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

#### 2026-10-12 17:50 HKT — 发现 Chrome 锁争用与状态竞争；改为共用场地缓存

**背景**：定时监控一轮耗时 4778s（16:18 启动，17:38 结束），且对同一空位重复通知（发到旧话题 `hkust-badminton-2cd292` 17:38:22，新话题未重复）。设施网页抓取 16:15→17:10 耗时约 55 分钟。  
**操作 / 分析**：
- 原因 1（bug）：`monitor.py` 在等 profile 锁之前就读了 `monitor_state.json`，排队期间别的进程更新了状态，它拿着旧状态（无缓存、无已通知记录）跑，导致重新点 37 个场地并重复通知。
- 原因 2：`facility/scrape.py` 每小时对所有「有空」场地逐个点进（羽毛球早上 8 点空位多），长时间占锁，监控被饿死。
- 修改：`facility/scrape.py` 新增 `load_cache` / `save_cache` / `scrape_day_cached`，缓存文件 `logs/fbs_cache.json`（TTL 1800s），网页抓取默认使用；`facility/monitor.py` 改用同一缓存（篮球 `ttl=0` 不缓存，羽毛球 1800s），并且在 `with browser()` 内读状态、读写缓存、发通知、写状态。
- 把旧 `monitor_state.json["cache"]` 的 37 条羽毛球缓存迁移到 `logs/fbs_cache.json`。
- 仅做语法检查；17:15 那轮旧代码的设施抓取仍在运行（未强制结束），新代码监控已在后台排队实测。  
**结果**：未验证（等实测耗时）。  
**决策 / 假设**：假设网页抓取复用缓存后可降到约 10 分钟以内；验证：观察 18:15 那轮 `facility scrape exit` 时间与 monitor.log 每轮耗时。  
**下一步**：记录实测耗时；通过后提交 main。

#### 2026-10-12 20:45 HKT — 实测：缓存过期时羽毛球全量重点场地太慢；改为轮换刷新

**背景**：17:50 改为共用缓存后观察实际耗时（P1 锁争用）。  
**操作 / 观察**：
- 18:15 设施抓取（旧代码，进程启动时加载）18:58 以 exit 1 失败：`APIRequestContext.post: Timeout 30000ms exceeded`；随后在 `facility/fbs.py` 加了 `_request` 重试（网络错误 / 5xx 退避重试 4 次）。19:15 那轮里重试生效过两次（Timeout、ECONNRESET），20:02 exit 0。
- 20:08 监控一轮：`等锁+查询` 共 1905s，其中只点进 1 个篮球场、0 个羽毛球场 → 绝大部分是排队等锁。
- 20:08 推送了「10/12 20:00 Seafront 2 号场」到 ntfy，而此时该时段已开始：bug，`now` 在等锁前取值。修复：`check_and_notify` 在拿到锁之后再取 `now`，日志改为分别打印 `等锁 Ns + 查询 Ns`。
- 20:09 手动跑 `uv run python facility/monitor.py`（无其他进程占锁）：`等锁 1s + 查询 1674s`，羽毛球缓存刚好过 30 分钟，37 个场地全部重新点进去。折算 fbs 今晚约 10 秒/请求、约 40 秒/场地。CPU：python 本身 4.6s user + 3.4s sys / 28 分钟。
- 核对 ntfy 历史（`https://ntfy.sh/hkust-badminton-moyunxiang/json?poll=1&since=4h`）：18:37 那轮其实已经推到新话题，18:57 的「补发」是重复的。  
**修改**：
- `facility/scrape.py`：新增 `stale(cache, key, n, ttl)`（缓存中超过 ttl 的最旧 n 个）；`scrape_day_cached` 改为只重新点 `refresh` 集合里的场地，不在缓存里的「有空」场地（满→有空）总是点。网页抓取每类型每次最多刷新 `REFRESH=6` 个。
- `facility/monitor.py`：篮球 `ttl=0, refresh=None`（室内场每轮全点）；羽毛球 `ttl=1800, refresh=3`（每轮最多刷新最旧的 3 个）。
- `docs/facilities/subscribe.html`：说明改为「每 5–10 分钟检查；原本全满的场地马上发现；本来有空的场地上新空出的时段可能 1 小时左右才发现」。  
**结果**：语法 / 导入检查通过（`stale` 对当前缓存返回预期）。实际每轮耗时**未验证**，等新代码跑两轮。  
**决策 / 假设**：假设 A2：每轮羽毛球成本 = 8 次 GET+search + 最多 3 个场地 × 3 请求，今晚约 4–5 分钟；验证：monitor.log 的 `查询 Ns`。  
**下一步**：记录实测；通过后提交 main 并发布订阅页。

#### 2026-10-12 21:35 HKT — 轮换刷新实测通过

**背景**：验证 20:45 的轮换刷新（假设 A2）。  
**操作**：观察 `logs/monitor.log` 与 `logs/run.log`。  
**结果**（fbs 今晚约 10–13 秒/请求）：
- 监控（新代码）21:19：`等锁 1494s + 查询 254s`（等的是旧代码的 20:15 设施抓取，它 21:13 才结束，约 58 分钟）。
- 设施网页抓取（新代码，`REFRESH=6`）21:15 启动，等监控到约 21:19，21:27:39 `facility scrape exit 0`：约 8 分钟（旧代码 47–58 分钟）。
- 监控 21:33：`basketball 点进 1 | badminton 点进 3`，`等锁 215s + 查询 357s`。
- 结论：单轮查询约 4–6 分钟，等锁降到几分钟；假设 A2 基本成立（略高于预估，因今晚服务器慢）。  
**下一步**：提交 main；发布订阅页文案。观察明早 08:00 新开放一天时（大量「满→有空」场地要点进去）的耗时。

#### 2026-10-13 19:30 HKT — 篮球订阅话题；Bark 只推 LG1

**背景**：用户要求篮球也做一个和羽毛球一样的订阅（话题 `hkust-basketball-moyunxiang`），推送内容和 Bark 一样；Bark 改成只推 LG1，Seafront 不推。  
**操作**：
- `facility/monitor.py`：`WATCHES[*]["to"]` 改为推送列表 `[(渠道, ntfy 话题, 场馆过滤)]`。篮球：`("ntfy", "hkust-basketball-moyunxiang", None)` + `("bark", None, "LG1")`；羽毛球：`("ntfy", "hkust-badminton-moyunxiang", None)`。`ntfy()` 增加 topic 参数，tag 取话题第二段（`basketball` / `badminton`）。`send()` 按场馆过滤后分别发，标题里的个数按过滤后计算；Mac 通知收全部。登录失效提醒仍只发 Bark。
- 用 mock 验证路由：LG1 + Seafront 各 1 个 → ntfy 2 个、Bark 只有 LG1 1 个；只有 Seafront → 只发 ntfy，不发 Bark。
- `docs/facilities/subscribe.html`：按 `?t=basketball|badminton` 切换标题、话题、ntfy 网页链接、通知范围（篮球只通知室内场）和延迟说明；默认羽毛球（旧链接不变）。
- `docs/facilities/app.js` / `index.html`：订阅按钮两种类型都显示，链接带 `?t=<类型>`；页脚改为「篮球 / 羽毛球空场通知」。
- 本地 `python3 -m http.server` + Playwright 冒烟：标题、话题、链接正确，无 JS 报错；截图检查 390px 排版。
- 测试推送 19:29：向 `hkust-basketball-moyunxiang` 和 Bark 各发 3 条相同内容（测试通知 + 两条格式示例，正文注明「测试」）；ntfy poll 确认 3 条均到达，`click=usthing://`，Bark 无报错。
- README / Makefile 说明同步。  
**结果**：已验证路由与页面；真实空位推送等下一次出现空位时观察。  
**下一步**：提交 main，发布 gh-pages。

#### 2026-10-25 11:00 HKT — 图书馆页面加楼层地图

**背景**：用户要求把图书馆地图放到网站上。服务于最大目标：找到空房后能直接看到在哪层、哪个位置。  
**操作**：
- 搜到官方平面图系统 https://lbcone.hkust.edu.hk/floorplans/（公开，不用登录）。`floor/view?name=<1f|gf|lg1|lg3|lg4|lg5>` 页面里有平面图 `<img id="map">` 和每个地点的 `div.lib_obj`（title = 地点名），坐标写在内联 CSS `#place_N{top;left;width;height}`。
- 把矩形叠到原图上截图核对：LG1 与 1600px 原图吻合；LG5 原图 2146px 宽，按 1600px 缩放后吻合 → 坐标基准统一为 1600px。
- 新增 `library/floorplans.py`：抓 1/F、LG1、LG3、LG4、LG5（G/F 无可预约房间），按楼层（`floor_of`）+ 房间号（后面不能紧跟数字）匹配预约系统房间名，写 `docs/library/floorplans.json`。结果：1/F 3、LG1 37（含 9 个 Pod 共用一块）、LG3 10、LG4 11、LG5 3，未匹配：无。
- 网页：`docs/library/index.html` 在「按时段找」后新增「地图」：楼层标签（数字 = 该时段整段空的房间数）、官方平面图裁到有房间的区域、房间色块（整段空绿 / 部分空虚线黄 / 已满红 / 不开放灰，人数不够变淡），点房间显示名称、人数、状态；手机上至少按 0.7 倍显示、可左右滑。图片直接引用 lbcone，不复制到本站；页脚注明来源。`floorplans.json` 拿不到时整个地图隐藏。
- `Makefile` 新增 `make maps`；README / plan.md 同步。
- 写 Makefile 注释前验证代理：`curl` 经 shell 代理 200（1.8s），直连 200（0.04s），注释写「直连更快」。
- 期间失误：第一次下载时 scratchpad 目录不存在，`cd` 失败导致在仓库里建了 `lbcone/`（2 个下载的 html），已整体移到 scratchpad，仓库无残留。
- 验证：本地 `python3 -m http.server` + Playwright，390px 浅色 LG1 / 1100px 深色 LG3 / 390px LG5：图片加载成功（naturalWidth 1600/1600/2146），色块数 29/10/3，点击显示详情，无 JS 报错；截图目测位置正确。  
**结果**：本地验证通过。  
**下一步**：提交 main，`./run.sh publish` 发布；等用户真机反馈。

#### 2026-10-25 12:20 HKT — 地图改为本站裁剪图：加载慢、1/F 网页版过大

**背景**：用户反馈地图还要加载（问是不是现场抓的），且 1/F 在网页版特别大。  
**操作 / 观察**：
- 不是现场抓：房间坐标是静态 `floorplans.json`；慢的是直接引用的官方 PNG：`curl` 实测 1f 769 KB / 2.9s、lg1 467 KB / 2.8s、lg3 1.16 MB / 3.1s，响应只有 `etag` / `last-modified`，没有 `Cache-Control`。
- 1/F 过大：3 个房间的包围盒只有约 32×151（基准像素），旧代码 `width:max(100%, …)` 在 1100px 页面上把它放大到整页宽。
- `library/floorplans.py`：下载官方 PNG → `sips --resampleWidth 1600`（LG5）→ 按房间包围盒裁剪（留白 40、至少 640×320、以房间为中心、不超出原图）→ JPEG q80 存到 `docs/library/maps/<楼层>.jpg`；`floorplans.json` 里的坐标换成裁剪图里的像素，并记录 `w`/`h`。`make maps` 结果：1/F 640×320 51 KB，LG1 1016×320 107 KB，LG3 1343×365 162 KB，LG4 1576×320 126 KB，LG5 640×320 36 KB。
- `docs/library/app.js`：图片铺满色块容器；宽度 `min(max(100%, 0.7×w), w)`，大屏不超过原图大小、手机至少 0.7 倍可左右滑；页面加载 1.5 秒后预加载其他楼层的图。`style.css`：边框移到地图本身，窄的楼层居中不再有大白框。
- 本地 Playwright：1100px 1/F 显示 640×320（原来铺满整页）；各层图片加载 0.07–0.18s；无 JS 报错；截图核对色块位置正确。  
**决策**：图片从直接引用改为本站托管裁剪版（为了速度），页脚继续注明来源 HKUST Library Floor Plans。  
**下一步**：提交并发布；用户确认手机 / 网页效果。
