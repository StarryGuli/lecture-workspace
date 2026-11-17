#!/usr/bin/env python3
"""Private account gateway. Run `set-password --stdin` before `serve`.
Only this service accepts server-managed provider/sync secrets; sync_server is unchanged.
"""
import argparse
import collections
import getpass
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import pathlib
import re
import secrets
import socket
import sqlite3
import ssl
import sys
import threading
import time
import urllib.parse
import zlib
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import sync_client as sync

ORIGIN = 'https://lecture.example.com'
JSON_LIMIT = 1024 * 1024
AUDIO_LIMIT = 32 * JSON_LIMIT
COOKIE = '__Host-lecture_session'
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}')


class Failure(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def check(ok, message='invalid request'):
    if not ok:
        raise Failure(400, message)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()


def private_write(path, value):
    tmp = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(canonical(value)); f.flush(); os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists(): tmp.unlink()


def password_valid(password):
    return isinstance(password, str) and 6 <= len(password) <= 128 and not any(c in password for c in '\r\n\x00')


def public_addresses(host, port):
    check(host and not host.lower().rstrip('.').endswith(('.localhost', '.local', '.internal')) and host.lower() != 'localhost', 'invalid provider host')
    try:
        addresses = list(dict.fromkeys(a[4][0] for a in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)))
        check(addresses and all(ipaddress.ip_address(a).is_global for a in addresses), 'invalid provider host')
        return addresses
    except (OSError, ValueError):
        raise Failure(400, 'invalid provider host')


def provider_url(url):
    check(isinstance(url, str) and not any(c.isspace() for c in url) and '\\' not in url)
    u = urllib.parse.urlsplit(url)
    check(u.scheme == 'https' and u.hostname and not u.username and not u.password and not u.query and not u.fragment, 'invalid provider URL')
    try: port = u.port or 443
    except ValueError: raise Failure(400, 'invalid provider URL')
    public_addresses(u.hostname, port)
    check(not any(x in urllib.parse.unquote(u.path).split('/') for x in ('.', '..')))
    return u


def valid_path(path):
    check(isinstance(path, str) and re.fullmatch(r'/[A-Za-z0-9_./-]*', path) and not path.startswith('//') and not any(x in path.split('/') for x in ('.', '..')), 'invalid provider path')
    return path


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, port, address):
        super().__init__(host, port, timeout=120, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw = socket.create_connection((self.address, self.port), self.timeout)
        try: self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close(); raise


def provider_transport(method, url, headers, body):
    u = provider_url(url)
    addresses = public_addresses(u.hostname, u.port or 443)
    conn = PinnedHTTPS(u.hostname, u.port or 443, addresses[0])
    try:
        conn.request(method, u.path or '/', body=body, headers=headers)
        response = conn.getresponse()
        response._gateway_connection = conn
        return response
    except Exception:
        conn.close(); raise


PRIVATE_ASR_ID = 'windows-asr'
PRIVATE_ASR_TRANSCRIBE = '/v1/audio/transcriptions'


def private_asr_settings(env=None):
    """One server-side private ASR upstream, e.g. a GPU laptop reached over Tailscale.

    Only the operator sets it (systemd Environment). Clients can select it by id but can
    never supply or change its address, so the public-HTTPS rule for providers stays intact.
    """
    env = os.environ if env is None else env
    url = env.get('LECTURE_PRIVATE_ASR_URL', '').strip()
    if not url: return None
    u = urllib.parse.urlsplit(url)
    try:
        address = ipaddress.ip_address(u.hostname or '')
        port = u.port
    except ValueError:
        raise SystemExit('LECTURE_PRIVATE_ASR_URL must be http://<private IP>:<port>')
    tailnet = ipaddress.ip_network('100.64.0.0/10')
    if u.scheme != 'http' or not port or u.path not in ('', '/') or u.query or u.username or not (address.is_private or address in tailnet) or address.is_loopback:
        raise SystemExit('LECTURE_PRIVATE_ASR_URL must be http://<private or Tailscale IP>:<port> without a path')
    return {'host': str(address), 'port': port,
            'name': env.get('LECTURE_PRIVATE_ASR_NAME', 'Windows 本地识别'),
            'model': env.get('LECTURE_PRIVATE_ASR_MODEL', 'Qwen/Qwen3-ASR-1.7B'),
            'fallback': env.get('LECTURE_PRIVATE_ASR_FALLBACK', 'siliconflow')}


def private_transport(settings, method, path, headers, body, timeout):
    conn = http.client.HTTPConnection(settings['host'], settings['port'], timeout=timeout)
    try:
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        response._gateway_connection = conn
        return response
    except Exception:
        conn.close(); raise


def audio_seconds(body):
    # PCM16 mono 16 kHz WAV inside multipart: a conservative size-based estimate.
    return max(1.0, len(body or b'') / 32000)


def validate_record(p):
    check(isinstance(p, dict) and set(p) == {'schema', 'session', *sync.TABLES} and p['schema'] == 1, 'invalid record schema')
    s = p['session']
    check(isinstance(s, dict) and set(s) == set(sync.SESSION_COLS), 'invalid session')
    check(isinstance(s['id'], str) and ID.fullmatch(s['id']) and not s['id'].lower().endswith(sync_audio_ext()), 'invalid session id')
    check(all(isinstance(s[k], str) for k in sync.SESSION_COLS) and s['status'] != 'recording', 'invalid session')
    for table, cols in sync.TABLES.items():
        check(isinstance(p[table], list) and len(p[table]) <= 10000)
        seen = set()
        for row in p[table]:
            check(isinstance(row, dict) and set(row) == set(cols), 'invalid record columns')
            check(isinstance(row['id'], (str, int)) and not isinstance(row['id'], bool) and row['session'] == s['id'], 'invalid record identity')
            check(str(row['id']) not in seen); seen.add(str(row['id']))
            check(all(v is None or type(v) in (str, int, float) for v in row.values()), 'invalid record value')
    canonical(p)
    return p


def sync_audio_ext():
    return ('.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg', '.opus', '.webm', '.pcm', '.aiff', '.meta', '.prev', '.tmp')


def cipher(data, passphrase, decrypt=False):
    pw = passphrase.encode()
    if not decrypt:
        ct = sync._openssl(False, zlib.compress(data, 6), pw)
        return sync.MAGIC + hmac.new(sync.mac_key(pw), ct, 'sha256').digest() + ct
    check(data.startswith(sync.MAGIC) and len(data) >= len(sync.MAGIC) + 32)
    mac, ct = data[len(sync.MAGIC):len(sync.MAGIC)+32], data[len(sync.MAGIC)+32:]
    check(hmac.compare_digest(mac, hmac.new(sync.mac_key(pw), ct, 'sha256').digest()))
    compressed = sync._openssl(True, ct, pw)
    decoder = zlib.decompressobj()
    out = decoder.decompress(compressed, 8 * JSON_LIMIT + 1)
    check(len(out) <= 8 * JSON_LIMIT and decoder.eof and not decoder.unused_data)
    return out


class Account:
    def __init__(self, store=None, origin=None, transport=None, private_asr=False, private_fetch=None):
        self.store = pathlib.Path(store or os.environ.get('LECTURE_ACCOUNT_STORE', '/var/lib/lecture-account'))
        self.store.mkdir(parents=True, exist_ok=True); os.chmod(self.store, 0o700)
        self.origin = origin or os.environ.get('LECTURE_ACCOUNT_ORIGIN', ORIGIN)
        self.lock = threading.RLock()
        self.transport = transport or provider_transport
        self.private_asr = private_asr_settings() if private_asr is False else private_asr
        self.private_fetch = private_fetch or (lambda *a: private_transport(self.private_asr, *a))
        self.private_state = {'at': 0.0, 'health': None, 'warmup_at': 0.0, 'inflight': 0}
        self.proxy_slots = threading.BoundedSemaphore(8)
        self.failures = collections.OrderedDict()
        self.global_attempts = collections.deque(maxlen=100)
        if not (self.store / 'credentials.json').exists():
            private_write(self.store / 'credentials.json', {'keys': {}, 'providers': [], 'config': {}, 'sync': {}})
        os.chmod(self.store / 'credentials.json', 0o600)
        with self.db() as db:
            db.execute('CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expiry REAL NOT NULL)')
        os.chmod(self.store / 'sessions.sqlite', 0o600)

    def db(self):
        return sqlite3.connect(self.store / 'sessions.sqlite', timeout=5)

    def credentials(self):
        with self.lock:
            return json.loads((self.store / 'credentials.json').read_text())

    def set_password(self, password):
        check(password_valid(password), 'password must contain 6..128 characters without newlines')
        salt = secrets.token_bytes(16)
        hashed = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1).hex()
        with self.lock:
            private_write(self.store / 'auth.json', {'salt': salt.hex(), 'hash': hashed})
            with self.db() as db: db.execute('DELETE FROM sessions')

    def configured(self):
        return (self.store / 'auth.json').is_file()

    def login(self, password, remember, ip):
        with self.lock:
            now = time.time()
            while self.global_attempts and self.global_attempts[0] <= now - 300: self.global_attempts.popleft()
            q = self.failures.setdefault(ip, collections.deque(maxlen=5))
            self.failures.move_to_end(ip)
            while len(self.failures) > 4096: self.failures.popitem(last=False)
            while q and q[0] <= now - 300: q.popleft()
            if len(q) >= 5 or len(self.global_attempts) >= 100: raise Failure(429, 'too many attempts')
            self.global_attempts.append(now)
            ok = False
            if self.configured() and password_valid(password):
                auth = json.loads((self.store / 'auth.json').read_text())
                hashed = hashlib.scrypt(password.encode(), salt=bytes.fromhex(auth['salt']), n=16384, r=8, p=1).hex()
                ok = hmac.compare_digest(hashed, auth['hash'])
            if not ok:
                q.append(now); raise Failure(401, 'invalid credentials')
            self.failures.pop(ip, None)
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            duration = 30 * 86400 if remember else 86400
            with self.db() as db:
                db.execute('DELETE FROM sessions WHERE expiry <= ?', (now,))
                db.execute('INSERT INTO sessions VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), csrf, now + duration))
            return token, csrf, duration

    def session(self, raw):
        try:
            c = SimpleCookie(); c.load(raw)
            token = c[COOKIE].value
            if len(token) > 128: return None
        except (KeyError, ValueError): return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        with self.lock, self.db() as db:
            row = db.execute('SELECT csrf,expiry FROM sessions WHERE hash=?', (digest,)).fetchone()
        return (digest, row[0]) if row and row[1] > time.time() else None

    def sanitized(self, value):
        # Remove secret-shaped fields at every level, and redact known secret values.
        creds = self.credentials()
        secret_values = [v for v in creds.get('keys', {}).values() if isinstance(v, str) and v]
        secret_values += [v for v in creds.get('sync', {}).values() if isinstance(v, str) and v]
        for p in creds.get('providers', []):
            secret_values.extend(v for v in p.get('headers', {}).values() if isinstance(v, str) and v)
            a = p.get('auth', '')
            if isinstance(a, str) and '<key>' not in a and a not in ('', 'No key (local server)'): secret_values.append(a)
        def clean(v):
            if isinstance(v, dict):
                return {k: clean(x) for k, x in v.items() if not re.fullmatch(r'api_?key|key|keys|secret|secrets|token|access_?token|refresh_?token|passphrase|password|headers|authorization|cookie|auth', k, re.I)}
            if isinstance(v, list): return [clean(x) for x in v]
            if isinstance(v, str):
                for secret in secret_values: v = v.replace(secret, '[redacted]')
            return v
        return clean(value)

    def bootstrap(self):
        c = self.credentials()
        providers = []
        for p in c.get('providers', []):
            public = self.sanitized({k: p[k] for k in ('id', 'name', 'baseURL', 'chatPath', 'transcriptionPath', 'models', 'network', 'webOnly') if k in p})
            public.update(hasKey=bool(c.get('keys', {}).get(p['id'])), serverManaged=True)
            public.update(auth='服务器保管认证信息', network='服务器代理')
            providers.append(public)
        s = self.private_asr
        if s:
            fallback = next((p for p in c.get('providers', []) if p['id'] == s['fallback']), None)
            providers.append({'id': PRIVATE_ASR_ID, 'name': s['name'], 'baseURL': 'tailscale://' + PRIVATE_ASR_ID,
                              'transcriptionPath': '/audio/transcriptions', 'models': [s['model']], 'webOnly': True,
                              'hasKey': True, 'serverManaged': True, 'privateRelay': True, 'isLocalModel': True,
                              'ownHardware': True, 'asrOnly': True, 'auth': '服务器经 Tailscale 调用，无需密钥', 'network': '服务器代理',
                              'fallbackProvider': fallback and {'id': fallback['id'], 'name': fallback.get('name', fallback['id'])}})
        return {'config': self.sanitized(c.get('config', {})), 'providers': providers, 'serverManaged': True,
                'searchReady': bool(c.get('keys', {}).get('search-key'))}

    # Private ASR (Windows GPU over Tailscale). Health is cached briefly so each speech
    # segment does not pay an extra round trip; any failure falls back to the public provider.
    def private_health(self, max_age=5.0):
        st = self.private_state
        if time.monotonic() - st['at'] < max_age: return st['health']
        health = None
        try:
            r = self.private_fetch('GET', '/health', {}, None, 4)
            try:
                if r.status == 200:
                    value = json.loads(r.read(65536))
                    if isinstance(value, dict): health = {'loaded': value.get('loaded') is True, 'busy': value.get('busy') is True}
            finally: r.close()
        except Exception: health = None
        st['at'], st['health'] = time.monotonic(), health
        return health

    def private_warmup(self):
        st = self.private_state
        with self.lock:
            if time.monotonic() - st['warmup_at'] < 60: return False
            st['warmup_at'] = time.monotonic()
        def go():
            try:
                r = self.private_fetch('POST', '/warmup', {'Content-Length': '0'}, b'', 10); r.read(65536); r.close()
            except Exception: pass
            st['at'] = 0.0
        threading.Thread(target=go, daemon=True).start()
        return True

    def private_status(self, warm=False):
        if not self.private_asr: return {'configured': False}
        h = self.private_health(max_age=2.0)
        started = warm and h is not None and not h['loaded'] and self.private_warmup()
        state = 'offline' if h is None else 'ready' if h['loaded'] else 'loading' if (h['busy'] or started or time.monotonic() - self.private_state['warmup_at'] < 240) else 'idle'
        return {'configured': True, 'name': self.private_asr['name'], 'state': state, 'reachable': h is not None,
                'loaded': bool(h and h['loaded']), 'warming': started or state == 'loading', 'fallback': self.private_asr['fallback']}

    def private_route(self):
        """Decide where the next private-ASR segment goes: ('private', None) or (fallback_id, reason)."""
        s, st = self.private_asr, self.private_state
        h = self.private_health()
        if h is None: return s['fallback'], 'offline'
        if not h['loaded']:
            self.private_warmup()
            return s['fallback'], 'loading'
        with self.lock:
            if st['inflight'] >= 2: return s['fallback'], 'backlog'
            st['inflight'] += 1
        return 'private', None

    def private_done(self):
        with self.lock: self.private_state['inflight'] = max(0, self.private_state['inflight'] - 1)

    def save_provider(self, body):
        check(isinstance(body, dict) and set(body) <= {'provider', 'key'} and isinstance(body.get('provider'), dict))
        public = body['provider']
        if public.get('id') == 'brave' and set(public) <= {'id', 'name'}:
            key = body.get('key')
            check(isinstance(key, str) and len(key) <= 8192 and not any(x in key for x in '\r\n'))
            with self.lock:
                c = self.credentials(); c.setdefault('keys', {})['search-key'] = key
                private_write(self.store / 'credentials.json', c)
            return {'saved': True, 'hasKey': bool(key)}
        allowed = {'id', 'name', 'baseURL', 'auth', 'chatPath', 'transcriptionPath', 'headers', 'models', 'network', 'webOnly', 'hasKey', 'serverManaged'}
        check(set(public) <= allowed and isinstance(public.get('id'), str) and ID.fullmatch(public['id']))
        check(public['id'] != PRIVATE_ASR_ID, 'reserved provider id')
        with self.lock:
            c = self.credentials(); providers = c.setdefault('providers', [])
            old = next((p for p in providers if p['id'] == public['id']), {})
            p = dict(old); p.update({k: v for k, v in public.items() if k not in ('hasKey', 'serverManaged', 'headers')})
            headers = dict(old.get('headers', {}))
            if 'headers' in public:
                check(isinstance(public['headers'], dict)); headers.update(public['headers'])
            check(len(headers) <= 32)
            for k, v in headers.items():
                check(isinstance(k, str) and re.fullmatch(r'[A-Za-z0-9-]+', k) and k.lower() not in ('host', 'cookie', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'proxy-authorization') and isinstance(v, str) and len(v) <= 8192 and '\r' not in v and '\n' not in v)
            p['headers'] = headers
            provider_url(p.get('baseURL'))
            for k, default in [('chatPath', '/chat/completions'), ('transcriptionPath', '/audio/transcriptions')]: p[k] = valid_path(p.get(k, default))
            auth = p.setdefault('auth', 'Authorization: Bearer <key>')
            check(isinstance(auth, str) and (auth == 'No key (local server)' or re.fullmatch(r'(Authorization: (Bearer |Basic )?|[xX]-[A-Za-z0-9-]+: )<key>', auth)), 'invalid provider auth')
            if 'key' in body:
                check(isinstance(body['key'], str) and len(body['key']) <= 8192 and not any(x in body['key'] for x in '\r\n'))
                c.setdefault('keys', {})[p['id']] = body['key']
            c['providers'] = [v for v in providers if v['id'] != p['id']] + [p]
            private_write(self.store / 'credentials.json', c)
        return self.bootstrap()

    def upstream(self, method, provider_id, action, body, ctype):
        c = self.credentials()
        p = next((p for p in c['providers'] if p['id'] == provider_id), None)
        if p is None: raise Failure(404, 'provider not found')
        path = '/models' if action == 'models' else p.get('chatPath' if action == 'chat' else 'transcriptionPath')
        valid_path(path)
        url = p['baseURL'].rstrip('/') + path
        provider_url(url)
        headers = dict(p.get('headers', {}))
        # Never inherit any incoming request headers, especially cookies.
        headers = {k: v for k, v in headers.items() if k.lower() not in ('cookie', 'host', 'content-length', 'connection', 'transfer-encoding')}
        auth = p.get('auth', 'Authorization: Bearer <key>')
        if auth != 'No key (local server)':
            check(isinstance(auth, str) and '<key>' in auth and ':' in auth, 'invalid provider auth')
            key = c.get('keys', {}).get(provider_id, '')
            if not key: raise Failure(503, 'provider unavailable')
            name, value = auth.split(':', 1); headers[name] = value.strip().replace('<key>', key)
        if ctype: headers['Content-Type'] = ctype
        return self.transport(method, url, headers, body)

    def sync_call(self, method, path, settings, body=None, version=None):
        conn = http.client.HTTPConnection('127.0.0.1', 8791, timeout=20)
        headers = {'Authorization': 'Bearer ' + settings['token']}
        if version is not None: headers['If-Match'] = str(version)
        try:
            conn.request(method, path, body=body, headers=headers)
            r = conn.getresponse(); data = r.read(8 * JSON_LIMIT + 1)
            if len(data) > 8 * JSON_LIMIT: raise Failure(502, 'sync unavailable')
            return r.status, data, r.getheader('ETag')
        finally: conn.close()

    def records(self, incoming=None):
        settings = self.credentials().get('sync', {})
        if not settings.get('token') or not settings.get('passphrase'):
            if incoming is None: return {'records': [], 'available': False}
            raise Failure(503, 'sync unavailable')
        def index():
            code, data, _ = self.sync_call('GET', '/v1/index', settings)
            if code != 200: raise Failure(502, 'sync unavailable')
            return json.loads(data)
        def fetch(name):
            code, data, version = self.sync_call('GET', '/v1/blob/' + name, settings)
            if code != 200: raise Failure(502, 'sync unavailable')
            p = validate_record(json.loads(cipher(data, settings['passphrase'], True)))
            check(name == 'records/' + p['session']['id'])
            return p, int(version)
        if incoming is None:
            result = []
            for name in index():
                if not name.startswith('records/') or not ID.fullmatch(name[8:]): continue
                try: result.append(fetch(name)[0])
                except (Failure, ValueError, KeyError, TypeError): continue
            return {'records': result, 'available': True}
        check(isinstance(incoming, dict) and set(incoming) == {'records'} and isinstance(incoming['records'], list) and len(incoming['records']) <= 100)
        payloads = [validate_record(p) for p in incoming['records']]
        for p in payloads:
            name = 'records/' + p['session']['id']
            for attempt in range(4):  # initial attempt plus at most three conflict retries
                idx = index(); version = 0; merged = p
                if name in idx:
                    old, version = fetch(name)
                    # Existing immutable session and row values always win.
                    merged = json.loads(sync.merge_records(canonical(old), canonical(p)))
                code, _, _ = self.sync_call('PUT', '/v1/blob/' + name, settings, cipher(canonical(merged), settings['passphrase']), version)
                if code == 200: break
                if code != 409: raise Failure(502, 'sync unavailable')
                if attempt == 3: raise Failure(409, 'sync conflict')
        return {'ok': True, 'saved': len(payloads)}


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 32
    def __init__(self, address, account):
        self.account = account
        self.slots = threading.BoundedSemaphore(24)
        super().__init__(address, Handler)

    def process_request(self, request, address):
        if not self.slots.acquire(False):
            try: request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: 16\r\nConnection: close\r\n\r\n{"error":"busy"}')
            finally: self.shutdown_request(request)
            return
        try: super().process_request(request, address)
        except Exception:
            self.slots.release(); raise

    def process_request_thread(self, request, address):
        try: super().process_request_thread(request, address)
        finally: self.slots.release()

    def handle_error(self, request, client_address):
        pass  # no exception text, upstream URLs or credentials in logs


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'lecture-account'
    def setup(self):
        super().setup(); self.connection.settimeout(20); self.started_response = False

    def log_message(self, *args): pass

    def send_error(self, code, message=None, explain=None):
        self.send(code, {'error': 'invalid request'})

    def send(self, status, value, headers=None):
        data = canonical(value)
        self.send_response(status); self.started_response = True
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(data)
        self.close_connection = True
        self.audit(status)

    def audit(self, status):
        # Log only known route shapes, never arbitrary paths or queries.
        route = getattr(self, 'route', '/account/unknown')
        sys.stderr.write('%s %s\n' % (route, status))

    def body(self, limit, raw=False):
        check(not self.headers.get('Transfer-Encoding'), 'transfer encoding unsupported')
        check(len(self.headers.get_all('Content-Length', [])) == 1, 'content length required')
        try: n = int(self.headers['Content-Length'])
        except ValueError: raise Failure(400, 'invalid content length')
        if n < 0 or n > limit: raise Failure(413, 'body too large')
        b = self.rfile.read(n); check(len(b) == n, 'short body')
        if raw: return b
        check(self.headers.get_content_type() == 'application/json', 'JSON required')
        try:
            value = json.loads(b, parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
            check(isinstance(value, dict)); return value
        except (ValueError, UnicodeError): raise Failure(400, 'invalid JSON')

    def do_GET(self): self.dispatch()
    def do_POST(self): self.dispatch()
    def do_PUT(self): self.dispatch()
    def do_DELETE(self): self.dispatch()

    def dispatch(self):
        self.close_connection = True
        self.route = '/account/unknown'
        try: self.handle_account()
        except Failure as e:
            if not self.started_response: self.send(e.status, {'error': e.message})
        except (BrokenPipeError, ConnectionResetError): pass
        except Exception:
            if not self.started_response: self.send(502, {'error': 'service unavailable'})

    def handle_account(self):
        a = self.server.account
        path = self.path
        match = re.fullmatch(r'/account/model/([A-Za-z0-9][A-Za-z0-9._-]{0,79})/(models|chat|transcribe)', path)
        routes = {'/account/status', '/account/login', '/account/logout', '/account/bootstrap', '/account/settings', '/account/providers', '/account/search', '/account/records', '/account/private-asr'}
        if path not in routes and not match: raise Failure(404, 'not found')
        self.route = '/account/model/:provider/' + match[2] if match else path
        session = a.session(self.headers.get('Cookie', ''))
        if self.command == 'GET' and path == '/account/status':
            out = {'enabled': True, 'configured': a.configured(), 'authenticated': bool(session)}
            if session: out['csrfToken'] = session[1]
            return self.send(200, out)
        if self.command not in ('GET',):
            if self.headers.get_all('Origin', []) != [a.origin]: raise Failure(403, 'origin required')
        if path == '/account/login' and self.command == 'POST':
            b = self.body(16384)
            check(set(b) <= {'password', 'remember'} and type(b.get('remember', False)) is bool)
            # X-Real-IP is trusted only from the loopback reverse proxy. It must overwrite this header.
            ip = self.client_address[0]
            if ipaddress.ip_address(ip).is_loopback:
                candidate = self.headers.get('X-Real-IP', ip)
                try: ip = str(ipaddress.ip_address(candidate))
                except ValueError: pass
            token, csrf, age = a.login(b.get('password'), b.get('remember', False), ip)
            return self.send(200, {'authenticated': True, 'csrfToken': csrf}, {'Set-Cookie': f'{COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age={age}'})
        if not session: raise Failure(401, 'authentication required')
        if self.command != 'GET' and (len(self.headers.get_all('X-CSRF-Token', [])) != 1 or not hmac.compare_digest(self.headers.get('X-CSRF-Token', ''), session[1])): raise Failure(403, 'CSRF required')
        if path == '/account/logout' and self.command == 'POST':
            with a.lock, a.db() as db: db.execute('DELETE FROM sessions WHERE hash=?', (session[0],))
            return self.send(200, {'ok': True}, {'Set-Cookie': f'{COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'})
        if path == '/account/bootstrap' and self.command == 'GET': return self.send(200, a.bootstrap())
        if path == '/account/settings':
            if self.command == 'GET': return self.send(200, a.bootstrap()['config'])
            if self.command == 'PUT':
                config = self.body(JSON_LIMIT)
                if set(config) == {'config'}:
                    config = config['config']
                    check(isinstance(config, dict))
                # Secret fields and literal endpoint overrides do not belong in native settings.
                def safe(v):
                    if isinstance(v, dict):
                        for k, x in v.items():
                            check(not re.fullmatch(r'api_?key|key|keys|secret|secrets|token|access_?token|refresh_?token|password|passphrase|headers|baseurl|chatpath|transcriptionpath|authorization|cookie', k, re.I), 'invalid settings field'); safe(x)
                    elif isinstance(v, list):
                        for x in v: safe(x)
                safe(config)
                with a.lock:
                    c = a.credentials(); c['config'] = config; private_write(a.store / 'credentials.json', c)
                return self.send(200, a.bootstrap()['config'])
        if path == '/account/providers' and self.command == 'POST': return self.send(200, a.save_provider(self.body(JSON_LIMIT)))
        if path == '/account/records' and self.command in ('GET', 'POST'):
            return self.send(200, a.records(None if self.command == 'GET' else self.body(8 * JSON_LIMIT)))
        if path == '/account/private-asr' and self.command in ('GET', 'POST'):
            if self.command == 'POST': self.body(16384)
            return self.send(200, a.private_status(warm=self.command == 'POST'))
        if match and match[1] == PRIVATE_ASR_ID:
            if not a.private_asr: raise Failure(404, 'provider not found')
            if match[2] == 'models' and self.command == 'GET': return self.send(200, {'data': [{'id': a.private_asr['model']}]})
            if match[2] != 'transcribe' or self.command != 'POST': raise Failure(400, 'speech recognition only')
            return self.private_transcribe()
        if match and ((match[2] == 'models' and self.command == 'GET') or (match[2] != 'models' and self.command == 'POST')):
            if not a.proxy_slots.acquire(False): raise Failure(503, 'provider busy')
            try:
                data, ctype = None, None
                if match[2] == 'chat':
                    body = self.body(JSON_LIMIT)
                    check(not any(k.lower() in ('url', 'baseurl', 'headers', 'path', 'chatpath', 'transcriptionpath', 'provider') for k in body), 'endpoint overrides forbidden')
                    data, ctype = canonical(body), 'application/json'
                elif match[2] == 'transcribe':
                    ctype = self.headers.get('Content-Type', '')
                    check(self.headers.get_content_type() == 'multipart/form-data' and self.headers.get_param('boundary') and '\r' not in ctype and '\n' not in ctype, 'multipart required')
                    data = self.body(AUDIO_LIMIT, True)
                response = a.upstream(self.command, match[1], match[2], data, ctype)
                try: return self.forward(response)
                finally:
                    response.close()
                    conn = getattr(response, '_gateway_connection', None)
                    if conn: conn.close()
            finally: a.proxy_slots.release()
        if path == '/account/search' and self.command == 'POST':
            b = self.body(JSON_LIMIT); check(set(b) == {'q'} and isinstance(b['q'], str) and 0 < len(b['q']) <= 2000)
            key = a.credentials().get('keys', {}).get('search-key')
            if not key: raise Failure(503, 'search unavailable')
            if not a.proxy_slots.acquire(False): raise Failure(503, 'provider busy')
            try:
                url = 'https://api.search.brave.com/res/v1/web/search'
                # fixed HTTPS host/path; query is encoded data only
                response = self.brave(url, b['q'], key)
                try: return self.forward(response)
                finally: response.close()
            finally: a.proxy_slots.release()
        raise Failure(405, 'method not allowed')

    def private_transcribe(self):
        a = self.server.account
        ctype = self.headers.get('Content-Type', '')
        check(self.headers.get_content_type() == 'multipart/form-data' and self.headers.get_param('boundary') and '\r' not in ctype and '\n' not in ctype, 'multipart required')
        if not a.proxy_slots.acquire(False): raise Failure(503, 'provider busy')
        try:
            data = self.body(AUDIO_LIMIT, True)
            target, reason = a.private_route()
            if target == 'private':
                try:
                    seconds = audio_seconds(data)
                    # Measured warm speed is ~0.6x real time plus relay transfer; leave room for fallback.
                    response = a.private_fetch('POST', PRIVATE_ASR_TRANSCRIBE, {'Content-Type': ctype}, data, min(420, 10 + 0.8 * seconds))
                    try:
                        if 200 <= response.status < 300:
                            return self.forward(response, {'X-Lecture-ASR-Backend': PRIVATE_ASR_ID})
                        reason = 'busy' if response.status == 503 else 'error'
                    finally:
                        response.close()
                        conn = getattr(response, '_gateway_connection', None)
                        if conn: conn.close()
                except Failure:
                    if self.started_response: raise
                    reason = 'error'
                except (OSError, http.client.HTTPException):
                    reason = 'timeout'
                finally:
                    a.private_done()
                a.private_state['at'] = 0.0  # re-check health before the next segment
                target = a.private_asr['fallback']
            response = a.upstream('POST', target, 'transcribe', data, ctype)
            try: return self.forward(response, {'X-Lecture-ASR-Backend': target, 'X-Lecture-ASR-Fallback': reason})
            finally:
                response.close()
                conn = getattr(response, '_gateway_connection', None)
                if conn: conn.close()
        finally: a.proxy_slots.release()

    def brave(self, url, query, key):
        # Use the injected transport as for provider tests. Production transport
        # intentionally excludes arbitrary queries, so handle fixed Brave query here.
        if self.server.account.transport is not provider_transport:
            return self.server.account.transport('GET', url + '?q=' + urllib.parse.quote(query), {'X-Subscription-Token': key}, None)
        u = provider_url(url); address = public_addresses(u.hostname, 443)[0]
        conn = PinnedHTTPS(u.hostname, 443, address)
        try:
            conn.request('GET', u.path + '?q=' + urllib.parse.quote(query), headers={'X-Subscription-Token': key})
            r = conn.getresponse(); r._gateway_connection = conn; return r
        except Exception:
            conn.close(); raise

    def forward(self, response, headers=None):
        if not 200 <= response.status < 300:
            # Keep actionable billing/rate-limit status without exposing upstream bodies.
            if response.status in (402, 429):
                raise Failure(response.status, 'provider quota or billing limit' if response.status == 402 else 'provider rate limit')
            raise Failure(502, 'provider request failed')
        ctype = response.getheader('Content-Type', '')
        if ctype.split(';')[0].strip() == 'text/event-stream':
            self.send_response(200); self.started_response = True
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.send_header('Connection', 'close'); self.end_headers(); self.audit(200)
            start, total = time.monotonic(), 0
            while time.monotonic() - start < 120:
                chunk = response.read1(4096)
                if not chunk: break
                total += len(chunk)
                if total > 32 * JSON_LIMIT: break
                self.wfile.write(chunk); self.wfile.flush()
            return
        data = response.read(8 * JSON_LIMIT + 1)
        if len(data) > 8 * JSON_LIMIT: raise Failure(502, 'provider response too large')
        try: value = json.loads(data)
        except ValueError: raise Failure(502, 'invalid provider response')
        return self.send(200, self.server.account.sanitized(value), headers)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('set-password'); p.add_argument('--stdin', action='store_true')
    commands.add_parser('serve')
    args = parser.parse_args()
    account = Account()
    if args.command == 'set-password':
        password = sys.stdin.read(1024) if args.stdin else getpass.getpass('Password: ')
        if not args.stdin: check(password == getpass.getpass('Repeat password: '), 'passwords differ')
        account.set_password(password)
        print('Password updated; all sessions invalidated.')
    else: Server(('127.0.0.1', 8792), account).serve_forever()


if __name__ == '__main__':
    try: main()
    except Failure as exc:
        print(exc.message, file=sys.stderr); sys.exit(1)
