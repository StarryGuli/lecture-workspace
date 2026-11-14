// Explicitly paid diagnostic: only run after the owner requests a real ASR comparison.
// Results and source audio stay in the ignored data directory. No correction LLM calls.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {MemoryStore} from '../static/mobile-store.mjs';
import {MobileRuntime,DEFAULT_CONFIG} from '../static/mobile-runtime.mjs';
import {wavFromPCM,audioBufferTo16k} from '../static/mobile-audio.mjs';

const [source,out]=process.argv.slice(2);
if(!source||!out)throw Error('Usage: node tools/asr_quality_audit.mjs SOURCE OUTPUT_DIRECTORY');
await fs.mkdir(out,{recursive:true,mode:0o700});
const key=(process.env.SILICONFLOW_API_KEY||await fs.readFile(new URL('../data/keys/siliconflow',import.meta.url),'utf8')).trim();
const model='Qwen/Qwen3-ASR-1.7B';
const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=sample_rate,channels','-of','json',source]));
const seconds=Number(metadata.format.duration),rate=48000;
const floats=execFileSync('ffmpeg',['-v','error','-i',source,'-ar',String(rate),'-ac','2','-f','f32le','pipe:1'],{maxBuffer:200*1024*1024});
const src=new Float32Array(floats.buffer,floats.byteOffset,floats.length/4),channels=[new Float32Array(src.length/2),new Float32Array(src.length/2)];
for(let i=0;i<channels[0].length;i++){channels[0][i]=src[2*i];channels[1][i]=src[2*i+1];}
const pcm=await audioBufferTo16k({sampleRate:rate,length:channels[0].length,numberOfChannels:2,getChannelData:i=>channels[i]});
await fs.writeFile(path.join(out,'converted.wav'),new Uint8Array(await wavFromPCM(pcm).arrayBuffer()));
const savedSettings=JSON.parse(await fs.readFile(new URL('../data/settings.json',import.meta.url),'utf8').catch(()=>'{}'));
const cfg={...structuredClone(DEFAULT_CONFIG),timeout:120,asr:{providerId:'siliconflow',model,language:'auto'},silence:{...DEFAULT_CONFIG.silence,...savedSettings.silence},live:{sentenceMode:true,pauseSeconds:.7,keywordEnabled:true,keywordProbeSeconds:3,chunkSeconds:12}};
const ledger=[];
async function asr(blob,label,start=0){
 const t=performance.now(),form=new FormData();form.append('model',model);form.append('file',blob,blob.type==='audio/mp4'?'source.m4a':'speech.wav');
 const r=await fetch('https://api.siliconflow.cn/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(120000)});
 const body=await r.json();const row={label,start,status:r.status,latencySeconds:(performance.now()-t)/1000,text:body.text,usage:body.usage,returnedModel:body.model};
 if(!r.ok)row.error=JSON.stringify(body).replaceAll(key,'[REDACTED]').slice(0,600);
 ledger.push(row);await fs.writeFile(path.join(out,'requests.json'),JSON.stringify(ledger,null,2));
 return row;
}
for(const [label,blob] of [['original-full',new Blob([await fs.readFile(source)],{type:'audio/mp4'})],['converted-full',wavFromPCM(pcm)]]){
 const r=await asr(blob,label);console.log(JSON.stringify({label,status:r.status,seconds:r.latencySeconds,chars:r.text?.length,error:r.error}));
}
// Reproduce the actual front-end's 4096-sample callbacks, adaptive pause rule and probe interval.
const chunks=[];let begin=0,quiet=0,peak=-96;
for(let pos=0;pos<channels[0].length;pos+=4096){
 const end=Math.min(channels[0].length,pos+4096);let energy=0;
 for(let i=pos;i<end;i++){const value=(channels[0][i]+channels[1][i])/2;energy+=value*value;}
 const dt=(end-pos)/rate,db=Math.max(-96,20*Math.log10(Math.max(1e-8,Math.sqrt(energy/(end-pos)))));
 peak=Math.max(db,peak-dt);quiet=db<Math.max(-80,peak-18)?quiet+dt:0;
 const length=(end-begin)/rate;
 const reason=length>=1.2&&quiet>=.7?'sentence':length>=3?'keyword-probe':null;
 if(reason||end===channels[0].length){chunks.push({seq:chunks.length,start:Math.floor(begin/rate*16000)/16000,end:Math.floor(end/rate*16000)/16000,reason:reason||'final'});begin=end;quiet=0;}
}
const summary={source:metadata,model,config:cfg,chunks,arms:{},note:'No human ground-truth supplied. Differences are not an accuracy score. Browser microphone processing and the server proxy are not replayed.'};
for(const enabled of [false,true]){
 const label=enabled?'platform-gated':'platform-ungated',store=new MemoryStore();
 const runtime=new MobileRuntime({store,keyring:{key:async()=>key},fetcher:fetch});
 runtime.model.transcribe=async(config,blob,duration)=>{const row=await asr(blob,label);if(!row.text&&row.status!==200)throw Error('HTTP '+row.status);row.audioSeconds=duration;return row.text;};
 const sid=label,results=[];await store.put('sessions',{id:sid});
 for(const c of chunks){const slice=pcm.slice(Math.round(c.start*16000),Math.round(c.end*16000));await store.put('chunks',{id:sid+':'+c.seq,session:sid,seq:c.seq,start:c.start,duration:slice.length/16000,blob:wavFromPCM(slice)});}
 for(let i=0;i<chunks.length;i++){
  const c=chunks[i],row=await store.get('chunks',sid+':'+c.seq);
  try{const r=await runtime.recognize(sid,row,{...cfg,silence:{...cfg.silence,enabled}},()=>{});results.push({seq:c.seq,start:c.start,end:c.end,reason:c.reason,text:r.text,sentSeconds:r.silence.sentSeconds,skippedSeconds:r.silence.skippedSeconds,thresholdDb:r.silence.settings?.thresholdDb,segments:r.segments});}
  catch(e){results.push({seq:c.seq,start:c.start,error:e.message});}
  await fs.writeFile(path.join(out,label+'.json'),JSON.stringify(results,null,2));
  if(i%10===0)console.log(label,i+1+'/'+chunks.length);
 }
 summary.arms[label]={requests:ledger.filter(x=>x.label===label).length,chars:results.reduce((n,x)=>n+(x.text?.length||0),0),sentSeconds:results.reduce((n,x)=>n+(x.sentSeconds||0),0),skippedSeconds:results.reduce((n,x)=>n+(x.skippedSeconds||0),0),errors:results.filter(x=>x.error).length};
 await fs.writeFile(path.join(out,label+'.txt'),results.map(x=>`[${x.start?.toFixed(2)}] ${x.text||x.error||''}`).join('\n'));
 await fs.writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
 console.log(JSON.stringify(summary.arms[label]));
}
console.log('Saved comparison:',out);
