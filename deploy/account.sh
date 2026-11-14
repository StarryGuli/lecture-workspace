#!/usr/bin/env bash
# Update the separate login/model gateway; never changes lecture-sync isolation.
set -euo pipefail
[[ ${1:-} == update ]] || { echo 'Usage: bash deploy/account.sh update'; exit 2; }
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
PYTHON=${LECTURE_PYTHON:-python3}
if ! "$PYTHON" -c 'import hashlib; assert hasattr(hashlib,"scrypt")' 2>/dev/null; then
  PYTHON=/opt/homebrew/bin/python3
fi
"$PYTHON" -m unittest test_cloud test_sync
"$PYTHON" -m py_compile cloud_server.py
HOST=root@203.0.113.10
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST")
REMOTE=$("${SSH[@]}" 'mktemp -d /tmp/lecture-account.XXXXXXXX')
[[ $REMOTE =~ ^/tmp/lecture-account\.[A-Za-z0-9]+$ ]]
trap '"${SSH[@]}" "rm -rf -- $REMOTE"' EXIT
scp -q -o BatchMode=yes cloud_server.py sync_client.py deploy/lecture-account.service "$HOST:$REMOTE/"
"${SSH[@]}" python3 - "$REMOTE" <<'REMOTE_INSTALL'
import pathlib,shutil,subprocess,sys,time
stage=pathlib.Path(sys.argv[1]); root=pathlib.Path('/opt/lecture-account')
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True).stdout
if subprocess.run(['getent','passwd','lecture-account'],stdout=subprocess.DEVNULL).returncode:
 run('useradd','--system','--no-create-home','--shell','/usr/sbin/nologin','lecture-account')
run('install','-d','-m','755',str(root))
run('install','-d','-m','700','-o','lecture-account','-g','lecture-account','/var/lib/lecture-account')
stamp=str(time.time_ns())
files=[(stage/'cloud_server.py',root/'cloud_server.py'),(stage/'sync_client.py',root/'sync_client.py'),(stage/'lecture-account.service',pathlib.Path('/etc/systemd/system/lecture-account.service'))]
saved=[]
for source,dest in files:
 backup=dest.with_name(dest.name+'.bak-'+stamp) if dest.exists() else None
 if backup:shutil.copy2(dest,backup)
 saved.append((dest,backup));shutil.copyfile(source,dest);dest.chmod(0o644)
try:
 run('systemctl','daemon-reload');run('systemctl','enable','--now','lecture-account')
 run('systemctl','restart','lecture-account')
 for _ in range(30):
  result=subprocess.run(['curl','--fail','--silent','--max-time','2','http://127.0.0.1:8792/account/status'],capture_output=True,text=True)
  if result.returncode==0:break
  time.sleep(.2)
 else:raise RuntimeError('account gateway did not start')
 import json
 status=json.loads(result.stdout);assert status['enabled'] is True and status['authenticated'] is False
 print('Account gateway active on loopback8792; existing sync service unchanged')
except BaseException:
 for dest,backup in saved:
  if backup:shutil.copy2(backup,dest)
 run('systemctl','daemon-reload')
 if all(backup for _,backup in saved):run('systemctl','restart','lecture-account')
 else:subprocess.run(['systemctl','stop','lecture-account'],check=False)
 raise
REMOTE_INSTALL
python3 tools/provision_account.py
