"""Offline account gateway tests. No external provider calls."""
import copy
import http.client
import io
import json
import pathlib
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import types
from unittest.mock import patch
import cloud_server as c


class Response(io.BytesIO):
    def __init__(self, data=b'{"ok":true}', status=200, ctype='application/json'):
        super().__init__(data); self.status = status; self.ctype = ctype
    def getheader(self, name, default=None):
        return self.ctype if name.lower() == 'content-type' else default


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []
        self.response = lambda: Response()
        def transport(*args):
            self.calls.append(args); return self.response()
        self.dns = patch.object(c.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('8.8.8.8', 443))]); self.dns.start()
        self.a = c.Account(self.tmp.name, origin='https://test.example', transport=transport)
        self.a.set_password('123456')
        self.s = types.SimpleNamespace(account=self.a)
        self.cookie = ''; self.csrf = ''

    def tearDown(self):
        self.dns.stop(); self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None):
        h = {'Origin': self.a.origin, 'Cookie': self.cookie, 'X-CSRF-Token': self.csrf}
        if isinstance(body, dict): body = json.dumps(body).encode(); h['Content-Type'] = 'application/json'
        h.update(headers or {})
        body = body or b''
        if isinstance(body, str): body = body.encode()
        h.setdefault('Content-Length', str(len(body)))
        raw = (method + ' ' + path + ' HTTP/1.1\r\nHost: localhost\r\n' + ''.join(k + ': ' + v + '\r\n' for k, v in h.items()) + '\r\n').encode() + body
        class Connection:
            def __init__(self): self.output = io.BytesIO()
            def makefile(self, mode, *args): return io.BytesIO(raw)
            def sendall(self, data): self.output.write(data)
            def settimeout(self, timeout): pass
        connection = Connection()
        c.Handler(connection, ('127.0.0.1', 1234), self.s)
        class Incoming:
            def makefile(self, *args): return io.BytesIO(connection.output.getvalue())
        r = http.client.HTTPResponse(Incoming()); r.begin()
        return r.status, json.loads(r.read()), dict(r.getheaders())

    def login(self, remember=True):
        status, b, h = self.request('POST', '/account/login', {'password': '123456', 'remember': remember})
        self.assertEqual(status, 200)
        self.cookie = h['Set-Cookie'].split(';')[0]; self.csrf = b['csrfToken']
        return h

    def provider(self):
        self.login()
        body = {'provider': {'id': 'test', 'name': 'Test', 'baseURL': 'https://api.example/v1', 'headers': {'X-Private': 'private-value'}}, 'key': 'provider-secret'}
        self.assertEqual(self.request('POST', '/account/providers', body)[0], 200)

    def test_status_cookie_csrf_origin(self):
        self.assertEqual(self.request('GET', '/account/status')[1], {'enabled': True, 'configured': True, 'authenticated': False})
        h = self.login()
        for item in ('Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=2592000'): self.assertIn(item, h['Set-Cookie'])
        self.assertEqual(self.request('GET', '/account/status')[1]['csrfToken'], self.csrf)
        self.assertEqual(self.request('PUT', '/account/settings', {}, {'X-CSRF-Token': ''})[0], 403)
        self.assertEqual(self.request('PUT', '/account/settings', {}, {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.request('PUT', '/account/settings', {'text': {'model': 'm', 'providerId': 'test'}})[0], 200)
        self.assertEqual(self.request('GET', '/account/settings')[1]['text']['model'], 'm')

    def test_wrong_password_rate_and_global_bound(self):
        for _ in range(5): self.assertEqual(self.request('POST', '/account/login', {'password': 'wrongwrong'})[0], 401)
        self.assertEqual(self.request('POST', '/account/login', {'password': '123456'})[0], 429)
        self.assertEqual(self.request('POST', '/account/login', {'password': 'wrongwrong'}, {'X-Real-IP': '8.8.4.4'})[0], 401)
        self.a.global_attempts.extend([time.time()] * 100)
        self.assertEqual(self.request('POST', '/account/login', {'password': '123456'}, {'X-Real-IP': '1.1.1.1'})[0], 429)

    def test_sessions_persist_expire_logout_reset(self):
        self.login(False)
        self.assertTrue(c.Account(self.tmp.name).session(self.cookie))
        with self.a.db() as db:
            stored = db.execute('SELECT hash,expiry FROM sessions').fetchone()
            self.assertNotIn(stored[0], self.cookie)
            self.assertAlmostEqual(stored[1] - time.time(), 86400, delta=5)
            db.execute('UPDATE sessions SET expiry=0')
        self.assertEqual(self.request('GET', '/account/bootstrap')[0], 401)
        self.login(); self.assertEqual(self.request('POST', '/account/logout', {})[0], 200)
        self.assertFalse(self.a.session(self.cookie))
        self.login(); self.a.set_password('87654321'); self.assertFalse(self.a.session(self.cookie))
        for p in ('short', '123456\n', 'x'*129):
            with self.assertRaises(c.Failure): self.a.set_password(p)
        for name in ('credentials.json', 'auth.json', 'sessions.sqlite'):
            self.assertEqual((pathlib.Path(self.tmp.name)/name).stat().st_mode & 0o777, 0o600)

    def test_bootstrap_preserves_keys_headers(self):
        self.provider()
        out = self.request('GET', '/account/bootstrap')[1]
        self.assertTrue(out['providers'][0]['hasKey']); self.assertTrue(out['serverManaged'])
        for secret in ('provider-secret', 'private-value', 'headers', 'Authorization'): self.assertNotIn(secret, json.dumps(out))
        self.assertEqual(self.request('POST', '/account/providers', {'provider': {'id': 'test', 'name': 'New'}})[0], 200)
        creds = self.a.credentials()
        self.assertEqual(creds['keys']['test'], 'provider-secret')
        self.assertEqual(creds['providers'][0]['headers'], {'X-Private': 'private-value'})
        self.request('POST', '/account/providers', {'provider': {'id': 'test'}, 'key': 'new-secret'})
        self.assertEqual(self.a.credentials()['keys']['test'], 'new-secret')

    def test_proxy_restrictions_and_auth(self):
        self.provider()
        self.assertEqual(self.request('POST', '/account/model/test/chat', {'model': 'm', 'messages': []})[0], 200)
        method, url, headers, _ = self.calls[-1]
        self.assertEqual(url, 'https://api.example/v1/chat/completions')
        self.assertEqual(headers['Authorization'], 'Bearer provider-secret'); self.assertNotIn('Cookie', headers)
        for body in ({'url': 'https://evil.example'}, {'headers': {}}, {'baseURL': 'https://evil.example'}):
            self.assertEqual(self.request('POST', '/account/model/test/chat', body)[0], 400)
        self.assertEqual(self.request('GET', '/account/model/test/arbitrary')[0], 404)
        for url in ('http://api.example', 'https://user:pw@api.example', 'https://api.example?x=1', 'https://api.example/#x'):
            self.assertEqual(self.request('POST', '/account/providers', {'provider': {'id': 'bad', 'baseURL': url}})[0], 400)
        with patch.object(c.socket, 'getaddrinfo', return_value=[(2,1,6,'',('127.0.0.1',443))]):
            self.assertEqual(self.request('POST', '/account/providers', {'provider': {'id': 'bad', 'baseURL': 'https://local.example'}})[0], 400)
            self.assertEqual(self.request('GET', '/account/model/test/models')[0], 400)
        for path in ('//evil.example/path', '/../secret', '/chat?x=1'):
            self.assertEqual(self.request('POST', '/account/providers', {'provider': {'id': 'test', 'chatPath': path}})[0], 400)
        self.response = lambda: Response(b'provider-secret private-value', status=302)
        status, out, _ = self.request('GET', '/account/model/test/models')
        self.assertEqual(status, 502); self.assertNotIn('provider-secret', json.dumps(out))

    def test_billing_and_rate_limit_preserve_status_without_provider_body(self):
        self.provider()
        for code in (402, 429):
            self.response = lambda code=code: Response(b'provider-secret private-value', status=code)
            status, out, _ = self.request('GET', '/account/model/test/models')
            self.assertEqual(status, code)
            self.assertNotIn('provider-secret', json.dumps(out))
            self.assertNotIn('private-value', json.dumps(out))

    def test_native_token_fields_and_wrapped_settings_survive_redaction(self):
        self.provider()
        config = {'maxTokens': 1800, 'text': {'model': 'm', 'providerId': 'test', 'maxTokens': 1200},
                  'live': {'keywordTriggers': ['why'], 'answerTimeoutSeconds': 12}}
        status, out, _ = self.request('PUT', '/account/settings', {'config': config})
        self.assertEqual(status, 200)
        self.assertEqual(out, config)
        self.assertEqual(self.request('GET', '/account/bootstrap')[1]['config'], config)
        self.response = lambda: Response(b'{"choices":[],"usage":{"prompt_tokens":1000,"completion_tokens":120,"prompt_tokens_details":{"cached_tokens":500}}}')
        usage = self.request('POST', '/account/model/test/chat', {'model': 'm', 'messages': []})[1]['usage']
        self.assertEqual(usage['prompt_tokens'], 1000)
        self.assertEqual(usage['completion_tokens'], 120)
        self.assertEqual(usage['prompt_tokens_details']['cached_tokens'], 500)
        self.assertEqual(self.request('PUT', '/account/settings', {'apiKey': 'nope'})[0], 400)

    def test_server_search_key_never_returns_and_enables_search(self):
        self.login()
        status, result, _ = self.request('POST', '/account/providers', {'provider': {'id': 'brave', 'name': 'Brave Search'}, 'key': 'search-private'})
        self.assertEqual(status, 200)
        self.assertTrue(result['hasKey'])
        boot = self.request('GET', '/account/bootstrap')[1]
        self.assertTrue(boot['searchReady'])
        self.assertNotIn('search-private', json.dumps(boot))

    def test_audio_memory_limits(self):
        self.provider(); before = {p.name for p in pathlib.Path(self.tmp.name).iterdir()}
        audio = b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n\r\nAUDIO\r\n--b--\r\n'
        status, _, _ = self.request('POST', '/account/model/test/transcribe', audio, {'Content-Type': 'multipart/form-data; boundary=b'})
        self.assertEqual(status, 200); self.assertEqual(self.calls[-1][3], audio)
        self.assertEqual(before, {p.name for p in pathlib.Path(self.tmp.name).iterdir()})
        self.assertEqual(self.request('POST', '/account/model/test/chat', b'x'*(c.JSON_LIMIT+1), {'Content-Type': 'application/json'})[0], 413)

    def test_sse_prompt_and_concurrent_status(self):
        self.provider(); release = threading.Event(); entered = threading.Event()
        class Streaming(Response):
            def __init__(self): super().__init__(ctype='text/event-stream'); self.n = 0
            def read1(self, size):
                self.n += 1
                if self.n == 1: return b'data: {"delta":"first"}\n\n'
                entered.set(); release.wait(3); return b''
        self.response = Streaming
        # A response writer captures each flush while the upstream stalls.
        output = io.BytesIO(); flushed = threading.Event()
        class Writer:
            closed = False
            def write(self, data):
                output.write(data)
                if b'first' in data: flushed.set()
            def flush(self): pass
        raw = ('POST /account/model/test/chat HTTP/1.1\r\nHost: localhost\r\nOrigin: ' + self.a.origin + '\r\nCookie: ' + self.cookie + '\r\nX-CSRF-Token: ' + self.csrf + '\r\nContent-Type: application/json\r\nContent-Length: 16\r\n\r\n{"stream": true}').encode()
        class Connection:
            def makefile(self, *args): return io.BytesIO(raw)
            def settimeout(self, timeout): pass
        class Handler(c.Handler):
            def setup(handler):
                handler.connection = handler.request
                handler.rfile = io.BytesIO(raw); handler.wfile = Writer(); handler.started_response = False
        thread = threading.Thread(target=lambda: Handler(Connection(), ('127.0.0.1', 1234), self.s))
        thread.start()
        try:
            self.assertTrue(flushed.wait(2)); self.assertTrue(entered.wait(1))
            self.assertIn(b'data: {"delta":"first"}', output.getvalue())
            self.assertEqual(self.request('GET', '/account/status')[0], 200)
        finally: release.set(); thread.join(4)
        for _ in range(8): self.a.proxy_slots.acquire()
        try: self.assertEqual(self.request('GET', '/account/model/test/models')[0], 503)
        finally:
            for _ in range(8): self.a.proxy_slots.release()

    def payload(self):
        return {'schema': 1, 'session': dict(id='s1', title='Title', mode='lecture', created='now', status='done'), **{t: [] for t in c.sync.TABLES}}

    def test_records_validation_missing_and_cipher_merge(self):
        self.login()
        self.assertEqual(self.request('GET', '/account/records')[1], {'records': [], 'available': False})
        self.assertEqual(self.request('POST', '/account/records', {'records': []})[0], 503)
        creds = self.a.credentials(); creds['sync'] = {'token': 'sync-secret', 'passphrase': 'sync-passphrase'}
        c.private_write(self.a.store/'credentials.json', creds)
        p = self.payload()
        for change in ('chunks', 'audio', 'body'):
            bad = copy.deepcopy(p); bad[change] = []
            self.assertEqual(self.request('POST', '/account/records', {'records': [bad]})[0], 400)
        bad = copy.deepcopy(p); bad['documents'] = [{'id': 1, 'session': 's1', 'name': 'n', 'offset': 0, 'pages': 'secret'}]
        self.assertEqual(self.request('POST', '/account/records', {'records': [bad]})[0], 400)
        old = copy.deepcopy(p); old['session']['title'] = 'Original'
        old['marks'] = [{'id': 1, 'session': 's1', 'seconds': 1, 'label': 'old'}]
        p['marks'] = [{'id': 1, 'session': 's1', 'seconds': 2, 'label': 'overwrite'}, {'id': 2, 'session': 's1', 'seconds': 3, 'label': 'new'}]
        blob = c.cipher(c.canonical(old), 'sync-passphrase'); writes = []
        def sync_call(method, path, settings, body=None, version=None):
            if path == '/v1/index': return 200, b'{"records/s1":{"version":1},"keys/key":{}}', None
            if method == 'GET': return 200, blob, '1'
            writes.append((body, version)); return (409 if len(writes) < 3 else 200), b'{}', None
        with patch.object(self.a, 'sync_call', side_effect=sync_call):
            self.assertEqual(self.request('POST', '/account/records', {'records': [p]})[0], 200)
            self.assertEqual(len(writes), 3)
            merged = json.loads(c.cipher(writes[-1][0], 'sync-passphrase', True))
            self.assertEqual(merged['session']['title'], 'Original'); self.assertEqual(merged['marks'][0]['label'], 'old'); self.assertEqual(len(merged['marks']), 2)
            self.assertEqual(self.request('GET', '/account/records')[1]['records'], [old])
        with patch.object(self.a, 'sync_call', side_effect=lambda m, p, s, body=None, version=None: (200, b'{}', None) if m == 'GET' else (409, b'{}', None)) as fake:
            self.assertEqual(self.request('POST', '/account/records', {'records': [p]})[0], 409)
            self.assertEqual(sum(call.args[0] == 'PUT' for call in fake.call_args_list), 4)

    def test_cli_stdin_no_newline(self):
        import os
        env = dict(os.environ, LECTURE_ACCOUNT_STORE=self.tmp.name)
        for password, expected in ((b'123456\n', 1), (b'123456', 0)):
            r = subprocess.run([sys.executable, str(pathlib.Path(c.__file__)), 'set-password', '--stdin'], input=password, env=env, capture_output=True)
            self.assertEqual(r.returncode, expected); self.assertNotIn(password, r.stdout)


class PrivateASRTests(unittest.TestCase):
    """Windows GPU ASR over Tailscale: routing, fallback and isolation. No network."""
    request = CloudTests.request
    login = CloudTests.login
    AUDIO = b'--b\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\n\r\n' + b'\0' * 64000 + b'\r\n--b--\r\n'
    MULTIPART = {'Content-Type': 'multipart/form-data; boundary=b'}

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls, self.private_calls = [], []
        self.health = {'loaded': True, 'busy': False}
        self.private_status = 200
        def transport(*args):
            self.calls.append(args); return Response(b'{"text":"fallback text"}')
        def private_fetch(method, path, headers, body, timeout):
            self.private_calls.append((method, path, headers, body, timeout))
            if self.health is None: raise OSError('unreachable')
            if path == '/health': return Response(json.dumps(self.health).encode())
            if path == '/warmup': return Response(b'{"warming":true}')
            return Response(b'{"text":"windows text"}', status=self.private_status)
        self.dns = patch.object(c.socket, 'getaddrinfo', return_value=[(2, 1, 6, '', ('8.8.8.8', 443))]); self.dns.start()
        settings = c.private_asr_settings({'LECTURE_PRIVATE_ASR_URL': 'http://100.100.100.100:11500', 'LECTURE_PRIVATE_ASR_FALLBACK': 'siliconflow'})
        self.a = c.Account(self.tmp.name, origin='https://test.example', transport=transport, private_asr=settings, private_fetch=private_fetch)
        self.a.set_password('123456')
        self.s = types.SimpleNamespace(account=self.a)
        self.cookie = ''; self.csrf = ''
        self.login()
        body = {'provider': {'id': 'siliconflow', 'name': 'SiliconFlow', 'baseURL': 'https://api.siliconflow.cn/v1'}, 'key': 'sf-secret'}
        self.assertEqual(self.request('POST', '/account/providers', body)[0], 200)

    def tearDown(self):
        self.dns.stop(); self.tmp.cleanup()

    def transcribe(self):
        self.a.private_state['at'] = 0.0  # each case starts with a fresh health check
        return self.request('POST', '/account/model/windows-asr/transcribe', self.AUDIO, self.MULTIPART)

    def test_settings_only_accept_private_http_addresses(self):
        ok = c.private_asr_settings({'LECTURE_PRIVATE_ASR_URL': 'http://192.168.5.10:11500'})
        self.assertEqual((ok['host'], ok['port']), ('192.168.5.10', 11500))
        self.assertIsNone(c.private_asr_settings({}))
        for bad in ('https://100.100.100.100:11500', 'http://8.8.8.8:11500', 'http://127.0.0.1:11500',
                    'http://100.100.100.100', 'http://100.100.100.100:11500/v1', 'http://win.example:11500'):
            with self.assertRaises(SystemExit, msg=bad): c.private_asr_settings({'LECTURE_PRIVATE_ASR_URL': bad})

    def test_bootstrap_lists_relay_without_address(self):
        out = self.request('GET', '/account/bootstrap')[1]
        relay = next(p for p in out['providers'] if p['id'] == 'windows-asr')
        self.assertTrue(relay['privateRelay'] and relay['ownHardware'] and relay['asrOnly'])
        self.assertEqual(relay['fallbackProvider'], {'id': 'siliconflow', 'name': 'SiliconFlow'})
        self.assertNotIn('100.100.100.100', json.dumps(out))
        # Clients cannot claim or overwrite the reserved id, nor use it for chat.
        self.assertEqual(self.request('POST', '/account/providers', {'provider': {'id': 'windows-asr', 'name': 'x', 'baseURL': 'https://api.example/v1'}})[0], 400)
        self.assertEqual(self.request('POST', '/account/model/windows-asr/chat', {'model': 'm'})[0], 400)
        self.assertEqual(self.request('GET', '/account/model/windows-asr/models')[1], {'data': [{'id': 'Qwen/Qwen3-ASR-1.7B'}]})

    def test_loaded_windows_serves_segment_for_free(self):
        status, body, headers = self.transcribe()
        self.assertEqual((status, body['text'], headers['X-Lecture-ASR-Backend']), (200, 'windows text', 'windows-asr'))
        sent = [x for x in self.private_calls if x[1] == '/v1/audio/transcriptions']
        self.assertEqual(sent[0][3], self.AUDIO); self.assertEqual(sent[0][2]['Content-Type'], self.MULTIPART['Content-Type'])
        self.assertEqual(self.calls, [])  # paid provider untouched
        self.assertEqual(self.a.private_state['inflight'], 0)

    def test_cold_model_warms_up_and_uses_fallback(self):
        self.health = {'loaded': False, 'busy': False}
        status, body, headers = self.transcribe()
        self.assertEqual((status, body['text'], headers['X-Lecture-ASR-Backend'], headers['X-Lecture-ASR-Fallback']), (200, 'fallback text', 'siliconflow', 'loading'))
        self.assertEqual(self.calls[-1][1], 'https://api.siliconflow.cn/v1/audio/transcriptions')
        self.assertEqual(self.calls[-1][3], self.AUDIO)
        self.assertEqual(self.calls[-1][2]['Authorization'], 'Bearer sf-secret')
        for _ in range(50):
            if any(x[1] == '/warmup' for x in self.private_calls): break
            time.sleep(.02)
        self.assertTrue(any(x[1] == '/warmup' for x in self.private_calls))
        warmups = sum(x[1] == '/warmup' for x in self.private_calls); self.transcribe(); time.sleep(.05)
        self.assertEqual(sum(x[1] == '/warmup' for x in self.private_calls), warmups)  # rate limited

    def test_offline_busy_and_backlog_fall_back(self):
        self.health = None
        self.assertEqual(self.transcribe()[2]['X-Lecture-ASR-Fallback'], 'offline')
        self.health = {'loaded': True, 'busy': True}; self.private_status = 503
        status, body, headers = self.transcribe()
        self.assertEqual((status, body['text'], headers['X-Lecture-ASR-Fallback']), (200, 'fallback text', 'busy'))
        self.private_status = 200; self.a.private_state['inflight'] = 2
        self.assertEqual(self.transcribe()[2]['X-Lecture-ASR-Fallback'], 'backlog')
        self.a.private_state['inflight'] = 0
        self.assertEqual(self.transcribe()[2]['X-Lecture-ASR-Backend'], 'windows-asr')

    def test_status_route_reports_and_warms(self):
        self.health = {'loaded': False, 'busy': False}
        self.a.private_state['at'] = 0.0
        out = self.request('POST', '/account/private-asr', {})[1]
        self.assertEqual((out['configured'], out['state'], out['reachable']), (True, 'loading', True))
        self.health = None; self.a.private_state['at'] = 0.0
        self.assertEqual(self.request('GET', '/account/private-asr')[1]['state'], 'offline')
        self.cookie = ''
        self.assertEqual(self.request('GET', '/account/private-asr')[0], 401)


if __name__ == '__main__': unittest.main()
