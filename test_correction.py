# -*- coding: utf-8 -*-
"""Sentence correction preserves originals, source offsets, next-ASR delivery and billing model."""
import copy, json, unittest
from unittest.mock import patch
import test_silence
m=test_silence.m
class CorrectionTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 make=test_silence.SilenceTests.make
 def chunk(self,seq=0,start=7):
  self.make([(3,.1)]);m.ingest(self.sid,seq,start,self.path.read_bytes())
 def cfg(self,retain=True):
  return {'text':{'providerId':'sf','model':'analysis'},'correction':{'providerId':'sf','model':'proofreader'},'live':{'correctTranscript':True,'retainTranscript':retain},'silence':{'enabled':False}}
 def test_class_delivers_raw_before_correction_then_keeps_both_and_retries_without_charge(self):
  self.chunk();events=[];seen=[]
  def fake(cfg,system,text):
   self.assertTrue(any(isinstance(e,dict) and e.get('transcript') for e in events))
   seen.append(cfg['text']['model']);return (json.dumps({'segments':[{'id':0,'text':'基圆内没有渐开线。'}]}),{})
  with patch.object(m,'transcribe',return_value='机圆内没有建开线。'),patch.object(m,'chat',side_effect=fake) as chat:
   first=m.realtime_transcribe(self.sid,{'seq':0,'config':self.cfg()},events.append)
   again=m.realtime_transcribe(self.sid,{'seq':0,'config':self.cfg()},events.append)
  self.assertEqual(chat.call_count,1);self.assertEqual(seen,['proofreader'])
  self.assertIn('机圆',first['text']);self.assertIn('基圆',first['correction']['text'])
  self.assertEqual(again['correction']['revision'],first['correction']['revision'])
  snap=m.transcript_snapshot(self.sid);versions={r['id']:r for r in m.detail(self.sid)['revisions']}
  self.assertIn('机圆',versions[snap['rawRevision']]['content']['text'])
  fixed=versions[snap['revision']]['content'];self.assertIn('基圆',fixed['text'])
  self.assertEqual(fixed['segments'][0]['start'],7);self.assertEqual(fixed['segments'][0]['end'],10)
 def test_live_detection_uses_corrected_text_and_does_not_overwrite_raw(self):
  self.chunk();inputs=[]
  def fake(cfg,system,text):
   data=json.loads(text);inputs.append(data)
   if 'segments' in data:return (json.dumps({'segments':[{'id':0,'text':'今天讲渐开线的形成过程。'}]}),{})
   self.assertIn('渐开线',data['transcript']);self.assertNotIn('建开县',data['transcript'])
   return (json.dumps({'isQuestion':False,'topic':'渐开线','candidateIndex':-1}),{})
  with patch.object(m,'transcribe',return_value='今天讲建开县的形成过程。'),patch.object(m,'chat',side_effect=fake):
   result=m.live(self.sid,{'seq':0,'config':self.cfg()},lambda _:None)
  self.assertEqual(len(inputs),2);self.assertIn('建开县',result['text']);self.assertIn('渐开线',result['context'])
 def test_partial_probe_waits_for_completed_sentence_and_corrects_group_together(self):
  self.chunk(0,0);self.chunk(1,3);cfg=self.cfg();events=[]
  cfg['live']['chunkSeconds']=12
  with patch.object(m,'transcribe',side_effect=['今天我们来讨论渐开','线是怎样通过基圆的运动形成的。']),patch.object(m,'chat',side_effect=[(json.dumps({'segments':[{'id':0,'text':'今天我们来讨论渐开'},{'id':1,'text':'线是怎样通过基圆的运动形成的。'}]}),{}),(json.dumps({'isQuestion':False,'topic':'渐开线'}),{})]) as chat:
   first=m.live(self.sid,{'seq':0,'reason':'keyword-probe','config':cfg},events.append)
   self.assertTrue(first['deferred']);self.assertEqual(chat.call_count,0)
   second=m.live(self.sid,{'seq':1,'reason':'keyword-probe','config':cfg},events.append)
  self.assertFalse(second.get('deferred',False));self.assertEqual(second['correction']['sequences'],[0,1])
  self.assertEqual([x['seq'] for x in second['correction']['segments']],[0,1])
 def test_failure_or_omission_preserves_every_word_and_continues_detection(self):
  self.chunk();original='今天我们来讲完整例子和公式推导，所有条件都必须保留。'
  for output in [ValueError('synthetic timeout'),('{}',{}),(json.dumps({'segments':[{'id':0,'text':'总结'}]}),{})]:
   with patch.object(m,'transcribe',return_value=original),patch.object(m,'chat',side_effect=[output,(json.dumps({'isQuestion':False,'topic':'公式'}),{})]):
    result=m.live(self.sid,{'seq':0,'config':self.cfg(retain=False)},lambda _:None)
   self.assertEqual(result['correction']['correctionState'],'failed');self.assertIn(original,result['context'])
  saved=m.detail(self.sid)['revisions']
  self.assertFalse(any(r['kind'] in ('corrected-transcript','live-transcript') for r in saved))
  self.assertTrue(all(not r['content'].get('text') and not r['content'].get('context') and 'correction' not in r['content'] for r in saved))
 def test_silent_segments_are_not_sent_to_correction_and_offsets_remain_exact(self):
  parts=[{'seq':1,'segments':[{'start':0,'end':2,'text':'静音','skipped':True},{'start':2,'end':4,'text':'今天讲基圆。'}]}]
  def fake(cfg,system,text):
   self.assertEqual(json.loads(text)['segments'],[{'id':1,'text':'今天讲基圆。'}])
   return (json.dumps({'segments':[{'id':1,'text':'今天讲基圆。'}]}),{})
  with patch.object(m,'chat',side_effect=fake):r=m.corrected_group(self.sid,parts,self.cfg(),lambda _:None)
  self.assertEqual(r['segments'][0],dict(parts[0]['segments'][0],seq=1));self.assertEqual(r['segments'][1]['start'],2)
 def test_correction_request_uses_own_model_and_disables_supported_thinking(self):
  cfg=self.cfg();cfg['correction'].update(model='deepseek-ai/DeepSeek-V4.1-Flash',timeout=8,maxTokens=3000)
  with patch.object(m,'providers',return_value=[{'id':'sf','baseURL':'https://api.siliconflow.cn/v1'}]):out=m.correction_config(cfg)
  self.assertEqual(out['text']['model'],cfg['correction']['model']);self.assertEqual(out['thinking'],'off')
  self.assertEqual(out['timeout'],8);self.assertEqual(out['maxTokens'],3000)
  self.assertEqual(cfg['text']['model'],'analysis')
 def test_correction_usage_is_billed_under_its_own_model_and_role(self):
  cfg=m.correction_config(dict(self.cfg(),_session=self.sid))
  response={'choices':[{'message':{'content':'{}'},'finish_reason':'stop'}],'usage':{'prompt_tokens':23,'completion_tokens':9}}
  with patch.object(m,'resolve',return_value=({},'synthetic','proofreader')),patch.object(m,'providers',return_value=[{'id':'sf','chatPath':'/chat/completions'}]),patch.object(m,'request',return_value=response):
   m.chat(cfg,'synthetic correction','synthetic text')
  row=m.usage_summary(self.sid)['rows'][-1]
  self.assertEqual(row['role'],'correction');self.assertEqual(row['model'],'proofreader')
  self.assertEqual(row['usage']['inputTokens'],23)
if __name__=='__main__':unittest.main()
