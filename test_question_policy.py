"""Precision, request policy and question identity regressions. No provider calls."""
import json, unittest
from unittest.mock import patch
import question_policy as policy
import test_silence
m=test_silence.m

class QuestionPolicyTests(unittest.TestCase):
 def test_weak_words_and_self_answered_speech_do_not_trigger_fast_alert(self):
  for text in ['为什么基圆内没有渐开线？','对不对？我们接着往下看。','What is the next topic?','为什么要这样计算？因为约束条件不同。','同学们听懂了吗？有问题下课再说。']:
   self.assertIsNone(policy.fast_hint(text,{}),text)
 def test_direct_student_invitation_still_alerts_before_answer(self):
  self.assertIsNotNone(policy.fast_hint('哪位同学来回答，为什么基圆内没有渐开线？',{}))
  self.assertIsNotNone(policy.fast_hint('Can you answer why the mechanism has one degree of freedom?',{}))
 def test_symbol_assignment_alerts_before_following_unrelated_explanation(self):
  text='第四题，指出材料字母所代表的含义，比如Q235的Q代表什么意思？235代表什么意思？下面一个就是改进结构，比如一个锻件。'
  hint=policy.fast_hint(text,{})
  self.assertIsNotNone(hint);self.assertIn('Q代表什么意思',hint);self.assertNotIn('锻件',hint)
  for answered in ['解释字母的含义，Q代表什么意思？Q代表屈服强度。','指出数字含义，235代表什么意思？235就是屈服强度的数值。','老师解释了材料符号的含义，没有提出问题。']:
   self.assertIsNone(policy.fast_hint(answered,{}),answered)
 def test_semantic_confidence_and_type_override_single_question_mark(self):
  raw={'isQuestion':True,'question':'为什么要这样？','confidence':.8,'questionType':'student-question'}
  self.assertFalse(policy.confirm(raw,'老师请同学回答',{})['isQuestion'])
  self.assertTrue(policy.confirm(raw,'老师请同学回答',{'live':{'questionSensitivity':'balanced'}})['isQuestion'])
  for kind in ['rhetorical','self-answered','admin','lecture']:
   self.assertFalse(policy.confirm(dict(raw,confidence=.99,questionType=kind),'课堂讲解',{})['isQuestion'])
  for bad in [None,float('nan'),True,'0.99']:
   self.assertFalse(policy.confirm(dict(raw,confidence=bad),'课堂讲解',{})['isQuestion'])
 def test_unknown_intent_and_classroom_acknowledgements_are_not_promoted(self):
  self.assertFalse(policy.confirm({'isQuestion':True,'question':'这个是什么？','confidence':.99},'讲解内容',{})['isQuestion'])
  self.assertFalse(policy.confirm({'isQuestion':True,'questionType':'student-question','question':'对不对？','confidence':.99},'讲解内容',{})['isQuestion'])
 def test_both_detection_and_answers_disable_deepseek_thinking_by_default(self):
  cfg={'thinking':'omit','maxTokens':6000,'text':{'providerId':'sf','model':'deepseek-ai/DeepSeek-V4.1-Flash'}}
  with patch.object(m,'providers',return_value=[{'id':'sf','baseURL':'https://api.siliconflow.cn/v1'}]):
   self.assertEqual(m.live_request_config(cfg,'detect')['thinking'],'off')
   answer=m.live_request_config(cfg,'answer');self.assertEqual(answer['thinking'],'off');self.assertEqual(answer['maxTokens'],1200)
   self.assertEqual(m.live_request_config(dict(cfg,live={'answerThinking':'inherit'}),'answer')['thinking'],'off')
 def test_other_providers_are_not_silently_given_vendor_specific_parameters(self):
  cfg={'thinking':'omit','maxTokens':800,'text':{'providerId':'other','model':'example'}}
  with patch.object(m,'providers',return_value=[{'id':'other','baseURL':'https://example.com/v1'}]):
   self.assertEqual(m.live_request_config(cfg,'answer')['thinking'],'omit')
   self.assertEqual(m.live_request_config(dict(cfg,live={'answerThinking':'off'}),'answer')['thinking'],'off')
 def test_in_flight_duplicate_reuses_original_answer_object_and_id(self):
  sid=m.uid();analysis={'answerPending':True,'answer':'等待中'}
  self.assertIsNone(m.reusable_question(sid,'为什么基圆内没有渐开线？',0,'first',analysis))
  reused=m.reusable_question(sid,'为什么基圆内没有渐开线呢？',20,'second',{})
  self.assertEqual(reused['id'],'first')
  analysis.update(answer='已完成原题答案',answerPending=False)
  self.assertEqual(reused['analysis']['answer'],'已完成原题答案')
  self.assertIsNone(m.reusable_question(sid,'为什么基圆内没有渐开线？',80,'third',{}))
 def test_questions_with_different_numbers_or_math_operators_are_not_merged(self):
  sid=m.uid()
  for i,text in enumerate(['请计算机构里第一题的 x+1 等于多少？','请计算机构里第二题的 x+1 等于多少？','请计算机构里第二题的 x-1 等于多少？','请计算机构里第二题的 y-1 等于多少？']):
   self.assertIsNone(m.reusable_question(sid,text,i*10,str(i),{}))
 def test_final_answer_payload_has_enable_thinking_false(self):
  cfg={'thinking':'omit','text':{'providerId':'sf','model':'deepseek-ai/DeepSeek-V4.1-Flash'}}
  captured=[]
  def fake_request(cfg,role,path,body,content='application/json'):
   captured.append(json.loads(body));return {'choices':[{'message':{'content':'简明答案'},'finish_reason':'stop'}],'usage':{}}
  with patch.object(m,'providers',return_value=[{'id':'sf','baseURL':'https://api.siliconflow.cn/v1'}]),patch.object(m,'resolve',return_value=({},'synthetic-credential','deepseek-ai/DeepSeek-V4.1-Flash')),patch.object(m,'request',side_effect=fake_request):
   m.chat(m.live_request_config(cfg,'answer'),'请简短回答','人工测试')
  self.assertIs(captured[0]['enable_thinking'],False)

if __name__=='__main__':unittest.main()
