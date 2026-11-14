import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechEndpoint} from './static/mobile-endpoint.mjs';
test('continuous voice passes three, twelve and ninety seconds without an endpoint',()=>{
 const e=new SpeechEndpoint();for(let i=0;i<3200;i++)assert.equal(e.push(.8,512),null);
});
test('brief breaths stay inside an utterance; sustained silence ends it once',()=>{
 const e=new SpeechEndpoint({pauseSeconds:1.2});for(let i=0;i<100;i++)e.push(.8,512);
 for(let i=0;i<15;i++)assert.equal(e.push(.01,512),null);
 for(let i=0;i<50;i++)assert.equal(e.push(.8,512),null);
 const boundaries=[];for(let i=0;i<70;i++){const x=e.push(.01,512);if(x!==null)boundaries.push(x);}
 assert.equal(boundaries.length,1);assert.equal(boundaries[0],(100+15+50+38)*512);
});
test('silence and short isolated noises do not create speech segments',()=>{
 const e=new SpeechEndpoint();for(let i=0;i<500;i++)assert.equal(e.push(.01,512),null);
 e.push(.8,512);for(let i=0;i<100;i++)assert.equal(e.push(.01,512),null);
});
test('new default retains classroom pauses shorter than three seconds',()=>{
 const e=new SpeechEndpoint();for(let i=0;i<100;i++)e.push(.8,512);
 for(let i=0;i<80;i++)assert.equal(e.push(.01,512),null);
 for(let i=0;i<50;i++)e.push(.8,512);
 let end=null;for(let i=0;i<100;i++){const at=e.push(.01,512);if(at!==null)end=at;}
 assert.equal(end,(100+80+50+94)*512);
});
test('meeting mode sends after a short natural pause without waiting for the classroom threshold',()=>{
 const e=new SpeechEndpoint({pauseSeconds:.6});for(let i=0;i<50;i++)e.push(.8,512);
 for(let i=0;i<18;i++)assert.equal(e.push(.01,512),null);
 assert.equal(e.push(.01,512),(50+19)*512);
});
