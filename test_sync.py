import argparse, hashlib, io, json, os, pathlib, sqlite3, tempfile, threading, unittest, urllib.error, urllib.request
from contextlib import redirect_stdout, redirect_stderr
from http.server import ThreadingHTTPServer

import sync_client as C
import sync_server as S

SCHEMA = '''
CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,mode TEXT,created TEXT,status TEXT DEFAULT 'recording');
CREATE TABLE chunks(session TEXT,seq INTEGER,start REAL,duration REAL,path TEXT,PRIMARY KEY(session,seq));
CREATE TABLE revisions(id TEXT PRIMARY KEY,session TEXT,kind TEXT,created TEXT,content TEXT,config TEXT,parent TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY,session TEXT,name TEXT,pages TEXT,offset INTEGER DEFAULT 0);
CREATE TABLE usage(id TEXT PRIMARY KEY,session TEXT,created TEXT,role TEXT,provider TEXT,model TEXT,seconds REAL,usage TEXT,price TEXT,cost REAL,status TEXT);
CREATE TABLE marks(id TEXT PRIMARY KEY,session TEXT,seconds REAL,label TEXT);
'''
SECRET_KEY = 'sk-test-SECRET-KEY-1234567890'
SECRET_TEXT = 'DISTINCTIVE-LECTURE-TRANSCRIPT-TEXT'
WAV_MAGIC = b'RIFF\x24\x00\x00\x00WAVEfmt DISTINCTIVE-AUDIO-BYTES'
TOKEN = 'test-token-abc'


def make_data(root, populated=True):
    root.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(root / 'records.sqlite'); c.executescript(SCHEMA)
    if populated:
        c.execute("INSERT INTO sessions VALUES('s1','课堂一','live','2026-11-01T10:00:00+08:00','saved')")
        c.execute("INSERT INTO sessions VALUES('s2','录音中','live','2026-11-01T11:00:00+08:00','recording')")
        c.execute("INSERT INTO chunks VALUES('s1',0,0,12,'s1/chunk-0.wav')")
        c.execute("INSERT INTO revisions VALUES('r1','s1','live-transcript','2026-11-01T10:30:00+08:00',?,'{\"a\":1}',NULL)", (SECRET_TEXT,))
        c.execute("INSERT INTO revisions VALUES('r2','s2','live','2026-11-01T11:30:00+08:00','half','{}',NULL)")
        c.execute("INSERT INTO documents VALUES('d1','s1','教材.pdf','[\"教材正文第一页\"]',3)")
        c.execute("INSERT INTO marks VALUES('m1','s1',5.5,'重点')")
        c.execute("INSERT INTO usage VALUES('u1','s1','2026-11-01T10:31:00+08:00','asr','siliconflow','m',12.0,'{}','{}',0.01,'ok')")
        (root / 's1').mkdir(); (root / 's1' / 'chunk-0.wav').write_bytes(WAV_MAGIC)
        (root / 's1' / 'original.wav').write_bytes(WAV_MAGIC)
        (root / 's1' / 'partial-transcript.json').write_text('[{"text":"PARTIAL-ONLY"}]')
        (root / 'keys').mkdir(); (root / 'keys' / 'siliconflow').write_text(SECRET_KEY)
        (root / 'settings.json').write_text('{"asr":{"providerId":"siliconflow","model":"x"}}')
        (root / 'web-providers.json').write_text('[{"id":"p"}]')
    c.commit(); c.close()
    return root


class SyncCase(unittest.TestCase):
    def setUp(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp())
        S.STORE = self.tmp / 'store'; S.STORE.mkdir()
        (S.STORE / 'token.sha256').write_text(hashlib.sha256(TOKEN.encode()).hexdigest())
        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), S.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.url = 'http://127.0.0.1:%d' % self.srv.server_address[1]
        self.dev = {}
        self.use_device('A')
        self.a = make_data(self.tmp / 'dataA')
        self.b = make_data(self.tmp / 'dataB', populated=False)

    def tearDown(self):
        self.srv.shutdown(); self.srv.server_close()

    def use_device(self, name, passphrase='pw-one'):
        home = self.tmp / ('home' + name); home.mkdir(exist_ok=True)
        (home / 'config.json').write_text(json.dumps({'url': self.url, 'token': TOKEN}))
        (home / 'passphrase').write_text(passphrase)
        C.HOME = home; C._mackey.clear()

    def run_cmd(self, fn, data, **kw):
        ns = argparse.Namespace(data=str(data), dry_run=kw.get('dry_run', False), prefer=kw.get('prefer'))
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(out): rc = fn(ns)
        return rc, out.getvalue()

    def store_bytes(self):
        return b''.join(p.read_bytes() for p in S.STORE.rglob('*') if p.is_file())

    def http(self, method, path, body=None, token=TOKEN, if_match=None):
        h = {}
        if token: h['Authorization'] = 'Bearer ' + token
        if if_match is not None: h['If-Match'] = str(if_match)
        req = urllib.request.Request(self.url + path, data=body, method=method, headers=h)
        try:
            with urllib.request.urlopen(req) as r: return r.status, r.read()
        except urllib.error.HTTPError as e: return e.code, e.read()

    # ── 功能 ──
    def test_roundtrip_to_new_device(self):
        rc, out = self.run_cmd(C.cmd_push, self.a); self.assertEqual(rc, 0, out)
        self.use_device('B')  # 第二台设备：拷贝过去同一份口令
        rc, out = self.run_cmd(C.cmd_pull, self.b); self.assertEqual(rc, 0, out)
        c = sqlite3.connect(self.b / 'records.sqlite')
        self.assertEqual(c.execute("SELECT title FROM sessions").fetchall(), [('课堂一',)])
        self.assertEqual(c.execute("SELECT content FROM revisions").fetchall(), [(SECRET_TEXT,)])
        self.assertEqual(c.execute("SELECT name,offset,pages FROM documents").fetchall(), [('教材.pdf', 3, '[]')])
        self.assertEqual(c.execute("SELECT label FROM marks").fetchall(), [('重点',)])
        self.assertEqual(c.execute("SELECT cost FROM usage").fetchall(), [(0.01,)])
        self.assertEqual((self.b / 'keys' / 'siliconflow').read_text(), SECRET_KEY)
        self.assertEqual((self.b / 'settings.json').read_text(), (self.a / 'settings.json').read_text())
        for f in (self.b / 'keys' / 'siliconflow', self.b / 'settings.json', self.b / 'web-providers.json'):
            self.assertEqual(f.stat().st_mode & 0o777, 0o600, f)

    def test_second_push_is_noop_and_status_is_clean(self):
        self.run_cmd(C.cmd_push, self.a)
        rc, out = self.run_cmd(C.cmd_push, self.a); self.assertIn('0 项已上传', out)
        rc, out = self.run_cmd(C.cmd_pull, self.a); self.assertIn('0 项已更新', out)

    # ── 录音留在本机 ──
    def test_audio_never_leaves_the_machine(self):
        self.run_cmd(C.cmd_push, self.a)
        names = [p.name for p in S.STORE.rglob('*')]
        self.assertFalse([n for n in names if n.lower().endswith(S.AUDIO_EXT)], names)
        self.assertNotIn(b'DISTINCTIVE-AUDIO-BYTES', self.store_bytes())
        records = C.collect_records(self.a)
        self.assertEqual(sorted(records), ['records/s1'])  # 录音中的 s2 不上传
        payload = json.loads(records['records/s1'])
        self.assertNotIn('chunks', payload)
        self.assertNotIn('.wav', json.dumps(payload, ensure_ascii=False))
        self.assertNotIn('教材正文第一页', json.dumps(payload, ensure_ascii=False))  # 资料正文不导出
        self.assertNotIn('PARTIAL-ONLY', json.dumps(payload, ensure_ascii=False))

    def test_server_only_sees_ciphertext(self):
        self.run_cmd(C.cmd_push, self.a)
        blob = self.store_bytes()
        for secret in ((SECRET_KEY.encode(), SECRET_TEXT.encode(), '课堂一'.encode(), b'siliconflow')):
            self.assertNotIn(secret, blob)

    def test_wrong_passphrase_cannot_decrypt(self):
        self.run_cmd(C.cmd_push, self.a)
        self.use_device('B', passphrase='another-pass')
        rc, out = self.run_cmd(C.cmd_pull, self.b)
        self.assertEqual(rc, 1); self.assertIn('校验失败', out)
        self.assertFalse((self.b / 'keys' / 'siliconflow').exists())

    # ── 冲突 ──
    def test_config_conflict_requires_explicit_choice(self):
        self.run_cmd(C.cmd_push, self.a)
        self.use_device('B'); self.run_cmd(C.cmd_pull, self.b)
        (self.b / 'settings.json').write_text('{"asr":{"model":"from-B"}}')
        self.run_cmd(C.cmd_push, self.b)
        self.use_device('A')
        (self.a / 'settings.json').write_text('{"asr":{"model":"from-A"}}')
        rc, out = self.run_cmd(C.cmd_push, self.a)
        self.assertEqual(rc, 1); self.assertIn('config/settings.json', out)
        rc, out = self.run_cmd(C.cmd_pull, self.a)
        self.assertEqual(rc, 1)
        self.assertEqual((self.a / 'settings.json').read_text(), '{"asr":{"model":"from-A"}}')  # 没被悄悄覆盖
        rc, out = self.run_cmd(C.cmd_pull, self.a, prefer='remote'); self.assertEqual(rc, 0, out)
        self.assertEqual((self.a / 'settings.json').read_text(), '{"asr":{"model":"from-B"}}')
        self.assertTrue(list((self.a / '.sync-backup').rglob('settings.json')))  # 旧文件有备份

    def test_records_merge_instead_of_conflict(self):
        self.run_cmd(C.cmd_push, self.a)
        self.use_device('B'); self.run_cmd(C.cmd_pull, self.b)
        cb = sqlite3.connect(self.b / 'records.sqlite')
        cb.execute("INSERT INTO revisions VALUES('rB','s1','edited','2026-11-02T00:00:00+08:00','B 改的','{}',NULL)"); cb.commit(); cb.close()
        self.run_cmd(C.cmd_push, self.b)
        self.use_device('A')
        ca = sqlite3.connect(self.a / 'records.sqlite')
        ca.execute("INSERT INTO revisions VALUES('rA','s1','edited','2026-11-02T01:00:00+08:00','A 改的','{}',NULL)"); ca.commit(); ca.close()
        rc, out = self.run_cmd(C.cmd_push, self.a); self.assertEqual(rc, 0, out)
        rc, out = self.run_cmd(C.cmd_pull, self.a); self.assertEqual(rc, 0, out)
        ids = sorted(r[0] for r in sqlite3.connect(self.a / 'records.sqlite').execute("SELECT id FROM revisions WHERE session='s1'"))
        self.assertEqual(ids, ['r1', 'rA', 'rB'])

    # ── 服务端 ──
    def test_auth_and_validation(self):
        self.assertEqual(self.http('GET', '/healthz', token=None)[0], 200)
        self.assertEqual(self.http('GET', '/v1/index', token=None)[0], 401)
        self.assertEqual(self.http('GET', '/v1/index', token='wrong')[0], 401)
        self.assertEqual(self.http('PUT', '/v1/blob/keys/x', b'1', token='wrong', if_match=0)[0], 401)
        self.assertEqual(self.http('PUT', '/v1/blob/keys/x', b'1')[0], 428)
        self.assertEqual(self.http('PUT', '/v1/blob/keys/x', b'1', if_match=5)[0], 409)
        self.assertEqual(self.http('PUT', '/v1/blob/keys/x', b'1', if_match=0)[0], 200)
        self.assertEqual(self.http('PUT', '/v1/blob/keys/x', b'2', if_match=0)[0], 409)  # 版本已是 1
        self.assertEqual(self.http('PUT', '/v1/blob/keys/x', b'2', if_match=1)[0], 200)
        self.assertEqual(self.http('GET', '/v1/blob/keys/x')[1], b'2')
        self.assertTrue((S.STORE / 'keys' / 'x.prev').is_file())
        for bad in ('/v1/blob/keys/a.wav', '/v1/blob/keys/a.WAV', '/v1/blob/other/x', '/v1/blob/keys/../x', '/v1/blob/keys/x.meta', '/v1/blob/keys/.hidden', '/v1/blob/keys/x.tmp'):
            self.assertEqual(self.http('PUT', bad, b'1', if_match=0)[0], 404, bad)
        self.assertEqual(self.http('DELETE', '/v1/blob/keys/x')[0], 405)

    def test_size_limit(self):
        S.MAX_BODY = 100
        try: self.assertEqual(self.http('PUT', '/v1/blob/keys/big', b'x' * 101, if_match=0)[0], 413)
        finally: S.MAX_BODY = 8 * 1024 * 1024

    def test_no_token_file_means_locked(self):
        (S.STORE / 'token.sha256').unlink()
        self.assertEqual(self.http('GET', '/v1/index')[0], 401)


if __name__ == '__main__':
    unittest.main()
