#!/usr/bin/env python3
"""Migrate authorized model credentials to the private account service over SSH.

No credentials are printed or placed in shell arguments, Git or public releases.
Existing server credentials are preserved; use --refresh only to replace them.
"""
import argparse
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parent.parent
REMOTE = '''import json,os,pathlib,pwd,sys,tempfile
p=pathlib.Path('/var/lib/lecture-account/credentials.json')
incoming=json.load(sys.stdin)
assert isinstance(incoming.get('keys'),dict) and incoming['keys']
if p.exists() and json.loads(p.read_text()).get('keys') and sys.argv[1]!='refresh':
 print('Existing server credentials preserved');sys.exit(0)
account=pwd.getpwnam('lecture-account')
fd,name=tempfile.mkstemp(prefix='.credentials-',dir=p.parent)
try:
 with os.fdopen(fd,'w') as out:
  json.dump(incoming,out,ensure_ascii=False);out.flush();os.fsync(out.fileno())
 os.chmod(name,0o600);os.chown(name,account.pw_uid,account.pw_gid)
 os.replace(name,p)
finally:
 if os.path.exists(name):os.unlink(name)
print('Authorized model credentials migrated to private server storage')
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    data = ROOT / 'data'
    config = json.loads((data / 'settings.json').read_text())
    providers = json.loads((data / 'web-providers.json').read_text())
    if isinstance(providers, dict):
        providers = providers.get('providers', list(providers.values()))
    for provider in providers:
        extra = provider.pop('extraHeaders', {})
        if isinstance(extra, str):
            extra = json.loads(extra) if extra.strip() else {}
        provider['headers'] = {**extra, **provider.get('headers', {})}
        provider['network'] = '服务器代理'
    keys = {p.name: p.read_text().strip() for p in (data / 'keys').iterdir() if p.is_file() and not p.is_symlink()}
    if (data / 'search-key').is_file():
        keys['search-key'] = (data / 'search-key').read_text().strip()
    home = Path.home() / '.lecture-sync'
    sync = json.loads((home / 'config.json').read_text())
    payload = {'config': config, 'providers': providers, 'keys': keys,
               'sync': {'token': sync['token'], 'passphrase': (home / 'passphrase').read_text().strip()}}
    result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15',
                             'root@203.0.113.10', 'python3 -c ' + shlex.quote(REMOTE) +
                             (' refresh' if args.refresh else ' preserve')],
                            input=json.dumps(payload).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise SystemExit('Credential migration failed; secret-bearing output was suppressed.')
    print('Server credential provisioning complete; no secrets were printed.')


if __name__ == '__main__':
    main()
