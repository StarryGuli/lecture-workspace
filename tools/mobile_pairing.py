#!/usr/bin/env python3
"""Export an encrypted device connection. Never prints credentials or uploads anything."""
import getpass,hashlib,hmac,json,os,pathlib,secrets,subprocess,zlib,sys
ROOT=pathlib.Path(__file__).resolve().parent.parent

def seal(payload,password):
    plain=zlib.compress(json.dumps(payload,ensure_ascii=False).encode())
    rd,wr=os.pipe()
    try:
        os.write(wr,password.encode()+b'\n');os.close(wr);wr=None
        result=subprocess.run(['openssl','enc','-aes-256-cbc','-pbkdf2','-iter','200000','-pass','fd:'+str(rd)],input=plain,capture_output=True,pass_fds=(rd,),check=True)
    finally:
        os.close(rd)
        if wr is not None:os.close(wr)
    key=hashlib.pbkdf2_hmac('sha256',password.encode(),b'lecture-sync-mac',200000)
    return b'LSYNC1\n'+hmac.new(key,result.stdout,'sha256').digest()+result.stdout

def main():
    home=pathlib.Path(os.environ.get('LECTURE_SYNC_HOME',str(pathlib.Path.home()/'.lecture-sync')))
    config=json.loads((home/'config.json').read_text());phrase=(home/'passphrase').read_text().strip()
    password=getpass.getpass('设置连接文件口令（至少8字符，只用于手机导入）：')
    if not 8<=len(password)<=1024 or any(c in password for c in '\r\n\0'):raise ValueError('口令至少 8 字符，不能包含换行')
    if password!=getpass.getpass('再次输入口令：'):raise ValueError('两次口令不同')
    data=ROOT/'data/mobile-pairing';data.mkdir(parents=True,exist_ok=True,mode=0o700)
    dest=data/('lecture-connection-'+secrets.token_hex(4)+'.lecture')
    raw=seal({'type':'lecture-mobile-pairing-v1','url':config['url'],'token':config['token'],'passphrase':phrase},password)
    fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb') as out:out.write(raw)
    print('已生成加密连接文件：',dest)
    print('将此文件传给你自己的手机，在网站“连接／同步”里导入，并输入刚设置的口令。文件内不含录音。')
if __name__=='__main__':
    try:main()
    except (ValueError,OSError,subprocess.CalledProcessError):print('导出失败：请检查同步初始化、口令或本机 openssl。',file=sys.stderr);sys.exit(1)
