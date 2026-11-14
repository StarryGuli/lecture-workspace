// Browser-owned locks disappear on refresh; another tab may read the record
// but must not promote its live journal or start a second microphone writer.
export class RecordingLease{
 constructor(manager=globalThis.navigator?.locks){this.manager=manager;this.sid=null;this.done=null;this.task=null;}
 async acquire(sid){
  if(this.sid)return this.sid===sid;
  if(!this.manager){this.sid=sid;return true;}
  return new Promise(resolve=>{this.task=this.manager.request('lecture-recording:'+sid,{ifAvailable:true},lock=>{
   if(!lock){resolve(false);return;}
   const held=new Promise(done=>{this.done=done;});this.sid=sid;resolve(true);return held;
  }).catch(()=>resolve(false));});
 }
 async busy(sid){if(this.sid===sid||!this.manager?.query)return false;const state=await this.manager.query();return state.held.some(l=>l.name==='lecture-recording:'+sid);}
 async release(){const task=this.task;this.done?.();this.done=null;this.sid=null;this.task=null;if(task)await task;}
}
