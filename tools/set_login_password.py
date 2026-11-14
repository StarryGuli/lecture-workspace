#!/usr/bin/env python3
"""Set the one website password through existing operator SSH; never log secrets."""
import getpass
import argparse
import html
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import secrets
import subprocess
import sys
from urllib.parse import parse_qs
from urllib.request import urlopen

HOST = 'root@203.0.113.10'
SITE = 'https://lecture.example.com/'


def remote_configured():
    with urlopen(SITE + 'account/status', timeout=8) as response:
        status = json.load(response)
        if type(status.get('configured')) is not bool:
            raise ValueError('服务器状态不可用。')
        return status['configured']


def set_remote(password):
    if not 6 <= len(password) <= 128 or any(c in password for c in '\r\n\0'):
        raise ValueError('密码需要 6–128 个字符，不能含换行。')
    result = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', HOST,
         'runuser -u lecture-account -- /usr/bin/python3 /opt/lecture-account/cloud_server.py set-password --stdin'],
        input=password.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('设置未完成，请检查部署状态和 SSH 连接；未显示服务器输出以保护密码。')
    if not remote_configured():
        raise RuntimeError('服务器尚未确认保存成功，请稍后重试；未修改已有密码。')


def create_setup_server(port=8772, setter=set_remote, configured=remote_configured):
    nonce = secrets.token_urlsafe(32)
    class Setup(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def respond(self, message='', done=False):
            page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>设置记录工作台登录密码</title><style>body{font:16px system-ui;background:#f7f8fa;color:#24252a;margin:0;padding:28px}main{max-width:420px;margin:8vh auto;background:white;border:1px solid #e3e4eb;border-radius:20px;padding:28px}h1{font-size:25px}p{line-height:1.7;color:#676a77}label{display:block;margin:20px 0}input{display:block;box-sizing:border-box;width:100%;font-size:18px;padding:12px;margin-top:8px;border:1px solid #d9dbe4;border-radius:10px}button,a{display:block;background:#292a31;color:white;padding:14px;border:0;border-radius:10px;text-align:center;text-decoration:none;font-size:16px;width:100%;box-sizing:border-box}small{color:#676a77}</style><main><h1>设置登录密码</h1><p>只设置这一次。以后手机、iPad、电脑输入同一个密码即可使用，不再填写模型 Key。</p>'''
            if done:
                page = page.replace('<h1>设置登录密码</h1>', '<h1>密码已设置</h1>')
            page += '<p role="status">' + html.escape(message) + '</p>'
            if done:
                page += '<a href="https://lecture.example.com/">打开记录工作台</a>'
            else:
                page += '<form method="post" action="/password"><input type="hidden" name="nonce" value="' + nonce + '"><label>登录密码（可用6 位数字）<input type="password" name="password" minlength="6" maxlength="128" autocomplete="new-password" required></label><label>再输入一次<input type="password" name="confirm" minlength="6" maxlength="128" autocomplete="new-password" required></label><button>设置密码</button></form><p><small>这是此 Mac 上的一次性设置页。密码通过现有 SSH 连接写入服务器哈希，不会出现在聊天或日志中。</small></p>'
            body = (page + '</main></html>').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path not in ('/', '/password') or not self.valid_host():
                self.send_error(404)
                return
            try:
                self.server.completed = self.server.completed or configured()
                message = self.server.message
                self.server.message = ''
                self.respond('已经保存到服务器，无需再次设置。手机和电脑请打开正式网站，使用原密码登录。' if self.server.completed else message, self.server.completed)
            except (OSError, ValueError):
                self.respond('暂时无法确认服务器状态。请稍后刷新，不要重复设置。', True)

        def valid_host(self):
            return self.headers.get('Host') in ('127.0.0.1:' + str(self.server.server_port), 'localhost:' + str(self.server.server_port))

        def do_POST(self):
            try:
                if self.path != '/password' or not self.valid_host():
                    raise ValueError('请从本机设置页提交。')
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 4096:
                    raise ValueError('无效提交。')
                values = parse_qs(self.rfile.read(size).decode(), strict_parsing=True)
                if not secrets.compare_digest(values.get('nonce', [''])[0], nonce):
                    raise ValueError('设置页已过期，请重新打开。')
                # Native in-app browser form navigation can omit Origin. The
                # unpredictable synchronizer token + exact Host prevent CSRF
                # without rejecting valid submissions from that browser.
                if self.server.completed or configured():
                    self.server.completed = True
                    self.respond('密码已经保存，无需重新设置。请直接用原密码登录正式网站。', True)
                    return
                password = values.get('password', [''])[0]
                if password != values.get('confirm', [''])[0]:
                    raise ValueError('两次密码不一致。')
                setter(password)
                if not configured():
                    raise RuntimeError('服务器未确认密码保存成功，请稍后重试。')
                self.server.completed = True
                self.send_response(303)
                self.send_header('Location', SITE)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Referrer-Policy', 'no-referrer')
                self.send_header('Content-Length', '0')
                self.end_headers()
            except (ValueError, RuntimeError, OSError) as error:
                # PRG also on failure: refreshing must never replay a password
                # POST or reuse a nonce from an earlier helper process.
                self.server.message = str(error)
                self.send_response(303)
                self.send_header('Location', '/')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', '0')
                self.end_headers()
    server = ThreadingHTTPServer(('127.0.0.1', port), Setup)
    server.completed = False
    server.message = ''
    return server


def web_setup():
    server = create_setup_server()
    print('一次性密码设置页：http://127.0.0.1:8772/ （请本人输入密码）', flush=True)
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web', action='store_true')
    args = parser.parse_args()
    if args.web:
        return web_setup()
    password = getpass.getpass('设置网站登录密码（可用 6 位数字）：')
    if password != getpass.getpass('再次输入：'):
        raise ValueError('两次密码不同，未作修改。')
    set_remote(password)
    print('网站登录密码已设置，旧登录已失效。')
    print('手机打开 https://lecture.example.com/ ，输入刚设置的密码即可。')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
