import test from 'node:test';import assert from 'node:assert/strict';
import {DEVICE_NETWORK,deviceURL,serverURL} from './static/mobile-provider-network.mjs';
import {MobileRuntime,DEFAULT_CONFIG} from './static/mobile-runtime.mjs';import {MemoryStore} from './static/mobile-store.mjs';
function fixture(){const calls=[],store=new MemoryStore(),r=new MobileRuntime({store,keyring:{key:()=>{throw Error('No-key route must not access the vault');}},fetcher:async(url,options)=>{calls.push({url:String(url),options});return Response.json({data:[{id:'local-asr'}]});}});r.account.enabled=true;r.account.authenticated=true;r.account.ready=true;r.account.providers=[{id:'siliconflow',baseURL:'https://api.siliconflow.cn/v1',serverManaged:true,hasKey:true}];r.account.remoteConfig=structuredClone(DEFAULT_CONFIG);return {r,store,calls};}
test('device-only HTTP permits private/Tailscale networks, not public plaintext or embedded secrets',()=>{
 for(const host of ['100.100.100.100','192.168.1.2','10.0.0.1','172.16.0.1','127.0.0.1','localhost'])assert.equal(deviceURL('http://'+host+':11500/v1').protocol,'http:');
 for(const url of ['http://8.8.8.8/v1','http://100.128.0.1/v1','file:///tmp/asr','https://user:secret@example.com/v1','https://example.com/v1?key=secret'])assert.throws(()=>deviceURL(url));
 assert.throws(()=>serverURL('http://100.100.100.100:11500/v1'),/本设备直连/);assert.throws(()=>serverURL('https://192.168.1.2/v1'),/本设备直连/);
});
test('account login can coexist with a device-local no-key provider; model list bypasses the account server',async()=>{
 const {r,store,calls}=fixture();r.account.request=async()=>{throw Error('Local provider must never reach account API');};
 const added=await r.api('/api/providers',{name:'Local ASR',baseURL:'http://100.100.100.100:11500/v1',auth:'No key (local server)',network:DEVICE_NETWORK});
 const provider=added.providers.find(p=>p.id===added.id);assert.equal(provider.serverManaged,false);assert.equal(provider.hasKey,true);assert.equal((await store.get('meta','providers')).value.length,1);
 const result=await r.api('/api/providers/'+added.id+'/models',{});assert.deepEqual(result.models,['local-asr']);assert.equal(calls[0].url,'http://100.100.100.100:11500/v1/models');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.targetAddressSpace,'local');assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(calls[0].options.headers['X-CSRF-Token'],undefined);
});
test('device selection survives account bootstrap without sending private provider IDs to shared settings',async()=>{
 const {r,store}=fixture(),added=await r.api('/api/providers',{name:'Local',baseURL:'http://10.0.0.1:11500/v1',auth:'No key (local server)',network:DEVICE_NETWORK});let remote;
 r.account.settingsWritable=true;r.account.request=async(path,options)=>{if(path==='settings'){remote=options.body.config;return {};}if(path==='bootstrap')return {config:DEFAULT_CONFIG,providers:r.account.providers};throw Error('unexpected request');};
 await r.saveSettings({...structuredClone(DEFAULT_CONFIG),asr:{providerId:added.id,model:'local-asr'}});
 assert.equal(remote.asr.providerId,'siliconflow');assert.equal((await store.get('meta','settings')).value.asr.providerId,added.id);
 await r.account.bootstrap();assert.equal((await store.get('meta','settings')).value.asr.providerId,added.id);
 await r.saveSettings(DEFAULT_CONFIG);await r.account.bootstrap();assert.equal((await store.get('meta','settings')).value.asr.providerId,'siliconflow');
});
test('proxy rejects private HTTP before any request and never silently falls back to server on direct failure',async()=>{
 const {r}=fixture();r.account.request=async()=>{throw Error('Must not call server');};await assert.rejects(r.api('/api/providers',{name:'bad proxy',baseURL:'http://100.100.100.100:11500/v1',auth:'No key (local server)',network:'服务器代理'}),/本设备直连/);
 const added=await r.api('/api/providers',{name:'Local',baseURL:'http://10.0.0.1:11500/v1',auth:'No key (local server)',network:DEVICE_NETWORK});let attempts=0;
 r.model.fetcher=async()=>{attempts++;throw Error('synthetic network failure');};
 await assert.rejects(r.model.request({text:{providerId:added.id,model:'local'},timeout:2},'text','/models',null,{method:'GET'}),/本设备直连失败/);assert.equal(attempts,1);
});
