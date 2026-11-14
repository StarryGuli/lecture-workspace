# -*- coding: utf-8 -*-
"""Streaming delivery, usage accounting, fused policy and conservative fallback. Synthetic only."""
import io,json,threading,unittest
from unittest.mock import patch
import test_silence
m=test_silence.m

def sse(*items):
 return io.BytesIO(''.join('data: '+(x if isinstance(x,str) else json.dumps(x,ensure_ascii=False))+'\r\n\r\n' for x in items).encode())
class StreamingTests(unittest.TestCase):
 def test_delta_is_delivered_before_end_and_usage_only_frame_is_kept(self):
  events=[];seen=[]
  def response():
   yield b': heartbeat\n\n'
   yield b'data: \n'
   yield b'\n'
   for line in sse({'choices':[{'index':0,'delta':{'reasoning_content':'must not be displayed'}}]}, {'choices':[{'index':0,'delta':{'content':'先答'}}]}):yield line
   self.assertEqual(seen,['先答'])
   for line in sse({'choices':[{'delta':{'content':'案'},'finish_reason':'stop'}]}, {'choices':[],'usage':{'prompt_tokens':8,'completion_tokens':3}}, '[DONE]'):yield line
  result=m.read_chat_stream(response(),seen.append)
  self.assertEqual(seen,['先答','先答案']);self.assertEqual(result['usage']['completion_tokens'],3)
  self.assertEqual(result['choices'][0]['message']['content'],'先答案')
 def test_disconnect_and_malformed_stream_are_not_complete_answers(self):
  seen=[]
  with self.assertRaises(m.StreamFailure):m.read_chat_stream(sse({'choices':[{'delta':{'content':'未完'}}]}),seen.append)
  self.assertEqual(seen,['未完'])
  for data in ['{invalid',json.dumps({'error':{'message':'synthetic provider failure'}})]:
   with self.assertRaises(m.StreamFailure):m.read_chat_stream(sse(data),lambda _:None)
 def test_request_reads_actual_local_http_stream_without_waiting_for_final_response(self):
  received=threading.Event();early=[]
  class Handler(m.BaseHTTPRequestHandler):
   def log_message(self,*a):pass
   def do_POST(self):
    self.rfile.read(int(self.headers['Content-Length']))
    self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
    self.wfile.write(sse({'choices':[{'delta':{'content':'第一句'}}]}).read());self.wfile.flush()
    early.append(received.wait(2))
    self.wfile.write(sse({'choices':[{'delta':{'content':'。'},'finish_reason':'stop'}]},'[DONE]').read());self.wfile.flush()
  http=m.ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
  provider={'id':'local','baseURL':'http://127.0.0.1:'+str(http.server_port),'network':'Direct (no proxy)'}
  try:
   with patch.object(m,'resolve',return_value=(provider,'','synthetic')):
    r=m.request({'timeout':3,'text':{'providerId':'local','model':'synthetic'}},'text','/chat',b'{}',on_content=lambda _:received.set())
   self.assertEqual(early,[True]);self.assertEqual(r['choices'][0]['message']['content'],'第一句。')
  finally:http.shutdown();http.server_close();thread.join(2)
 def test_chat_sends_real_stream_flag_and_meters_usage_once(self):
  sid=m.uid()
  with m.db() as c:c.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(sid,'synthetic streaming','live',m.now(),'saved'))
  cfg={'_session':sid,'thinking':'off','text':{'providerId':'sf','model':'synthetic'}};seen=[]
  def request(cfg,role,path,body,**kw):
   payload=json.loads(body);self.assertTrue(payload['stream']);self.assertFalse(payload['enable_thinking'])
   self.assertTrue(payload['stream_options']['include_usage']);kw['on_content']('即时文字')
   return {'choices':[{'message':{'content':'即时文字'},'finish_reason':'stop'}],'usage':{'prompt_tokens':9,'completion_tokens':4}}
  with patch.object(m,'resolve',return_value=({},'','synthetic')),patch.object(m,'providers',return_value=[{'id':'sf'}]),patch.object(m,'request',side_effect=request):
   r=m.chat(cfg,'system','user',on_content=seen.append)
  self.assertEqual(seen,['即时文字']);self.assertEqual(m.usage_summary(sid)['requests'],1)
  self.assertEqual(m.usage_summary(sid)['outputTokens'],4)

 def test_filtered_or_truncated_response_is_not_a_complete_answer(self):
  cfg={'text':{'providerId':'sf','model':'synthetic'}}
  for finish in ['length','content_filter']:
   response={'choices':[{'message':{'content':'部分回答'},'finish_reason':finish}],'usage':{}}
   with patch.object(m,'resolve',return_value=({},'','synthetic')),patch.object(m,'providers',return_value=[{'id':'sf'}]),patch.object(m,'request',return_value=response):
    with self.assertRaises(ValueError):m.chat(cfg,'system','user')

class FastPipelineTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 make=test_silence.SilenceTests.make
 def cfg(self):
  return {'text':{'providerId':'sf','model':'synthetic'},'correction':{'providerId':'sf','model':'synthetic'},'silence':{'enabled':False},'live':{'correctTranscript':True,'fastPipeline':True,'streamAnswers':True}}
 def chunk(self):
  self.make([(3,.1)]);m.ingest(self.sid,0,0,self.path.read_bytes())
 def fused(self,question=True,score=.99):
  return {'segments':[{'id':0,'text':'请回答，为什么基圆内没有渐开线？'}], 'analysis':{'topic':'渐开线','isQuestion':question,'confidence':score,'questionType':'student-question','question':'为什么基圆内没有渐开线？','candidateIndex':-1}}
 def test_fused_correction_and_detection_remove_one_call_and_stream_first_answer(self):
  self.chunk();events=[]
  def chat(cfg,prompt,text,**kwargs):
   if cfg.get('_chatRole')=='correction':
    self.assertIn('analysis',prompt);return (json.dumps(self.fused()),{})
   self.assertIn('渐开线',json.loads(text)['classroomContext'])
   self.assertTrue(any(isinstance(e,dict) and e.get('transcriptCorrection') for e in events))
   kwargs['on_content']('可直接回答的第一句')
   self.assertTrue(any(isinstance(e,dict) and e.get('question',{}).get('analysis',{}).get('answerStreaming') for e in events))
   return ('可直接回答的第一句。补充说明。',{})
  with patch.object(m,'transcribe',return_value='请回答，为什么机圆内没有建开线？'),patch.object(m,'chat',side_effect=chat) as mock:
   result=m.live(self.sid,{'seq':0,'config':self.cfg()},events.append)
  self.assertEqual(mock.call_count,2);self.assertEqual(result['timings']['analysisMode'],'fused')
  self.assertFalse(result['analysis']['answerStreaming']);self.assertFalse(result['analysis']['keywordTentative'])
  self.assertIn('firstAnswerSeconds',result['timings']);self.assertIn('机圆',result['text'])
 def test_separate_selected_models_or_manual_switch_keep_separate_detection(self):
  cfg=self.cfg();self.assertTrue(m.fused_detection_enabled(cfg))
  cfg['correction']['model']='different';self.assertFalse(m.fused_detection_enabled(cfg))
  cfg=self.cfg();cfg['live']['fastPipeline']=False;self.assertFalse(m.fused_detection_enabled(cfg))
  cfg=self.cfg();cfg['live']['correctTranscript']=False;self.assertFalse(m.fused_detection_enabled(cfg))
 def test_missing_fused_analysis_falls_back_to_detector_using_corrected_text(self):
  self.chunk();fused=self.fused();fused.pop('analysis');calls=[]
  def chat(cfg,prompt,text,**kw):
   calls.append(json.loads(text))
   if len(calls)==1:return(json.dumps(fused),{})
   self.assertIn('基圆',calls[-1]['transcript'])
   return(json.dumps({'isQuestion':False,'topic':'基圆'}),{})
  with patch.object(m,'transcribe',return_value='请回答，为什么机圆内没有建开线？'),patch.object(m,'chat',side_effect=chat):
   result=m.live(self.sid,{'seq':0,'config':self.cfg()},lambda _:None)
  self.assertEqual(len(calls),2);self.assertEqual(result['timings']['analysisMode'],'separate')
 def test_fusion_does_not_bypass_conservative_confidence_gate(self):
  self.chunk()
  with patch.object(m,'transcribe',return_value='请回答，为什么基圆内没有渐开线？'),patch.object(m,'chat',return_value=(json.dumps(self.fused(score=.5)),{})) as chat:
   result=m.live(self.sid,{'seq':0,'config':self.cfg()},lambda _:None)
  self.assertFalse(result['analysis']['isQuestion']);self.assertEqual(chat.call_count,1)
 def test_malformed_fused_analysis_cannot_silently_skip_question_detection(self):
  good=self.fused()['analysis'];self.assertTrue(m.valid_fused_analysis(good))
  for bad in [{},dict(good,confidence=True),dict(good,confidence=float('nan')),dict(good,isQuestion='true'),dict(good,candidateIndex=True)]:
   self.assertFalse(m.valid_fused_analysis(bad))
 def test_three_fused_jobs_begin_streaming_answers_concurrently(self):
  for seq in range(3):
   self.make([(3,.1)]);m.ingest(self.sid,seq,seq*60,self.path.read_bytes())
  barrier=threading.Barrier(3,timeout=3);started=[]
  def chat(cfg,prompt,text,**kw):
   if cfg.get('_chatRole')=='correction':return(json.dumps(self.fused()),{})
   started.append(threading.get_ident());barrier.wait();kw['on_content']('并发首句');return('并发完整答案',{})
  with patch.object(m,'transcribe',return_value='请回答，为什么基圆内没有渐开线？'),patch.object(m,'chat',side_effect=chat):
   jobs=[m.job(lambda progress,seq=seq:m.live(self.sid,{'seq':seq,'config':self.cfg()},progress)) for seq in range(3)]
   import time
   deadline=time.monotonic()+5
   while any(m.JOBS[j['job']]['status']=='running' for j in jobs) and time.monotonic()<deadline:time.sleep(.01)
   self.assertEqual(len(set(started)),3)
   for job in jobs:self.assertEqual(m.JOBS[job['job']]['status'],'done',m.JOBS[job['job']])
 def test_stream_failure_keeps_partial_answer_and_marks_it_incomplete(self):
  self.chunk()
  def chat(cfg,prompt,text,**kwargs):
   if cfg.get('_chatRole')=='correction':return(json.dumps(self.fused()),{})
   kwargs['on_content']('只收到这部分');raise m.StreamFailure('synthetic disconnect')
  with patch.object(m,'transcribe',return_value='请回答，为什么基圆内没有渐开线？'),patch.object(m,'chat',side_effect=chat):
   result=m.live(self.sid,{'seq':0,'config':self.cfg()},lambda _:None)
  self.assertEqual(result['analysis']['answer'],'只收到这部分');self.assertTrue(result['analysis']['answerIncomplete'])
  self.assertFalse(result['analysis']['answerPending']);self.assertFalse(result['analysis']['answerStreaming'])
if __name__=='__main__':unittest.main()
