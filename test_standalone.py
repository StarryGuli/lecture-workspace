"""Standalone storage contracts, using temporary data and synthetic credentials only."""
import io,json,pathlib,shutil,tempfile,unittest,wave
from unittest.mock import patch
from test_server import m

class StandaloneTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.addCleanup(self.tmp.cleanup)
  self.base=pathlib.Path(self.tmp.name)
  self.data=self.base/'first';self.data.mkdir()
  self.patcher=patch.object(m,'DATA',self.data);self.patcher.start();self.addCleanup(self.patcher.stop)
  self.data.joinpath('records.sqlite').touch()
  with m.db() as c:
   c.executescript('CREATE TABLE sessions(id TEXT PRIMARY KEY,title TEXT,mode TEXT,created TEXT,status TEXT);CREATE TABLE chunks(session TEXT,seq INTEGER,start REAL,duration REAL,path TEXT,PRIMARY KEY(session,seq));')
 def test_provider_and_settings_loaded_only_from_project(self):
  p={'id':'imported','name':'Imported','baseURL':'https://example.com/v1','webOnly':False}
  (self.data/'web-providers.json').write_text(json.dumps([p]))
  (self.data/'settings.json').write_text(json.dumps({'asr':{'providerId':'imported','model':'synthetic'}}))
  (self.data/'keys').mkdir();(self.data/'keys'/'imported').write_text('synthetic-credential')
  original=m.read_json;reads=[]
  def checked(path,fallback):
   self.assertTrue(path.is_relative_to(self.data));reads.append(path)
   return original(path,fallback)
  with patch.object(m,'read_json',side_effect=checked):
   self.assertEqual(m.config()['asr']['model'],'synthetic')
   entry=next(p for p in m.providers() if p['id']=='imported')
   self.assertEqual(m.key_for(entry),'synthetic-credential')
   self.assertTrue(entry['webOnly'])
   updated=m.save_web_provider(dict(entry,name='Changed',key='synthetic-replacement'))
   self.assertNotIn('synthetic-replacement',json.dumps(updated))
   self.assertEqual(m.key_for(entry),'synthetic-replacement')
  self.assertTrue(reads)
 def test_audio_still_assembles_after_entire_data_directory_moves(self):
  sid=m.uid()
  with m.db() as c:c.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(sid,'test','class',m.now(),'recording'))
  raw=io.BytesIO()
  with wave.open(raw,'wb') as w:w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(b'\0\0'*16000)
  m.ingest(sid,0,0,raw.getvalue())
  with m.db() as c:value=c.execute('SELECT path FROM chunks').fetchone()[0]
  self.assertFalse(pathlib.Path(value).is_absolute())
  moved=self.base/'moved';shutil.move(str(self.data),str(moved))
  with patch.object(m,'DATA',moved):
   self.assertEqual(m.assemble(sid)['seconds'],1)
   with wave.open(str(m.session_dir(sid)/'original.wav')) as w:self.assertEqual(w.getnframes(),16000)

if __name__=='__main__':unittest.main()
