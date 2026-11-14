// Speech endpoints only. Elapsed recording time never causes an ASR submission.
export class SpeechEndpoint {
  constructor({pauseSeconds=3}={}) {this.pause=Math.max(.35,Number(pauseSeconds)||3);this.reset();}
  reset(){this.position=0;this.voiced=0;this.quiet=0;this.inSpeech=false;}
  push(probability,frames){
    this.position+=frames;
    if(probability>=.35){this.voiced+=frames;this.quiet=0;this.inSpeech=true;}
    else if(this.inSpeech)this.quiet+=frames;
    if(this.inSpeech&&this.voiced>=3200&&this.quiet>=this.pause*16000){
      this.inSpeech=false;this.voiced=0;this.quiet=0;
      return this.position;
    }
    return null;
  }
}

export function createSpeechEndpoint({pauseSeconds,onEnd,onUnavailable}) {
  const worker=new Worker(new URL('./mobile-endpoint-worker.mjs',import.meta.url),{type:'module'});
  let active=true,ready=false,pending=[];
  const timer=setTimeout(()=>{if(active&&!ready){onUnavailable?.();worker.terminate();active=false;pending=[];}},15000);
  worker.onmessage=({data})=>{
    if(!active)return;
    if(data.type==='ready'){ready=true;clearTimeout(timer);for(const pcm of pending)worker.postMessage({type:'audio',pcm},[pcm.buffer]);pending=[];}
    else if(data.type==='endpoint')onEnd(data.endFrame);
    else if(data.type==='unavailable'){clearTimeout(timer);active=false;worker.terminate();pending=[];onUnavailable?.();}
  };
  worker.onerror=()=>{if(active){clearTimeout(timer);active=false;worker.terminate();pending=[];onUnavailable?.();}};
  worker.postMessage({type:'init',pauseSeconds});
  return {push(pcm){if(!active)return;const copy=pcm.slice();if(ready)worker.postMessage({type:'audio',pcm:copy},[copy.buffer]);else pending.push(copy);},close(){active=false;clearTimeout(timer);pending=[];worker.terminate();}};
}
