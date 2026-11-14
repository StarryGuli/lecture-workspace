// No credentials or network: verify production requests against genuine cached
// ASR responses, then compare output with a separately obtained whole-file result.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {MobileRuntime,DEFAULT_CONFIG} from '../static/mobile-runtime.mjs';
import {MemoryStore} from '../static/mobile-store.mjs';import {decodeWav,wavFromPCM} from '../static/mobile-audio.mjs';
const [dir,baselineFile]=process.argv.slice(2);if(!dir||!baselineFile)throw Error('Usage: node tools/verify_context_replay.mjs PRIVATE_CORPUS ORIGINAL_RESULT');
const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')),sample=manifest.samples[0],cache=JSON.parse(await fs.readFile(path.join(dir,'cache.json'),'utf8'));
const old=JSON.parse(await fs.readFile(path.join(dir,'results-pause-3.json'),'utf8'))[0],base=JSON.parse(await fs.readFile(baselineFile,'utf8'))[0].arms.full.text;
const bytes=await fs.readFile(path.resolve(dir,sample.wav)),pcm=decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)).pcm;
const store=new MemoryStore(),runtime=new MobileRuntime({store,keyring:{key:async()=>{throw Error('Replay cannot access keys');}}}),cfg={...structuredClone(DEFAULT_CONFIG),silence:{enabled:false},live:{retainTranscript:true,correctTranscript:false}},requests=[],steps=[];
const norm=s=>[...s.toLowerCase()].filter(c=>/[\p{L}\p{N}]/u.test(c));
function compare(text,reference,prefix=false){const a=norm(text),b=norm(reference);let row=Array.from({length:b.length+1},(_,i)=>i);for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]!==b[j-1]));row=next;}let end=b.length;if(prefix){const low=Math.max(1,Math.floor(a.length*.6)),high=Math.min(b.length,Math.ceil(a.length*1.4));end=low;for(let j=low;j<=high;j++)if(row[j]<row[end])end=j;}return {edits:row[end],referenceCharacters:end,difference:row[end]/end,prefixComparison:prefix};}
await store.put('sessions',{id:'replay'});
runtime.model.transcribe=async(c,blob,seconds)=>{const audio=new Uint8Array(await blob.arrayBuffer()),hash=crypto.createHash('sha256').update(cfg.asr.model).update(audio).digest('hex');if(!cache[hash])throw Error('No genuine response for this request; replay never sends paid requests');requests.push({seconds,hash});return cache[hash].text;};
for(let seq=0;seq<old.boundaries.length-1;seq++){
 const start=old.boundaries[seq],end=old.boundaries[seq+1],row={id:'replay:'+seq,session:'replay',seq,start,duration:end-start,blob:wavFromPCM(pcm.slice(Math.round(start*16000),Math.round(end*16000)))};
 await store.put('chunks',row);const raw=await runtime.recognize('replay',row,cfg,()=>{});await runtime.revision('replay','live-transcript',raw,cfg);
 steps.push({endSeconds:end,...compare(raw.acousticText||raw.segments.map(s=>s.text).join(''),base,seq<old.boundaries.length-2),newAnalysisText:raw.text,replacedSequences:raw.replacedSequences});
}
const snapshot=await runtime.snapshot('replay'),saved=await store.get('revisions',snapshot.revision),count=requests.length,final=await runtime.reviewLiveAudio('replay',{config:cfg},()=>{});
const report={method:'Production pipeline replay of real ASR responses. Intermediate comparisons align with the corresponding best prefix of the whole-file baseline. No human reference and no accuracy claim.',threshold:.03,baselineCharacters:norm(base).length,oldSplit:compare(old.arms.endpoint.text,base),steps,passed:steps.every(s=>s.difference<.03),requests,sourceSeconds:pcm.length/16000,submittedSeconds:requests.reduce((n,r)=>n+r.seconds,0),finalExtraASRRequests:requests.length-count,snapshotBlocks:saved.content.segments.length,final,additionalPaidRequests:0};
await fs.writeFile(path.join(dir,'context-acceptance.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,oldDifference:report.oldSplit.difference,steps:steps.map(({endSeconds,difference})=>({endSeconds,difference})),submittedSeconds:report.submittedSeconds,sourceSeconds:report.sourceSeconds,finalExtraASRRequests:report.finalExtraASRRequests}));
if(!report.passed)process.exitCode=1;
