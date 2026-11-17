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

test('a long utterance ends on a shorter real pause; continuous speech is still never cut',()=>{
 const e=new SpeechEndpoint({pauseSeconds:3});const step=1600;let end=null;
 for(let i=0;i<300&&end===null;i++)end=e.push(.9,step);          // 30 s of speech, no pause
 assert.equal(end,null);
 for(let i=0;i<8&&end===null;i++)end=e.push(.05,step);           // 0.8 s breath: not enough
 assert.equal(end,null);
 for(let i=0;i<30&&end===null;i++)end=e.push(.9,step);
 for(let i=0;i<20&&end===null;i++)end=e.push(.05,step);          // 1.2 s pause ends it
 assert.ok(end!==null);
 const short=new SpeechEndpoint({pauseSeconds:3});let cut=null;
 for(let i=0;i<50;i++)short.push(.9,step);                          // 5 s utterance
 for(let i=0;i<20&&cut===null;i++)cut=short.push(.05,step);       // 2 s pause: short utterances keep the 3 s rule
 assert.equal(cut,null);
});
