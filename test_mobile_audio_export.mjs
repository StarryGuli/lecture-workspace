import test from 'node:test';import assert from 'node:assert/strict';
import {installAudioExport} from './static/mobile-audio-export.mjs';import {MemoryStore} from './static/mobile-store.mjs';import {wavFromPCM} from './static/mobile-audio.mjs';
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(nav={}){
 const store=new MemoryStore();await store.put('sessions',{id:'session',title:'课堂/录音'});await store.put('chunks',{id:'session:0',session:'session',seq:0,start:0,duration:1,blob:wavFromPCM(new Int16Array(16000))});
 const notices=[],downloads=[],revoked=[],link={href:'https://example.test/api/sessions/session/audio',textContent:''};let handler;
 const document={documentElement:{dataset:{}},body:{append:a=>{a.connected=true;}},addEventListener:(type,fn)=>{handler=fn;},removeEventListener:()=>{},createElement:()=>({click(){assert.equal(this.connected,true);downloads.push({name:this.download,url:this.href});},remove(){this.connected=false;}})};
 class URLs extends URL{static createObjectURL(){return 'blob:prepared-audio';}static revokeObjectURL(url){revoked.push(url);}}
 const dispose=installAudioExport({runtime:{store},document,navigator:nav,URL:URLs,notify:s=>notices.push(s)});
 return {store,link,document,notices,downloads,revoked,dispose,tap:()=>handler({target:{closest:()=>link},preventDefault(){}})};
}
test('file is prepared before the fresh tap invokes native sharing synchronously',async()=>{
 let shared;const f=await fixture({canShare:()=>true,share:data=>{shared=data;return Promise.resolve();}});
 f.tap();assert.equal(shared,undefined);await tick();assert.match(f.link.textContent,/已就绪/);
 f.tap();assert.equal(shared.files[0].name,'课堂_录音-session.wav');assert.equal(shared.files[0].size,32044);assert.equal(shared.files[0].type,'audio/wav');
 assert.equal(f.downloads.length,0);assert.ok(await f.store.get('chunks','session:0'));f.dispose();assert.deepEqual(f.revoked,['blob:prepared-audio']);
});
test('browsers without file sharing download using a connected anchor',async()=>{
 const f=await fixture({});f.tap();await tick();f.tap();assert.equal(f.downloads.length,1);assert.equal(f.downloads[0].url,'blob:prepared-audio');
});
test('share cancellation does not delete audio or pretend a file was saved',async()=>{
 const f=await fixture({canShare:()=>true,share:()=>Promise.reject(Object.assign(Error('cancel'),{name:'AbortError'}))});f.tap();await tick();f.tap();await tick();assert.match(f.notices.at(-1),/已取消/);assert.equal(f.downloads.length,0);assert.ok(await f.store.get('chunks','session:0'));
});
test('failed native sharing offers download on the next tap',async()=>{
 let count=0;const f=await fixture({canShare:()=>true,share:()=>{count++;return Promise.reject(Error('blocked'));}});f.tap();await tick();f.tap();await tick();f.tap();assert.equal(count,1);assert.equal(f.downloads.length,1);
});
test('missing audio reports the error and recording blocks full export',async()=>{
 const f=await fixture();await f.store.delete('chunks','session:0');f.tap();await tick();assert.match(f.notices.at(-1),/原音不在此设备/);assert.match(f.link.textContent,/重新导出/);
 f.document.documentElement.dataset.recording='true';f.tap();assert.match(f.notices.at(-1),/先结束录音/);assert.equal(f.downloads.length,0);
});
