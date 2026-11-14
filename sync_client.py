#!/usr/bin/env python3
"""记录工作台 · 同步客户端（在本机运行，把必要的数据同步到 CMIN2 的同步仓库）。

只同步：设置与平台定义（config）、API 密钥（keys）、各场景的分析结果（records：会话、
文稿版本、打点、用量，以及资料的文件名/页码偏移）。
永远不同步：录音（*.wav、chunks 音频索引、uploaded-audio）、资料正文、partial-transcript、测试数据。
上传前全部在本机用口令文件加密，服务器只存密文；模型请求只由本机应用发出，这个脚本不碰模型。

用法：
  python3 sync_client.py init --url https://lecture.example.com   # 生成 token 与口令（只做一次）
  python3 sync_client.py status            # 对照本机与服务器，列出会做什么，以及哪些内容不会上传
  python3 sync_client.py push [--dry-run] [--prefer local]
  python3 sync_client.py pull [--dry-run] [--prefer remote]
环境变量：LECTURE_WORKSPACE_DATA（数据目录）、LECTURE_SYNC_HOME（默认 ~/.lecture-sync）。仅标准库 + 系统 openssl。
"""
import argparse, hashlib, hmac, json, os, pathlib, re, secrets, shutil, sqlite3, subprocess, sys, time, urllib.error, urllib.request, zlib

ROOT = pathlib.Path(__file__).resolve().parent
HOME = pathlib.Path(os.environ.get('LECTURE_SYNC_HOME', str(pathlib.Path.home() / '.lecture-sync')))
MAGIC = b'LSYNC1\n'
ITER = 200000
NAME_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}')
SESSION_COLS = ('id', 'title', 'mode', 'created', 'status')
TABLES = {  # 表 -> 导出列（chunks 不在其中：它只是本机音频文件的索引）
    'revisions': ('id', 'session', 'kind', 'created', 'content', 'config', 'parent'),
    'marks': ('id', 'session', 'seconds', 'label'),
    'documents': ('id', 'session', 'name', 'offset'),  # 不含 pages（资料正文）
    'usage': ('id', 'session', 'created', 'role', 'provider', 'model', 'seconds', 'usage', 'price', 'cost', 'status'),
}


def data_dir(arg=None):
    return pathlib.Path(arg or os.environ.get('LECTURE_WORKSPACE_DATA') or os.environ.get('LECTURE_DEMO_DATA') or ROOT / 'data').resolve()


def die(msg, code=1):
    print('✗ ' + msg, file=sys.stderr); sys.exit(code)


# ───────────── 本机配置 / 状态 ─────────────
def load_config():
    p = HOME / 'config.json'
    if not p.is_file(): die('还没初始化：先运行 sync_client.py init --url https://…')
    c = json.loads(p.read_text())
    if not c.get('url') or not c.get('token'): die('config.json 缺 url 或 token')
    return c


def passphrase():
    p = HOME / 'passphrase'
    if not p.is_file(): die('缺少口令文件 %s（别的设备要把它原样拷过去才能解密）' % p)
    return p.read_text().strip().encode()


def load_state():
    try: return json.loads((HOME / 'state.json').read_text())
    except (OSError, ValueError): return {}


def save_state(st):
    HOME.mkdir(parents=True, exist_ok=True)
    p = HOME / 'state.json'
    p.write_text(json.dumps(st, indent=1, sort_keys=True)); os.chmod(p, 0o600)


def cmd_init(a):
    HOME.mkdir(parents=True, exist_ok=True); os.chmod(HOME, 0o700)
    cp, pp = HOME / 'config.json', HOME / 'passphrase'
    if cp.is_file() and not a.force: die('已初始化过（%s）；轮换 token 加 --force（口令不变）' % cp)
    if a.new_passphrase and pp.is_file() and not a.force: die('换口令会让服务器上现有密文全部无法解密，需要和 --force 一起显式给出')
    token = secrets.token_urlsafe(32)
    cp.write_text(json.dumps({'url': a.url.rstrip('/'), 'token': token}, indent=1)); os.chmod(cp, 0o600)
    if not pp.is_file() or a.new_passphrase: pp.write_text(secrets.token_urlsafe(48)); os.chmod(pp, 0o600)
    print('✓ 已生成 %s 与 %s（权限 600，内容不会显示）' % (cp, pp))
    print('下一步：把下面这个哈希装到服务器的 /var/lib/lecture-sync/token.sha256（deploy.sh token 会做）：')
    print(hashlib.sha256(token.encode()).hexdigest())
    print('口令文件是解密一切的唯一钥匙：丢了，服务器上的密文就废了；换设备时要把它安全地拷过去。')


# ───────────── 加密：openssl aes-256-cbc + pbkdf2，外面再套 HMAC（先验证再解密）─────────────
_mackey = {}


def mac_key(pw):
    if pw not in _mackey: _mackey[pw] = hashlib.pbkdf2_hmac('sha256', pw, b'lecture-sync-mac', ITER)
    return _mackey[pw]


def _openssl(decrypt, data, pw):
    r, w = os.pipe()
    os.write(w, pw + b'\n'); os.close(w)
    try:
        p = subprocess.run(['openssl', 'enc'] + (['-d'] if decrypt else []) + ['-aes-256-cbc', '-pbkdf2', '-iter', str(ITER), '-pass', 'fd:%d' % r],
                           input=data, capture_output=True, pass_fds=(r,))
    finally:
        os.close(r)
    if p.returncode: raise ValueError('openssl 失败：' + p.stderr.decode('utf-8', 'replace')[:120])
    return p.stdout


def encrypt(plain):
    pw = passphrase()
    ct = _openssl(False, zlib.compress(plain, 6), pw)
    return MAGIC + hmac.new(mac_key(pw), ct, 'sha256').digest() + ct


def decrypt(blob):
    pw = passphrase()
    if not blob.startswith(MAGIC) or len(blob) < len(MAGIC) + 32: raise ValueError('不是 lecture-sync 的密文')
    mac, ct = blob[len(MAGIC):len(MAGIC) + 32], blob[len(MAGIC) + 32:]
    if not hmac.compare_digest(mac, hmac.new(mac_key(pw), ct, 'sha256').digest()): raise ValueError('校验失败：口令不对，或密文被改动')
    return zlib.decompress(_openssl(True, ct, pw))


# ───────────── 服务器 ─────────────
class Remote:
    def __init__(self):
        c = load_config(); self.url, self.token = c['url'], c['token']

    def call(self, method, path, body=None, if_match=None):
        h = {'Authorization': 'Bearer ' + self.token, 'User-Agent': 'lecture-sync-client'}
        if if_match is not None: h['If-Match'] = str(if_match)
        if body is not None: h['Content-Type'] = 'application/octet-stream'
        req = urllib.request.Request(self.url + path, data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=60) as r: return r.status, r.read(), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers
        except (urllib.error.URLError, OSError) as e:
            die('连不上同步服务器 %s：%s' % (self.url, getattr(e, 'reason', e)))

    def index(self):
        s, b, _ = self.call('GET', '/v1/index')
        if s == 401: die('服务器拒绝了 token（服务器上的 token.sha256 与本机不一致）')
        if s != 200: die('取索引失败 HTTP %d' % s)
        return json.loads(b)

    def get(self, name):
        s, b, h = self.call('GET', '/v1/blob/' + name)
        if s != 200: die('取 %s 失败 HTTP %d' % (name, s))
        return b

    def put(self, name, blob, version):
        s, b, _ = self.call('PUT', '/v1/blob/' + name, blob, version)
        return s, (json.loads(b) if b else {})


# ───────────── 本机数据 → 载荷 ─────────────
def canon(o): return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def collect_files(data):
    """设置、平台定义、密钥：原样的文件字节。键是 '<命名空间>/<名字>'。"""
    out, skipped = {}, []
    for rel, name in (('settings.json', 'config/settings.json'), ('web-providers.json', 'config/web-providers.json'), ('search-key', 'keys/search-key')):
        if (data / rel).is_file(): out[name] = (data / rel).read_bytes()
    kd = data / 'keys'
    if kd.is_dir():
        for f in sorted(kd.iterdir()):
            if f.is_file() and NAME_RE.fullmatch(f.name): out['keys/' + f.name] = f.read_bytes()
            elif f.is_file(): skipped.append(f.name)
    return out, skipped


def db_ro(data):
    p = data / 'records.sqlite'
    if not p.is_file(): die('找不到 %s' % p)
    c = sqlite3.connect('file:%s?mode=ro' % p, uri=True, timeout=30); c.row_factory = sqlite3.Row
    return c


def collect_records(data):
    """每个已结束的会话一份载荷（只含文本类结果）。录音中的会话跳过，避免半成品。"""
    out = {}
    with db_ro(data) as c:
        for s in c.execute('SELECT %s FROM sessions WHERE status!=? ORDER BY id' % ','.join(SESSION_COLS), ('recording',)):
            sid = s['id']
            if not NAME_RE.fullmatch(sid): continue
            p = {'schema': 1, 'session': {k: s[k] for k in SESSION_COLS}}
            for t, cols in TABLES.items():
                p[t] = [{k: r[k] for k in cols} for r in c.execute('SELECT %s FROM %s WHERE session=? ORDER BY id' % (','.join(cols), t), (sid,))]
            out['records/' + sid] = canon(p)
    return out


def exclusions(data):
    """列出不会上传的内容，让人一眼确认录音留在本机。"""
    wavs = [f for f in data.rglob('*.wav')] if data.is_dir() else []
    size = sum(f.stat().st_size for f in wavs)
    with db_ro(data) as c:
        chunks = c.execute('SELECT count(*) FROM chunks').fetchone()[0]
        running = c.execute("SELECT count(*) FROM sessions WHERE status='recording'").fetchone()[0]
        pages = c.execute("SELECT count(*) FROM documents").fetchone()[0]
    return ['录音文件 %d 个（%.1f MB）：留在本机' % (len(wavs), size / 1048576), 'chunks 音频索引 %d 行：不导出' % chunks,
            '资料正文（documents.pages 与 *.txt）%d 份：不导出，只同步文件名/页码偏移' % pages,
            '录音中的会话 %d 个：结束后再同步' % running, 'partial-transcript.json、uploaded-audio、test-runs、测试剪辑：不导出']


# ───────────── 载荷 → 本机 ─────────────
def backup_file(data, path, stamp):
    if path.is_file():
        dst = data / '.sync-backup' / stamp / path.relative_to(data)
        dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(path, dst); os.chmod(dst, 0o600)


def write_file(data, rel, content, stamp):
    path = data / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    backup_file(data, path, stamp)
    tmp = path.with_name(path.name + '.synctmp'); tmp.write_bytes(content); os.chmod(tmp, 0o600); os.replace(tmp, path)


def local_target(name):
    ns, n = name.split('/', 1)
    if name == 'keys/search-key': return 'search-key'
    return {'config': n, 'keys': 'keys/' + n}[ns]


def import_records(data, payload):
    """把一份载荷并进本机数据库：全部 INSERT OR IGNORE（版本不可变，已有的不动、不删）。"""
    p = json.loads(payload)
    if p.get('schema') != 1: raise ValueError('不认识的载荷版本 %r' % p.get('schema'))
    path = data / 'records.sqlite'
    if not path.is_file(): die('本机还没有数据库：先启动一次应用（python3 server.py）让它建表')
    c = sqlite3.connect(path, timeout=30)
    added = {}
    try:
        c.execute('BEGIN IMMEDIATE')
        s = p['session']
        added['sessions'] = c.execute('INSERT OR IGNORE INTO sessions(%s) VALUES(%s)' % (','.join(SESSION_COLS), ','.join('?' * len(SESSION_COLS))), [s[k] for k in SESSION_COLS]).rowcount
        for t, cols in TABLES.items():
            n = 0
            for r in p.get(t, []):
                row = dict(r)
                cc = list(cols)
                if t == 'documents': cc.append('pages'); row['pages'] = '[]'  # 资料正文不随同步，留空
                n += c.execute('INSERT OR IGNORE INTO %s(%s) VALUES(%s)' % (t, ','.join(cc), ','.join('?' * len(cc))), [row[k] for k in cc]).rowcount
            added[t] = n
        c.execute('COMMIT')
    except Exception:
        c.execute('ROLLBACK') if c.in_transaction else None
        raise
    finally:
        c.close()
    return added


def merge_records(a, b):
    """并集合并两份载荷（按 id 去重）；用于两边都改过同一会话。"""
    x, y = json.loads(a), json.loads(b)
    out = {'schema': 1, 'session': x['session']}
    for t in TABLES:
        rows = {r['id']: r for r in x.get(t, [])}
        for r in y.get(t, []): rows.setdefault(r['id'], r)
        out[t] = [rows[k] for k in sorted(rows)]
    return canon(out)


# ───────────── push / pull ─────────────
def sha(b): return hashlib.sha256(b).hexdigest()


def cmd_push(a):
    data, st, rem = data_dir(a.data), load_state(), Remote()
    items, skipped = collect_files(data)
    items.update(collect_records(data))
    idx = rem.index()
    pushed = same = 0; problems = []
    for name in sorted(items):
        plain, h = items[name], sha(items[name])
        rmeta, s, merged = idx.get(name), st.get(name), False
        if s and s['sha'] == h and rmeta and rmeta['version'] == s['version']: same += 1; continue
        if rmeta and (not s or rmeta['version'] != s['version']):  # 服务器上的版本不是本机上次见过的
            try: rplain = decrypt(rem.get(name))
            except ValueError as e: problems.append('%s：%s' % (name, e)); continue
            if sha(rplain) == h:
                st[name] = {'version': rmeta['version'], 'sha': h}; same += 1; continue
            if name.startswith('records/'): plain, merged = merge_records(plain, rplain), True
            elif a.prefer != 'local': problems.append('%s：服务器上有另一台设备的修改，与本机不同。先 pull（--prefer remote 取服务器的），或 push --prefer local 覆盖它' % name); continue
        if a.dry_run: print('  将上传 %s（%d 字节明文）' % (name, len(plain))); pushed += 1; continue
        code, res = rem.put(name, encrypt(plain), rmeta['version'] if rmeta else 0)
        if code == 200:
            if merged: import_records(data, plain)  # 合并进了对方的新内容，同步写回本机，否则之后的 pull 会因版本一致而跳过
            st[name] = {'version': res['version'], 'sha': sha(plain)}; pushed += 1
        elif code == 409: problems.append('%s：上传瞬间服务器版本变了，重跑一次 push' % name)
        else: problems.append('%s：HTTP %d %s' % (name, code, res))
    if not a.dry_run: save_state(st)
    print('push%s：%d 项%s，%d 项已一致' % ('（预演）' if a.dry_run else '', pushed, '将上传' if a.dry_run else '已上传', same))
    for s_ in skipped: print('  跳过（名字不合规）：keys/' + s_)
    for p_ in problems: print('  ⚠ ' + p_)
    return 1 if problems else 0


def cmd_pull(a):
    data, st, rem = data_dir(a.data), load_state(), Remote()
    idx = rem.index()
    stamp = time.strftime('%Y%m%d-%H%M%S')
    got = same = 0; problems = []
    for name in sorted(idx):
        rmeta, s = idx[name], st.get(name)
        if s and s['version'] == rmeta['version']: same += 1; continue
        try: plain = decrypt(rem.get(name))
        except ValueError as e: problems.append('%s：%s' % (name, e)); continue
        if name.startswith('records/'):
            if a.dry_run: print('  将导入 ' + name); got += 1; continue
            added = import_records(data, plain)
            print('  导入 %s：新增 %s' % (name, '，'.join('%s %d' % kv for kv in added.items() if kv[1]) or '无（本机已有）'))
            st[name] = {'version': rmeta['version'], 'sha': sha(plain)}; got += 1; continue
        rel = local_target(name); path = data / rel
        cur = path.read_bytes() if path.is_file() else None
        if cur is not None and sha(cur) != sha(plain) and not (s and sha(cur) == s['sha']) and a.prefer != 'remote':
            problems.append('%s：本机与服务器都改过。push（以本机为准，--prefer local）或 pull --prefer remote（以服务器为准，本机旧文件会备份）' % name); continue
        if a.dry_run: print('  将写入 ' + rel); got += 1; continue
        if cur is None or sha(cur) != sha(plain): write_file(data, rel, plain, stamp)
        st[name] = {'version': rmeta['version'], 'sha': sha(plain)}; got += 1
    if not a.dry_run: save_state(st)
    print('pull%s：%d 项%s，%d 项已是最新' % ('（预演）' if a.dry_run else '', got, '将更新' if a.dry_run else '已更新', same))
    for p_ in problems: print('  ⚠ ' + p_)
    return 1 if problems else 0


def cmd_status(a):
    data = data_dir(a.data); rem = Remote()
    idx = rem.index()
    print('服务器 %s：%d 项（命名空间 %s）' % (rem.url, len(idx), '、'.join(sorted({k.split('/')[0] for k in idx})) or '空'))
    print('数据目录 %s' % data)
    print('── 本机 → 服务器'); a.dry_run, a.prefer = True, None
    r1 = cmd_push(a)
    print('── 服务器 → 本机'); r2 = cmd_pull(a)
    print('── 明确不会上传'); [print('  · ' + e) for e in exclusions(data)]
    return r1 or r2


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    i = sp.add_parser('init'); i.add_argument('--url', required=True); i.add_argument('--force', action='store_true', help='轮换 token（口令保持不变）'); i.add_argument('--new-passphrase', action='store_true', help='同时换口令（旧密文作废，需删库重推）'); i.set_defaults(f=cmd_init)
    for n, f in (('status', cmd_status), ('push', cmd_push), ('pull', cmd_pull)):
        p = sp.add_parser(n); p.add_argument('--data'); p.add_argument('--dry-run', action='store_true')
        p.add_argument('--prefer', choices=('local', 'remote')); p.set_defaults(f=f)
    a = ap.parse_args()
    sys.exit(a.f(a) or 0)


if __name__ == '__main__':
    main()
