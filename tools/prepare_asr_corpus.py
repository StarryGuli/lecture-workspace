"""Local-only corpus selection and Silero scores for bounded ASR comparisons."""
import argparse,hashlib,json,pathlib,re,sqlite3,subprocess,sys,wave
import numpy as np
import onnxruntime as ort
ROOT=pathlib.Path(__file__).resolve().parent.parent

def detector():
    opts=ort.SessionOptions();opts.intra_op_num_threads=1;opts.inter_op_num_threads=1
    return ort.InferenceSession(str(ROOT/'static/models/silero_vad.onnx'),opts,providers=['CPUExecutionProvider'])

def scores(model,pcm,gain):
    state=np.zeros((2,1,128),np.float32);context=np.zeros((1,64),np.float32);out=[]
    for start in range(0,len(pcm),512):
        block=np.zeros(512,np.float32);n=min(512,len(pcm)-start)
        block[:n]=np.clip(pcm[start:start+n].astype(np.float32)/32768*gain,-1,1)
        inp=np.concatenate([context,block.reshape(1,-1)],axis=1)
        prob,state=model.run(None,{'input':inp,'state':state,'sr':np.array(16000,np.int64)})
        context=inp[:,-64:];out.append({'startFrame':start,'endFrame':start+n,'probability':float(prob.item())})
    return out

def main():
    parser=argparse.ArgumentParser();parser.add_argument('output',nargs='?');parser.add_argument('--detector-stdin',action='store_true');parser.add_argument('--dictation',action='store_true');parser.add_argument('--source',action='append');parser.add_argument('--whole',action='store_true');args=parser.parse_args()
    model=detector()
    if args.detector_stdin:
        pcm=np.frombuffer(sys.stdin.buffer.read(),dtype='<i2');peak=float(np.max(np.abs(pcm.astype(np.float32)/32768))) if len(pcm) else 0
        print(json.dumps(scores(model,pcm,max(1,min(8,.8/max(peak,1e-8))))));return
    out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True,mode=0o700)
    db=sqlite3.connect(ROOT/'data/records.sqlite');labels=dict(db.execute('select id,title from sessions'))
    files=sorted((pathlib.Path.home()/'Desktop').glob('*.m4a'))+sorted((pathlib.Path.home()/'Downloads').glob('*.m4a'))+sorted((ROOT/'data').glob('*/original.wav'))
    inventory=None
    if args.dictation:
        support=pathlib.Path.home()/'Library/Application Support/Speakless'
        history=json.loads((support/'history.json').read_text());available=[]
        for r in history:
            source=support/'audio'/(r['id']+'.wav');text=r.get('raw','')+' '+r.get('text','')
            if not source.exists() or r.get('seconds',0)<45:continue
            if any(s in r.get('appName','').lower() for s in ['wechat','微信','qq','messages']):continue
            if re.search(r'sk-[\w-]{10,}|ghp_\w{10,}|\b1[3-9]\d{9}\b|\b\d{6}\b',text):continue
            mixed=len(re.findall(r'[A-Za-z]{2,}',text))
            tech=sum(word in text.lower() for word in ['api','asr','模型','代码','转录','录音'])
            available.append((mixed+tech*3,float(r.get('seconds',0)),source))
        files=[]
        if available:files.append(max(available,key=lambda x:x[0])[2])
        rest=[r for r in available if r[2] not in files]
        if rest:files.append(max(rest,key=lambda x:x[1])[2])
        labels={p.parent.name:'Speakless 日常输入' for p in files}
        inventory={'files':len(history),'minutes':sum(r.get('seconds',0) for r in history)/60,'selectedSources':len(files),'note':'Only duration and local text features used for selection. History text is never sent to a model.'}
    if args.source:files=[pathlib.Path(p) for p in args.source]
    used=set();manifest={'samples':[],'excluded':[],'selection':'Whole recording' if args.whole else 'One acoustically challenging natural-boundary excerpt per non-synthetic source, no remote calls during selection.','inventory':inventory}
    for source in files:
        label=labels.get(source.parent.name,source.name)
        if '合成' in label or '校准' in label:
            manifest['excluded'].append({'source':str(source),'reason':'synthetic calibration'});continue
        raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(source),'-ac','1','-ar','16000','-f','s16le','pipe:1'])
        sha=hashlib.sha256(raw).hexdigest()
        if sha in used:
            manifest['excluded'].append({'source':str(source),'reason':'identical decoded PCM'});continue
        used.add(sha);pcm=np.frombuffer(raw,dtype='<i2');voice=scores(model,pcm,4)
        # Production SpeechEndpoint: >=.35 probability, .2 s voiced, 1.2 s hangover.
        voiced=quiet=0;inside=False;ends=[]
        for r in voice:
            if r['endFrame']-r['startFrame']<512:continue
            if r['probability']>=.35:voiced+=512;quiet=0;inside=True
            elif inside:quiet+=512
            if inside and voiced>=3200 and quiet>=19200:
                ends.append(r['endFrame']);voiced=quiet=0;inside=False
        bounds=sorted(set([0,*ends,len(pcm)]));candidates=[]
        if args.whole or len(pcm)<=80*16000:candidates=[(0,len(pcm),0)]
        else:
            # Keep excerpt edges on detected boundaries; prefer quiet speech and
            # several short turns (the cases most vulnerable to losing context).
            for i,a in enumerate(bounds[:-1]):
                possible=[b for b in bounds[i+1:] if 40*16000<=b-a<=80*16000]
                if not possible:continue
                b=min(possible,key=lambda b:abs((b-a)/16000-60))
                rows=voice[a//512:min(len(voice),b//512)];human=[r for r in rows if r['probability']>=.35]
                if len(human)*512/16000<5:continue
                rms=[np.sqrt(np.mean(pcm[r['startFrame']:r['endFrame']].astype(np.float64)**2))/32768 for r in human]
                quiet_db=float(np.percentile(20*np.log10(np.maximum(rms,1e-8)),25))
                density=sum(a<x<b for x in ends)/((b-a)/16000)
                score=-quiet_db/100+density*2-abs((b-a)/16000-60)/200
                candidates.append((a,b,score))
        if not candidates:
            manifest['excluded'].append({'source':str(source),'reason':'no bounded representative speech window'});continue
        a,b,_=max(candidates,key=lambda x:x[2]);sid=f'sample-{len(manifest["samples"])+1:02d}'
        clip=pcm[a:b];name=sid+'.wav'
        with wave.open(str(out/name),'wb') as w:w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(clip.tobytes())
        sample={'id':sid,'source':str(source),'label':label,'sourceSeconds':len(pcm)/16000,'start':a/16000,'end':b/16000,'seconds':len(clip)/16000,'wav':name,'sha256':hashlib.sha256(clip.tobytes()).hexdigest(),'speech':scores(model,clip,4)}
        manifest['samples'].append(sample)
        print(json.dumps({k:sample[k] for k in ['id','label','sourceSeconds','start','end','seconds']},ensure_ascii=False),flush=True)
        (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
    print('Total selected seconds:',sum(s['seconds'] for s in manifest['samples']),flush=True)

if __name__=='__main__':main()
