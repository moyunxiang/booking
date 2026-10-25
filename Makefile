# HKUST 预约爬虫常用命令。在本目录下运行：make <命令>
.PHONY: help update library facility publish maps auth login log watch notify status

help:
	@echo "make update    抓图书馆 + 体育设施并发布网站（登录失效会自动弹 Chrome 登录）"
	@echo "make library   只抓图书馆并发布（约 2 分钟）"
	@echo "make facility  只抓篮球 + 羽毛球并发布（约 5–20 分钟）"
	@echo "make publish   把本地 docs/ 发布到网站（gh-pages），不抓取"
	@echo "make maps      重新抓图书馆楼层平面图的房间位置（布局变了才需要），之后 make publish"
	@echo "make auth      检查 HKUST 登录是否有效（不弹窗口）"
	@echo "make login     弹出 Chrome 重新登录（一般不用：过期时会自动弹出）"
	@echo "make log       看最近的抓取 / 监控记录"
	@echo "make watch     立刻检查一次篮球室内场 + 羽毛球（有新空位会推送）"
	@echo "make notify    发一条测试推送"
	@echo "make status    看定时任务是否在跑"

update: library facility

# 登录失效时 run.sh 会自己弹出 Chrome 等你登录，登录后接着重抓
library facility:
	@./run.sh $@

publish:
	@./run.sh publish

# 平面图是公开页面，不用登录；校内地址直连更快，绕过 shell 代理
maps:
	@env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY uv run python library/floorplans.py

auth:
	@uv run python auth.py --check

login:
	@uv run python auth.py

log:
	@grep -E '^=== |exit|pushed|no changes' logs/run.log | tail -12
	@echo "--- 空位监控（篮球 / 羽毛球）"
	@grep -E 'free=|失效|失败|点进' logs/monitor.log | tail -6

watch:
	@uv run python facility/monitor.py

notify:
	@uv run python facility/monitor.py --test

status:
	@launchctl list | grep -E 'PID|hkust-booking'
