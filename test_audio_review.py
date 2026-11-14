"""Acoustic review must reconstruct original bytes and exclude model-paused rows."""
import json,unittest,wave
from unittest.mock import patch
import test_silence
m=test_silence.m
class AudioReviewTests(unittest.TestCase):
 setUp=test_silence.SilenceTests.setUp
 make=test_silence.SilenceTests.make
 def prepare(self):
  self.make([(2,.05)]);blob=self.path.read_bytes();cfg={'asr':{'providerId':'p','model':'m'},'live':{'correctTranscript':False}}
  for i in range(2):
   m.ingest(self.sid,i,i*2,blob)
   m.save_revision(self.sid,'live-transcript',{'seq':i,'segments':[{'start':i*2,'end':i*2+2,'text':'片段原文'}]},cfg)
  return blob,cfg
 def test_reassembles_original_samples_and_reuses_successful_review(self):
  blob,cfg=self.prepare()
  with wave.open(str(self.path),'rb') as w:original=w.readframes(w.getnframes())
  def recognize(_,path):
   with wave.open(str(path),'rb') as w:self.assertEqual(w.readframes(w.getnframes()),original+original)
   return '完整声音上下文'
  with patch.object(m,'transcribe',side_effect=recognize) as call:
   result=m.review_live_audio(self.sid,{'config':cfg},lambda _:None)
   m.review_live_audio(self.sid,{'config':cfg},lambda _:None)
  self.assertEqual(call.call_count,1)
  with m.db() as c:final=json.loads(c.execute('SELECT content FROM revisions WHERE id=?',(result['revision'],)).fetchone()['content'])
  self.assertTrue(final['audioReviewed']);self.assertIn('完整声音上下文',final['text'])
 def test_missing_model_interval_is_not_backfilled(self):
  blob,cfg=self.prepare()
  with m.db() as c:c.execute('DELETE FROM revisions WHERE session=? AND kind="live-transcript"',(self.sid,))
  m.save_revision(self.sid,'live-transcript',{'seq':0,'segments':[{'start':0,'end':2,'text':'已处理内容'}]},cfg)
  with patch.object(m,'transcribe') as call:result=m.review_live_audio(self.sid,{'config':cfg},lambda _:None)
  self.assertEqual(call.call_count,0)
  with m.db() as c:final=json.loads(c.execute('SELECT content FROM revisions WHERE id=?',(result['revision'],)).fetchone()['content'])
  self.assertTrue(final['segments'][-1]['unprocessed'])
if __name__=='__main__':unittest.main()
