"""Local lesson cue audit. Model question labels are candidates, never training truth."""
import argparse,bisect,json,pathlib,statistics,sys
ROOT=pathlib.Path(__file__).resolve().parent.parent;sys.path.insert(0,str(ROOT))
import server as m

def analyze(sid):
    audio=m.session_dir(sid)/'original.wav'
    if not audio.is_file():raise ValueError('Complete original audio is required')
    rate,total,levels=m.audio_gate.scan(audio)
    speech=m.speech_activity.scan(audio)
    report=m.audio_gate.analyze_scan(rate,total,levels,{'silence':{'thresholdMode':'auto'}},speech=speech)
    with m.db() as c:rows=c.execute("SELECT content FROM revisions WHERE session=? AND kind='live' ORDER BY rowid",(sid,)).fetchall()
    events={}
    for row in rows:
        v=json.loads(row['content']);events[v.get('questionId',v.get('seq'))]=v
    starts=[a/rate for a,b,p in (speech or [])];samples=[]
    for v in events.values():
        a=v.get('analysis',{});text=v.get('text','')
        if not text:continue
        segments=(v.get('correction') or {}).get('segments') or v.get('segments',[])
        end=max((seg.get('end',v.get('start',0)) for seg in segments),default=v.get('start',0)+3)
        pause=0;longest=0
        for start,stop,p in (speech or [])[bisect.bisect_left(starts,max(0,end-.5)):bisect.bisect_left(starts,end+3)]:
            pause=pause+(stop-start)/rate if p<.35 else 0;longest=max(longest,pause)
        if a.get('isQuestion') or ('?' in text or '？' in text):
            samples.append({'questionId':v.get('questionId'),'start':v.get('start'),'end':end,'question':a.get('question') or text,'modelType':a.get('questionType'),'modelConfidence':a.get('confidence'),'modelQuestion':a.get('isQuestion') is True,'nearbyPauseSeconds':round(longest,3),'userVerdict':None})
    for_model=[s['nearbyPauseSeconds'] for s in samples if s['modelQuestion']]
    result={'session':sid,'durationSeconds':total/rate,'thresholdRecommendation':report['recommendedDb'],'speechProtection':report['speechProtection'],'energyQuality':report['quality'],'questionCandidates':samples,'medianPauseNearModelQuestion':statistics.median(for_model) if for_model else None,'trainingStatus':'needs-user-labels','note':'Offline candidate audit only. Question labels come from the previous model, not ground truth. Pauses do not prove a teacher asked a question. Review true/false/missed events before learning course-specific rules.'}
    dest=m.DATA/'course-review'/sid;dest.mkdir(parents=True,exist_ok=True,mode=0o700)
    (dest/'candidates.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));(dest/'candidates.json').chmod(0o600)
    return result
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('session');args=parser.parse_args();r=analyze(args.session)
    print(json.dumps({k:r[k] for k in ('session','durationSeconds','thresholdRecommendation','speechProtection','trainingStatus')},ensure_ascii=False))
    print('Review candidates saved locally; no API calls.')
