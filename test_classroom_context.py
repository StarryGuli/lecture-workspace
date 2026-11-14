# -*- coding: utf-8 -*-
"""Causal local transcript plus earlier topic timeline; no model answers leak into context."""
import json,unittest
from unittest.mock import patch
import test_silence
m=test_silence.m
class ClassroomContextTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 make=test_silence.SilenceTests.make
 def source(self,seq,start,text,sid=None):
  sid=sid or self.sid
  part={'seq':seq,'start':start,'segments':[{'start':start,'end':start+3,'text':text}],'text':text}
  m.save_revision(sid,'live-transcript',part,{})
  return part
 def event(self,start,topic,question='',sid=None):
  return m.save_revision(sid or self.sid,'live',{'start':start,'questionId':str(start),'segments':[{'start':start,'end':start+1,'text':'原话'}],'analysis':{'topic':topic,'isQuestion':bool(question),'question':question,'answer':'不能当作课堂原话的旧 AI 答案'}},{})
 def test_nearby_context_prefers_corrected_source_and_excludes_future_and_other_sessions(self):
  self.source(0,5,'太早的内容');self.source(1,105,'错误术语');self.source(2,116,'未来的内容')
  m.save_revision(self.sid,'corrected-transcript',{'seq':1,'sequences':[1],'correctionState':'corrected','segments':[{'seq':1,'start':105,'end':108,'text':'材料牌号'}]}, {})
  other=m.uid()
  with m.db() as c:c.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(other,'another class','live',m.now(),'saved'))
  self.source(0,105,'另一堂课的聊天',other)
  self.event(106,'材料')
  result=m.recent_classroom_context(self.sid,110)
  self.assertIn('材料牌号',result['text'])
  for text in ['太早','未来','另一堂课','错误术语','旧 AI 答案']:self.assertNotIn(text,result['text'])
  self.assertEqual(result['segmentCount'],1)
 def test_volatile_context_works_without_persisting_transcripts(self):
  m.remember_classroom_context(self.sid,{'seq':0,'segments':[{'start':0,'end':3,'text':'正在讲材料牌号'}]})
  self.assertIn('材料牌号',m.recent_classroom_context(self.sid,4)['text'])
  self.assertFalse(m.detail(self.sid)['revisions'])
 def test_context_never_grows_into_an_unbounded_lesson_transcript(self):
  for i in range(140):m.remember_classroom_context(self.sid,{'seq':i,'segments':[{'start':i*2,'end':i*2+2,'text':str(i)+'x'*150}]})
  result=m.recent_classroom_context(self.sid,280)
  self.assertLessEqual(len(result['text']),4000);self.assertLessEqual(len(m.LIVE_CONTEXT[self.sid]),96)
  self.assertGreaterEqual(result['start'],190)
 def test_timeline_keeps_older_topics_but_no_answers_future_or_other_lesson(self):
  self.event(0,'碳素结构钢与材料牌号');self.event(10,'屈服强度','牌号里的数值表示什么？');self.event(20,'未来知识点')
  timeline=m.classroom_timeline(self.sid,15)
  text=json.dumps(timeline,ensure_ascii=False)
  self.assertIn('材料牌号',text);self.assertIn('牌号里的数值',text)
  self.assertNotIn('未来知识点',text);self.assertNotIn('旧 AI 答案',text)
  self.assertEqual(timeline['totalEvents'],2)
 def test_long_timeline_compaction_is_chronological_and_reports_omissions(self):
  for i in range(50):self.event(i*5,'话题'+str(i))
  result=m.classroom_timeline(self.sid,300)
  self.assertEqual(result['totalEvents'],50);self.assertGreater(result['omittedEvents'],0)
  self.assertLessEqual(len(result['events']),24)
  starts=[x['start'] for x in result['events']];self.assertEqual(starts,sorted(starts));self.assertEqual(starts[0],0);self.assertEqual(starts[-1],245)
 def test_split_question_sends_nearby_words_and_full_lesson_timeline_to_correction_and_answer(self):
  self.source(0,90,'第四题，指出这个材料字母所代表的含义。');self.source(1,94,'比如这个牌号。')
  self.event(0,'机械制造与材料');self.event(80,'材料牌号')
  self.make([(3,.1)]);m.ingest(self.sid,2,98,self.path.read_bytes())
  cfg={'text':{'providerId':'sf','model':'synthetic'},'correction':{'providerId':'sf','model':'synthetic'},'silence':{'enabled':False},'live':{'streamAnswers':False}}
  calls=[]
  def chat(cfg,prompt,text,**kwargs):
   data=json.loads(text);calls.append(data)
   self.assertIn('材料字母',data['previousContext']['text'])
   self.assertIn('机械制造',json.dumps(data['classroomTimeline'],ensure_ascii=False))
   self.assertNotIn('旧 AI 答案',json.dumps(data,ensure_ascii=False))
   if cfg.get('_chatRole')=='correction':
    return(json.dumps({'segments':[{'id':0,'text':'Q代表什么意思？235代表什么意思？'}],'analysis':{'topic':'材料牌号','isQuestion':True,'question':'Q代表什么意思？235代表什么意思？','questionType':'genuine-question','confidence':.95,'candidateIndex':-1}}),{})
   self.assertIn('已给出的上下文',prompt);return('基于材料牌号语境的回答',{})
  with patch.object(m,'transcribe',return_value='Q代表什么意思？二百三十五代表什么意思？'),patch.object(m,'chat',side_effect=chat):
   result=m.live(self.sid,{'seq':2,'config':cfg},lambda _:None)
  self.assertEqual(len(calls),2);self.assertIn('材料字母',result['context']);self.assertIn('机械制造',result['context'])
  self.assertEqual(result['contextWindow']['segmentCount'],2)
 def test_unfused_detector_receives_context_without_treating_old_questions_as_current(self):
  self.source(0,0,'上一句话在讲电荷量符号。');self.event(0,'静电学','之前的一道题')
  self.make([(3,.1)]);m.ingest(self.sid,1,5,self.path.read_bytes());seen=[]
  def chat(cfg,prompt,text):
   data=json.loads(text);seen.append(data)
   self.assertIn('电荷量',data['previousContext']['text']);self.assertEqual(data['transcript'],'[00:05—00:08] Q代表什么？')
   return(json.dumps({'topic':'静电学','isQuestion':False}),{})
  with patch.object(m,'transcribe',return_value='Q代表什么？'),patch.object(m,'chat',side_effect=chat):
   m.live(self.sid,{'seq':1,'config':{'silence':{'enabled':False}}},lambda _:None)
  self.assertEqual(len(seen),1)
 def test_saved_asr_can_be_reanswered_after_audio_deletion_without_a_new_asr_call(self):
  part={'seq':7,'start':10,'segments':[{'start':10,'end':13,'text':'请回答这道题。'}]}
  rid=m.save_revision(self.sid,'live-transcript',part,{})
  with patch.object(m,'transcribe',side_effect=AssertionError('ASR must not run')),patch.object(m,'chat',return_value=(json.dumps({'isQuestion':False,'topic':'材料'}),{})):
   result=m.live(self.sid,{'seq':7,'replayRevision':rid,'config':{}},lambda _:None)
  self.assertEqual(result['transcriptionSource'],'saved-transcript')
  self.assertEqual(result['revision'],rid)
  other=m.uid()
  with m.db() as c:c.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(other,'other','live',m.now(),'saved'))
  with self.assertRaises(ValueError):m.live(other,{'seq':7,'replayRevision':rid,'config':{}},lambda _:None)
if __name__=='__main__':unittest.main()
