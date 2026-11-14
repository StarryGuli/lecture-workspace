import test from 'node:test';import assert from 'node:assert/strict';
import {requestWait,upgradeTimeouts} from './static/mobile-timeouts.mjs';
import {ModelClient} from './static/mobile-model.mjs';import {MemoryStore} from './static/mobile-store.mjs';import {wavFromPCM} from './static/mobile-audio.mjs';
const automatic={live:{timeoutMode:'auto'},asr:{providerId:'local',model:'model'}};
test('self-hosted ASR timeout grows with actual uploaded audio and grants cold loading allowance',()=>{
 const provider={auth:'No key (local server)'},wait=(seconds,warm)=>requestWait({config:automatic,role:'asr',provider,seconds,warm});
 assert.equal(wait(10,true),35);assert.equal(wait(180,true),205);assert.equal(wait(180,false),325);assert.equal(wait(600,true),300);assert.equal(wait(600,false),420);
});
test('remote ASR scales for longer classes while manual limits remain explicit',()=>{
 const provider={auth:'Authorization: Bearer <key>'};
 assert.equal(requestWait({config:automatic,role:'asr',provider,seconds:10}),14);assert.equal(requestWait({config:automatic,role:'asr',provider,seconds:180}),116);assert.equal(requestWait({config:automatic,role:'asr',provider,seconds:900}),120);
 assert.equal(requestWait({config:{...automatic,live:{timeoutMode:'manual'},asr:{timeout:17}},role:'asr',provider,seconds:900}),17);
});
test('correction/analysis wait scales with actual text instead of recording duration',()=>{
 const provider={},body=n=>({messages:[{content:'字'.repeat(n)}]});
 const short=requestWait({config:automatic,role:'correction',provider,body:body(20)}),long=requestWait({config:automatic,role:'correction',provider,body:body(1000)});
 assert.ok(long>short);assert.ok(long<=120);
});
test('legacy defaults migrate to automatic mode while custom timeouts remain manual',()=>{
 const a=upgradeTimeouts({live:{asrTimeoutSeconds:12,detectTimeoutSeconds:8,answerTimeoutSeconds:12},correction:{timeout:10}});assert.equal(a.live.timeoutMode,'auto');assert.equal(a.live.timeoutPolicyVersion,3);
 const b=upgradeTimeouts({live:{asrTimeoutSeconds:77},correction:{timeout:33}});assert.equal(b.live.timeoutMode,'manual');assert.equal(b.live.asrTimeoutSeconds,77);assert.equal(b.correction.timeout,33);
});
test('successful local inference warms subsequent requests without forcing an actual wait',async()=>{
 const provider={id:'local',baseURL:'http://127.0.0.1:11500/v1',auth:'No key (local server)'},client=new ModelClient({store:new MemoryStore(),keyring:{},providers:async()=>[provider],fetcher:async()=>Response.json({text:'synthetic result'})});
 await client.transcribe(automatic,wavFromPCM(new Int16Array(32000)),2);assert.equal(client.lastTimeout.seconds,147);assert.equal(client.lastTimeout.cold,true);
 await client.transcribe(automatic,wavFromPCM(new Int16Array(64000)),4);assert.equal(client.lastTimeout.seconds,29);assert.equal(client.lastTimeout.cold,false);
});
