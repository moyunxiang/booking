#!/bin/zsh
# 定时任务入口：抓取 → 如有变化则提交并推送 docs/data（GitHub Pages）
set -u
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mkdir -p logs
exec >>logs/run.log 2>&1
echo "=== $(date '+%F %T') ==="

uv run python scrape.py --days 7
code=$?
[[ $code -ne 0 ]] && { echo "scrape failed ($code)"; exit $code; }

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config user.name >/dev/null && git config user.email >/dev/null || { echo "git user.name/email 未配置"; exit 1; }
git add docs/data
git diff --cached --quiet && { echo "no changes"; exit 0; }
git commit -q -m "data: $(date '+%F %H:%M')" && git push -q && echo "pushed"
