"""Synthetic PCM tests: filtering must reduce submitted duration without moving source offsets."""
import array, hashlib, importlib, io, math, pathlib, tempfile, unittest, wave
import test_server
m=test_server.m
import audio_gate

class SilenceTests(unittest.TestCase):
 def setUp(self):
  self.sid=m.uid()
  with m.db() as c:c.execute('INSERT INTO sessions(id,title,mode,created) VALUES(?,?,?,?)',(self.sid,'synthetic silence tests','class',m.now()))
  self.path=m.session_dir(self.sid)/'original.wav'
 def make(self,parts):
  pcm=array.array('h')
  for seconds,amplitude in parts:
   pcm.extend(int(32767*amplitude*math.sin(2*math.pi*440*i/16000)) for i in range(round(seconds*16000)))
  with wave.open(str(self.path),'wb') as w:w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(pcm.tobytes())
 def test_padding_and_original_timestamps(self):
  self.make([(2,0),(1,.1),(4,0),(1,.1),(2,0)])
  before=hashlib.sha256(self.path.read_bytes()).digest()
  p=audio_gate.plan(self.path,{})
  self.assertEqual(p['duration'],10)
  self.assertAlmostEqual(p['sentSeconds'],3.4,places=2)
  self.assertAlmostEqual(p['ranges'][1]['start'],6.65,places=2)
  self.assertAlmostEqual(p['skippedSeconds']+p['sentSeconds'],10)
  self.assertEqual(before,hashlib.sha256(self.path.read_bytes()).digest())
 def test_lower_threshold_retains_quiet_voice(self):
  self.make([(2,0),(1,.001),(2,0)])
  high=audio_gate.plan(self.path,{'silence':{'thresholdDb':-55}})
  low=audio_gate.plan(self.path,{'silence':{'thresholdDb':-70}})
  self.assertEqual(high['requestCount'],0)
  self.assertGreater(low['sentSeconds'],0)
 def test_short_pauses_preserved(self):
  self.make([(1,.1),(.7,0),(1,.1)])
  p=audio_gate.plan(self.path,{})
  self.assertAlmostEqual(p['sentSeconds'],2.7)
  self.assertEqual(p['requestCount'],1)
 def test_disabled_keeps_entire_silence(self):
  self.make([(4,0)])
  p=audio_gate.plan(self.path,{'silence':{'enabled':False}})
  self.assertEqual(p['sentSeconds'],4);self.assertEqual(p['skippedSeconds'],0)
 def test_silent_offline_and_live_never_call_remote(self):
  self.make([(4,0)])
  cfg={};oldasr,oldchat=m.transcribe,m.chat
  def forbidden(*args):raise AssertionError('silent audio must not be sent to AI')
  m.transcribe=m.chat=forbidden
  try:
   r=m.transcribe_all(self.sid,cfg,lambda _:None)
   self.assertEqual(r['silence']['sentSeconds'],0)
   content=m.detail(self.sid)['revisions'][0]['content']
   self.assertEqual(content['segments'][0]['end'],4)
   m.ingest(self.sid,0,100,self.path.read_bytes())
   r=m.live(self.sid,{'seq':0,'config':cfg},lambda _:None)
   self.assertTrue(r['skipped']);self.assertEqual(r['segments'][0]['start'],100)
   self.assertEqual(r['segments'][0]['end'],104)
  finally:m.transcribe,m.chat=oldasr,oldchat
 def test_remote_audio_lengths_and_mapping(self):
  self.make([(2,0),(1,.1),(4,0),(1,.1),(2,0)])
  sent=[];old=m.transcribe
  def fake(cfg,path):
   with wave.open(str(path)) as w:sent.append(w.getnframes()/w.getframerate())
   return '模拟人声'
  m.transcribe=fake
  try:r=m.transcribe_all(self.sid,{},lambda _:None)
  finally:m.transcribe=old
  self.assertEqual(len(sent),2);self.assertAlmostEqual(sum(sent),3.4)
  segments=m.detail(self.sid)['revisions'][0]['content']['segments']
  self.assertEqual(len([x for x in segments if x['skipped']]),3)
  self.assertAlmostEqual([x for x in segments if not x['skipped']][1]['start'],6.65)
 def test_invalid_parameters_rejected(self):
  for value in [float('nan'),float('inf'),-5,-90]:
   with self.assertRaises(ValueError):audio_gate.settings({'silence':{'thresholdDb':value}})
 def test_delayed_close_keeps_the_wait_and_carries_remaining_time(self):
  self.make([(1,.1),(10,0)])
  config={'silence':{'thresholdDb':-55,'minSilence':3,'padding':.35,'preRoll':1,'holdBeforeSkip':True}}
  result=audio_gate.plan(self.path,config)
  self.assertAlmostEqual(result['ranges'][0]['end'],4)
  self.assertAlmostEqual(result['skipped'][0]['start'],4)
  self.make([(5,0)])
  silence=audio_gate.plan(self.path,config)
  carried=audio_gate.extend_initial_hold(silence,1.8)
  self.assertAlmostEqual(carried['sentSeconds'],1.8)
  self.assertAlmostEqual(carried['skipped'][0]['start'],1.8)

if __name__=='__main__':unittest.main()
