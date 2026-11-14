"""Storage and job contracts. No API calls, no user recordings."""
import importlib.util, json, os, pathlib, tempfile, unittest, wave, io
TMP=tempfile.TemporaryDirectory()
os.environ['LECTURE_DEMO_DATA']=TMP.name
spec=importlib.util.spec_from_file_location('demo',pathlib.Path(__file__).with_name('server.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class StorageTests(unittest.TestCase):
 def setUp(self):
  self.sid=m.uid()
  with m.db() as c:c.execute('INSERT INTO sessions(id,title,mode,created) VALUES(?,?,?,?)',(self.sid,'test','class',m.now()))
 def wav(self,n=16000):
  b=io.BytesIO()
  with wave.open(b,'wb') as w:w.setparams((1,2,16000,0,'NONE','not compressed'));w.writeframes(b'\0\0'*n)
  return b.getvalue()
 def test_idempotent_chunks_and_missing_chunk(self):
  b=self.wav();m.ingest(self.sid,0,0,b);m.ingest(self.sid,0,0,b)
  m.ingest(self.sid,2,2,b)
  with self.assertRaises(ValueError):m.assemble(self.sid)
  m.ingest(self.sid,1,1,b);self.assertEqual(m.assemble(self.sid)['seconds'],3)
  with wave.open(str(m.session_dir(self.sid)/'original.wav')) as w:self.assertEqual(w.getnframes(),48000)
 def test_versions_immutable_and_reanalysis(self):
  r=m.save_revision(self.sid,'raw',{'text':'[00:00] 原稿','segments':[{'start':0,'text':'原稿'}]}, {})
  calls=[]
  def fake(cfg,sys,text):calls.append((sys,text));return ('结果'+str(len(calls)),{})
  old=m.chat;m.chat=fake
  try:
   for prompt in ['保留全部','修改提示词']:
    m.organize(self.sid,{'config':{},'source':r,'prompt':prompt,'kind':'verbatim'},lambda _:None)
  finally:m.chat=old
  ds=m.detail(self.sid)['revisions'];self.assertEqual(len(ds),3);self.assertEqual(ds[0]['content']['text'],'[00:00] 原稿');self.assertNotEqual(ds[1]['content']['prompt'],ds[2]['content']['prompt'])
 def test_documents_true_pages_and_offset(self):
  d=m.import_document(self.sid,'notes.txt','机构自由度\f渐开线：基圆内没有渐开线'.encode(),18)
  self.assertEqual(d['pages'],2)
  r=m.candidates(self.sid,'基圆内没有渐开线')[0];self.assertEqual(r['page'],2);self.assertEqual(r['printedPage'],20)
 def test_live_unknown_page_does_not_fabricate_match(self):
  m.ingest(self.sid,0,0,self.wav())
  oldasr,oldchat=m.transcribe,m.chat
  m.transcribe=lambda *a:'老师问：为什么？'
  m.chat=lambda *a:(json.dumps({'candidateIndex':99,'isQuestion':True,'confidence':.95,'questionType':'student-question','question':'为什么？'}),{})
  try:r=m.live(self.sid,{'seq':0,'config':{'silence':{'enabled':False}}},lambda _:None)
  finally:m.transcribe,m.chat=oldasr,oldchat
  self.assertIsNone(r['analysis']['match']);self.assertTrue(r['analysis']['isQuestion'])
 def test_safe_paths_and_different_duplicate_rejected(self):
  with self.assertRaises(ValueError):m.session_dir('../outside')
  m.ingest(self.sid,0,0,self.wav())
  with self.assertRaises(ValueError):m.ingest(self.sid,0,0,self.wav(8000))
class HTTPTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  import threading
  cls.http=m.ThreadingHTTPServer(('127.0.0.1',0),m.Handler)
  cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
  cls.base='http://127.0.0.1:'+str(cls.http.server_port)
 @classmethod
 def tearDownClass(cls):cls.http.shutdown();cls.http.server_close()
 def post(self,path,body,header=True):
  import urllib.request
  h={'Content-Type':'application/json'}
  if header:h['X-Lecture-Demo']='1'
  return urllib.request.urlopen(urllib.request.Request(self.base+path,data=json.dumps(body).encode(),headers=h))
 def test_http_sample_export_and_call_consent(self):
  import urllib.request,urllib.error
  d=json.load(self.post('/api/sample',{}));sid=d['id']
  result=json.load(urllib.request.urlopen(self.base+'/api/sessions/'+sid+'/export'))
  self.assertTrue(result['revisions'][0]['content']['sample'])
  self.assertEqual(len(result['documents']),1)
  with self.assertRaises(urllib.error.HTTPError) as cm:self.post('/api/sessions/'+sid+'/transcribe',{'config':{}})
  self.assertEqual(cm.exception.code,400)
 def test_silence_preview_without_paid_consent(self):
  import urllib.request,time
  sid=json.load(self.post('/api/sessions',{'title':'synthetic preview'}))['id']
  req=urllib.request.Request(self.base+'/api/sessions/'+sid+'/upload',data=StorageTests.wav(self),headers={'X-Lecture-Demo':'1','Content-Type':'audio/wav'})
  json.load(urllib.request.urlopen(req))
  jid=json.load(self.post('/api/sessions/'+sid+'/silence-preview',{'config':{}}))['job']
  deadline=time.monotonic()+5
  while time.monotonic()<deadline:
   j=json.load(urllib.request.urlopen(self.base+'/api/jobs/'+jid))
   if j['status']!='running':break
   time.sleep(.01)
  self.assertEqual(j['status'],'done')
  self.assertEqual(j['result']['sentSeconds'],0)
  self.assertEqual(j['result']['duration'],1)
 def test_cross_site_mutation_rejected(self):
  import urllib.error
  with self.assertRaises(urllib.error.HTTPError) as cm:self.post('/api/sample',{},False)
  self.assertEqual(cm.exception.code,403)
 def test_upload_convert_and_audio_download(self):
  import urllib.request
  if not m.shutil.which('ffmpeg'):self.skipTest('ffmpeg unavailable')
  sid=json.load(self.post('/api/sessions',{'title':'synthetic upload'}))['id']
  raw=StorageTests.wav(self)
  req=urllib.request.Request(self.base+'/api/sessions/'+sid+'/upload',data=raw,headers={'X-Lecture-Demo':'1','Content-Type':'audio/wav'})
  self.assertTrue(json.load(urllib.request.urlopen(req))['saved'])
  audio=urllib.request.urlopen(self.base+'/api/sessions/'+sid+'/audio').read()
  with wave.open(io.BytesIO(audio)) as w:self.assertEqual(w.getnframes(),16000)
if __name__=='__main__': unittest.main()
