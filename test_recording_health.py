# -*- coding: utf-8 -*-
"""Failure isolation and lesson budget math. All requests are synthetic/local."""
import json,threading,time,unittest
from unittest.mock import patch
import test_silence,lesson_budget
m=test_silence.m
class HealthTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 make=test_silence.SilenceTests.make
 def test_all_slow_analysis_workers_cannot_block_the_next_asr(self):
  self.make([(1,.1)]);m.ingest(self.sid,0,0,self.path.read_bytes())
  entered=threading.Barrier(7,timeout=3);release=threading.Event();tasks=[]
  def block():entered.wait();release.wait(4)
  try:
   tasks=[m.POOL.submit(block) for _ in range(6)];entered.wait()
   with patch.object(m,'transcribe',return_value='已经返回的实际片段'),patch.object(m,'chat',return_value=(json.dumps({'isQuestion':False,'topic':'测试'}),{})):
    created=m.job(lambda p:m.live(self.sid,{'seq':0,'config':{'silence':{'enabled':False}}},p,defer_analysis=True),m.ASR_POOL)
    deadline=time.monotonic()+2
    while not m.JOBS[created['job']].get('transcript') and time.monotonic()<deadline:time.sleep(.01)
    job=m.JOBS[created['job']];self.assertIn('已经返回',job['transcript']['text'])
    self.assertEqual(job['status'],'running');self.assertEqual(job['stage'],'analysis-queued')
    release.set()
    while job['status']=='running' and time.monotonic()<deadline+2:time.sleep(.01)
    self.assertEqual(job['status'],'done',job)
  finally:
   release.set()
   for task in tasks:task.result(timeout=5)
 def test_continuously_streaming_response_still_has_a_deadline(self):
  from test_answer_speed import sse
  seen=[]
  stream=sse({'choices':[{'delta':{'content':'已收到正文'}}]}, {'choices':[{'delta':{'reasoning_content':'still running'}}]}, '[DONE]')
  with patch.object(m.time,'monotonic',side_effect=[0,.1,2]):
   with self.assertRaises(m.StreamFailure):m.read_chat_stream(stream,seen.append,deadline=1)
  self.assertEqual(seen,['已收到正文'])
 def test_stale_analysis_is_explicitly_skipped_without_another_paid_request(self):
  called=[]
  def start(progress):
   progress({'transcript':{'text':'原稿保留'}});later=m.Continuation(lambda:called.append(True));later.queued-=21;return later
  created=m.job(start,m.ASR_POOL);deadline=time.monotonic()+2
  while m.JOBS[created['job']]['status']=='running' and time.monotonic()<deadline:time.sleep(.01)
  result=m.JOBS[created['job']];self.assertEqual(result['status'],'error');self.assertIn('超过20秒',result['message'])
  self.assertEqual(result['transcript']['text'],'原稿保留');self.assertEqual(called,[])
 def test_http_audio_save_does_not_clear_pending_analysis_until_explicit_completion(self):
  import urllib.request
  self.make([(1,.1)]);m.ingest(self.sid,0,0,self.path.read_bytes())
  m.LIVE_BUFFERS[self.sid]=[{'text':'尚待处理'}]
  server=m.ThreadingHTTPServer(('127.0.0.1',0),m.Handler)
  thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  base='http://127.0.0.1:'+str(server.server_port)+'/api/sessions/'+self.sid
  def post(path,body):
   req=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Lecture-Demo':'1'})
   return json.load(urllib.request.urlopen(req,timeout=3))
  try:
   saved=post('/finish',{'finalized':False})
   self.assertEqual(saved['seconds'],1);self.assertTrue((m.session_dir(self.sid)/'original.wav').is_file())
   self.assertIn(self.sid,m.LIVE_BUFFERS)
   post('/complete-live',{});self.assertNotIn(self.sid,m.LIVE_BUFFERS)
  finally:server.shutdown();server.server_close();thread.join(2)
 def test_realtime_wait_limits_apply_to_asr_detection_and_answer(self):
  cfg={'timeout':120};self.assertEqual(m.live_timeout(cfg,'asr'),8)
  self.assertEqual(m.live_request_config(cfg,'detect')['timeout'],8)
  self.assertEqual(m.live_request_config(cfg,'answer')['timeout'],12)
  self.assertEqual(m.live_timeout({'timeout':3},'asr'),3)
  self.assertEqual(m.live_timeout({'timeout':120,'live':{'asrTimeoutSeconds':5}},'asr'),5)
  with self.assertRaises(ValueError):m.live_timeout({'live':{'asrTimeoutSeconds':float('nan')}},'asr')
 def test_fused_timeout_does_not_start_a_second_long_detection_request(self):
  self.make([(1,.1)]);m.ingest(self.sid,0,0,self.path.read_bytes())
  cfg={'text':{'providerId':'sf','model':'synthetic'},'correction':{'providerId':'sf','model':'synthetic'},'silence':{'enabled':False}}
  with patch.object(m,'transcribe',return_value='这是一段完整的课堂讲解。'),patch.object(m,'chat',side_effect=TimeoutError('synthetic timeout')) as chat:
   result=m.live(self.sid,{'seq':0,'config':cfg},lambda _:None)
  self.assertEqual(chat.call_count,1);self.assertIn('未完成',result['analysisError'])
  self.assertIn('课堂讲解',result['text'])

class LessonBudgetTests(unittest.TestCase):
 def cfg(self):return {'asr':{'model':'asr'},'correction':{'model':'corrector'},'text':{'model':'answer'},'live':{'keywordProbeSeconds':3,'chunkSeconds':12,'correctTranscript':True}}
 def prices(self):return {'asr':{'currency':'CNY','audioPerSecond':.00022},'correction':{'currency':'CNY','inputPerMillion':2,'outputPerMillion':8},'text':{'currency':'CNY','inputPerMillion':2,'outputPerMillion':8}}
 def test_explicit_full_lesson_includes_asr_and_both_text_roles_without_double_detection(self):
  r=lesson_budget.estimate(self.cfg(),{'mode':'assist'},self.prices(),True)
  self.assertEqual(r['sentSeconds'],2025);self.assertEqual(len(r['rows']),5)
  self.assertEqual(r['rows'][0]['requests'],675)
  self.assertAlmostEqual(r['rows'][0]['amount'],.4455)
  self.assertAlmostEqual(r['amounts']['CNY'],.4455+675*.005+10*.0036+2700*.00022+(2700*5*2+2700*4*8)/1e6)
 def test_unknown_roles_are_partial_not_free_and_currencies_are_separate(self):
  p=self.prices();p.pop('correction');p['text']['currency']='USD'
  r=lesson_budget.estimate(self.cfg(),{},p,True)
  self.assertFalse(r['complete']);self.assertIn('校订与判题',r['unpriced'])
  self.assertIn('USD',r['amounts']);self.assertIn('CNY',r['amounts'])
 def test_per_request_audio_minimums_and_free_prices_are_respected(self):
  p=self.prices();p['asr'].update(audioPerSecond=.1,minimumAudioSeconds=5)
  r=lesson_budget.estimate(self.cfg(),{'minutes':1,'speechPercent':10,'questions':0},p,True)
  self.assertEqual(r['rows'][0]['requests'],2);self.assertEqual(r['rows'][0]['amount'],1)
  p['asr']['audioPerSecond']=0
  self.assertEqual(lesson_budget.estimate(self.cfg(),{'minutes':1},p,True)['rows'][0]['amount'],0)
 def test_disabled_silence_gate_budgets_the_entire_class(self):
  cfg=self.cfg();cfg['silence']={'enabled':False}
  result=lesson_budget.estimate(cfg,{'minutes':45,'speechPercent':50},self.prices(),True)
  self.assertEqual(result['sentSeconds'],2700);self.assertIn('按全部',result['note'])
 def test_separate_models_charge_detection_and_invalid_numbers_are_rejected(self):
  r=lesson_budget.estimate(self.cfg(),{},self.prices(),False)
  self.assertEqual(len(r['rows']),6)
  for field,value in [('minutes',0),('speechPercent',101),('inputTokens',float('inf'))]:
   with self.assertRaises(ValueError):lesson_budget.estimate(self.cfg(),{field:value},self.prices(),True)
if __name__=='__main__':unittest.main()
