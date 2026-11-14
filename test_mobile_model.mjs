import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelClient,quote} from './static/mobile-model.mjs';

const cfg={text:{model:'mock',providerId:'account'}};
function client(fetcher,managed=true){return new ModelClient({fetcher,providers:async()=>[{id:'account',serverManaged:managed,baseURL:'https://example.invalid',auth:'Bearer'}],account:{require(){},csrfToken:'csrf-private-value'},keyring:{key:async()=> 'device-private-value'},store:{}});}
const request=(c,options)=>c.request(cfg,'text','/chat/completions',{},options);

test('SiliconFlow Qwen ASR is paid while verified free candidates keep zero prices',()=>{
 const provider={baseURL:'https://api.siliconflow.cn/v1'};
 assert.equal(quote({asr:{model:'Qwen/Qwen3-ASR-1.7B'}},'asr',provider).audioPerSecond,.00022);
 assert.equal(quote({asr:{model:'FunAudioLLM/SenseVoiceSmall'}},'asr',provider).audioPerSecond,0);
 const text=quote({text:{model:'Qwen/Qwen3.5-4B'}},'text',provider);
 assert.equal(text.inputPerMillion,0);assert.equal(text.outputPerMillion,0);
});

test('402 preserves account status and meaningful message while redacting credentials',async()=>{
 const c=client(async()=>new Response(JSON.stringify({error:{message:'余额不足; token=upstream-private; Bearer abc-secret; sk-upstream123; csrf-private-value'}}),{status:402}));
 await assert.rejects(request(c),e=>{assert.equal(e.status,402);assert.equal(e.kind,'http');assert.match(e.message,/HTTP 402.*余额不足/);for(const secret of ['upstream-private','abc-secret','sk-upstream123','csrf-private-value'])assert.ok(!e.message.includes(secret));return true;});
});
test('direct upstream 402 redacts the actual device key even without a standard key prefix',async()=>{
 await assert.rejects(request(client(async()=>new Response(JSON.stringify({message:'Quota exhausted device-private-value'}),{status:402}),false)),e=>e.status===402&&e.message.includes('Quota exhausted')&&!e.message.includes('device-private-value'));
});
test('fetch rejection is a transport error and does not expose its raw message',async()=>{
 await assert.rejects(request(client(async()=>{throw new TypeError('fetch failed csrf-private-value');})),e=>e.kind==='transport'&&!e.message.includes('csrf-private-value'));
});
test('internal callback TypeError is processing, not a connection failure',async()=>{
 const c=client(async()=>new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}));
 await assert.rejects(request(c,{stream(){throw new TypeError('callback failed');}}),e=>e.kind==='processing'&&e.message.includes('callback failed')&&!e.message.includes('连接失败'));
});
test('invalid JSON is a parsing failure',async()=>{
 await assert.rejects(request(client(async()=>new Response('{broken'))),e=>e.kind==='processing');
});
test('stream read interruption is transport and retains delivered partial text',async()=>{
 let reads=0,partial='';
 const c=client(async()=>({ok:true,headers:new Headers({'Content-Type':'text/event-stream'}),body:{getReader:()=>({read:async()=>{if(reads++)throw new TypeError('socket reset');return {done:false,value:new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')};}})}}));
 await assert.rejects(request(c,{stream:text=>{partial=text;}}),e=>e.kind==='transport');assert.equal(partial,'partial');
});
test('clean EOF without completion marker is an interrupted stream',async()=>{
 await assert.rejects(request(client(async()=>new Response('data: {"choices":[]}\n',{headers:{'Content-Type':'text/event-stream'}})),{stream(){}}),e=>e.kind==='transport');
});
test('successful response remains usable',async()=>{
 assert.deepEqual(await request(client(async()=>new Response('{"choices":[]}'))),{choices:[]});
});
