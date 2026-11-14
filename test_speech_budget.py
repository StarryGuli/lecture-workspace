"""Speech retention and observed budget regressions; no paid API calls."""
import datetime,unittest
import audio_gate,lesson_budget
class SpeechProtectionTests(unittest.TestCase):
 def test_uses_quiet_speech_retention_rather_than_loudest_cliff(self):
  rate=16000;levels=[];voice=[]
  # Quiet phrase, long background pause, louder phrase: raising to the loud cliff loses the quiet phrase.
  for i in range(1000):
   db=(-48+i%9*.2) if i<150 else (-65+i%20*.15) if i<700 else (-29+i%18*.25)
   levels.append((i*320,(i+1)*320,db))
   if i<150 or i>=700:voice.append((i*320,(i+1)*320,.9))
  r=audio_gate.analyze_scan(rate,320000,levels,{},speech=voice)
  self.assertEqual(r['speechProtection']['method'],'local-silero')
  chosen=next(p for p in r['curve'] if p['db']==r['recommendedDb'])
  self.assertGreaterEqual(chosen['quietSpeechRetained'],.995)
  self.assertGreater(chosen['sentSeconds'],9)
  self.assertLess(chosen['sentSeconds'],20)
  self.assertLess(r['recommendedDb'],-45)
 def test_speech_retention_fallback_is_explicit_when_no_speech_found(self):
  levels=[(i*320,(i+1)*320,-46+i%20*.1) for i in range(500)]
  r=audio_gate.analyze_scan(16000,160000,levels,{},speech=[])
  self.assertIsNone(r['recommendedDb']);self.assertIn('不足 2 秒',r['recommendationReason'])
 def test_ranges_measure_real_overlap_and_do_not_count_non_speech(self):
  import speech_activity as v
  self.assertEqual(v.retention([{'startFrame':0,'endFrame':50}],[(0,100,.9),(100,200,.01)]),.5)
class ObservedBudgetTests(unittest.TestCase):
 def row(self,second,cost=.004,model='m'):
  return {'created':(datetime.datetime(2026,11,4,10,tzinfo=datetime.timezone.utc)+datetime.timedelta(seconds=second)).isoformat(),'role':'correction','provider':'p','model':model,'price':{'currency':'CNY'},'cost':cost}
 def test_pace_uses_recent_higher_rate_and_does_not_call_unknown_cost_free(self):
  rows=[self.row(i) for i in range(0,121,3)]+[self.row(121,None)]
  r=lesson_budget.project_observed(rows,125,45,{'correction':{'providerId':'p','model':'m'}})
  self.assertTrue(r['available']);self.assertEqual(r['unpricedRequests'],1)
  self.assertGreaterEqual(r['perMinute']['CNY'],r['averagePerMinute']['CNY'])
  self.assertGreater(r['amounts']['CNY'],3)
 def test_short_sample_or_different_model_cannot_predict_current_configuration(self):
  cfg={'correction':{'providerId':'p','model':'m'}}
  self.assertFalse(lesson_budget.project_observed([self.row(0)],10,45,cfg)['available'])
  self.assertFalse(lesson_budget.project_observed([self.row(0,model='old')],120,45,cfg)['available'])
if __name__=='__main__':unittest.main()

class BalancedWakeTests(unittest.TestCase):
 def test_pause_supports_complete_question_but_is_not_a_question_alone(self):
  import question_policy as p
  cfg={'live':{'questionSensitivity':'balanced'},'_acoustic':{'pauseSeconds':1.1,'endedByPause':True}}
  self.assertIsNotNone(p.fast_hint('我们为什么要坚持全面依法治国？',cfg))
  self.assertIsNone(p.fast_hint('下面我们继续讲全面依法治国。',cfg))
  self.assertIsNone(p.fast_hint('为什么需要法治？因为这样可以保障权利。',cfg))
  self.assertIsNone(p.fast_hint('我们为什么要坚持全面依法治国？',{'live':{'questionSensitivity':'balanced'}}))
