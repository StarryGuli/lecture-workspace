"""Question-first delivery, buffering, and actual-usage cost accounting. No real API calls."""
import datetime, json, unittest
from unittest.mock import patch
import test_silence, usage_meter
m=test_silence.m
class LiveFlowTests(unittest.TestCase):
    setUp=test_silence.SilenceTests.setUp
    make=test_silence.SilenceTests.make
    def chunk(self,seq,start):
        self.make([(3,.1)])
        m.ingest(self.sid,seq,start,self.path.read_bytes())
    def test_transcript_and_keyword_alert_precede_every_llm_and_answer(self):
        self.chunk(0,0);events=[]
        def semantic(*args):
            self.assertTrue(any(isinstance(e,dict) and e.get('transcript') for e in events))
            self.assertTrue(any(isinstance(e,dict) and e.get('question',{}).get('analysis',{}).get('answerPending') for e in events))
            return (json.dumps({'topic':'齿轮','isQuestion':True,'confidence':.95,'questionType':'student-question','question':'为什么基圆内没有渐开线？','candidateIndex':-1}),{})
        def answer(*args):
            self.assertTrue(any(isinstance(e,dict) and e.get('question') for e in events))
            return ('参考答案',{})
        with patch.object(m,'transcribe',return_value='请回答：为什么基圆内没有渐开线？'),patch.object(m,'chat',side_effect=[semantic,answer]) as chat:
            # mock side_effect list returns items verbatim; use a dispatcher to run assertions.
            chat.side_effect=lambda *a: semantic(*a) if chat.call_count==1 else answer(*a)
            result=m.live(self.sid,{'seq':0,'config':{}},events.append)
        self.assertEqual(result['analysis']['answer'],'参考答案')
        self.assertFalse(result['analysis']['answerPending'])
        self.assertTrue(any(r['kind']=='live-transcript' for r in m.detail(self.sid)['revisions']))
    def test_fast_asr_probes_buffer_context_without_repeated_llm_or_asr_at_finalize(self):
        events=[]
        for seq in range(2):self.chunk(seq,seq*3)
        cfg={'live':{'chunkSeconds':12,'keywordEnabled':True}}
        with patch.object(m,'transcribe',side_effect=['今天讲基圆。','为 什么基圆内没有渐开线？']) as asr,patch.object(m,'chat',side_effect=AssertionError('probe must wait for sentence')):
            first=m.live(self.sid,{'seq':0,'reason':'keyword-probe','config':cfg},events.append)
            second=m.live(self.sid,{'seq':1,'reason':'keyword-probe','config':cfg},events.append)
        self.assertTrue(first['deferred']);self.assertTrue(second['deferred'])
        self.assertEqual(first['questionId'],second['questionId'])
        self.assertFalse(any(isinstance(e,dict) and e.get('question') for e in events))
        with patch.object(m,'transcribe',side_effect=AssertionError('must not retranscribe')),patch.object(m,'chat',return_value=(json.dumps({'topic':'基圆','isQuestion':False,'candidateIndex':-1}),{})):
            result=m.finalize_live(self.sid,{'config':cfg},events.append)
        self.assertFalse(result.get('deferred',False))
        self.assertNotIn(self.sid,m.LIVE_BUFFERS)
        self.assertEqual(len([r for r in m.detail(self.sid)['revisions'] if r['kind']=='live-transcript']),2)
    def test_answer_failure_clears_pending_alert_and_keeps_transcript(self):
        self.chunk(0,0)
        detected=json.dumps({'isQuestion':True,'confidence':.95,'questionType':'student-question','question':'为什么？','candidateIndex':-1})
        with patch.object(m,'transcribe',return_value='为什么？'),patch.object(m,'chat',side_effect=[(detected,{}),ValueError('synthetic failure')]):
            result=m.live(self.sid,{'seq':0,'config':{}},lambda _:None)
        self.assertFalse(result['analysis']['answerPending'])
        self.assertIn('生成失败',result['analysis']['answer'])
        self.assertTrue(any(r['kind']=='live-transcript' for r in m.detail(self.sid)['revisions']))
    def test_meeting_notes_preserve_source_and_do_not_invent_assignments(self):
        original=m.save_revision(self.sid,'raw',{'text':'讨论方案，负责人还没决定。'}, {})
        prompts=[]
        def fake(cfg,prompt,text):prompts.append(prompt);return ('会议纪要：负责人未明确',{})
        with patch.object(m,'chat',side_effect=fake):
            m.organize(self.sid,{'config':{},'source':original,'kind':'record','style':'meeting','prompt':'完整记录'},lambda _:None)
        self.assertIn('只能引用原话',prompts[0])
        self.assertEqual(m.detail(self.sid)['revisions'][0]['content']['text'],'讨论方案，负责人还没决定。')

    def test_complete_direct_question_does_not_wait_for_twelve_second_interval(self):
        self.chunk(0,0);events=[]
        text='哪位同学来回答，为什么基圆内没有渐开线？'
        detected={'isQuestion':True,'confidence':.95,'questionType':'student-question','question':text,'candidateIndex':-1}
        with patch.object(m,'transcribe',return_value=text),patch.object(m,'chat',side_effect=[(json.dumps(detected),{}),('简明参考答案',{})]) as chat:
            result=m.live(self.sid,{'seq':0,'reason':'keyword-probe','config':{'live':{'chunkSeconds':12}}},events.append)
        self.assertFalse(result.get('deferred',False));self.assertEqual(chat.call_count,2)
        self.assertEqual(result['analysis']['answer'],'简明参考答案')
    def test_repeated_question_reuses_answer_without_a_second_answer_request(self):
        self.chunk(0,0);self.chunk(1,12)
        text='请回答，为什么基圆内没有渐开线？'
        detected={'isQuestion':True,'confidence':.95,'questionType':'student-question','question':text,'candidateIndex':-1}
        with patch.object(m,'transcribe',return_value=text),patch.object(m,'chat',side_effect=[(json.dumps(detected),{}),('第一题答案',{}),(json.dumps(detected),{})]) as chat:
            first=m.live(self.sid,{'seq':0,'config':{}},lambda _:None)
            second=m.live(self.sid,{'seq':1,'config':{}},lambda _:None)
        self.assertEqual(chat.call_count,3)
        self.assertTrue(second['duplicate']);self.assertEqual(second['questionId'],first['questionId'])
        self.assertEqual(second['analysis']['answer'],'第一题答案')

class MeterTests(unittest.TestCase):
    def test_unknown_prices_and_missing_usage_are_not_zero_cost(self):
        self.assertIsNone(usage_meter.cost('text',{'prompt_tokens':10,'completion_tokens':20},0,None))
        self.assertIsNone(usage_meter.cost('text',{},0,{'inputPerMillion':2,'outputPerMillion':8}))
        self.assertEqual(usage_meter.cost('asr',{},3,{'audioPerSecond':0}),0)
    def test_cache_is_not_billed_twice_and_audio_rounds_per_request(self):
        price={'inputPerMillion':2,'cachedPerMillion':.04,'outputPerMillion':8}
        self.assertAlmostEqual(usage_meter.cost('text',{'prompt_tokens':1000,'completion_tokens':100,'prompt_tokens_details':{'cached_tokens':800}},0,price),(.0004+.000032+.0008))
        self.assertEqual(usage_meter.audio_seconds(1.1,{'minimumAudioSeconds':2,'roundAudioSeconds':1}),2)
        self.assertAlmostEqual(usage_meter.cost('search',{},0,{'perThousandRequests':5}),.005)
    def test_off_peak_china_only_and_prices_belong_to_provider_model(self):
        cfg={'text':{'providerId':'sf','model':'deepseek-ai/DeepSeek-V4.1-Flash'}}
        china={'baseURL':'https://api.siliconflow.cn/v1'}
        t=datetime.datetime(2026,11,3,3,tzinfo=datetime.timezone(datetime.timedelta(hours=8)))
        off=usage_meter.quote(cfg,'text',china,t)
        peak=usage_meter.quote(cfg,'text',china,t.replace(hour=10))
        self.assertEqual(off['inputPerMillion'],1);self.assertEqual(peak['inputPerMillion'],2)
        self.assertIsNone(usage_meter.quote(cfg,'text',{'baseURL':'https://api.siliconflow.com/v1'},t))
        cfg['prices']={'other/'+cfg['text']['model']:{'inputPerMillion':99}}
        self.assertEqual(usage_meter.quote(cfg,'text',china,t)['inputPerMillion'],1)
    def test_siliconflow_qwen_asr_is_paid_and_verified_free_text_is_zero(self):
        china={'baseURL':'https://api.siliconflow.cn/v1'}
        asr=usage_meter.quote({'asr':{'model':'Qwen/Qwen3-ASR-1.7B'}},'asr',china)
        text=usage_meter.quote({'text':{'model':'XingChenAGI/Xing4.0-29B'}},'text',china)
        self.assertEqual(asr['audioPerSecond'],.00022)
        self.assertEqual(text['inputPerMillion'],0)
        self.assertEqual(text['outputPerMillion'],0)
        self.assertAlmostEqual(usage_meter.cost('asr',{},3600,asr),.792)
        self.assertEqual(usage_meter.cost('text',{'prompt_tokens':1000,'completion_tokens':200},0,text),0)
    def test_ledger_keeps_reported_tokens_price_snapshot_and_unknown_amounts(self):
        sid=m.uid()
        with m.db() as c:c.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(sid,'synthetic billing','record',m.now(),'saved'))
        cfg={'_session':sid,'text':{'providerId':'custom','model':'example'},'prices':{'custom/example':{'currency':'USD','inputPerMillion':2,'cachedPerMillion':.2,'outputPerMillion':4}}}
        m.meter(cfg,'text',{'prompt_tokens':100,'completion_tokens':20})
        cfg['prices']['custom/example']['inputPerMillion']=999
        m.meter(dict(cfg,prices={}), 'text', {})
        summary=m.usage_summary(sid)
        self.assertEqual(summary['inputTokens'],100);self.assertEqual(summary['outputTokens'],20)
        self.assertEqual(summary['unpricedRequests'],1);self.assertEqual(summary['unreportedTokenRequests'],1)
        self.assertAlmostEqual(summary['amounts']['USD'],.00028)
        self.assertEqual(summary['rows'][0]['price']['inputPerMillion'],2)

if __name__=='__main__':unittest.main()
