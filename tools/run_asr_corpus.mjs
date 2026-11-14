// The owner must explicitly authorize paid comparisons before this command runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {SpeechEndpoint} from '../static/mobile-endpoint.mjs';
import {decodeWav,wavFromPCM} from '../static/mobile-audio.mjs';
import {MemoryStore} from '../static/mobile-store.mjs';
import {MobileRuntime,DEFAULT_CONFIG} from '../static/mobile-runtime.mjs';
const dir=process.argv[2];if(!dir)throw Error('Supply a prepared private corpus directory');
const pauseSeconds=Number(process.argv[3]||1.2),selected=new Set(process.argv.slice(4));
if(!Number.isFinite(pauseSeconds)||pauseSeconds<.8||pauseSeconds>3)throw Error('Invalid pause duration');
const suffix=process.env.ASR_RESULT_SUFFIX||(pauseSeconds===1.2?'':`-pause-${pauseSeconds}`);
if(!/^[\w.-]*$/.test(suffix))throw Error('Invalid result suffix');
const silenceOverride=JSON.parse(process.env.ASR_SILENCE_JSON||'{}');
const arms=(process.env.ASR_ARMS||'endpoint,endpoint-gated').split(',');
if(arms.some(x=>!['endpoint','endpoint-gated'].includes(x)))throw Error('Invalid ASR arms');
const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
const key=(await fs.readFile(new URL('../data/keys/siliconflow',import.meta.url),'utf8')).trim();
const model='Qwen/Qwen3-ASR-1.7B',maxSeconds=Number(process.env.ASR_BUDGET_SECONDS||1500);
const requestTimeout=Number(process.env.ASR_REQUEST_TIMEOUT_MS||30000);
if(!Number.isFinite(requestTimeout)||requestTimeout<2000||requestTimeout>120000)throw Error('Invalid request timeout');
if(!Number.isFinite(maxSeconds)||maxSeconds<1||maxSeconds>1500)throw Error('Budget must be 1–1500 audio seconds');
const cache=JSON.parse(await fs.readFile(path.join(dir,'cache.json'),'utf8').catch(()=>'{}'));
const ledger=JSON.parse(await fs.readFile(path.join(dir,'ledger.json'),'utf8').catch(()=>'[]'));
let reserved=ledger.reduce((n,r)=>n+r.reservedSeconds,0);
const results=[];
async function persist(){await fs.writeFile(path.join(dir,'ledger.json'),JSON.stringify(ledger,null,2));await fs.writeFile(path.join(dir,'cache.json'),JSON.stringify(cache,null,2));await fs.writeFile(path.join(dir,`results${suffix}.json`),JSON.stringify(results,null,2));}
async function transcribe(blob,seconds,tag){
 const bytes=new Uint8Array(await blob.arrayBuffer()),hash=crypto.createHash('sha256').update(model).update(bytes).digest('hex');
 if(cache[hash])return cache[hash].text;
 const billing=Math.ceil(seconds);
 if(reserved+billing>maxSeconds)throw Error('ASR budget cap reached; no further request sent');
 reserved+=billing;const row={tag,hash,seconds,reservedSeconds:billing,status:'pending'};ledger.push(row);await persist();
 const form=new FormData();form.append('model',model);form.append('file',new Blob([bytes],{type:blob.type||'audio/wav'}),blob.type==='audio/mp4'?'source.m4a':'speech.wav');
 const t=performance.now();
 try{const response=await fetch('https://api.siliconflow.cn/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(requestTimeout)});const body=await response.json();row.status=response.status;row.latencySeconds=(performance.now()-t)/1000;row.usage=body.usage;
  if(!response.ok||typeof body.text!=='string')throw Error('ASR HTTP '+response.status);
  cache[hash]={text:body.text,usage:body.usage};await persist();return body.text;
 }catch(e){row.error=String(e.message).replaceAll(key,'[REDACTED]');row.status=row.status==='pending'?'error':row.status;await persist();throw e;}
}
for(const sample of manifest.samples){
 if(selected.size&&!selected.has(sample.id))continue;
 const voiced=sample.speech.reduce((n,r)=>n+(r.probability>=.35?r.endFrame-r.startFrame:0),0)/16000;
 if(voiced<.2){results.push({id:sample.id,label:sample.label,skipped:'Local detector found no reliable speech; no paid ASR request',voicedSeconds:voiced});await persist();continue;}
 const data=await fs.readFile(path.join(dir,sample.wav)),pcm=decodeWav(data.buffer.slice(data.byteOffset,data.byteOffset+data.length)).pcm;
 const endpoint=new SpeechEndpoint({pauseSeconds}),boundaries=[0];for(const r of sample.speech){if(r.endFrame-r.startFrame<512)continue;const end=endpoint.push(r.probability,512);if(end!==null&&end<pcm.length)boundaries.push(end);}boundaries.push(pcm.length);
 const result={id:sample.id,label:sample.label,source:sample.source,start:sample.start,end:sample.end,seconds:sample.seconds,pauseSeconds,voicedSeconds:voiced,boundaries:boundaries.map(x=>x/16000),arms:{}};results.push(result);
 console.log(sample.id,sample.label,'seconds',sample.seconds,'segments',boundaries.length-1);
 try{const blob=process.env.ASR_ORIGINAL==='1'?new Blob([await fs.readFile(sample.source)],{type:'audio/mp4'}):wavFromPCM(pcm);result.arms.full={text:await transcribe(blob,sample.seconds,sample.id+':full'),sourceFormat:process.env.ASR_ORIGINAL==='1'?'original':'pcm16'};}catch(e){result.arms.full={error:e.message};}
 for(const enabled of [false,true].filter(x=>arms.includes(x?'endpoint-gated':'endpoint'))){
  const name=enabled?'endpoint-gated':'endpoint',store=new MemoryStore();
  const runtime=new MobileRuntime({store,keyring:{key:async()=>key},detector:async p=>{
   const json=execFileSync('python3',[new URL('./prepare_asr_corpus.py',import.meta.url).pathname,'--detector-stdin'],{input:Buffer.from(p.buffer,p.byteOffset,p.byteLength),maxBuffer:10*1024*1024,timeout:15000});return JSON.parse(json.toString());
  }});
  const sid=sample.id;await store.put('sessions',{id:sid});const rows=[];
  for(let i=0;i<boundaries.length-1;i++){const a=boundaries[i],b=boundaries[i+1];const row={id:sid+':'+i,session:sid,seq:i,start:a/16000,duration:(b-a)/16000,blob:wavFromPCM(pcm.slice(a,b))};rows.push(row);await store.put('chunks',row);}
  let seq=0;runtime.model.transcribe=async(c,blob,seconds)=>transcribe(blob,seconds,`${sid}:${name}:${seq}`);
  const segments=[],gates=[];let skippedSeconds=0,sentSeconds=0;
  for(const row of rows){seq=row.seq;try{const r=await runtime.recognize(sid,row,{...structuredClone(DEFAULT_CONFIG),silence:{...DEFAULT_CONFIG.silence,...silenceOverride,enabled}},()=>{});segments.push(...r.segments);skippedSeconds+=r.silence.skippedSeconds;sentSeconds+=r.silence.sentSeconds;gates.push({seq:row.seq,start:row.start,duration:row.duration,settings:r.silence.settings,sentSeconds:r.silence.sentSeconds,skippedSeconds:r.silence.skippedSeconds,skipped:r.segments.filter(s=>s.skipped),speechProtection:r.silence.calibration?.speechProtection});}catch(e){segments.push({start:row.start,end:row.start+row.duration,error:e.message});}}
  result.arms[name]={text:segments.filter(s=>!s.skipped).map(s=>s.text||'').join(''),segments,gates,sentSeconds,skippedSeconds,errors:segments.filter(s=>s.error).length};
  await persist();console.log(sample.id,name,'sent',sentSeconds.toFixed(2),'skipped',skippedSeconds.toFixed(2));
 }
 await fs.writeFile(path.join(dir,sample.id+suffix+'.json'),JSON.stringify(result,null,2));await persist();
}
console.log(JSON.stringify({actualRequests:ledger.length,reservedSeconds:reserved,estimatedCNY:reserved*.00022,budgetCNY:maxSeconds*.00022}));
