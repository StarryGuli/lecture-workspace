"""Reported token usage and price-based estimates. Never claims to be the provider's bill."""
import datetime, math
from urllib.parse import urlparse
SOURCE='https://www.siliconflow.cn/pricing'
CHECKED='2026-11-05'
FREE_ASR_MODELS={
    'FunAudioLLM/SenseVoiceSmall','XingChenAGI/XingChenASR-V3.2-Ultra',
    'XingChenAGI/XingChenASR-Diarize-V3.0','XingChenAGI/XingChenASR-V3.2',
}
FREE_TEXT_MODELS={'XingChenAGI/Xing4.0-29B','Qwen/Qwen3.5-4B','tencent/Hunyuan-MT-7B'}

def quote(cfg,role,provider,at=None):
    model=cfg.get(role,{}).get('model','')
    key=cfg.get(role,{}).get('providerId','')+'/'+model
    custom=cfg.get('prices',{}).get(key)
    if custom:
        result={'currency':custom.get('currency','CNY'),'source':'手动单价','checked':CHECKED}
        if result['currency'] not in ('CNY','USD','EUR'): raise ValueError('不支持的计价币种')
        for k in ('audioPerSecond','inputPerMillion','outputPerMillion','cachedPerMillion','minimumAudioSeconds','roundAudioSeconds','perThousandRequests'):
            v=custom.get(k)
            if v not in (None,''):
                value=float(v)
                if not math.isfinite(value) or not 0<=value<=1000000: raise ValueError('计费单价必须是有限的非负数')
                result[k]=value
        return result
    host=urlparse(provider.get('baseURL','')).hostname or ''
    if host not in ('api.siliconflow.cn','api.siliconflow.com.cn'): return None
    result={'currency':'CNY','source':SOURCE,'checked':CHECKED}
    if role=='asr' and model=='Qwen/Qwen3-ASR-1.7B': return dict(result,audioPerSecond=.00022)
    if role=='asr' and model in FREE_ASR_MODELS: return dict(result,audioPerSecond=0)
    if role in ('correction','text') and model in FREE_TEXT_MODELS:
        return dict(result,inputPerMillion=0,outputPerMillion=0,cachedPerMillion=0)
    if model=='deepseek-ai/DeepSeek-V4.1-Flash':
        date=at or datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8)))
        off=2<=date.astimezone(datetime.timezone(datetime.timedelta(hours=8))).hour<8
        return dict(result,inputPerMillion=1 if off else 2,outputPerMillion=4 if off else 8,cachedPerMillion=.02 if off else .04,period='02:00–08:00 北京时间' if off else '常规时段（北京时间）')
    return None

def normalized(usage):
    u=usage or {}
    prompt=u.get('prompt_tokens',u.get('input_tokens'))
    completion=u.get('completion_tokens',u.get('output_tokens'))
    details=u.get('prompt_tokens_details') or u.get('input_tokens_details') or {}
    cached=u.get('prompt_cache_hit_tokens',details.get('cached_tokens',0))
    def number(x): return max(0,int(x)) if isinstance(x,(int,float)) and math.isfinite(x) else None
    p,o,c=number(prompt),number(completion),number(cached)
    return {'inputTokens':p,'outputTokens':o,'cachedTokens':min(p,c or 0) if p is not None else None}

def audio_seconds(seconds,price):
    n=max(0,seconds);p=price or {}
    step=p.get('roundAudioSeconds',0)
    if step:n=math.ceil(n/step)*step
    return max(n,p.get('minimumAudioSeconds',0))

def cost(role,usage,seconds,price):
    if not price: return None
    if role=='search': return price['perThousandRequests']/1000 if 'perThousandRequests' in price else None
    if role=='asr':
        return audio_seconds(seconds,price)*price['audioPerSecond'] if 'audioPerSecond' in price else None
    u=normalized(usage)
    if u['inputTokens'] is None or u['outputTokens'] is None: return None
    if 'inputPerMillion' not in price or 'outputPerMillion' not in price:return None
    cached=u['cachedTokens'] or 0
    cacheprice=price.get('cachedPerMillion',price['inputPerMillion'])
    return ((u['inputTokens']-cached)*price['inputPerMillion']+cached*cacheprice+u['outputTokens']*price['outputPerMillion'])/1e6
