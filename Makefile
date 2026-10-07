# HKUST 预约爬虫常用命令。在本目录下运行：make <命令>
.PHONY: help update library facility publish auth login log watch notify status

help:
	@echo "make update    抓图书馆 + 体育设施并发布网站（登录失效会自动弹 Chrome 登录）"
	@echo "make library   只抓图书馆并发布（约 2 分钟）"
	@echo "make facility  只抓篮球 + 羽毛球并发布（约 5–20 分钟）"
	@echo "make publish   只把本地改动发布上网站，不抓取"
	@echo "make auth      检查 HKUST 登录是否有效（不弹窗口）"
	@echo "make login     弹出 Chrome 重新登录（一般不用，update 会自动处理）"
	@echo "make log       看最近的抓取 / 监控记录"
	@echo "make watch     立刻检查一次篮球室内场（有新空位会推送）"
	@echo "make notify    发一条测试推送"
	@echo "make status    看定时任务是否在跑"

update: library facility

# 登录失效（退出码 2）时自动弹出 Chrome 让你登录，登录成功后接着重抓
library facility:
	@./run.sh $@ || { c=$$?; [ $$c -eq 2 ] || exit $$c; \
	  echo "登录已失效，正在打开 Chrome，请完成 HKUST 登录…"; \
	  uv run python auth.py && ./run.sh $@; }

publish:
	@./run.sh publish

auth:
	@uv run python auth.py --check

login:
	@uv run python auth.py

log:
	@grep -E '^=== |exit|pushed|no changes' logs/run.log | tail -12
	@echo "--- 篮球室内场监控"
	@grep -E 'indoor free|失效|失败' logs/monitor.log | tail -6

watch:
	@uv run python facility/monitor.py || { c=$$?; [ $$c -eq 2 ] || exit $$c; \
	  echo "登录已失效，正在打开 Chrome，请完成 HKUST 登录…"; \
	  uv run python auth.py && uv run python facility/monitor.py; }

notify:
	@uv run python facility/monitor.py --test

status:
	@launchctl list | grep -E 'PID|hkust-booking'
