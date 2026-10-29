# 项目计划

> 最后更新：2026-10-29 14:00 HKT
> 本文件是新 Claude session 的首要上下文。说明性内容使用中文。

## 1. 最大目标

让我（和需要的同学）**不用反复手动刷 HKUST 预约系统**，就能随时知道图书馆房间、体育场地哪里有空，并且在稀缺资源（室内篮球场、羽毛球场等）出现空位时**第一时间收到手机通知**。

### 成功标准

- moyunxiang.com/booking 上的图书馆 / 体育设施数据在 Mac 开机时持续自动更新（图书馆 30 分钟、设施 1 小时内）。
- 稀缺场地出现 10:00 及以后的空位时，几分钟内推送到手机。
- 登录过期等故障能自动恢复或明确提醒，不需要我开终端排查。
- 只通知，**绝不自动预约**；不公开任何预约人姓名。

## 2. 当前状态

- 图书馆：`library/scrape.py` 每 30 分钟抓 area 3/8/20，网页 `docs/library/`（现在有空 / 按时段找含「自选」/ 地图 / 整段空闲 / 时间轴），Scriptable 小组件。
- 3D 打印机：同一个图书馆预约系统的 area 14（Printer 1 单色 / Printer 2 多色，09:30–20:30，30 分钟一格）。`library/scrape.py` 的 `SITES["print3d"]` 写到 `data/print3d/`（含姓名，本地）和 `docs/print3d/data/`（公开）；`run.sh library` 每小时抓完整 15 天，其余只抓今明两天。网页 `docs/print3d/`（现在 / 找空档 / 时间轴），首页有入口。
- 图书馆地图：`library/floorplans.py`（`make maps`）从公开的 lbcone.hkust.edu.hk/floorplans 抓各层房间矩形，写 `docs/library/floorplans.json`（坐标以图宽 1600px 为基准）；网页直接引用官方 PNG，按所选时段给房间上色。
- 体育设施：`facility/scrape.py` 每小时抓篮球 + 羽毛球 8 天，网页 `docs/facilities/`，Scriptable 小组件。
- 空位监控：`facility/monitor.py` 每 5 分钟（launchd，不重叠），只通知 ≥10:00 的新空位：
  - 篮球室内场（LG1 ×3 + Seafront 室内 A 半场）→ ntfy 公开话题 `hkust-basketball-moyunxiang`；其中 **LG1** 的另推 Bark（只发给我），Seafront 不推 Bark。
  - 羽毛球所有场 → ntfy 公开话题 `hkust-badminton-moyunxiang`。
  - 订阅页 `docs/facilities/subscribe.html?t=basketball|badminton`（同一页面，JS 按参数切换）；设施页两种类型都显示「订阅空场通知」大按钮。
- 场地时段缓存 `logs/fbs_cache.json`：监控和网页抓取共用；「满→有空」的场地立刻点进去，已有空的场地轮换刷新（监控羽毛球每轮最旧 3 个，网页抓取每类型最多 6 个）。
- 发布：网站从 `gh-pages` 分支发布，`run.sh` 把本地 `docs/` 追加提交推上去；main 只放代码，数据不进 main。
- 登录：共用 Chrome profile `.auth/hkust-chrome-profile`；过期时后台自动弹出 Chrome 等我登录（30 分钟内最多弹一次）。
- 常用操作都在 `Makefile`。

## 3. 当前阶段目标

把「空位通知」从只发给我自己扩展到**可订阅**：羽毛球空场（≥10:00）推送到一个公开的 ntfy 话题，任何人用订阅链接就能收到。这直接服务于最大目标里的「需要的同学也能第一时间知道」。

## 4. 当前任务

### P0
- [x] 羽毛球空场订阅通知（ntfy 话题 + 订阅页）：已上线，用户已订阅并收到推送。
- [x] 篮球空场订阅（`hkust-basketball-moyunxiang`）+ Bark 只推 LG1：2026-10-13 上线，测试推送已发出。
- [ ] 验证轮换刷新后的稳态耗时：监控每轮 `查询` 时间、设施网页抓取整轮时间、`等锁` 时间都应明显下降。
  - 服务于最大目标：监控被锁饿死时，通知会晚几十分钟，等于没用。

### P1
- [ ] 若设施网页抓取仍长时间占锁：让 `monitor.py` 顺手写 `docs/facilities/data/*.json`（它每轮已经搜了两类型 8 天），去掉单独的设施抓取任务或降频。

### P2
- [ ] 图书馆地图：用户真机看效果后调整（手机上 LG1 需要左右滑）。
- [ ] 小组件真机排版反馈后微调。

## 5. 里程碑

- Phase 0（完成）：图书馆爬虫 + 网站 + 小组件。
- Phase 1（完成）：体育设施网站 + 篮球监控 + Bark。
- Phase 2（进行中）：可订阅的空位通知（羽毛球）。

## 6. 已确认结论

- F0: fbs 搜索表单只有 facility_type / location / facility / date 四个过滤项，**没有时间过滤**；要知道时段必须对每个场地 `select_facility_N`。
- F1: fbs 的 Drupal 表单状态只能用一次，每多查一个场地要重新 GET 令牌 + search + select（约 3 个请求 × 5 秒）。
- F2: 2026-10-12 实测羽毛球 8 天内的空位全部在 10:00 之前，≥10:00 的和篮球一样稀缺，通知不会刷屏。
- F3: 给自己发 iMessage 在 iPhone 上不稳定响铃，已弃用；Bark 可用。
- F4: ntfy.sh 从本机直连可达（需绕过 shell 代理；launchd 环境本来无代理）。
- F5: launchd 的 LaunchAgent 在用户桌面会话内运行，可以弹出有界面的 Chrome。
- F6: 2026-10-12 晚 fbs 约 10–13 秒/请求，偶发 30s 超时与 ECONNRESET（`fbs._request` 已重试）；点一个场地 = GET+search+select 3 个请求。
- F7: 缓存一次性全部过期时，37 个羽毛球场全量重点要 28 分钟（20:09 实测 1674s）；因此改为轮换刷新。
- F9: lbcone 平面图页面公开、不用登录；每个地点是 `#place_N{top;left;width;height}`，坐标基准宽 1600px（LG5 图 2146px 宽也一样）；预约系统 64 个房间全部能对上（`LG1- Media and Discussion`→LG1-329，`LG3 Seminar`→LG3-10，9 个 Study Pod 共用一块「Study Pod Zone」）。
- F10: 3D 打印机规则（官方页 library.hkust.edu.hk/facilities-space/facilities/3d-printing）：每次最多 4 小时、每天 1 次、每周 2 次、最多提前两周；2026-10-29 实测未来 7 天两台几乎全满（只剩 3 个零散 30 分钟），周末不开放。
- F8: 监控脚本本身几乎不耗 CPU（28 分钟内 python 4.6s user + 3.4s sys），时间都花在等服务器。

## 7. 未解决问题 / 阻塞项

- Q1: ntfy iOS App 对 priority=5 的消息是否按「时效性通知」处理（勿扰下是否响）——未验证。
- Q2: 订阅链接公开后，任何人都能往该 ntfy 话题发消息（垃圾消息风险）；目前接受。

## 8. 关键文件

- `auth.py`: 共用登录（profile 锁、`--check`、`--auto` 自动弹窗登录）。
- `library/scrape.py`: 图书馆抓取。
- `facility/fbs.py`: fbs AJAX 表单客户端与解析。
- `facility/scrape.py`: 设施 8 天抓取，写 `docs/facilities/data/`。
- `facility/monitor.py`: 空位监控与推送（Bark / ntfy）。
- `run.sh`: 定时任务入口（抓取 → 发布 gh-pages）。
- `Makefile`: 常用命令。
- `com.moyunxiang.hkust-booking*.plist`: launchd 任务（已复制到 `~/Library/LaunchAgents`）。

## 9. 运行与验证

```bash
make help        # 所有命令
make update      # 抓取 + 发布
make watch       # 立刻跑一次监控
make notify      # 测试推送
make log         # 最近记录
make status      # launchd 任务状态
```

## 10. 数据与产物位置

- `data/library/`: 图书馆原始数据（含预约人姓名，只在本地，gitignored）。
- `docs/library/data/`, `docs/facilities/data/`: 公开数据（无姓名），只发布到 gh-pages。
- `logs/`: 运行日志、监控状态 `monitor_state.json`。
- `.auth/`: 登录 profile、`notify.json`（Bark key），不进 git。

## 11. 非目标 / 边界

- 不自动预约、不代订。
- 不公开预约人姓名。
- 不在 Mac 睡眠时运行（接受）。

## 12. 废弃路线 / 不要回退

- 导出 cookie 给 requests：会被服务器拒绝，必须用 Playwright `ctx.request`。
- 模拟点击 fbs 页面：不稳定，已改为直接 POST AJAX。
- iMessage 自发自收通知：iPhone 不稳定响铃。
- 网站从 main `/docs` 发布：数据提交刷屏 main，已改 gh-pages。
- 强制推送 gh-pages：被权限拦截，改为追加提交。

## 13. 当前假设

- A1: 新空位主要来自「满→有空」的场地或每天 08:00 新开放的一天；已有空场地上新空出的时段可接受约 1 小时延迟（订阅页已如实说明）。
  - 验证方式：对比 ntfy 推送时间与网页数据中该时段首次出现的时间。

## 14. 验收标准

- 订阅页可访问，按步骤能在手机上订阅话题并收到测试推送。
- 监控每轮 `查询` 在 5 分钟左右，`等锁` 一般不超过几分钟；新出现的 ≥10:00 羽毛球空位会推送到话题。

## 15. 风险

- 监控时间过长占用 profile 锁，延迟图书馆抓取 → 观察耗时，必要时把羽毛球改为每 10 分钟。
- ntfy.sh 免费服务限流（每 IP 每天约 250 条）→ 只推新空位，量很小。

## 16. 回滚策略

- 代码：`git revert` 对应提交。
- 关闭羽毛球通知：`facility/monitor.py` 中把 badminton 从监控列表去掉即可。

## 17. 输出物

- moyunxiang.com/booking（library / facilities / 订阅页）。
- Scriptable 小组件两个。
- Bark（我）与 ntfy（公开订阅）推送。

## 18. 交接说明

先读本文件。当前 P0 是验证轮换刷新后的耗时（看 `make log` / `logs/monitor.log` 的「等锁 / 查询」）；git 推送要用 `env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY git push`；commit 作者只能是 moyunxiang，不加任何 Claude 署名。
