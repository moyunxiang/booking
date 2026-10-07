#!/bin/zsh
# 定时任务入口：抓取 → 如有变化则提交并推送 docs（GitHub Pages）
#   run.sh library    图书馆（launchd 每 30 分钟）
#   run.sh facility   体育设施：篮球 + 羽毛球（launchd 每小时）
#   run.sh publish    不抓取，只把 docs 发布到 gh-pages
set -u
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
what=${1:-library}
mkdir -p logs
# 在终端里运行（make）时边看边写日志；launchd 运行时只写日志
if [[ -t 1 ]]; then exec > >(tee -a logs/run.log) 2>&1; else exec >>logs/run.log 2>&1; fi
echo "=== $(date '+%F %T') $what ==="

case $what in
  library)
    # 每天第一次运行抓 7 天，其余只抓今天和明天（服务器限流，请求越少越好）
    marker=logs/.last_full
    if [[ ! -f $marker || $(( $(date +%s) - $(stat -f %m $marker) )) -gt 72000 ]]; then days=7; else days=2; fi
    uv run python library/scrape.py --days $days
    code=$?
    [[ $code -eq 0 && $days -eq 7 ]] && touch $marker ;;
  facility)
    uv run python facility/scrape.py
    code=$? ;;
  publish)
    code=0 ;;
  *) echo "unknown: $what"; exit 1 ;;
esac
echo "$(date '+%T') $what scrape exit $code"
[[ $code -ne 0 ]] && exit $code

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config user.name >/dev/null && git config user.email >/dev/null || { echo "git user.name/email 未配置"; exit 1; }
# 网站从 gh-pages 分支发布：把 docs/ 当前内容做成 gh-pages 上的一个新提交再推送。
# 不切换分支、不碰 main（main 只放代码）。两个任务可能同时走到这里，用文件锁串行。
lockf -t 300 logs/.git.lock zsh -c '
  set -e
  export GIT_INDEX_FILE=$PWD/logs/.pages.index
  rm -f $GIT_INDEX_FILE
  git --work-tree=docs add -A .
  tree=$(git write-tree)
  rm -f $GIT_INDEX_FILE
  parent=$(git rev-parse -q --verify gh-pages || true)
  [[ -n $parent && $tree == $(git rev-parse "gh-pages^{tree}") ]] && { echo "no changes"; exit 0; }
  c=$(git commit-tree $tree ${parent:+-p} $parent -m "site: $(date "+%F %H:%M") '"$what"'")
  env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY git push -q origin ${c}:refs/heads/gh-pages
  git update-ref refs/heads/gh-pages $c
  echo "pushed"'
