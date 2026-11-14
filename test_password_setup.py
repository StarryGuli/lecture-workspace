"""Exercise actual local setup form HTTP without touching real credentials."""
import http.client
import re
import threading
import unittest
from urllib.parse import urlencode

from tools.set_login_password import create_setup_server


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.saved = False
        self.writes = 0
        def setter(password):
            self.assertEqual(password, '000000')
            self.writes += 1
            self.saved = True
        self.server = create_setup_server(0, setter, lambda: self.saved)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, method='GET', path='/', body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=3)
        try:
            connection.request(method, path, body, headers or {})
            result = connection.getresponse()
            return result.status, result.read().decode(), dict(result.getheaders())
        finally:
            connection.close()

    def form(self):
        body = self.request()[1]
        return re.search(r'name="nonce" value="([^"]+)"', body)[1]

    def post(self, nonce, extra=None):
        return self.request('POST', '/password', urlencode({'nonce': nonce, 'password': '000000', 'confirm': '000000'}),
                            {'Content-Type': 'application/x-www-form-urlencoded', **(extra or {})})

    def test_missing_origin_submits_once_and_redirects_to_real_website(self):
        nonce = self.form()
        status, _, headers = self.post(nonce)
        self.assertEqual(status, 303)
        self.assertEqual(headers['Location'], 'https://lecture.example.com/')
        self.assertEqual(self.writes, 1)
        self.post(nonce)
        self.assertEqual(self.writes, 1)
        page = self.request(path='/password')[1]
        self.assertNotIn('<form', page)
        self.assertIn('<h1>密码已设置</h1>', page)

    def test_null_origin_works_with_correct_nonce(self):
        self.assertEqual(self.post(self.form(), {'Origin': 'null'})[0], 303)
        self.assertEqual(self.writes, 1)

    def test_wrong_nonce_and_foreign_host_cannot_set_password(self):
        status, _, headers = self.post('wrong')
        self.assertEqual(status, 303)
        self.assertEqual(headers['Location'], '/')
        self.assertEqual(self.writes, 0)
        self.post(self.form(), {'Host': 'attacker.example'})
        self.assertEqual(self.writes, 0)

    def test_already_configured_never_offers_or_overwrites_password(self):
        self.saved = True
        self.assertNotIn('<form', self.request()[1])
        self.assertEqual(self.writes, 0)


if __name__ == '__main__':
    unittest.main()
