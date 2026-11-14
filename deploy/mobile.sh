#!/usr/bin/env bash
# Explicit operator invocation only. Never ships application/server source or data.
set -euo pipefail
[[ ${1:-} == deploy ]] || { echo 'Usage: bash deploy/mobile.sh deploy'; exit 2; }
HERE=$(cd "$(dirname "$0")/.." && pwd)
cd "$HERE"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
python3 -m unittest test_sync test_mobile_build
for test in test_mobile_*.mjs; do
  [[ -f "$test" ]] && node --test "$test"
done
# Rebuild independently and compare the entire published tree, not just its version.
python3 tools/build_mobile.py --output "$TMP/fresh"
if [[ -d build/mobile ]]; then
  diff -qr build/mobile "$TMP/fresh" || { echo 'Stale/tampered build/mobile; rebuild explicitly and retry.' >&2; exit 1; }
else
  python3 tools/build_mobile.py
fi
VERSION=$(python3 -c 'import json; print(json.load(open("build/mobile/release.json"))["version"])')
[[ $VERSION =~ ^[a-f0-9]{64}$ ]]
REUSE_VENDOR=${LECTURE_MOBILE_REUSE_VENDOR:-0}
[[ $REUSE_VENDOR == 0 || $REUSE_VENDOR == 1 ]] || exit 2
python3 - "$TMP/fresh" "$TMP/public.tar.gz" "$REUSE_VENDOR" <<'ARCHIVE'
import json, pathlib, sys, tarfile
root = pathlib.Path(sys.argv[1])
names = sorted(json.loads((root / 'release.json').read_text())['checksums']) + ['release.json']
with tarfile.open(sys.argv[2], 'w:gz') as archive:
    for name in names:
        if sys.argv[3] == '1' and name.startswith(('vendor/', 'models/')):
            continue
        archive.add(root / name, arcname=name, recursive=False)
ARCHIVE
HOST=root@203.0.113.10
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$HOST")
REMOTE=$("${SSH[@]}" 'mktemp -d /tmp/lecture-mobile.XXXXXXXX')
[[ $REMOTE =~ ^/tmp/lecture-mobile\.[A-Za-z0-9]+$ ]]
trap 'rm -rf "$TMP"; "${SSH[@]}" "rm -rf -- $REMOTE"' EXIT
scp -O -q -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3 "$TMP/public.tar.gz" "$HOST:$REMOTE/public.tar.gz"
"${SSH[@]}" python3 - "$VERSION" "$REMOTE" "$REUSE_VENDOR" <<'PY'
import hashlib, json, os, pathlib, re, shutil, subprocess, sys, tarfile, time
version, tmp, reuse_vendor = sys.argv[1:]
base = pathlib.Path('/var/www/lecture-workspace')
release = base / 'releases' / version
current = base / 'current'
vhost = pathlib.Path('/etc/nginx/sites-available/lecture-sync')
if not re.fullmatch('[a-f0-9]{64}', version):
    raise RuntimeError('invalid version')
if current.exists() and not current.is_symlink():
    raise RuntimeError('current must be a symlink')
old = os.readlink(current) if current.is_symlink() else None
original = vhost.read_bytes()
backup = vhost.with_name('lecture-sync.mobile-backup-' + version + '-' + str(time.time_ns()))
if backup.exists():
    raise RuntimeError('backup already exists; inspect previous deployment before retrying')
shutil.copy2(vhost, backup)

def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True).stdout

def switch(target):
    pending = base / '.current-mobile-next'
    if pending.exists() or pending.is_symlink():
        raise RuntimeError('pending deployment exists')
    pending.symlink_to(target)
    pending.replace(current)

try:
    staging = pathlib.Path(tmp) / 'public'
    staging.mkdir()
    with tarfile.open(pathlib.Path(tmp) / 'public.tar.gz') as archive:
        for m in archive.getmembers():
            if m.name.startswith('/') or '..' in pathlib.PurePosixPath(m.name).parts or not (m.isfile() or m.isdir()):
                raise RuntimeError('unsafe archive member')
        if reuse_vendor == '1':
            incoming = json.load(archive.extractfile('release.json'))
            shipped = set(archive.getnames())
            for name, sha in incoming['checksums'].items():
                if name in shipped:
                    continue
                if not name.startswith(('vendor/', 'models/')) or '..' in pathlib.PurePosixPath(name).parts:
                    raise RuntimeError('unexpected omitted public asset')
                source = current / name
                if not source.is_file() or source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != sha:
                    raise RuntimeError('existing vendor differs; retry without LECTURE_MOBILE_REUSE_VENDOR')
                dest = staging / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, dest)
        archive.extractall(staging)
    manifest = json.loads((staging / 'release.json').read_text())
    if manifest['version'] != version or manifest['schema'] != 1:
        raise RuntimeError('release mismatch')
    actual = {str(p.relative_to(staging)) for p in staging.rglob('*') if p.is_file()}
    if actual != set(manifest['checksums']) | {'release.json'}:
        raise RuntimeError('unexpected release files')
    for name, sha in manifest['checksums'].items():
        if hashlib.sha256((staging / name).read_bytes()).hexdigest() != sha:
            raise RuntimeError('checksum mismatch: ' + name)
    release.parent.mkdir(parents=True, exist_ok=True)
    if release.exists():
        existing = {str(p.relative_to(release)) for p in release.rglob('*') if p.is_file()}
        if existing != actual or any((release / name).read_bytes() != (staging / name).read_bytes() for name in actual):
            raise RuntimeError('existing release differs; inspect it before retrying')
    else:
        shutil.copytree(staging, release)
    for p in [release, *release.rglob('*')]:
        p.chmod(0o755 if p.is_dir() else 0o644)
    text = original.decode()
    # Fail closed on a nonstandard or already-migrated vhost. Only this block changes.
    matches = list(re.finditer(r'location\s+/\s*\{', text))
    if len(matches) != 1:
        raise RuntimeError('expected exactly one simple location / block')
    start = matches[0].start()
    end = matches[0].end()
    depth = 1
    while end < len(text) and depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    if depth:
        raise RuntimeError('unbalanced root location')
    block = text[start:end]
    if 'proxy_pass' not in block or '127.0.0.1:8791' not in block:
        if '# mobile-pwa managed' not in block:
            raise RuntimeError('unexpected root location')
    proxy = '''proxy_pass http://127.0.0.1:8791;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;'''
    root = '''location / {
        # mobile-pwa managed
        root /var/www/lecture-workspace/current;
        include /etc/nginx/mime.types;
        types { application/javascript mjs; application/wasm wasm; application/manifest+json webmanifest; }
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
        add_header Permissions-Policy "microphone=(self), camera=()" always;
        add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: http:; worker-src 'self' blob:; media-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
    }'''
    if '# mobile-pwa managed' not in block:
        # Refuse ambiguous existing routing rather than replace unrelated directives.
        if re.search(r'location\s+[^\n{]*(?:/v1|/healthz|/api)', text):
            raise RuntimeError('existing endpoint locations need manual review')
        root += '\n    location ^~ /v1/ { ' + proxy + ' }\n'
        root += '    location = /healthz { ' + proxy + ' }\n'
        root += '    location = /api { return 403; }\n    location ^~ /api/ { return 403; }'
    text = text[:start] + root + text[end:]
    vhost.write_text(text)
    switch(str(release))
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    domain = 'https://lecture.example.com'
    # nginx reload returns before the new worker generation is accepting requests.
    # Poll only this public marker; keep rollback armed throughout the transition.
    page = ''
    for attempt in range(20):
        page = run('curl', '--fail', '--silent', '--show-error', '--max-time', '10', domain + '/')
        if 'type="module" src="/mobile-ui.mjs' in page:
            break
        time.sleep(0.3)
    if 'type="module" src="/mobile-ui.mjs' not in page:
        raise RuntimeError('page audit failed')
    if json.loads(run('curl', '--fail', '--silent', '--show-error', '--max-time', '30', domain + '/healthz')).get('ok') is not True:raise RuntimeError('sync health body invalid')
    anon=run('curl','--silent','--show-error','--max-time','30','-o','/dev/null','-w','%{http_code}',domain+'/v1/index')
    if anon!='401':raise RuntimeError('sync authentication audit failed')
    code = run('curl', '--silent', '--show-error', '--max-time', '30', '-o', '/dev/null', '-w', '%{http_code}', domain + '/api/anything')
    if code != '403':
        raise RuntimeError('API denial audit failed')
    # Require actual machine-readable audit evidence; unknown schemas fail closed.
    audit_code = 'import contextlib,importlib.util,io,json; spec=importlib.util.spec_from_file_location("lecture_mobile_audit","/root/webserver/site_audit.py"); m=importlib.util.module_from_spec(spec); capture=io.StringIO(); exec("with contextlib.redirect_stdout(capture):\\n try:spec.loader.exec_module(m)\\n except SystemExit as e:assert e.code in (0,None),capture.getvalue()"); print(json.dumps({"failed":m.nfail,"warnings":m.nwarn,"checks":len(m.results)}))'
    report = json.loads(run('python3', '-c', audit_code))
    summary = report.get('summary', report)
    if type(summary.get('failed')) is not int or summary['failed'] != 0:
        raise RuntimeError('site_audit must report integer failed=0')
    print(json.dumps({'version': version, 'page': 'passed', 'health': 'passed', 'api_denial': 'passed', 'site_audit': report, 'nginx_backup': str(backup), 'previous_current': old, 'registry': 'unchanged'}))
except BaseException:
    vhost.write_bytes(original)
    if old is None:
        if current.is_symlink():
            current.unlink()
    else:
        switch(old)
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    raise
PY
