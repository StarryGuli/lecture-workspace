"""Adaptive and live gating contracts; synthetic PCM and fake providers, no paid calls."""
import hashlib, json, unittest
from unittest.mock import patch
import test_silence
m = test_silence.m

class AdaptiveGateTests(unittest.TestCase):
    setUp = test_silence.SilenceTests.setUp
    make = test_silence.SilenceTests.make
    automatic = {'silence': {'thresholdMode': 'auto'}}

    def ingest(self, seq, start, parts):
        self.make(parts)
        m.ingest(self.sid, seq, start, self.path.read_bytes())
        with m.db() as c:
            return c.execute('SELECT * FROM chunks WHERE session=? AND seq=?', (self.sid, seq)).fetchone()

    def test_each_recording_recalibrates_instead_of_reusing_threshold(self):
        self.make([(6,.0002),(6,.02)])
        quiet = m.audio_gate.curve(self.path,self.automatic)
        self.make([(6,.002),(6,.1)])
        louder = m.audio_gate.curve(self.path,self.automatic)
        self.assertIsNotNone(quiet['recommendedDb'])
        self.assertGreater(louder['recommendedDb'],quiet['recommendedDb'])
        self.assertLess(louder['recommendedDb'],louder['quality']['quietSoundDb'])

    def test_short_or_unseparated_keeps_quiet_input_not_old_threshold(self):
        self.make([(2,.0008)])
        result=m.audio_gate.plan(self.path,{'silence':{'thresholdMode':'auto','thresholdDb':-20}})
        self.assertEqual(result['settings']['thresholdDb'],-80)
        self.assertAlmostEqual(result['sentSeconds'],2)
        self.assertIsNone(result['calibration']['recommendedDb'])

    def test_manual_override_and_disabled_gate_remain_exact(self):
        self.make([(4,0),(4,.001),(4,0)])
        blocked=m.audio_gate.plan(self.path,{'silence':{'thresholdMode':'manual','thresholdDb':-30}})
        kept=m.audio_gate.plan(self.path,{'silence':{'thresholdMode':'manual','thresholdDb':-75}})
        self.assertEqual(blocked['sentSeconds'],0)
        self.assertGreater(kept['sentSeconds'],0)
        self.assertEqual(m.audio_gate.plan(self.path,{'silence':{'thresholdMode':'auto','enabled':False}})['sentSeconds'],12)

    def test_auto_silence_never_calls_any_remote_provider(self):
        row=self.ingest(0,42,[(12,0)])
        before=hashlib.sha256(self.path.read_bytes()).hexdigest()
        with patch.object(m,'transcribe',side_effect=AssertionError('silence sent')),patch.object(m,'chat',side_effect=AssertionError('silence analyzed')):
            result=m.realtime_transcribe(self.sid,{'seq':0,'config':self.automatic},lambda _:None)
            assist=m.live(self.sid,{'seq':0,'config':self.automatic},lambda _:None)
        self.assertTrue(result['skipped']);self.assertTrue(assist['skipped'])
        self.assertEqual(result['segments'][0]['start'],42)
        self.assertEqual(result['segments'][0]['end'],54)
        self.assertEqual(before,hashlib.sha256(self.path.read_bytes()).hexdigest())

    def test_recent_calibration_bounded_and_no_future_chunks(self):
        first=self.ingest(0,0,[(6,.0002),(6,.02)])
        initial=m.live_gate(self.sid,first,self.automatic)
        for seq in range(1,8): self.ingest(seq,seq*12,[(6,.004),(6,.15)])
        repeat=m.live_gate(self.sid,first,self.automatic)
        self.assertEqual(initial['settings'],repeat['settings'])
        with m.db() as c: last=c.execute('SELECT * FROM chunks WHERE session=? AND seq=7',(self.sid,)).fetchone()
        recent=m.live_gate(self.sid,last,self.automatic)
        self.assertEqual(recent['calibration']['windowSeconds'],60)
        self.assertGreater(recent['settings']['thresholdDb'],initial['settings']['thresholdDb'])
        preview=m.silence_preview(self.sid,self.automatic,recent=True)
        self.assertEqual(preview['duration'],60)
        self.assertFalse('original.wav' in str(preview))

    def test_realtime_transcript_only_asr_is_idempotent_and_snapshot_preserves_gaps(self):
        self.ingest(0,0,[(12,.02)])
        self.ingest(1,12,[(12,.02)])  # simulated manual model pause
        self.ingest(2,24,[(12,.02)])
        with patch.object(m,'transcribe',return_value='逐字原话，包含公式。') as asr,patch.object(m,'chat',side_effect=AssertionError('No summary during ASR')):
            first=m.realtime_transcribe(self.sid,{'seq':0,'config':self.automatic},lambda _:None)
            repeated=m.realtime_transcribe(self.sid,{'seq':0,'config':self.automatic},lambda _:None)
            last=m.realtime_transcribe(self.sid,{'seq':2,'config':self.automatic},lambda _:None)
        self.assertEqual(first['revision'],repeated['revision'])
        self.assertEqual(asr.call_count,2)
        snap=m.transcript_snapshot(self.sid)
        raw=next(r for r in m.detail(self.sid)['revisions'] if r['id']==snap['revision'])
        self.assertEqual([s['start'] for s in raw['content']['segments']],[0,12,24])
        self.assertTrue(raw['content']['segments'][1]['unprocessed'])
        self.assertNotIn('skipped',raw['content']['segments'][1])
        self.assertEqual(raw['content']['segments'][-1]['text'],'逐字原话，包含公式。')
        self.assertEqual(raw['content']['segments'][-1]['end'],36)

    def test_invalid_threshold_mode_rejected(self):
        with self.assertRaises(ValueError): m.audio_gate.settings({'silence':{'thresholdMode':'guess'}})

if __name__ == '__main__': unittest.main()
