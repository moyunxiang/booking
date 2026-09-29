#!/bin/zsh
# 定时任务入口：抓取 → 如有变化则提交并推送 docs（GitHub Pages）
set -u
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p logs
exec >>logs/run.log 2>&1
echo "=== $(date '+%F %T') ==="

# 每天第一次运行抓 7 天，其余只抓今天和明天（服务器限流，请求越少越好）
marker=logs/.last_full
if [[ ! -f $marker || $(( $(date +%s) - $(stat -f %m $marker) )) -gt 72000 ]]; then days=7; else days=2; fi
uv run python library/scrape.py --days $days
code=$?
[[ $code -eq 0 && $days -eq 7 ]] && touch $marker
[[ $code -ne 0 ]] && { echo "scrape failed ($code)"; exit $code; }

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config user.name >/dev/null && git config user.email >/dev/null || { echo "git user.name/email 未配置"; exit 1; }
git add docs
git diff --cached --quiet && { echo "no changes"; exit 0; }
git commit -q -m "data: $(date '+%F %H:%M')" && env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY git push -q && echo "pushed"
