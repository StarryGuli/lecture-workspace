// Paid control: replay the owner's supplied PCM through the production ASR client.
import fs from 'node:fs/promises';
import path from 'node:path';
import {MobileRuntime,DEFAULT_CONFIG} from '../static/mobile-runtime.mjs';
import {MemoryStore} from '../static/mobile-store.mjs';
import {decodeWav,wavFromPCM,gatePCM,analyzePCM} from '../static/mobile-audio.mjs';
const dir=process.argv[2];if(!dir)throw Error('Supply an existing private audit directory');
const buffer=await fs.readFile(path.join(dir,'converted.wav'));
const pcm=decodeWav(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.length)).pcm;
const key=(await fs.readFile(new URL('../data/keys/siliconflow',import.meta.url),'utf8')).trim();
const runtime=new MobileRuntime({store:new MemoryStore(),keyring:{key:async()=>key}});
const cfg={...structuredClone(DEFAULT_CONFIG),timeout:120,silence:{...DEFAULT_CONFIG.silence,enabled:false}};
const results=[];
for(let start=0;start<pcm.length;start+=12*16000){
 const end=Math.min(pcm.length,start+12*16000),t=performance.now();
 try{const text=await runtime.model.transcribe(cfg,wavFromPCM(pcm.slice(start,end)),(end-start)/16000);results.push({start:start/16000,end:end/16000,text,latencySeconds:(performance.now()-t)/1000});}
 catch(e){results.push({start:start/16000,end:end/16000,error:e.message});}
 await fs.writeFile(path.join(dir,'platform-12s.json'),JSON.stringify(results,null,2));
 if(results.length%10===0)console.log('12-second control',results.length);
}
await fs.writeFile(path.join(dir,'platform-12s.txt'),results.map(x=>`[${x.start}] ${x.text||x.error}`).join('\n'));
let speech=null;try{speech=JSON.parse(await fs.readFile(path.join(dir,'speech-scores.json'),'utf8'));}catch{}
const report=analyzePCM(pcm,DEFAULT_CONFIG,{speech});
await fs.writeFile(path.join(dir,'full-gate-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({requests:results.length,errors:results.filter(x=>x.error).length,chars:results.reduce((n,x)=>n+(x.text?.length||0),0),suggestedDb:report.suggestedDb}));
