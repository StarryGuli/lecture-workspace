import test from 'node:test';import assert from 'node:assert/strict';
import {RecordingJournal} from './static/mobile-recording-journal.mjs';import {MemoryStore,audioBlob} from './static/mobile-store.mjs';import {wavFromPCM,decodeWav} from './static/mobile-audio.mjs';import {MobileRuntime} from './static/mobile-runtime.mjs';
import {RecordingLease} from './static/mobile-recording-lease.mjs';
const voice=n=>Int16Array.from({length:n},(_,i)=>(i%15000)-7500);
async function store(){const s=new MemoryStore();await s.put('sessions',{id:'lesson',status:'recording'});return s;}
test('a fresh runtime restores a long unfinished utterance without sending it to ASR',async()=>{
 const s=await store(),j=new RecordingJournal(s),pcm=voice(24000);j.append('lesson',0,pcm);await j.flush();
 const restored=await new RecordingJournal(s).recover('lesson');assert.equal(restored.seconds,1.5);assert.equal(restored.nextSequence,1);
 const file=await audioBlob(s,'lesson');assert.deepEqual(decodeWav(await file.arrayBuffer()).pcm,pcm);
 const again=await new RecordingJournal(s).recover('lesson');assert.equal(again.recoveredSeconds,0);assert.equal(again.nextSequence,1);
});
test('overlapping journals trim the already committed prefix instead of duplicating audio',async()=>{
 const s=await store(),pcm=voice(24000),j=new RecordingJournal(s);j.append('lesson',0,pcm);await j.flush();
 const old=wavFromPCM(pcm.slice(0,16000));await s.put('chunks',{id:'lesson:0',session:'lesson',seq:0,start:0,duration:1,blob:old});
 const info=await new RecordingJournal(s).recover('lesson');assert.equal(info.seconds,1.5);assert.equal(info.nextSequence,2);
 assert.deepEqual(decodeWav(await(await audioBlob(s,'lesson')).arrayBuffer()).pcm,pcm);assert.deepEqual(await (await s.get('chunks','lesson:0')).blob.arrayBuffer(),await old.arrayBuffer());
});
test('half-second durability fragments rejoin into one utterance, not repeated short ASR requests',async()=>{
 const s=await store(),j=new RecordingJournal(s);for(let i=0;i<20;i++)j.append('lesson',i*.5,voice(8000),true);await j.flush();
 const info=await new RecordingJournal(s).recover('lesson');assert.equal(info.seconds,10);assert.equal(info.nextSequence,1);assert.equal((await s.all('chunks')).filter(r=>!r.temporary).length,1);
});
test('model-paused sound remains in the raw audio and never becomes eligible for analysis on recovery',async()=>{
 const s=await store(),j=new RecordingJournal(s);j.append('lesson',0,voice(8000),true);j.append('lesson',.5,voice(8000),false);await j.flush();
 await new RecordingJournal(s).recover('lesson');const rows=(await s.all('chunks')).filter(r=>!r.temporary).sort((a,b)=>a.seq-b.seq);assert.deepEqual(rows.map(r=>r.analyze),[true,false]);assert.equal(rows[1].start,.5);
});
test('resume continues sequence and recorded-audio time, preserving the source and marking missing refresh time',async()=>{
 const s=await store(),j=new RecordingJournal(s);j.append('lesson',0,voice(32000));await j.flush();
 const r=new MobileRuntime({store:s,keyring:{},fetcher:async()=>{throw Error('Recovery must not call a provider');}});
 const info=await r.resumeRecording('lesson');assert.equal(info.nextSequence,1);assert.equal(info.seconds,2);assert.equal((await s.get('sessions','lesson')).status,'recording');
 assert.equal((await s.all('marks'))[0].seconds,2);assert.equal((await r.rows('chunks','lesson')).length,1);
});
test('gaps retain recovery data and completed recordings cannot silently reopen for append',async()=>{
 const s=await store();await s.put('chunks',{id:'lesson:1',session:'lesson',seq:1,start:1,duration:1,blob:wavFromPCM(voice(16000))});
 await assert.rejects(new RecordingJournal(s).recover('lesson'),/缺口/);assert.ok(await s.get('chunks','lesson:1'));
 await s.delete('chunks','lesson:1');await s.put('sessions',{id:'lesson',status:'saved'});const r=new MobileRuntime({store:s,keyring:{}});await assert.rejects(r.resumeRecording('lesson'),/尚未结束/);
});
test('another tab cannot promote an actively recorded journal or acquire its microphone writer lock',async()=>{
 const held=new Set(),manager={request:async(name,options,fn)=>{if(held.has(name))return fn(null);held.add(name);try{return await fn({name});}finally{held.delete(name);}},query:async()=>({held:[...held].map(name=>({name}))})};
 const s=await store(),j=new RecordingJournal(s);j.append('lesson',0,voice(8000));await j.flush();const owner=new RecordingLease(manager);assert.equal(await owner.acquire('lesson'),true);
 const other=new RecordingLease(manager);assert.equal(await other.acquire('lesson'),false);
 const r=new MobileRuntime({store:s,keyring:{}});r.recordingLease=other;assert.equal((await r.recoverRecording('lesson')).busy,true);assert.equal((await r.rows('chunks','lesson')).length,0);
 await owner.release();assert.equal((await r.recoverRecording('lesson')).seconds,.5);assert.equal(await other.acquire('lesson'),true);await other.release();
});
