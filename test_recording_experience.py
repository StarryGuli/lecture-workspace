"""Local recording experience: titles, pause buffers and original timeline protection."""
import array,hashlib,io,math,unittest,wave
from unittest.mock import patch
import test_server
m=test_server.m
class ExperienceTests(unittest.TestCase):
 setUp=test_server.StorageTests.setUp
 def wav(self,seconds,amplitude=0):
  pcm=array.array('h',(int(32767*amplitude*math.sin(i*.2)) for i in range(int(seconds*16000))))
  b=io.BytesIO()
  with wave.open(b,'wb') as w:w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(pcm.tobytes())
  return b.getvalue()
 def row(self,seq):
  with m.db() as c:return c.execute('select * from chunks where session=? and seq=?',(self.sid,seq)).fetchone()
 def test_preroll_restores_unsent_previous_tail_without_duplicating_original_audio(self):
  cfg={'silence':{'thresholdMode':'manual','thresholdDb':-40,'minSilence':.5,'padding':.15,'preRoll':.5}}
  m.ingest(self.sid,0,0,self.wav(2));m.ingest(self.sid,1,2,self.wav(2,.1))
  before=hashlib.sha256(m.chunk_path(self.row(0)['path']).read_bytes()).digest()
  first=self.row(0);m.recognize_live_ranges(self.sid,first,cfg,lambda _:None,m.live_gate(self.sid,first,cfg))
  lengths=[]
  def asr(cfg,path):
   with wave.open(str(path),'rb') as w:lengths.append(w.getnframes()/16000)
   return '完整讲话'
  current=self.row(1)
  with patch.object(m,'transcribe',side_effect=asr):segments,gate=m.recognize_live_ranges(self.sid,current,cfg,lambda _:None,m.live_gate(self.sid,current,cfg))
  self.assertEqual(lengths,[2.5]);self.assertEqual(segments[0]['start'],1.5)
  self.assertEqual(gate['preRollSeconds'],.5);self.assertEqual(m.assemble(self.sid)['seconds'],4)
  self.assertEqual(before,hashlib.sha256(m.chunk_path(self.row(0)['path']).read_bytes()).digest())
 def test_unprocessed_previous_chunk_cannot_be_backfilled_after_model_pause(self):
  cfg={'silence':{'thresholdDb':-40,'preRoll':1}}
  m.ingest(self.sid,0,0,self.wav(2));m.ingest(self.sid,1,2,self.wav(2,.1))
  row=self.row(1)
  with patch.object(m,'transcribe',return_value='继续讲话'):segments,gate=m.recognize_live_ranges(self.sid,row,cfg,lambda _:None,m.live_gate(self.sid,row,cfg))
  self.assertEqual(segments[0]['start'],2);self.assertNotIn('preRollSeconds',gate)
 def test_generated_titles_preserve_manual_titles_and_library_has_duration(self):
  with m.db() as c:c.execute('update sessions set title=? where id=?',('听课记录 · 2026/11/4',self.sid))
  m.maybe_auto_title(self.sid,{'sessionTitle':'人的现代化与法治建设'})
  with m.db() as c:self.assertEqual(c.execute('select title from sessions where id=?',(self.sid,)).fetchone()[0],'人的现代化与法治建设')
  m.session_dir(self.sid).joinpath('record-meta.json').write_text('{"manualTitle":true}')
  m.maybe_auto_title(self.sid,{'sessionTitle':'不应该覆盖'})
  m.ingest(self.sid,0,0,self.wav(2))
  entry=next(x for x in m.session_summaries() if x['id']==self.sid)
  self.assertEqual(entry['title'],'人的现代化与法治建设');self.assertEqual(entry['durationSeconds'],2);self.assertEqual(entry['audioLocation'],'service-device')
 def test_pause_duration_and_independent_pre_post_buffers(self):
  levels=[(i*320,(i+1)*320,-30 if i<50 or i>=135 else -80) for i in range(185)]
  p=m.audio_gate.from_scan(16000,59200,levels,m.audio_gate.settings({'silence':{'thresholdDb':-50,'minSilence':1.5,'padding':.2,'preRoll':.2}}))
  self.assertAlmostEqual(p['sentSeconds'],2.4);self.assertAlmostEqual(p['skippedSeconds'],1.3)
if __name__=='__main__':unittest.main()
