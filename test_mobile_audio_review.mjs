import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewGroups} from './static/mobile-audio-review.mjs';
import {MobileRuntime,DEFAULT_CONFIG} from './static/mobile-runtime.mjs';
import {MemoryStore} from './static/mobile-store.mjs';
import {wavFromPCM,decodeWav} from './static/mobile-audio.mjs';
async function fixture(){
 const store=new MemoryStore(),runtime=new MobileRuntime({store,keyring:{key:async()=>''}}),config={...structuredClone(DEFAULT_CONFIG),live:{retainTranscript:true,correctTranscript:false}};
 await store.put('sessions',{id:'lesson'});
 const original=Int16Array.from({length:64000},(_,i)=>(i%1024)-512);
 for(let seq=0;seq<2;seq++){
  await store.put('chunks',{id:'lesson:'+seq,session:'lesson',seq,start:seq*2,duration:2,blob:wavFromPCM(original.slice(seq*32000,(seq+1)*32000))});
  await runtime.revision('lesson','live-transcript',{seq,start:seq*2,segments:[{start:seq*2,end:seq*2+2,text:'不完整实时识别'}]},config);
 }
 return {store,runtime,config,original};
}
test('final review sends byte-identical continuous original sound, not gated snippets; retries reuse ASR',async()=>{
 const f=await fixture();let calls=0;
 f.runtime.model.transcribe=async(cfg,blob,seconds)=>{calls++;assert.equal(seconds,4);assert.deepEqual(decodeWav(await blob.arrayBuffer()).pcm,f.original);return '完整上下文识别';};
 const result=await f.runtime.reviewLiveAudio('lesson',{config:f.config},()=>{});
 assert.equal(calls,1);assert.equal(result.requests,1);
 const final=await f.store.get('revisions',result.revision);assert.equal(final.kind,'verbatim');assert.equal(final.content.audioReviewed,true);assert.equal(final.content.timestampPrecision,'block');assert.match(final.content.text,/完整上下文识别/);
 await f.runtime.reviewLiveAudio('lesson',{config:f.config},()=>{});assert.equal(calls,1);
 assert.equal((await f.runtime.rows('revisions','lesson')).filter(r=>r.kind==='live-transcript').length,2);
});
test('paused model chunks are never included in acoustic review',async()=>{
 const f=await fixture();const rows=await f.runtime.rows('chunks','lesson'),parts=[{seq:0,segments:[]},{seq:2,segments:[]}];
 assert.deepEqual(reviewGroups([...rows,{seq:2,start:4,duration:2}],parts).map(g=>g.rows.map(r=>r.seq)),[[0],[2]]);
});
test('endpoint grouping never cuts a continuous utterance at the duration target',()=>{
 const rows=[{seq:0,start:0,duration:610},{seq:1,start:610,duration:5}],parts=rows.map(r=>({seq:r.seq,segments:[]}));
 assert.deepEqual(reviewGroups(rows,parts).map(g=>g.rows.map(r=>r.seq)),[[0],[1]]);
});
test('a failed acoustic review cannot replace saved live snapshots',async()=>{
 const f=await fixture();const snapshot=await f.runtime.snapshot('lesson');
 f.runtime.model.transcribe=async()=>{throw Error('synthetic service failure');};
 await assert.rejects(f.runtime.reviewLiveAudio('lesson',{config:f.config},()=>{}),/synthetic/);
 const rows=await f.runtime.rows('revisions','lesson');assert.equal(rows.filter(r=>r.kind==='raw').length,1);assert.ok(await f.store.get('revisions',snapshot.revision));
});
test('no transcript retention or disabled review incurs no extra model requests',async()=>{
 const f=await fixture();f.runtime.model.transcribe=async()=>{throw Error('must not call');};
 for(const live of [{retainTranscript:false},{finalAudioReview:false}])assert.equal((await f.runtime.reviewLiveAudio('lesson',{config:{...f.config,live}},()=>{})).skipped,true);
});
test('lesson estimate includes the extra full-audio pass even when silence filtering is enabled',async()=>{
 const f=await fixture();const estimate=await f.runtime.api('/api/lesson-estimate',{config:f.config,plan:{minutes:45,mode:'record'}});
 const row=estimate.rows.find(r=>r.label==='完整原音复核（含静音）');assert.equal(row.requests,5);assert.equal(row.amount,2700*.00022);
 f.config.live.finalAudioReview=false;
 const disabled=await f.runtime.api('/api/lesson-estimate',{config:f.config,plan:{minutes:45,mode:'record'}});assert.ok(!disabled.rows.some(r=>r.label.includes('完整原音复核')));
});
test('final correction failure preserves the acoustically reviewed words',async()=>{
 const f=await fixture();f.config.live.correctTranscript=true;f.runtime.model.transcribe=async()=> '完整原音识别内容';f.runtime.model.chat=async()=>{throw Error('synthetic correction failure');};
 const result=await f.runtime.reviewLiveAudio('lesson',{config:f.config},()=>{}),final=await f.store.get('revisions',result.revision);
 assert.equal(final.content.segments[0].text,'完整原音识别内容');assert.equal(final.content.segments[0].correctionState,'failed');
 assert.equal((await f.runtime.rows('revisions','lesson')).filter(r=>r.kind==='corrected-transcript').length,0);
});
