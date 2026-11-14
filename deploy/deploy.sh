#!/bin/bash
# 记录工作台同步仓库：日常更新部署（首次安装的步骤见 DEPLOY.md「首次安装」，已完成，不要重复）。
#   ./deploy/deploy.sh update   上传 sync_server.py，重启服务，冒烟测试，跑站点自检
#   ./deploy/deploy.sh status   只读：服务状态、数据目录概况、冒烟测试
#   ./deploy/deploy.sh token    把本机 ~/.lecture-sync/config.json 里 token 的哈希装到服务器（换 token 时用）
set -euo pipefail
HOST="${LECTURE_SYNC_SSH:-root@203.0.113.10}"
DOMAIN="lecture.example.com"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

smoke() {
  echo "── 冒烟测试"
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMAIN/healthz" || true); echo "  公网 /healthz → $code（期望 200）"
  code2=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "https://$DOMAIN/v1/index" || true); echo "  无 token 取索引 → $code2（期望 401）"
  [ "$code" = 200 ] && [ "$code2" = 401 ]
}

case "${1:-}" in
  update)
    python3 -c "import ast,sys; ast.parse(open('$HERE/sync_server.py').read())"
    echo "── 本地测试"; (cd "$HERE" && python3 -m unittest test_sync 2>&1 | tail -3)
    "${SSH[@]}" 'cp -p /opt/lecture-sync/sync_server.py /opt/lecture-sync/sync_server.py.bak-$(date +%Y%m%d-%H%M%S)'
    scp -q -o BatchMode=yes "$HERE/sync_server.py" "$HOST:/opt/lecture-sync/sync_server.py"
    "${SSH[@]}" 'chmod 644 /opt/lecture-sync/sync_server.py && systemctl restart lecture-sync && sleep 1 && systemctl is-active lecture-sync'
    smoke
    echo "── 站点自检（❌ 必须为 0）"; "${SSH[@]}" 'python3 /root/webserver/site_audit.py 2>&1 | grep -A12 "同步仓库" ; python3 /root/webserver/site_audit.py 2>&1 | tail -3'
    ;;
  status)
    "${SSH[@]}" 'systemctl is-active lecture-sync; systemctl is-enabled lecture-sync; ss -tlnH | grep -c ":8791 " | sed "s/^/监听 8791：/"; for ns in config keys records; do printf "%s: %s 份, %s\n" $ns "$(ls /var/lib/lecture-sync/$ns 2>/dev/null | grep -vc "\.meta$\|\.prev$")" "$(du -sh /var/lib/lecture-sync/$ns 2>/dev/null | cut -f1)"; done; journalctl -u lecture-sync -n 5 --no-pager -q | cut -c1-160'
    smoke
    ;;
  token)
    H=$(python3 -c "import json,hashlib,os;print(hashlib.sha256(json.load(open(os.path.expanduser('~/.lecture-sync/config.json')))['token'].encode()).hexdigest())")
    "${SSH[@]}" "umask 077; echo $H > /var/lib/lecture-sync/token.sha256 && chown lecture-sync:lecture-sync /var/lib/lecture-sync/token.sha256 && chmod 600 /var/lib/lecture-sync/token.sha256 && echo token 哈希已更新（不用重启，下次请求生效）"
    ;;
  *) echo "用法: $0 update|status|token"; exit 2;;
esac
