"""Local PCM gate, duration curve and source-timeline mapping. Originals are never edited."""
import array, math, sys, wave
import speech_activity

DEFAULTS = {'enabled': True, 'thresholdDb': -55.0, 'minSilence': 1.5, 'padding': 0.35, 'thresholdMode': 'manual'}

def settings(cfg):
    src = cfg.get('silence', {})
    if not isinstance(src, dict): raise ValueError('静音设置格式错误')
    result = dict(DEFAULTS)
    if 'holdBeforeSkip' in src:
        if not isinstance(src['holdBeforeSkip'],bool):raise ValueError('延迟关闭开关必须为布尔值')
        result['holdBeforeSkip']=src['holdBeforeSkip']
    if 'enabled' in src:
        if not isinstance(src['enabled'], bool): raise ValueError('静音开关必须为布尔值')
        result['enabled'] = src['enabled']
    for k, lo, hi in [('thresholdDb', -80, -20), ('minSilence', 0.5, 10), ('padding', 0.15, 1.5), ('preRoll', 0.15, 3)]:
        if k in src:
            val = float(src[k])
            if not math.isfinite(val) or not lo <= val <= hi: raise ValueError('静音参数 %s 超出范围' % k)
            result[k] = val
    result['preRoll']=result.get('preRoll',result['padding'])
    mode=src.get('thresholdMode','manual')
    if mode not in ('auto','manual'): raise ValueError('未知阈值模式')
    result['thresholdMode']=mode
    return result

def scan(path):
    with wave.open(str(path), 'rb') as src:
        rate, total = src.getframerate(), src.getnframes()
        if src.getnchannels() != 1 or src.getsampwidth() != 2: raise ValueError('静音分析要求单声道 PCM16')
        frame = max(1, round(rate * .02)); levels = []; pos = 0
        while pos < total:
            data = array.array('h', src.readframes(frame))
            if sys.byteorder != 'little': data.byteswap()
            if not data: break
            rms = math.sqrt(sum(x*x for x in data) / len(data)) / 32768
            levels.append((pos, pos + len(data), 20*math.log10(max(rms, 10**(-96/20)))))
            pos += len(data)
    return rate, total, levels

def from_scan(rate, total, levels, opts):
    active = []
    if not opts['enabled']: active = [[0,total]] if total else []
    else:
        for start,end,db in levels:
            if db >= opts['thresholdDb']:
                if active and start == active[-1][1]: active[-1][1] = end
                else: active.append([start,end])
        pre = round(rate*opts.get('preRoll',opts['padding'])); post=round(rate*(max(opts['padding'],opts['minSilence']) if opts.get('holdBeforeSkip') else opts['padding']))
        gap = round(rate*opts['minSilence']); joined=[]
        for a,b in active:
            if joined and a-joined[-1][1] < max(gap,pre+post): joined[-1][1]=b
            else: joined.append([a,b])
        active=[[0 if a<gap else max(0,a-pre),total if total-b<gap else min(total,b+post)] for a,b in joined]
    kept=[]
    for a,b in active:
        for x in range(a,b,rate*90):
            end=min(b,x+rate*90)
            kept.append({'startFrame':x,'endFrame':end,'start':x/rate,'end':end/rate})
    skipped=[]; cursor=0
    for r in kept:
        if r['startFrame']>cursor: skipped.append({'start':cursor/rate,'end':r['start'],'skipped':True,'text':'【静音跳过，原录音保留】'})
        cursor=r['endFrame']
    if cursor<total: skipped.append({'start':cursor/rate,'end':total/rate,'skipped':True,'text':'【静音跳过，原录音保留】'})
    sent=sum(r['endFrame']-r['startFrame'] for r in kept)/rate
    result={'settings':opts,'duration':total/rate,'sentSeconds':sent,'skippedSeconds':max(0,total/rate-sent),
            'requestCount':len(kept),'peakFrameDb':round(max((x[2] for x in levels),default=-96),1) if opts['enabled'] else None,
            'ranges':kept,'skipped':skipped}
    if opts.get('holdBeforeSkip'):
        last=next((b for a,b,db in reversed(levels) if db>=opts['thresholdDb']),None)
        result['holdRemainingSeconds']=max(0,(last+round(rate*opts['minSilence'])-total)/rate) if opts['enabled'] and last is not None else 0
    return result

def extend_initial_hold(gate,seconds):
    if not math.isfinite(seconds) or seconds<=0:return gate
    end=min(round(gate['duration']*16000),round(seconds*16000));ranges=[]
    for row in [dict(startFrame=0,endFrame=end,start=0,end=end/16000),*gate['ranges']]:
        if row['endFrame']<=row['startFrame']:continue
        if ranges and row['startFrame']<=ranges[-1]['endFrame']:
            ranges[-1]['endFrame']=max(ranges[-1]['endFrame'],row['endFrame']);ranges[-1]['end']=ranges[-1]['endFrame']/16000
        else:ranges.append(dict(row))
    skipped=[];cursor=0;sent=0
    for r in ranges:
        if r['start']>cursor:skipped.append(dict(start=cursor,end=r['start'],skipped=True,text='【静音跳过，原录音保留】'))
        sent+=r['end']-r['start'];cursor=r['end']
    if cursor<gate['duration']:skipped.append(dict(start=cursor,end=gate['duration'],skipped=True,text='【静音跳过，原录音保留】'))
    return dict(gate,ranges=ranges,skipped=skipped,sentSeconds=sent,skippedSeconds=max(0,gate['duration']-sent),requestCount=len(ranges),holdRemainingSeconds=max(gate.get('holdRemainingSeconds',0),seconds-gate['duration']))

def plan(path,cfg):
    values=scan(path); opts=settings(cfg)
    if opts['thresholdMode']=='auto' and opts['enabled']:
        report=analyze_scan(*values,cfg,speech=speech_activity.scan(path))
        return apply_report(*values,opts,report)
    return from_scan(*values,opts)

def apply_report(rate,total,levels,opts,report):
    # No reliable split: keep quiet sound rather than reuse a different recording's threshold.
    effective=report['recommendedDb'] if report['recommendedDb'] is not None else -80
    if opts.get('holdBeforeSkip'):effective=min(effective,-55)
    result=from_scan(rate,total,levels,dict(opts,thresholdDb=effective))
    result['calibration']={k:report[k] for k in ('curve','cliff','recommendedDb','recommendationReason','quality','duration','speechProtection','distribution')}
    if opts.get('holdBeforeSkip'):result['calibration'].update(uncappedRecommendedDb=report['recommendedDb'],recommendedDb=effective,autoSafetyCeilingDb=-55)
    return result

def curve(path,cfg):
    return analyze_scan(*scan(path),cfg,speech=speech_activity.scan(path))

def analyze_scan(rate,total,levels,cfg,speech=None):
    opts=settings(cfg)
    result=from_scan(rate,total,levels,opts); points=[]
    for db in range(-80,-19):
        p=from_scan(rate,total,levels,dict(opts,enabled=True,thresholdDb=db))
        points.append({'db':db,'sentSeconds':round(p['sentSeconds'],3)})
    drops=[{'db':p['db'],'dropSeconds':round(points[i-1]['sentSeconds']-p['sentSeconds'],3)} for i,p in enumerate(points) if i and points[i-1]['sentSeconds']>p['sentSeconds']]
    drops=sorted(drops,key=lambda x:x['dropSeconds'],reverse=True)
    peak=max((x[2] for x in levels),default=-96)
    meaningful=[d for d in drops if d['dropSeconds']>=max(1,total/rate*.08) and -78<d['db']<-22]
    ordered=sorted(d for _,_,d in levels)
    def quantile(q): return ordered[min(len(ordered)-1,int((len(ordered)-1)*q))] if ordered else -96
    quality={'floorDb':round(quantile(.1),1),'medianDb':round(quantile(.5),1),
             'loudDb':round(quantile(.9),1),'peakDb':round(peak,1),
             'rangeDb':round(quantile(.9)-quantile(.1),1),'confidence':'insufficient'}
    recommendation=None; cliff=meaningful[0] if meaningful else None
    reason='尚无可靠的背景/声音分界；自动模式暂用 −80 dBFS 保守保留，手动模式保持你的选择。'
    # A real gap between two sufficiently populated energy groups, not simply the loudest cliff.
    # This is a local energy heuristic, not speech classification or a probability of correctness.
    splits=[]; count=len(ordered); minimum=max(50,round(count*.1))
    for i in range(minimum,count-minimum):
        if ordered[i]-ordered[i-1]>=6:
            splits.append((ordered[i]-ordered[i-1],i))
    if total/rate>=8 and peak>-78 and splits:
        gap,i=max(splits)
        low=ordered[max(0,i-1)]; quiet=ordered[i]
        recommendation=round(max(-80,min(-20,low+3,quiet-6)))
        if cliff: recommendation=min(recommendation,max(-80,cliff['db']-4))
        quality.update(noiseCeilingDb=round(low,1),quietSoundDb=round(quiet,1),confidence='separated')
        reason='本段存在两组分离的音量；建议位于低音量组上方、较轻声音组下方，并避开时长骤降处。不能据此确认哪组一定是噪声，请试听。'
    elif peak<=-80:
        quality['confidence']='near-silence'
        reason='接近全静音，无法估计人声边界；自动模式仅跳过 −80 dBFS 以下的声音。检查麦克风。'
    elif total/rate<8:
        reason='校准样本不足 8 秒；自动模式暂用 −80 dBFS，先保留轻声，不沿用上一段录音的阈值。'
    protection={'method':'energy-only','available':speech is not None}
    voiced=[(a,b,p) for a,b,p in (speech or []) if p>=.35]
    voiced_seconds=sum(b-a for a,b,p in voiced)/rate
    if total/rate>=8 and voiced_seconds>=2:
        # Optimize against independently detected speech, not the duration cliff.
        # Protect quiet speech separately so loud speech cannot mask its removal.
        energies={a:db for a,b,db in levels}
        def energy(a):return energies.get((a//max(1,round(rate*.02)))*max(1,round(rate*.02)),-96)
        ordered_voice=sorted(voiced,key=lambda v:energy(v[0]))
        quiet=sorted(ordered_voice[:max(1,len(ordered_voice)//4)])
        safe=[]
        for point in points:
            candidate=from_scan(rate,total,levels,dict(opts,enabled=True,thresholdDb=point['db']))
            recall=speech_activity.retention(candidate['ranges'],voiced)
            quiet_recall=speech_activity.retention(candidate['ranges'],quiet)
            point.update(speechRetained=round(recall,5),quietSpeechRetained=round(quiet_recall,5))
            if recall>=.995 and quiet_recall>=.995:safe.append(point['db'])
        if safe:
            recommendation=max(-80,max(safe)-3)
            protection={'method':'local-silero','available':True,'speechSeconds':round(voiced_seconds,2),'targetRetention':.995,'marginDb':3,'boundaryDb':max(safe)}
            quality['confidence']='speech-protected'
            reason='以本地人声检测为参照，保留至少 99.5% 的疑似人声及较轻人声，再向保守方向留 3 dB 余量；最大下降仅供观察。检测可能出错，请回听核对轻声。'
    if speech is not None and voiced_seconds<2 and recommendation is None:
        reason='本地检测在此窗口找到的人声不足 2 秒，不能确定轻声边界；本窗口保守保留，待后续语音重新校准。'
    if speech is None and recommendation is None:
        reason+=' 本地人声检测未安装或不可用；可运行 tools/setup_vad.py 并安装 numpy、onnxruntime。'
    if opts.get('holdBeforeSkip') and opts['thresholdMode']=='auto' and recommendation is not None:
        recommendation=min(recommendation,-55)
        reason+=' 课堂保守保护：自动阈值最高 −55 dBFS，低音量先保留完整等待时长，再跳过后续静音。'
    bands=[]
    for low in range(-96,-19,2):
        frames=sum(b-a for a,b,db in levels if low<=db<low+2)
        bands.append({'fromDb':low,'toDb':low+2,'seconds':round(frames/rate,3),'percent':round(100*frames/max(1,total),1)})
    quality['dominantBand']=max(bands,key=lambda b:b['seconds'])
    result['distribution']=bands
    result['speechProtection']=protection
    result.update(curve=points,cliffs=meaningful[:4],cliff=cliff,recommendedDb=recommendation,recommendationReason=reason,quality=quality,
                  levels=[{'start':a/rate,'end':b/rate,'db':round(d,1)} for a,b,d in levels[::max(1,len(levels)//500)]])
    return result
