#!/usr/bin/env python3
"""Install the one /account/ gateway route without changing the sync route."""
import subprocess

REMOTE = '''import pathlib,shutil,subprocess,time,json
p=pathlib.Path('/etc/nginx/sites-available/lecture-sync');old=p.read_bytes();text=old.decode()
marker='# lecture-account gateway managed'
block=''' + repr('''    # lecture-account gateway managed
    location ^~ /account/ {
        proxy_pass http://127.0.0.1:8792;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Connection "";
        proxy_request_buffering off;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 180s;
        proxy_send_timeout 180s;
        client_max_body_size 32m;
        add_header Cache-Control "no-store" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
    }
''') + '''
if marker not in text:
 if 'location ^~ /account/' in text:raise RuntimeError('Unmanaged account route; inspect first')
 assert text.rstrip().endswith('}');text=text.rstrip()[:-1]+block+chr(125)+chr(10)
 backup=p.with_name(p.name+'.account-backup-'+str(time.time_ns()));shutil.copy2(p,backup)
 p.write_text(text)
 try:
  subprocess.run(['nginx','-t'],check=True,capture_output=True)
  subprocess.run(['systemctl','reload','nginx'],check=True)
 except BaseException:
  p.write_bytes(old);subprocess.run(['nginx','-t'],check=True,capture_output=True);subprocess.run(['systemctl','reload','nginx'],check=True);raise
for _ in range(30):
 r=subprocess.run(['curl','--fail','--silent','--max-time','5','https://lecture.example.com/account/status'],capture_output=True,text=True)
 try:
  status=json.loads(r.stdout);assert status['enabled'] is True;break
 except (ValueError,KeyError,AssertionError):time.sleep(.3)
else:raise RuntimeError('Public account route not ready')
print('Public account route ready; request/response buffering disabled')
'''

if __name__ == '__main__':
    subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
                    'root@203.0.113.10', 'python3', '-'], input=REMOTE.encode(), check=True)
