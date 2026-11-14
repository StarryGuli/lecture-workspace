import {decodeWav,wavFromPCM} from './mobile-audio.mjs';
export class RecordingJournal{
 constructor(store){this.store=store;this.pending=[];this.frames=0;this.queue=Promise.resolve();this.error=null;}
 append(sid,start,pcm,analyze=true){
  if(this.pending.length&&(this.pending[0].sid!==sid||this.pending[0].analyze!==analyze))this.flush();
  this.pending.push({sid,start,pcm,analyze});this.frames+=pcm.length;if(this.frames>=8000)this.flush();
 }
 flush(){
  if(!this.pending.length)return this.queue;const parts=this.pending;this.pending=[];this.frames=0;
  const startFrame=Math.round(parts[0].start*16000),endFrame=Math.max(...parts.map(p=>Math.round(p.start*16000)+p.pcm.length)),pcm=new Int16Array(endFrame-startFrame);
  for(const p of parts)pcm.set(p.pcm,Math.round(p.start*16000)-startFrame);
  const row={id:'journal:'+parts[0].sid+':'+startFrame,session:parts[0].sid,start:startFrame/16000,duration:pcm.length/16000,blob:wavFromPCM(pcm),temporary:true,journal:true,analyze:parts[0].analyze};
  this.queue=this.queue.then(()=>this.store.put('chunks',row)).catch(e=>{this.error=e;throw e;});this.queue.catch(()=>{});return this.queue;
 }
 commit(sid,end){
  this.flush();this.queue=this.queue.then(async()=>{for(const r of await this.store.all('chunks'))if(r.session===sid&&r.journal&&r.start+r.duration<=end+.0001)await this.store.delete('chunks',r.id);});this.queue.catch(()=>{});return this.queue;
 }
 async recover(sid){
  await this.flush();
  const all=(await this.store.all('chunks')).filter(r=>r.session===sid),normal=all.filter(r=>!r.temporary).sort((a,b)=>a.seq-b.seq),journals=all.filter(r=>r.journal).sort((a,b)=>a.start-b.start);
  if(normal.some((r,i)=>r.seq!==i))throw Error('录音保存序号有缺口，请先重传待保存片段；不会覆盖原音');
  let end=Math.max(0,...normal.map(r=>r.start+r.duration)),seq=normal.length,recovered=0,group;
  const groups=[],consumed=[];
  for(const r of journals){
   const pcm=decodeWav(await r.blob.arrayBuffer()).pcm,from=Math.max(0,Math.round((end-r.start)*16000));
   if(from>=pcm.length){consumed.push(r.id);continue;}
   if(r.start>end+.002)throw Error('录音缓存存在时间缺口；缓存已保留，未覆盖原音');
   if(!group||group.analyze!==r.analyze){group={start:end,analyze:r.analyze,parts:[],frames:0};groups.push(group);}
   const gap=Math.max(0,Math.round((r.start-end)*16000));if(gap){group.parts.push(new Int16Array(gap));group.frames+=gap;end+=gap/16000;}
   const kept=pcm.slice(from);group.parts.push(kept);group.frames+=kept.length;
   end+=kept.length/16000;recovered+=kept.length/16000;consumed.push(r.id);
  }
  // Durability fragments are not ASR segments: restore one continuous utterance
  // per model-pause interval, never submit half-second fragments separately.
  for(const g of groups){const pcm=new Int16Array(g.frames);let at=0;for(const p of g.parts){pcm.set(p,at);at+=p.length;}
   await this.store.put('chunks',{id:sid+':'+seq,session:sid,seq:seq++,start:g.start,duration:pcm.length/16000,blob:wavFromPCM(pcm),analyze:g.analyze,recovered:true});}
  for(const id of consumed)await this.store.delete('chunks',id);
  return {nextSequence:seq,seconds:end,recoveredSeconds:recovered};
 }
}
