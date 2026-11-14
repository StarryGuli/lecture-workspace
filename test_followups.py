"""Per-question context isolation, thinking and concurrent execution. Synthetic only."""
import json, threading, concurrent.futures, unittest
from unittest.mock import patch
import test_silence
m=test_silence.m
class FollowupTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 def seed(self,qid,question,context='本题课堂内容'):
  return m.save_revision(self.sid,'live',{'questionId':qid,'start':0,'context':context,'analysis':{'isQuestion':True,'question':question,'answer':'原题答案','answerPending':False}}, {})
 def body(self,qid,text='请解释第二步',request='synthetic-request',thinking='off'):
  return {'questionId':qid,'requestId':request,'text':text,'thinking':thinking,'config':{'text':{'providerId':'sf','model':'deepseek-ai/DeepSeek-V4.1-Flash'}}}
 def supported(self): return patch.object(m,'providers',return_value=[{'id':'sf','baseURL':'https://api.siliconflow.cn/v1'}])
 def test_context_history_and_idempotency_are_scoped_to_one_question(self):
  self.seed('first','机构自由度是多少？','第一题上下文');self.seed('other','另一个问题','不能串入的上下文');seen=[]
  def fake(cfg,system,text):seen.append(json.loads(text));return ('本题追问答案',{})
  with self.supported(),patch.object(m,'chat',side_effect=fake) as chat:
   a=m.question_followup(self.sid,self.body('first'),lambda _:None)
   duplicate=m.question_followup(self.sid,self.body('first'),lambda _:None)
   b=m.question_followup(self.sid,self.body('first','再解释为什么','synthetic-next','high'),lambda _:None)
  self.assertEqual(chat.call_count,2);self.assertEqual(a['revision'],duplicate['revision'])
  self.assertEqual(seen[0]['classroomContext'],'第一题上下文');self.assertEqual(seen[0]['question'],'机构自由度是多少？')
  self.assertNotIn('不能串入',json.dumps(seen,ensure_ascii=False));self.assertEqual(seen[1]['previousFollowups'][0]['answer'],'本题追问答案')
  self.assertEqual(b['requestParameters'],{'enable_thinking':True,'reasoning_effort':'high'})
 def test_reanswered_question_uses_latest_context_and_initial_answer(self):
  self.seed('same','原题','旧的缺失背景')
  m.save_revision(self.sid,'live',{'questionId':'same','context':'新的课堂背景与时间线','analysis':{'isQuestion':True,'question':'补全后的题目','answer':'已经修正的回答'}},{})
  captured=[]
  with self.supported(),patch.object(m,'chat',side_effect=lambda cfg,prompt,text:(captured.append(json.loads(text)) or '新追问答案',{})):
   m.question_followup(self.sid,self.body('same'),lambda _:None)
  self.assertEqual(captured[0]['classroomContext'],'新的课堂背景与时间线')
  self.assertEqual(captured[0]['initialAnswer'],'已经修正的回答')
 def test_all_effort_choices_have_real_request_parameters(self):
  cfg=self.body('unused')['config'];captured=[]
  def request(*args):captured.append(json.loads(args[3]));return {'choices':[{'message':{'content':'结果'},'finish_reason':'stop'}],'usage':{}}
  with self.supported(),patch.object(m,'resolve',return_value=({},'fake','deepseek-ai/DeepSeek-V4.1-Flash')),patch.object(m,'request',side_effect=request):
   for mode in ['off','high','max']:
    out,_=m.followup_config(cfg,mode);m.chat(out,'test','synthetic')
  self.assertFalse(captured[0]['enable_thinking']);self.assertNotIn('reasoning_effort',captured[0])
  self.assertEqual(captured[1]['reasoning_effort'],'high');self.assertEqual(captured[2]['reasoning_effort'],'max')
 def test_unknown_question_cannot_invoke_a_provider(self):
  with self.supported(),patch.object(m,'chat') as chat:
   with self.assertRaises(ValueError):m.question_followup(self.sid,self.body('missing'),lambda _:None)
   chat.assert_not_called()
 def test_different_questions_answer_concurrently(self):
  for i in range(3):self.seed(str(i),'第%d题的题目'%i)
  barrier=threading.Barrier(3,timeout=3)
  def fake(*args):barrier.wait();return ('并发完成',{})
  with self.supported(),patch.object(m,'chat',side_effect=fake),concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
   tasks=[pool.submit(m.question_followup,self.sid,self.body(str(i),request='request-'+str(i)),lambda _:None) for i in range(3)]
   self.assertEqual(len([t.result(timeout=5) for t in tasks]),3)
 def test_three_new_question_answer_jobs_do_not_wait_for_each_other(self):
  rows=[]
  for i in range(3):
   sid=self.sid
   import io,wave
   b=io.BytesIO()
   with wave.open(b,'wb') as w:w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(b'\0\0'*16000)
   m.ingest(sid,i,i*60,b.getvalue());rows.append((sid,i))
  barrier=threading.Barrier(3,timeout=3);started=[]
  def fake(cfg,system,text):
   if '只输出 JSON' in system:return (json.dumps({'topic':'测试','isQuestion':True,'question':'请回答第'+str(json.loads(text)['transcript'].split(']')[0])+'题的机构自由度是多少？','questionType':'student-question','confidence':.99,'candidateIndex':-1}),{})
   started.append(cfg['_session']);barrier.wait();return ('并发答案',{})
  with patch.object(m,'transcribe',return_value='请回答机构自由度是多少？'),patch.object(m,'chat',side_effect=fake):
   jobs=[m.job(lambda progress,sid=sid,seq=seq:m.live(sid,{'seq':seq,'config':{'silence':{'enabled':False}}},progress)) for sid,seq in rows]
   import time
   deadline=time.monotonic()+5
   while any(m.JOBS[j['job']]['status']=='running' for j in jobs) and time.monotonic()<deadline:time.sleep(.01)
   self.assertEqual(len(started),3)
   for j in jobs:self.assertEqual(m.JOBS[j['job']]['status'],'done',m.JOBS[j['job']])
if __name__=='__main__':unittest.main()
