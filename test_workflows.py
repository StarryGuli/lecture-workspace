"""Regression contracts for three workflows. Uses synthetic PCM and mocked providers only."""
import hashlib, json, os, unittest
from unittest.mock import patch
import test_server, test_silence
m=test_server.m

class WorkflowTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 make=test_silence.SilenceTests.make
 def test_curve_matches_actual_gate_and_preserves_original(self):
  self.make([(3,0),(3,.002),(4,0),(3,.025),(3,0)])
  before=hashlib.sha256(self.path.read_bytes()).hexdigest()
  result=m.audio_gate.curve(self.path,{})
  self.assertEqual(len(result['curve']),61)
  values=[p['sentSeconds'] for p in result['curve']]
  self.assertEqual(values,sorted(values,reverse=True))
  for db in (-75,-65,-55,-45,-25):
   expected=m.audio_gate.plan(self.path,{'silence':{'thresholdDb':db}})
   value=next(p['sentSeconds'] for p in result['curve'] if p['db']==db)
   self.assertAlmostEqual(value,expected['sentSeconds'],places=2)
  self.assertLess(result['recommendedDb'],result['cliff']['db'])
  self.assertEqual(before,hashlib.sha256(self.path.read_bytes()).hexdigest())
 def test_no_recommendation_for_silence_or_short_sample(self):
  self.make([(12,0)]);self.assertIsNone(m.audio_gate.curve(self.path,{})['recommendedDb'])
  self.make([(1,.1),(1,0)]);self.assertIsNone(m.audio_gate.curve(self.path,{})['recommendedDb'])
 def test_preview_running_chunks_does_not_finish_recording(self):
  self.make([(3,0),(3,.1),(6,0)])
  raw=self.path.read_bytes();self.path.unlink();m.ingest(self.sid,0,0,raw)
  result=m.silence_preview(self.sid,{})
  self.assertEqual(result['duration'],12);self.assertFalse(self.path.exists())
  self.assertEqual(m.detail(self.sid)['status'],'recording')
 def test_manual_edit_keeps_original_and_source_timing(self):
  content={'segments':[{'start':42,'end':51,'text':'原文'}],'text':'原文'}
  original=m.save_revision(self.sid,'raw',content,{})
  r=m.edit_revision(self.sid,{'source':original,'segments':[{'start':0,'text':'校订文本','speaker':'老师'}]})
  versions=m.detail(self.sid)['revisions'];self.assertEqual(versions[0]['content'],content)
  updated=next(x for x in versions if x['id']==r['revision'])
  self.assertEqual(updated['content']['segments'][0]['start'],42)
  self.assertEqual(updated['content']['segments'][0]['speaker'],'老师')
 def test_original_style_does_not_call_text_model(self):
  original=m.save_revision(self.sid,'raw',{'text':'完整原文。'},{})
  with patch.object(m,'chat',side_effect=AssertionError('not needed')):
   m.organize(self.sid,{'config':{},'source':original,'kind':'record','style':'verbatim','prompt':'保留全文'},lambda _:None)
  self.assertEqual(m.detail(self.sid)['revisions'][-1]['content']['text'],'完整原文。')
 def test_long_record_auto_preserves_all_content(self):
  text='原话与细节。'*3000
  original=m.save_revision(self.sid,'raw',{'text':text},{})
  with patch.object(m,'chat',side_effect=AssertionError('no shortening')):
   m.organize(self.sid,{'config':{},'source':original,'kind':'record','style':'auto','prompt':'完整保留'},lambda _:None)
  self.assertEqual(m.detail(self.sid)['revisions'][-1]['content']['text'],text)
 def test_live_without_retention_does_not_write_transcript(self):
  self.make([(12,.1)]);m.ingest(self.sid,0,0,self.path.read_bytes())
  with patch.object(m,'transcribe',return_value='私密课堂逐字原话'),patch.object(m,'chat',return_value=(json.dumps({'topic':'机构自由度','isQuestion':False,'candidateIndex':-1}),{})):
   result=m.live(self.sid,{'seq':0,'config':{'live':{'retainTranscript':False}}},lambda _:None)
  self.assertIn('私密课堂',result['text'])
  saved=m.detail(self.sid)['revisions'][-1]['content']
  self.assertEqual(saved['text'],'');self.assertEqual(saved['segments'],[])
  self.assertFalse((m.session_dir(self.sid)/'partial-transcript.json').exists())
 def test_question_alert_precedes_optional_search_answer(self):
  self.make([(12,.1)]);m.ingest(self.sid,0,0,self.path.read_bytes())
  initial={'topic':'齿轮','isQuestion':True,'confidence':.95,'questionType':'student-question','question':'为什么？','answer':'资料回答','candidateIndex':-1}
  events=[]
  def search(question):
   self.assertTrue(any(isinstance(e,dict) and e.get('question') for e in events))
   return [{'title':'来源','url':'https://example.com/reference','excerpt':'公开资料'}]
  with patch.object(m,'transcribe',return_value='为什么？'),patch.object(m,'chat',side_effect=[(json.dumps(initial),{}),('带来源的回答 [1]',{})]),patch.object(m,'search_web',side_effect=search):
   result=m.live(self.sid,{'seq':0,'config':{'live':{'webSearch':True,'retainTranscript':False}}},events.append)
  self.assertEqual(result['analysis']['searchStatus'],'done')
  self.assertEqual(result['analysis']['sources'][0]['url'],'https://example.com/reference')
 def test_generated_chapters_cannot_invent_timestamps(self):
  original=m.save_revision(self.sid,'raw',{'segments':[{'start':42,'end':80,'text':'内容'}],'text':'[00:42] 内容'},{})
  with patch.object(m,'chat',return_value=('[{"start":999,"title":"不存在的时间"}]',{})):
   with self.assertRaises(ValueError):m.organize(self.sid,{'config':{},'source':original,'kind':'chapters','prompt':m.PROMPTS['chapters']},lambda _:None)
  with patch.object(m,'chat',return_value=('[{"start":42,"title":"真正的话题"}]',{})):
   m.organize(self.sid,{'config':{},'source':original,'kind':'chapters','prompt':m.PROMPTS['chapters']},lambda _:None)
  self.assertEqual(m.detail(self.sid)['revisions'][-1]['content']['chapters'][0]['start'],42)
 def test_provider_credentials_are_local_and_never_returned(self):
  with self.assertRaises(ValueError):m.save_web_provider({'id':'../outside','baseURL':'https://example.com'})
  key='synthetic-unit-test-credential'
  result=m.save_web_provider({'name':'test local platform','baseURL':'https://example.com/v1','key':key})
  self.assertNotIn(key,json.dumps(result))
  kp=m.DATA/'keys'/result['id'];self.assertEqual(kp.stat().st_mode&0o777,0o600)
  self.assertTrue(next(p for p in result['providers'] if p['id']==result['id'])['hasKey'])

if __name__=='__main__':unittest.main()
