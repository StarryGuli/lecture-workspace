import test from 'node:test';import assert from 'node:assert/strict';
import {acousticDelta,allowAcousticContext,visibleAcousticParts} from './static/mobile-asr-context.mjs';
import {MobileRuntime,DEFAULT_CONFIG} from './static/mobile-runtime.mjs';import {MemoryStore} from './static/mobile-store.mjs';import {wavFromPCM,decodeWav} from './static/mobile-audio.mjs';
test('delta alignment tolerates revised terms but retains repeated new speech',()=>{
 const p='这个液空口的压力取决于弹簧压力。',c='这个液控口的压力取决于弹簧压力。再说一次，弹簧压力。';
 const d=acousticDelta(p,c);assert.equal(d.text,'再说一次，弹簧压力。');assert.equal(d.prefix+d.text,c);
 assert.equal(acousticDelta('完全不同的历史课程内容不能串词','这次课程毫不相关而且老师正在讲新内容'),null);
});
test('repeated audio has a bounded budget and cannot cross the gateway size limit',()=>{
 assert.equal(allowAcousticContext({sentSeconds:531,sourceSeconds:283,nextSeconds:27,blockSeconds:310}),true);
 assert.equal(allowAcousticContext({sentSeconds:90,sourceSeconds:30,nextSeconds:6,blockSeconds:36}),false);
 assert.equal(allowAcousticContext({sentSeconds:0,sourceSeconds:1000,nextSeconds:10,blockSeconds:1001}),false);
});
async function fixture(){const store=new MemoryStore(),r=new MobileRuntime({store,keyring:{key:async()=>''}}),cfg={...structuredClone(DEFAULT_CONFIG),silence:{enabled:false},live:{retainTranscript:true,correctTranscript:false}};await store.put('sessions',{id:'lesson'});const voice=Int16Array.from({length:32000},(_,i)=>Math.sin(i)*2000);for(let seq=0;seq<3;seq++)await store.put('chunks',{id:'lesson:'+seq,session:'lesson',seq,start:seq*2,duration:2,blob:wavFromPCM(voice)});return {store,r,cfg};}
test('continuous audio context revises old words without duplicating visible transcript or question text',async()=>{
 const {store,r,cfg}=await fixture(),seconds=[];
 r.model.transcribe=async(c,blob,n)=>{seconds.push(n);assert.equal(decodeWav(await blob.arrayBuffer()).pcm.length,n*16000);return seconds.length===1?'这个液空口的压力取决于弹簧压力。':'这个液控口的压力取决于弹簧压力。老师接下来提出什么问题？';};
 for(let i=0;i<2;i++){const row=await store.get('chunks','lesson:'+i),raw=await r.recognize('lesson',row,cfg,()=>{});await r.revision('lesson','live-transcript',raw,cfg);}
 assert.deepEqual(seconds,[2,4]);const parts=(await r.rows('revisions','lesson')).map(x=>x.content),shown=visibleAcousticParts(parts);assert.equal(shown.length,1);assert.match(shown[0].segments[0].text,/液控口/);assert.equal(shown[0].text,'老师接下来提出什么问题？');
 const context=await r.previousContext('lesson',4);assert.equal(context.segments.length,1);
 const snapshot=await r.snapshot('lesson'),saved=await store.get('revisions',snapshot.revision);assert.equal(saved.content.segments.filter(s=>!s.unprocessed).length,1);assert.match(saved.content.text,/液控口/);
});
test('a model-paused gap or a model change starts a new acoustic context',async()=>{
 const {store,r,cfg}=await fixture(),seconds=[];r.model.transcribe=async(c,b,n)=>{seconds.push(n);return '这是一段完整的历史课堂内容。';};
 const raw=await r.recognize('lesson',await store.get('chunks','lesson:0'),cfg,()=>{});await r.revision('lesson','live-transcript',raw,cfg);
 const next=await r.recognize('lesson',await store.get('chunks','lesson:2'),cfg,()=>{});assert.deepEqual(next.replacedSequences,[]);assert.deepEqual(seconds,[2,2]);
 const changed=await r.recognize('lesson',await store.get('chunks','lesson:1'),{...cfg,asr:{...cfg.asr,model:'other'}},()=>{});assert.deepEqual(changed.replacedSequences,[]);
});
test('only current delta goes into correction and detection, while revised history remains visible',async()=>{
 const {store,r,cfg}=await fixture();cfg.live.correctTranscript=true;
 r.model.transcribe=async(c,b,n)=>n===2?'这是一段完整的历史课堂讲解。':'这是一段完整的历史课堂讲解。现在问新的问题。';
 for(let i=0;i<2;i++){const raw=await r.recognize('lesson',await store.get('chunks','lesson:'+i),cfg,()=>{});await r.revision('lesson','live-transcript',raw,cfg);if(i===1){r.model.chat=async(c,s,p)=>{assert.equal(p.segments[0].text,'现在问新的问题。');return JSON.stringify({segments:[{id:0,text:'现在问一道新的问题。'}]});};const out=await r.correct('lesson',[raw],cfg,()=>{});assert.match(out.segments[0].text,/历史课堂讲解/);assert.match(out.segments[0].text,/一道新的问题/);assert.doesNotMatch(out.analysisText,/历史课堂讲解/);}}
});
test('disabled transcript retention keeps acoustic context only in memory',async()=>{
 const {store,r,cfg}=await fixture(),sid=(await r.api('/api/sessions',{mode:'class'})).id;cfg.live.retainTranscript=false;const seconds=[];
 for(const row of await r.rows('chunks','lesson'))await store.put('chunks',{...row,id:sid+':'+row.seq,session:sid});
 r.model.transcribe=async(c,b,n)=>{seconds.push(n);return n===2?'这是一段完整的历史课堂讲解。':'这是一段完整的历史课堂讲解。现在开始新的一句。';};
 for(let seq=0;seq<2;seq++)await r.live(sid,{seq,reason:'sentence',config:cfg},()=>{},true);
 assert.deepEqual(seconds,[2,4]);assert.equal((await r.rows('revisions',sid)).length,0);
 await r.api('/api/sessions/'+sid+'/complete-live',{});assert.equal(r.context.has(sid),false);
});
test('classroom analysis cannot persist hidden acoustic transcript fields when retention is disabled',async()=>{
 const {r,cfg}=await fixture();cfg.live.retainTranscript=false;
 r.model.transcribe=async()=> '只允许暂存在内存的本节课堂逐字内容';
 r.model.chat=async()=>JSON.stringify({isQuestion:false,topic:'课堂知识点'});
 await r.live('lesson',{seq:0,reason:'sentence',config:cfg},()=>{});
 const rows=await r.rows('revisions','lesson');assert.equal(rows.length,1);
 assert.doesNotMatch(JSON.stringify(rows),/只允许暂存在内存/);assert.equal(rows[0].content.acousticText,undefined);assert.equal(rows[0].content.contextPrefix,undefined);assert.equal(rows[0].content.analysisSegments,undefined);
});
