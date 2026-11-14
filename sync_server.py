#!/usr/bin/env python3
"""记录工作台 · 同步仓库（部署在 CMIN2，只存数据，不跑应用、不调模型）。

服务器看到的只有「命名空间/名字」、大小和版本号；内容由本机客户端加密后上传，
服务器没有解密口令。录音永远不会经过这里（客户端不读音频，这里也限制名字和大小）。

接口（除 / 与 /healthz 外都要 Authorization: Bearer <token>）：
  GET  /healthz                     存活检查（不含任何数据）
  GET  /v1/index                    全部 blob 的 {版本, sha256, 大小, 更新时间}
  GET  /v1/blob/<ns>/<name>         取内容；ETag = 版本号
  PUT  /v1/blob/<ns>/<name>         存内容；必须带 If-Match: <当前版本>（新建用 0），不符返回 409
ns 只允许 config / keys / records。仅标准库，Python 3.9+。
"""
import hashlib, hmac, json, os, pathlib, re, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STORE = pathlib.Path(os.environ.get('LECTURE_SYNC_STORE', '/var/lib/lecture-sync')).resolve()
HOST = os.environ.get('LECTURE_SYNC_HOST', '127.0.0.1')
PORT = int(os.environ.get('LECTURE_SYNC_PORT', '8791'))
MAX_BODY = int(os.environ.get('LECTURE_SYNC_MAX_BODY', str(8 * 1024 * 1024)))
NAMESPACES = ('config', 'keys', 'records')
NAME_RE = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}')
AUDIO_EXT = ('.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.pcm', '.aiff')
LOCK = threading.Lock()


def token_hash():
    """token 的 sha256（十六进制）。服务器只存哈希，不存 token 本身。"""
    p = STORE / 'token.sha256'
    return p.read_text().strip().lower() if p.is_file() else ''


def blob_path(ns, name): return STORE / ns / name
def meta_path(ns, name): return STORE / ns / (name + '.meta')


def read_meta(ns, name):
    try: return json.loads(meta_path(ns, name).read_text())
    except (OSError, ValueError): return None


def atomic_write(path, data):
    tmp = path.with_name(path.name + '.tmp')
    with open(tmp, 'wb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def store_blob(ns, name, body, if_match):
    with LOCK:
        meta = read_meta(ns, name)
        cur = meta['version'] if meta else 0
        if if_match != cur: return 409, {'error': 'version conflict', 'version': cur}
        (STORE / ns).mkdir(parents=True, exist_ok=True)
        os.chmod(STORE / ns, 0o700)
        bp = blob_path(ns, name)
        if bp.is_file(): atomic_write(blob_path(ns, name + '.prev'), bp.read_bytes())  # 留一份上一版，便于回滚
        new = {'version': cur + 1, 'sha256': hashlib.sha256(body).hexdigest(), 'size': len(body),
               'updated': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
        atomic_write(bp, body)
        atomic_write(meta_path(ns, name), json.dumps(new).encode())
        return 200, new


def index():
    out = {}
    for ns in NAMESPACES:
        d = STORE / ns
        if not d.is_dir(): continue
        for m in sorted(d.glob('*.meta')):
            name = m.name[:-5]
            meta = read_meta(ns, name)
            if meta and blob_path(ns, name).is_file(): out[ns + '/' + name] = meta
    return out


class Handler(BaseHTTPRequestHandler):
    server_version = 'lecture-sync'
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):  # 只记方法/路径/状态，不记 header 与内容
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    def send(self, code, body=b'', ctype='application/json', extra=None):
        if isinstance(body, (dict, list)): body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD': self.wfile.write(body)

    def authed(self):
        want = token_hash()
        got = self.headers.get('Authorization', '')
        ok = bool(want) and got.startswith('Bearer ') and hmac.compare_digest(
            hashlib.sha256(got[7:].strip().encode()).hexdigest(), want)
        if not ok:
            time.sleep(0.4)  # 拖慢暴力尝试
            self.send(401, {'error': 'unauthorized'}, extra={'WWW-Authenticate': 'Bearer'})
        return ok

    def parse_blob(self, path):
        m = re.fullmatch(r'/v1/blob/([a-z]+)/([^/]+)', path)
        if not m or m.group(1) not in NAMESPACES: return None
        ns, name = m.groups()
        if not NAME_RE.fullmatch(name) or name.endswith(('.meta', '.prev', '.tmp')) or name.lower().endswith(AUDIO_EXT): return None
        return ns, name

    def do_HEAD(self): self.do_GET()

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/': return self.send(200, b'lecture-sync ok\n', 'text/plain; charset=utf-8')
        if path == '/healthz': return self.send(200, {'ok': True})
        if not self.authed(): return
        if path == '/v1/index': return self.send(200, index())
        b = self.parse_blob(path)
        if not b: return self.send(404, {'error': 'not found'})
        ns, name = b
        meta = read_meta(ns, name)
        if not meta or not blob_path(ns, name).is_file(): return self.send(404, {'error': 'not found'})
        self.send(200, blob_path(ns, name).read_bytes(), 'application/octet-stream',
                  {'ETag': str(meta['version']), 'X-Sha256': meta['sha256']})

    def do_PUT(self):
        self.close_connection = True  # 提前返回时请求体没读完，不能复用这条连接
        path = self.path.split('?')[0]
        if not self.authed(): return
        b = self.parse_blob(path)
        if not b: return self.send(404, {'error': 'not found'})
        try: n = int(self.headers.get('Content-Length', ''))
        except ValueError: return self.send(411, {'error': 'content-length required'})
        if n < 0 or n > MAX_BODY:
            return self.send(413, {'error': 'too large', 'max': MAX_BODY})
        try: if_match = int(self.headers.get('If-Match', ''))
        except ValueError: return self.send(428, {'error': 'If-Match required (0 to create)'})
        body = self.rfile.read(n)
        if len(body) != n: return self.send(400, {'error': 'short body'})
        self.close_connection = False
        code, out = store_blob(b[0], b[1], body, if_match)
        self.send(code, out)

    def do_DELETE(self): self.send(405, {'error': 'delete is done by hand on the server'})


def main():
    STORE.mkdir(parents=True, exist_ok=True)
    os.chmod(STORE, 0o700)
    if not token_hash(): print('警告：%s 不存在，所有受保护接口都会返回 401' % (STORE / 'token.sha256'), file=sys.stderr)
    print('lecture-sync 监听 %s:%d，数据目录 %s' % (HOST, PORT, STORE), flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == '__main__':
    main()
