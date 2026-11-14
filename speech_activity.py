"""Optional local Silero ONNX inference. Audio never leaves the machine."""
import collections,hashlib,os,pathlib,threading,wave
MODEL_SHA256='1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3'
_LOCK=threading.RLock();_SESSIONS={};_CACHE=collections.OrderedDict()

def scan(path):
    path=pathlib.Path(path)
    model=pathlib.Path(os.environ.get('LECTURE_VAD_MODEL',str(path.parent.parent/'models/silero_vad.onnx')))
    if not model.is_file():return None
    try:
        import numpy as np
        import onnxruntime as ort
    except ImportError:return None
    key=(str(path.resolve()),path.stat().st_mtime_ns,path.stat().st_size,str(model.resolve()))
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key);return _CACHE[key]
        name=str(model.resolve())
        if name not in _SESSIONS:
            if hashlib.sha256(model.read_bytes()).hexdigest()!=MODEL_SHA256:raise ValueError('本地 VAD 模型校验失败，请重新运行 tools/setup_vad.py')
            opts=ort.SessionOptions();opts.inter_op_num_threads=1;opts.intra_op_num_threads=1
            _SESSIONS[name]=ort.InferenceSession(name,sess_options=opts,providers=['CPUExecutionProvider'])
        session=_SESSIONS[name]
    with wave.open(str(path),'rb') as src:
        if src.getframerate()!=16000 or src.getnchannels()!=1 or src.getsampwidth()!=2:return None
        pcm=np.frombuffer(src.readframes(src.getnframes()),dtype='<i2').astype(np.float32)/32768
    # Boost only the local detector's copy for distant/quiet speech; original audio is unchanged.
    peak=float(np.max(np.abs(pcm))) if len(pcm) else 0
    pcm=pcm*max(1,min(8,.8/max(peak,1e-8)))
    state=np.zeros((2,1,128),dtype=np.float32);context=np.zeros((1,64),dtype=np.float32);scores=[]
    for start in range(0,len(pcm),512):
        chunk=pcm[start:start+512];frame=np.pad(chunk,(0,512-len(chunk))).reshape(1,-1)
        inp=np.concatenate((context,frame),axis=1)
        prob,state=session.run(None,{'input':inp,'state':state,'sr':np.array(16000,dtype=np.int64)})
        context=inp[:,-64:];scores.append((start,min(start+512,len(pcm)),float(prob.ravel()[0])))
    with _LOCK:
        _CACHE[key]=scores
        while len(_CACHE)>160:_CACHE.popitem(last=False)
    return scores

def retention(ranges,voice):
    kept=0;total=0;i=0
    for a,b,p in voice:
        if p<.35:continue
        total+=b-a
        while i<len(ranges) and ranges[i]['endFrame']<=a:i+=1
        j=i
        while j<len(ranges) and ranges[j]['startFrame']<b:
            kept+=max(0,min(b,ranges[j]['endFrame'])-max(a,ranges[j]['startFrame']));j+=1
    return kept/total if total else None
