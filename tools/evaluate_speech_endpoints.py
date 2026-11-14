"""Replay local PCM through the shipped Silero model without any remote request."""
import json,pathlib,sys,wave
import numpy as np
import onnxruntime as ort
root=pathlib.Path(__file__).resolve().parent.parent
opts=ort.SessionOptions();opts.intra_op_num_threads=1;opts.inter_op_num_threads=1
model=ort.InferenceSession(str(root/'static/models/silero_vad.onnx'),opts,providers=['CPUExecutionProvider'])
with wave.open(sys.argv[1]) as src:
    assert src.getframerate()==16000 and src.getnchannels()==1
    pcm=np.frombuffer(src.readframes(src.getnframes()),dtype='<i2')
state=np.zeros((2,1,128),np.float32);context=np.zeros((1,64),np.float32)
voiced=quiet=0;inside=False;ends=[]
for start in range(0,len(pcm)-511,512):
    inp=np.concatenate([context,np.clip(pcm[start:start+512].astype(np.float32)/32768*4,-1,1).reshape(1,-1)],axis=1)
    probability,state=model.run(None,{'input':inp,'state':state,'sr':np.array(16000,np.int64)})
    context=inp[:,-64:]
    if probability.item()>=.35:voiced+=512;quiet=0;inside=True
    elif inside:quiet+=512
    if inside and voiced>=3200 and quiet>=1.2*16000:
        ends.append((start+512)/16000);inside=False;voiced=quiet=0
durations=np.diff([0,*ends,len(pcm)/16000])
print(json.dumps({'seconds':len(pcm)/16000,'segmentsIncludingFinal':len(durations),'shortestSeconds':float(min(durations)),'medianSeconds':float(np.median(durations)),'longestSeconds':float(max(durations)),'endpoints':ends}))
