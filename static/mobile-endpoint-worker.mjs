import * as ort from './vendor/ort/ort.wasm.min.mjs';
import {SpeechEndpoint} from './mobile-endpoint.mjs';
ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('./vendor/ort/',import.meta.url).href;
let session,state=new Float32Array(256),context=new Float32Array(64),tail=new Int16Array(),endpoint;
let queue=Promise.resolve();
self.onmessage=({data})=>{queue=queue.then(async()=>{
  if(data.type==='init'){
    endpoint=new SpeechEndpoint({pauseSeconds:data.pauseSeconds});
    session=await ort.InferenceSession.create('/models/silero_vad.onnx',{executionProviders:['wasm']});
    self.postMessage({type:'ready'});return;
  }
  if(data.type!=='audio'||!session)return;
  const pcm=new Int16Array(tail.length+data.pcm.length);pcm.set(tail);pcm.set(data.pcm,tail.length);
  let start=0;
  for(;start+512<=pcm.length;start+=512){
    const input=new Float32Array(576);input.set(context);
    // Modest fixed gain on the detector's copy only, preserving acoustic continuity.
    for(let i=0;i<512;i++)input[64+i]=Math.max(-1,Math.min(1,pcm[start+i]/32768*4));
    const tensors={input:new ort.Tensor('float32',input,[1,576]),state:new ort.Tensor('float32',state,[2,1,128]),sr:new ort.Tensor('int64',new BigInt64Array([16000n]),[])};
    const output=await session.run(tensors);
    state=new Float32Array(output.stateN.data);context=input.slice(-64);
    const endFrame=endpoint.push(output.output.data[0],512);
    for(const t of [...Object.values(tensors),...Object.values(output)])t.dispose?.();
    if(endFrame!==null)self.postMessage({type:'endpoint',endFrame});
  }
  tail=pcm.slice(start);
}).catch(()=>self.postMessage({type:'unavailable'}));};
