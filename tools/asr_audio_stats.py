"""Local diagnostic audio measurements and optional speech probabilities. No network."""
import json, pathlib, sys, wave
import numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import speech_activity

source=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2])
with wave.open(str(source)) as f:
    rate=f.getframerate(); pcm=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2')
samples=pcm.astype(np.float64)/32768
levels=[20*np.log10(max(1e-8,float(np.sqrt(np.mean(x*x))))) for x in np.array_split(samples,max(1,len(samples)//320))]
scores=speech_activity.scan(source)
result={'seconds':len(samples)/rate,'peakDbFS':20*np.log10(max(1e-8,float(np.max(np.abs(samples))))),
        'clippedFraction':float(np.mean(np.abs(samples)>=.999)),
        'levelPercentiles':dict(zip(['p05','p25','p50','p75','p95'],np.percentile(levels,[5,25,50,75,95]).tolist())),
        'vadAvailable':scores is not None}
out.mkdir(exist_ok=True,parents=True)
(out/'audio-stats.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
if scores is not None:
    (out/'speech-scores.json').write_text(json.dumps([{'startFrame':a,'endFrame':b,'probability':p} for a,b,p in scores]))
print(json.dumps(result,ensure_ascii=False))
