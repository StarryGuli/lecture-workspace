"""Conservative classroom question policy. Confidence is a model score, not calibrated probability."""
import math, re

THRESHOLDS={'conservative':.85,'balanced':.72,'sensitive':.55}
DEFAULT_KEYWORDS=['请回答','谁来回答','哪位同学','你来回答','请问','回答','can you answer']

def clean_text(text):
    return re.sub(r'\[\d+:\d+(?:—\d+:\d+)?\]','',str(text)).strip()

def assignment_hint(text):
    """Specific unanswered symbol-meaning task, not a general why/what trigger."""
    match=re.search(r'(?:指出|解释|说明|写出).{0,40}(?:字母|符号|数字).{0,24}(?:含义|意思)',text,re.S)
    if not match:return None
    segment=re.split(r'下面(?:一个|一题|我们)|接下来|下一个(?:问题|题)',text[match.start():],maxsplit=1)[0][:350]
    if not re.search(r'(?:代表|表示).{0,8}(?:什么|多少)',segment):return None
    # Do not alert when this same symbol question already has an explicit answer.
    if re.search(r'[A-Za-z0-9]\s*(?:代表|表示)\s*(?!什么|多少)[^\s?？]{2,}|[A-Za-z0-9]\s*(?:就是|是指|代表的是|表示的是)',segment):return None
    return segment.strip()

def fast_hint(text,cfg):
    text=clean_text(text);compact=re.sub(r'\s+','',text.lower())
    if len(compact)<8:return None
    task=assignment_hint(text)
    direct=bool(task) or bool(re.search(r'请(?:你|大家|同学们)?(?:回答|解释|说一说)|谁(?:来|能|愿意).{0,12}(?:回答|解释|说|告诉)|哪位同学|你来(?:回答|说)|同学们.{0,8}(?:想一想|算一算)|请问.{6}|can (?:you|anyone).{0,12}(?:answer|explain)',text,re.I))
    if re.search(r'有什么问题(?:下课|课后)再|听懂了吗|明白了吗|对不对|好不好',text) and not direct:return None
    if re.search(r'(?:为什么|为何|why).{0,100}(?:因为|这是由于|because)',text,re.I) and not direct:return None
    live=cfg.get('live',{});mode=live.get('questionSensitivity','conservative')
    words=live.get('keywords',DEFAULT_KEYWORDS)
    words=words if isinstance(words,list) else DEFAULT_KEYWORDS
    configured=any(re.sub(r'\s+','',str(w).lower()) in compact for w in words if str(w).strip())
    if mode=='conservative':return task or (text[-700:] if direct else None)
    academic=bool(re.search(r'(?:为什么|为何|如何理解|怎么理解|有什么区别|有哪些|什么是|是什么|意味着什么).{0,80}[？?]\s*$',text)) and len(re.sub(r'\W','',text))>=8
    pause=cfg.get('_acoustic',{}).get('pauseSeconds',0)
    pause=bool(isinstance(pause,(int,float)) and math.isfinite(pause) and pause>=.5 and cfg.get('_acoustic',{}).get('endedByPause'))
    if mode=='balanced':return text[-700:] if direct or academic and pause or configured and bool(re.search(r'[?？]',text)) else None
    return text[-700:] if direct or configured or re.search(r'[?？]',text) else None

def confirm(analysis,text,cfg):
    out=dict(analysis);mode=cfg.get('live',{}).get('questionSensitivity','conservative')
    threshold=THRESHOLDS.get(mode,.85)
    confidence=out.get('confidence',0)
    confidence=float(confidence) if isinstance(confidence,(int,float)) and not isinstance(confidence,bool) and math.isfinite(confidence) else 0
    out['confidence']=max(0,min(1,confidence));out['questionThreshold']=threshold
    kind=out.get('questionType','unknown')
    if out.get('isQuestion') is not True:return out
    if kind in ('rhetorical','self-answered','admin','lecture'):
        out.update(isQuestion=False,suppressedReason='讲解反问、自问自答或课堂管理用语')
    elif mode=='conservative' and kind not in ('student-question','genuine-question'):
        out.update(isQuestion=False,suppressedReason='未确认是面向听众的待回答提问')
    elif re.fullmatch(r'(?:同学们)?(?:对不对|懂了吗|明白了吗|好不好|理解不理解|有没有问题)[？?。！!]*',str(out.get('question','')).strip()):
        out.update(isQuestion=False,suppressedReason='课堂确认用语，不作为学科题目')
    elif out['confidence']<threshold:
        out.update(isQuestion=False,suppressedReason='提问置信度低于当前灵敏度门限')
    elif not str(out.get('question','')).strip():
        out.update(isQuestion=False,suppressedReason='没有提取出完整题目')
    elif re.search(r'(?:为什么|为何|why).{0,100}(?:因为|这是由于|because)',clean_text(text),re.I) and not fast_hint(text,{'live':{'questionSensitivity':'conservative'}}):
        out.update(isQuestion=False,suppressedReason='当前片段已经自问自答')
    return out
