"""Download pinned public MIT model; no user audio or credentials are sent."""
import hashlib,os,pathlib,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent.parent
REV='066409f3d9db45a30d21dfcbf9147826ffdd7052'
SHA='1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3'
def main():
    dest=pathlib.Path(os.environ.get('LECTURE_WORKSPACE_DATA',os.environ.get('LECTURE_DEMO_DATA',str(ROOT/'data'))))/'models/silero_vad.onnx'
    raw=urllib.request.urlopen('https://raw.githubusercontent.com/snakers4/silero-vad/'+REV+'/src/silero_vad/data/silero_vad.onnx',timeout=30).read()
    if hashlib.sha256(raw).hexdigest()!=SHA:raise RuntimeError('Model checksum mismatch')
    dest.parent.mkdir(parents=True,exist_ok=True);tmp=dest.with_suffix('.tmp');tmp.write_bytes(raw);tmp.replace(dest)
    print('Local VAD model installed; inference needs numpy and onnxruntime.')
if __name__=='__main__':main()
