"""Explicit planning assumptions, never a provider bill or guaranteed upper bound."""
import math
import usage_meter
DEFAULTS={'minutes':45,'speechPercent':75,'segmentSeconds':6,'questions':10,'inputTokens':1500,'outputTokens':250,'answerInputTokens':1000,'answerOutputTokens':200}
def assumptions(src):
    out={}
    for k,lo,hi in [('minutes',1,480),('speechPercent',0,100),('segmentSeconds',2,60),('questions',0,200),('inputTokens',1,100000),('outputTokens',1,16000),('answerInputTokens',1,100000),('answerOutputTokens',1,16000)]:
        value=float(src.get(k,DEFAULTS[k]))
        if not math.isfinite(value) or not lo<=value<=hi:raise ValueError('费用预估参数超出范围：'+k)
        out[k]=value
    return out

def estimate(cfg,plan,prices,fused):
    a=assumptions(plan);mode=plan.get('mode','assist')
    if mode not in ('record','transcript','assist'):raise ValueError('预估场景不存在')
    if cfg.get('silence',{}).get('enabled') is False:a['speechPercent']=100
    seconds=a['minutes']*60*a['speechPercent']/100
    live=cfg.get('live',{});interval=float(live.get('keywordProbeSeconds',3) if mode=='assist' and live.get('keywordEnabled',True) else live.get('chunkSeconds',12)) if mode!='record' else 90
    if not math.isfinite(interval) or interval<=0:raise ValueError('发送间隔必须大于零')
    audio_requests=math.ceil(seconds/interval)
    effective_segment=min(a['segmentSeconds'],interval) if mode=='assist' else a['segmentSeconds']
    segments=math.ceil(seconds/effective_segment);rows=[]
    def add(role,label,count,tokens=None,audio=None):
        if not count:return
        price=prices.get(role);amount=None
        if audio is not None:
            # Each submitted interval has its own rounding/minimum charge.
            full=max(0,count-1);last=audio-full*interval
            one=usage_meter.cost('asr',None,interval,price);tail=usage_meter.cost('asr',None,last,price)
            if one is not None and tail is not None:amount=full*one+tail
        else:
            one=usage_meter.cost(role,tokens or {},0,price)
            if one is not None:amount=count*one
        rows.append({'role':role,'label':label,'requests':count,'amount':amount,'currency':price.get('currency','CNY') if price else None,'price':price,'model':cfg.get(role,{}).get('model',''),'tokensPerRequest':tokens})
    add('asr','语音识别',audio_requests,audio=seconds)
    per={'prompt_tokens':a['inputTokens'],'completion_tokens':a['outputTokens']}
    if mode=='record':
        if plan.get('recordStyle')!='verbatim':add('text','录后整理一次',1,{'prompt_tokens':max(500,seconds*4),'completion_tokens':max(250,seconds*3)})
    else:
        correct=live.get('correctTranscript',True)
        if correct:add('correction','校订与判题' if mode=='assist' and fused else '逐字稿校订',segments,per)
        if mode=='assist':
            if not fused:add('text','课堂知识点与判题',segments,per)
            questions=int(a['questions'])
            add('text','课堂提问回答',questions,{'prompt_tokens':a['answerInputTokens'],'completion_tokens':a['answerOutputTokens']})
            if live.get('webSearch'):add('search','联网搜索',questions)
    if live.get('retainTranscript') is not False and live.get('finalAudioReview') is not False:
        review_seconds=a['minutes']*60;price=prices.get('asr')
        rows.append({'role':'asr','label':'完整原音复核（含静音）','requests':math.ceil(review_seconds/600),'amount':usage_meter.cost('asr',None,review_seconds,price),'currency':price.get('currency','CNY') if price else None,'price':price,'model':cfg.get('asr',{}).get('model','')})
        if live.get('correctTranscript') is not False:add('correction','完整原音复核后校订',1,{'prompt_tokens':review_seconds*5,'completion_tokens':review_seconds*4})
    amounts={};missing=[]
    for row in rows:
        if row['amount'] is None:missing.append(row['label'])
        else:amounts[row['currency']]=amounts.get(row['currency'],0)+row['amount']
    return {'assumptions':a,'mode':mode,'sentSeconds':seconds,'rows':rows,'amounts':amounts,'complete':not missing,'unpriced':missing,'fused':fused,'effectiveSegmentSeconds':effective_segment,'note':('听课快检的短段也可能立即校订，按不长于 %.1f 秒/次估算；'%effective_segment if mode=='assist' else '')+('静音跳过关闭，按全部录音时长估算；' if cfg.get('silence',{}).get('enabled') is False else '')+'按上述语音比例、句段频率、tokens 和提问数量估算；不假设缓存命中，不含重试、追问、额外总结，非费用上限或平台账单。'}

def project_observed(rows,elapsed,minutes,cfg):
    """Extrapolate recorded charges; never substitute for missing bills or pending jobs."""
    import datetime
    if elapsed<30:return {'available':False,'reason':'至少积累 30 秒录音和已返回用量后显示实测推算。'}
    relevant=[r for r in rows if r['role'] in ('asr','correction','text','search')]
    if not relevant:return {'available':False,'reason':'尚无已返回的模型用量。'}
    if any((r['provider'],r['model'])!=(cfg.get(r['role'],{}).get('providerId'),cfg.get(r['role'],{}).get('model')) for r in relevant):
        return {'available':False,'reason':'本记录曾使用不同模型，不能混算为当前模型的速度。'}
    end=max(datetime.datetime.fromisoformat(r['created']) for r in relevant)
    start=min(datetime.datetime.fromisoformat(r['created']) for r in relevant)
    recent=[r for r in relevant if (end-datetime.datetime.fromisoformat(r['created'])).total_seconds()<=60]
    # A recent window is valid only after 90 seconds of returned calls; otherwise use all elapsed audio.
    recent_seconds=60 if (end-start).total_seconds()>=90 else None
    def totals(items,seconds):
        costs={};unknown=0
        for r in items:
            if r['cost'] is None or not r.get('price'):unknown+=1;continue
            currency=r['price']['currency'];costs[currency]=costs.get(currency,0)+r['cost']
        return costs,{c:v*60/seconds for c,v in costs.items()},unknown
    spent,average,unknown=totals(relevant,elapsed)
    _,recent_rate,_=totals(recent,recent_seconds) if recent_seconds else ({},{},0)
    rate={c:max(v,recent_rate.get(c,0)) for c,v in average.items()}
    return {'available':bool(rate),'elapsedSeconds':elapsed,'spent':spent,'perMinute':rate,'amounts':{c:max(spent[c],v*minutes) for c,v in rate.items()},'averagePerMinute':average,'recentPerMinute':recent_rate,'unpricedRequests':unknown,'requests':len(relevant),'note':'按本次累计与最近 60 秒中较高的已记录费用速度推算；包含本次重复调用，待返回请求和未知费用仍未计入，不是费用上限或平台账单。'}
