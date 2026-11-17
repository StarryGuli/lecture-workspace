// Execute the actual UI state machine against fake devices/DOM/providers.
// No browser automation, microphone access, credentials, or network requests.
import vm from "node:vm";
import fs from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {MobileRuntime} from './static/mobile-runtime.mjs';
import {MemoryStore} from './static/mobile-store.mjs';
import {wavFromPCM} from './static/mobile-audio.mjs';
const source = fs
  .readFileSync(new URL("./static/app.js", import.meta.url), "utf8")
  .replace(/^applyAppearance\(\);$/m, "")
  .replace(/^guard\(init\);$/m, "");
function harness() {
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        id,
        value: "",
        checked: true,
        hidden: false,
        disabled: false,
        textContent: "",
        innerHTML: "",
        dataset: {},
        style: {},
        classList: { toggle() {} },
        parentElement: {},
        handlers: {},
        addEventListener(k, f) {
          this.handlers[k] = f;
        },
        setAttribute() {},
        removeAttribute() {},
        pause() {},
        focus() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
          this.handlers.close?.();
        },
        append() {},
      });
    return elements.get(id);
  };
  class AudioContext {
    sampleRate = 16000;
    state = "running";
    async resume() {}
    async close() {
      this.state = "closed";
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    createScriptProcessor() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 0 }, connect() {} };
    }
  }
  const c = vm.createContext({
    console,
    Blob,
    URL,
    Float32Array,
    Int16Array,
    DataView,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    structuredClone,
    AudioContext,
    performance: { now: () => 200 },
    location: { pathname: "/transcript" },
    history: { pushState() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      getElementById: el,
      createElement: () => el("audio"),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      documentElement: { dataset: {} },
    },
    window: { addEventListener() {} },
    navigator: {
      mediaDevices: {
        async getUserMedia() {
          return {
            getTracks: () => [{ stop() {} }],
            getAudioTracks: () => [{}],
          };
        },
      },
    },
  });
  vm.runInContext(source, c);
  vm.runInContext(
    `
    var sent=[],saved=[],decisions=[],confirmAnswer=true;
    options={asr:{providerId:'mock',model:'mock'},text:{providerId:'mock',model:'mock'},realtimeTranscript:true,
      silence:{enabled:true,thresholdDb:-80,thresholdMode:'auto',minSilence:1.5,padding:.35},live:{chunkSeconds:12}};
    boot={prompts:{}};detailData={hasAudio:false,chunks:[],revisions:[],status:'recording'};
    current='synthetic';
    ensure=async()=>current; render=()=>{}; drawWave=()=>{};
    confirmCall=()=>confirmAnswer;
    idb=async()=>{};uploadChunk=async item=>saved.push(item);
    var actualDisplayTranscript=displayTranscript;
    displayTranscript=r=>decisions.push(r); updateGateState=()=>{};
    var actualLoad=load;
    load=async()=>{};list=async()=>{};drawCurve=()=>{};refreshUsage=async()=>{};scheduleCost=()=>{};var actualQuestionHistoryRenderer=renderQuestionHistory;renderQuestionHistory=()=>{};
    api=async()=>({});
    var actualJobs=jobs;
    jobs=async(path,body)=>{sent.push({path,body});return path.endsWith('silence-preview') ?
      {duration:23,sentSeconds:10,curve:[{db:-65,sentSeconds:10}],cliff:null,recommendedDb:-65,recommendationReason:'test',quality:null} : {seq:body.seq};};
    $('silenceEnabled').checked=true;$('silenceThreshold').value=-80;
    $('silenceDuration').value=1.5;$('silencePadding').value=.35;$('thresholdMode').value='auto';
  `,
    c,
  );
  return { c, el, run: (code) => vm.runInContext(code, c),utterance:()=>vm.runInContext("processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000).fill(.1)}});processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(48000)}})",c) };
}
test("model pause preserves the recorder clock and never submits the paused interval on resume", async () => {
  const h = harness();
  await h.run("beginRecording()");
  h.run(
    "processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(8000)}})",
  );
  await h.el("pause").onclick();
  assert.equal(h.run("recording"), true);
  assert.equal(h.run("modelPaused"), true);
  h.run(
    "processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000)}})",
  );
  assert.equal(h.run("elapsed"), 1.5);
  await h.el("pause").onclick();
  h.run(
    "processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(192000)}})",
  );
  h.run("flush('manual')");
  await h.run("queue");
  await h.run("liveQueue");
  assert.equal(h.run("elapsed"), 13.5);
  assert.equal(h.run("saved.length"), 3);
  assert.equal(h.run("saved[2].start"), 1.5);
  const submitted = h.run(
    "sent.filter(x=>x.path.endsWith('realtime-transcribe')).map(x=>x.body.seq).join(',')",
  );
  assert.ok(
    !submitted.split(",").includes("1"),
    "paused audio must never be submitted",
  );
  assert.equal(submitted.split(",").at(-1), "2");
});
test("offline review performs only a local scan; dismissal cannot trigger transcription", async () => {
  const h = harness();
  h.run("detailData.hasAudio=true");
  await h.run("runTranscribe()");
  assert.equal(h.el("silenceDialog").open, true);
  assert.equal(h.el("continueTranscribe").disabled, false);
  assert.equal(h.run("sent.length"), 1);
  assert.match(h.run("sent[0].path"), /silence-preview$/);
  h.el("silenceDialog").close();
  await assert.rejects(h.run("executeTranscribe()"), /本机曲线/);
  assert.equal(h.run("sent.length"), 1);
});
test("offline confirmation freezes the chosen threshold rather than recalibrating after consent", async () => {
  const h = harness();
  h.run("detailData.hasAudio=true");
  await h.run("runTranscribe()");
  h.run("confirmAnswer=false");
  await h.run("executeTranscribe()");
  assert.equal(h.run("sent.length"), 1);
  h.run("confirmAnswer=true");
  await h.run("executeTranscribe()");
  assert.equal(h.run("sent.length"), 2);
  assert.match(h.run("sent[1].path"), /transcribe$/);
  assert.equal(h.run("sent[1].body.config.silence.thresholdDb"), -65);
  assert.equal(h.run("sent[1].body.config.silence.thresholdMode"), "manual");
});
test("next ASR dispatch is released by transcript progress while the previous answer is pending", async () => {
  const h = harness();
  h.run(`view='assist';options.live.keywordEnabled=true;options.live.keywordProbeSeconds=3;
    displayAssistTranscript=()=>{};displayLive=()=>{};
    var releaseAnswers;var answerBarrier=new Promise(r=>releaseAnswers=r);
    jobs=async(path,body,progress)=>{sent.push({path,body});progress({transcript:{seq:body.seq}});await answerBarrier;return {seq:body.seq};};`);
  await h.run("beginRecording()");
  h.utterance();
  await h.run("queue");
  await h.run("liveQueue");
  assert.equal(h.run("sent.length"), 1);
  h.utterance();
  await h.run("queue");
  await h.run("liveQueue");
  assert.equal(h.run("sent.length"), 2);
  assert.equal(h.run("analysisTasks.size"), 2);
  h.run("releaseAnswers()");
  await h.run("Promise.allSettled([...analysisTasks])");
  assert.equal(h.run("analysisTasks.size"), 0);
});
test("new questions and late answers never replace the open question", () => {
  const h = harness();
  h.run(`notifyQuestion({seq:0,questionId:'first',analysis:{isQuestion:true,question:'第一道完整题目是什么？',answerPending:true}});
    notifyQuestion({seq:1,questionId:'second',start:60,analysis:{isQuestion:true,question:'第二道不同题目是什么？',answer:'第二题答案',answerPending:false}});`);
  assert.equal(h.run("currentQuestionKey"), "first");
  assert.equal(h.run('questionUnread.has("second")'), true);
  assert.equal(h.el("questionText").textContent, "第一道完整题目是什么？");
  h.run(
    `selectQuestion('second');notifyQuestion({seq:2,questionId:'first',analysis:{isQuestion:true,answer:'迟到的第一题答案',answerPending:false}});`,
  );
  assert.equal(h.run("currentQuestionKey"), "second");
  assert.equal(h.el("answerText").textContent, "第二题答案");
  h.run(`selectQuestion('first')`);
  assert.equal(h.el("answerText").textContent, "迟到的第一题答案");
});

test("a speech pause sends a segment before the fixed maximum interval", async () => {
  const h = harness();
  h.run("options.live.sentenceMode=true;options.live.pauseSeconds=.7;");
  await h.run("beginRecording()");
  h.run(
    "processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(24000).fill(.1)}})",
  );
  h.run(
    "processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(12800)}})",
  );
  await h.run("queue");
  await h.run("liveQueue");
  assert.equal(h.run("saved.length"), 1);
  assert.equal(h.run("saved[0].reason"), "sentence");
  assert.equal(h.run("elapsed"), 2.3);
});
test('continuous speech is not cut by legacy three or twelve second settings',async()=>{
 const h=harness();h.run("view='assist';options.live.keywordEnabled=true;options.live.keywordProbeSeconds=3;options.live.chunkSeconds=12");
 await h.run('beginRecording()');
 for(let i=0;i<35;i++)h.run('processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000).fill(.1)}})');
 await h.run('queue');assert.equal(h.run('saved.length'),0);assert.equal(h.run('sent.length'),0);
 h.run('processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(48000)}})');
 await h.run('queue');await h.run('liveQueue');assert.equal(h.run('saved.length'),1);assert.equal(h.run('saved[0].reason'),'sentence');assert.equal(h.run('saved[0].duration'),38);
});
test('meeting pickup uses a short pause independently of classroom settings',async()=>{
 const h=harness();h.run("view='record';options.live.pauseSeconds=3");await h.run('beginRecording()');
 assert.equal(h.run('liveConfig.live.pauseSeconds'),.6);assert.equal(h.run('options.live.pauseSeconds'),3);
 h.run('processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000).fill(.1)}});processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(10240)}})');
 await h.run('queue');assert.equal(h.run('saved.length'),1);
});
test('re-recognition (ASR) and re-analysis are separate: retry never turns into a new transcription',async()=>{
 const h=harness();h.run("detailData.hasAudio=true;recording=false;finishing=false;busy=0;var reviews=0;reviewAudio=async()=>reviews++");
 h.run('updateControls()');assert.equal(h.el('retranscribeAudio').hidden,false);assert.equal(h.el('retranscribeAudio').disabled,false);
 // No failed work: the re-analysis button stays hidden.
 assert.equal(h.el('retryAnalysis').hidden,true);
 await h.run("action('transcribe',{})");assert.equal(h.run('reviews'),1);assert.equal(h.run('sent.length'),0);
 await h.run('retryFailedAnalysis()');assert.equal(h.run('reviews'),1);assert.equal(h.run('sent.length'),0);
 // Without audio on this device, re-recognition is not offered at all.
 h.run('detailData.hasAudio=false;updateControls()');assert.equal(h.el('retranscribeAudio').hidden,true);
});
test('automatic task retries are bounded, back off and set the cache-bypass flag',async()=>{
 const h=harness();h.run(`var posts=[],delays=[];setTimeout=(fn,ms)=>{delays.push(ms);Promise.resolve().then(fn);};api=async(path,body)=>{if(path.startsWith('/api/jobs/'))return posts.length<3?{status:'error',message:'模型请求超时'}:{status:'done',result:{ok:true}};posts.push(body);return {job:'job'};};`);
 const result=await h.run("actualJobs('/api/sessions/synthetic/live',{seq:1},()=>{})");assert.equal(result.ok,true);assert.equal(h.run('posts.length'),3);assert.equal(h.run('posts[1].retryFailed'),true);assert.equal(h.run('posts[2].retryFailed'),true);assert.equal(h.run('delays.includes(500)&&delays.includes(1500)'),true);assert.equal(h.run('failedAnalysisTasks.size'),0);
});
test('persistent transient failures stop after two retries and remain manually retryable',async()=>{
 const h=harness();h.run(`var posts=0;setTimeout=fn=>Promise.resolve().then(fn);api=async path=>{if(path.startsWith('/api/jobs/'))return {status:'error',message:'HTTP 503 temporarily unavailable'};posts++;return {job:'job'};};`);
 await assert.rejects(h.run("actualJobs('/api/sessions/synthetic/organize',{source:'original'},()=>{})"),/503/);assert.equal(h.run('posts'),3);assert.equal(h.run('failedAnalysisTasks.size'),1);
});
test('billing errors and unknown polling transport failures cannot create automatic duplicate jobs',async()=>{
 for(const polling of [false,true]){
  const h=harness();h.c.polling=polling;h.run(`var posts=0;setTimeout=fn=>Promise.resolve().then(fn);api=async path=>{if(path.startsWith('/api/jobs/')){if(polling)throw Error('network interrupted while polling');return {status:'error',message:'HTTP 402 余额不足'};}posts++;return {job:'job'};};`);
  await assert.rejects(h.run("actualJobs('/api/sessions/synthetic/live',{seq:0},()=>{})"));assert.equal(h.run('posts'),1);
 }
});
test('different failed segments can retry concurrently',async()=>{
 const h=harness();h.run(`var counts=new Map(),initial=[];setTimeout=fn=>Promise.resolve().then(fn);api=async(path,body)=>{if(path.startsWith('/api/jobs/')){const seq=Number(path.split('/').at(-1));return counts.get(seq)===1?{status:'error',message:'分析超时'}:{status:'done',result:{seq}};}counts.set(body.seq,(counts.get(body.seq)||0)+1);initial.push(body.seq);return {job:String(body.seq)};};`);
 await h.run("Promise.all([actualJobs('/api/sessions/synthetic/live',{seq:0},()=>{}),actualJobs('/api/sessions/synthetic/live',{seq:1},()=>{})])");assert.equal(h.run('initial.slice(0,2).join()'),'0,1');assert.equal(h.run('counts.get(0)'),2);assert.equal(h.run('counts.get(1)'),2);
});
test('recording finish saves quickly; the whole-recording re-check runs only when opted in',async()=>{
 const off=harness();off.run("view='record';api=async()=>({seconds:4})");
 await off.run('beginRecording()');off.utterance();await off.run('queue');await off.run('liveQueue');await off.run('Promise.allSettled([...analysisTasks])');
 await off.run('finishRecording()');assert.equal(off.run("sent.filter(x=>x.path.endsWith('/review-live-audio')).length"),0);
 const h=harness();h.run("view='record';options.live.finalAudioReview=true;var finishActions=[];api=async path=>{finishActions.push(path);return {seconds:4};}");
 await h.run('beginRecording()');h.utterance();await h.run('queue');await h.run('liveQueue');await h.run('Promise.allSettled([...analysisTasks])');
 await h.run('finishRecording()');
 assert.equal(h.run("sent.filter(x=>x.path.endsWith('/review-live-audio')).length"),1);
 assert.ok(h.run("finishActions.some(x=>x.endsWith('/transcript-snapshot'))"));
 assert.equal(h.run("sent.at(-1).body.consent"),true);
});
test('late speech endpoint preserves newer audio in the pending buffer without moving time',async()=>{
 const h=harness();await h.run('beginRecording()');
 h.run('processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(48000).fill(.1)}});flush("sentence",32000)');
 await h.run('queue');assert.equal(h.run('saved[0].duration'),2);assert.equal(h.run('frames'),16000);assert.equal(h.run('elapsed'),3);
 h.run('flush("final")');await h.run('queue');assert.equal(h.run('saved[1].start'),2);assert.equal(h.run('saved[1].duration'),1);assert.equal(h.run('frames'),0);
});
test('streaming endpoint resampling retains fractional source frames instead of drifting',async()=>{
 const h=harness();await h.run('beginRecording()');
 h.run('ctx.sampleRate=48000;endpointSourceQuantum=3;endpointSourceTail=new Float32Array();var detectorFrames=0;endpointDetector={push:p=>detectorFrames+=p.length};for(let i=0;i<100;i++)feedSpeechEndpoint(new Float32Array(4096))');
 assert.equal(h.run('detectorFrames*3+endpointSourceTail.length'),409600);
 assert.ok(h.run('endpointSourceTail.length')<3);
});
test("page interaction cannot suppress the full-screen question alert", () => {
  const h = harness();
  h.run("questionActivity();");
  h.run(
    `notifyQuestion({questionId:'new',start:0,analysis:{isQuestion:true,question:'老师现在提出的完整题目是什么？',answerPending:true}});`,
  );
  assert.equal(Boolean(h.el("questionDialog").open), false);
  assert.equal(h.run("questionUnread.size"), 1);
  assert.equal(h.el("questionInboxLauncher").hidden, false);
  assert.equal(h.run("currentQuestionKey"), "new");
  assert.equal(h.el("questionAlertDialog").open, true);
  h.el("openQuestionInbox").onclick();
  assert.equal(h.run("currentQuestionKey"), "new");
  assert.equal(h.el("questionDialog").open, true);
});
test("previous and next navigation retain answers arriving in the background", () => {
  const h = harness();
  h.run(`showQuestion({questionId:'a',start:0,analysis:{isQuestion:true,question:'第一题如何求机构自由度？',answer:'第一题答案',answerPending:false}});
 notifyQuestion({questionId:'b',start:60,analysis:{isQuestion:true,question:'第二题如何判断连续传动？',answerPending:true}});`);
  h.el("nextQuestion").onclick();
  assert.equal(h.run("currentQuestionKey"), "b");
  h.el("previousQuestion").onclick();
  h.run(
    `notifyQuestion({questionId:'b',start:60,analysis:{isQuestion:true,question:'第二题如何判断连续传动？',answer:'第二题完成',answerPending:false}});`,
  );
  assert.equal(h.el("answerText").textContent, "第一题答案");
  h.el("nextQuestion").onclick();
  assert.equal(h.el("answerText").textContent, "第二题完成");
});
test("duplicate question updates one history item and does not regress a completed answer to pending", () => {
  const h = harness();
  h.run(`showQuestion({questionId:'a',start:0,analysis:{isQuestion:true,question:'为什么渐开线只能在基圆及其外部形成？',answer:'已有答案',answerPending:false}});
 notifyQuestion({questionId:'alias',start:20,analysis:{isQuestion:true,question:'为什么渐开线只能在基圆及其外部形成呢？',answer:'等待',answerPending:true}});`);
  assert.equal(h.run("questionOrder.length"), 1);
  assert.equal(h.el("answerText").textContent, "已有答案");
});
test("different numbers remain separate questions", () => {
  const h = harness();
  h.run(`showQuestion({questionId:'a',start:0,analysis:{isQuestion:true,question:'第一题请计算 x+1 的结果是多少？'}});
 notifyQuestion({questionId:'b',start:10,analysis:{isQuestion:true,question:'第二题请计算 x+1 的结果是多少？'}});`);
  assert.equal(h.run("questionOrder.length"), 2);
});
test("historical questions restore without opening an alert", () => {
  const h = harness();
  h.run(
    `detailData.revisions=[{kind:'live',content:{questionId:'old',start:0,analysis:{isQuestion:true,question:'上一节课堂的完整题目是什么？',answer:'历史答案',answerPending:false}}}];restoreQuestionInbox();`,
  );
  assert.equal(h.run("questionOrder.length"), 1);
  assert.equal(Boolean(h.el("questionDialog").open), false);
  assert.equal(h.run("questionUnread.size"), 0);
});
test("closing a reader retains its question and does not suppress future full-screen alerts", () => {
  const h = harness();
  h.run(
    `showQuestion({questionId:'a',start:0,analysis:{isQuestion:true,question:'如何求当前机构的自由度？'}});`,
  );
  h.el("questionAutoToggle").onclick();
  assert.equal(h.run("questionAttentionLocked"), true);
  assert.equal(h.el("questionDialog").open, false);
  h.run(
    `notifyQuestion({questionId:'b',start:60,analysis:{isQuestion:true,question:'怎样判断齿轮能否连续传动？'}});`,
  );
  assert.equal(h.run("currentQuestionKey"), "a");
  assert.equal(h.run("questionAlertKey"), "b");
  assert.equal(h.el("questionAlertDialog").open, true);
});

test("alerts interrupt reading in red but never replace the previous answer", () => {
 const h=harness();
 h.run(`showQuestion({questionId:'a',analysis:{isQuestion:true,question:'上一题完整问题是什么？',answer:'保留的答案'}});questionActivity();notifyQuestion({questionId:'b',start:60,analysis:{isQuestion:true,question:'新题完整问题是什么？',answerPending:true}});`);
 assert.equal(h.el('questionAlertDialog').open,true);
 assert.equal(h.el('questionAlertText').textContent,'新题完整问题是什么？');
 assert.equal(h.el('answerText').textContent,'保留的答案');
 h.el('dismissQuestionAlert').onclick();
 assert.equal(h.el('questionAlertDialog').open,false);
 assert.equal(h.run('currentQuestionKey'),'a');
});
test("three arriving questions retain all alerts without replacing the active alert", () => {
 const h=harness();
 h.run(`for(let i=0;i<3;i++)notifyQuestion({questionId:'q'+i,start:i*60,analysis:{isQuestion:true,question:'第'+i+'题：计算本题结果？',answerPending:true}});`);
 assert.equal(h.run('questionOrder.length'),3);
 assert.equal(h.run('questionAlertQueue.length'),3);
 assert.equal(h.run('questionAlertKey'),'q0');
 h.el('dismissQuestionAlert').onclick();
 assert.equal(h.run('questionAlertKey'),null);
 assert.equal(h.el('questionAlertDialog').open,false);
 assert.equal(h.run('questionUnread.size'),3);
});
test("arrow keys switch questions but do not steal textarea editing", () => {
 const h=harness();
 h.run(`showQuestion({questionId:'a',analysis:{isQuestion:true,question:'第一道题？'}});notifyQuestion({questionId:'b',start:60,analysis:{isQuestion:true,question:'第二道题？'}});dismissQuestionAlert();`);
 h.run(`handleQuestionNavigation({key:'ArrowRight',target:{closest:()=>null},preventDefault(){}});`);
 assert.equal(h.run('currentQuestionKey'),'b');
 h.run(`handleQuestionNavigation({key:'ArrowLeft',target:{closest:()=>true},preventDefault(){throw Error('input interrupted')}});`);
 assert.equal(h.run('currentQuestionKey'),'b');
 h.run(`handleQuestionNavigation({key:'ArrowUp',target:{closest:()=>null},preventDefault(){}});`);
 assert.equal(h.run('currentQuestionKey'),'a');
});
test("paragraph grouping removes generated timestamps without dropping words", () => {
 const h=harness();
 const groups=h.run(`paragraphSegments([{start:0,end:3,text:'[00:00—00:03] 今天讲基圆。'},{start:3,end:6,text:'接着讨论渐开线。'},{start:10,end:12,text:'新的一个话题。'}])`);
 assert.equal(groups.length,2);
 assert.equal(groups[0].text,'今天讲基圆。接着讨论渐开线。');
 assert.equal(groups[1].start,10);
});
test("a deferred or silent update cannot clear the last real knowledge point", () => {
 const h=harness();
 h.run(`view='assist';liveEvents=[{seq:0,start:10,analysis:{topic:'渐开线的形成'}},{seq:1,start:20,deferred:true,analysis:{topic:'等待下一段课堂分析'}}];updateTopicDisplay();`);
 assert.equal(h.el('currentTopic').textContent,'渐开线的形成');
});

test("switching records removes history buttons from the previous record", () => {
 const h=harness();
 h.run(`showQuestion({questionId:'current',analysis:{isQuestion:true,question:'当前记录的题目？'}});
 var currentButton={dataset:{questionKey:'current'},setAttribute(){}};
 var staleButton={dataset:{questionKey:'stale'},remove(){this.removed=true;}};
 $('questionHistory').querySelectorAll=()=>[currentButton,staleButton];
 $('questionHistory').children=[currentButton];
 actualQuestionHistoryRenderer();`);
 assert.equal(h.run('staleButton.removed'),true);
});

test("formatted outputs escape model HTML and preserve list numbering across paragraphs", () => {
 const h=harness();
 const html=h.run("formattedText("+JSON.stringify("1. 第一项\n说明内容\n2. 第二项\n<script>bad()</script>")+")");
 assert.match(html,/<ol start="2">/);
 assert.ok(!html.includes('<script>'));
 assert.ok(html.includes('&lt;script&gt;'));
});

test("placeholder knowledge points never replace a substantive topic", () => {
 const h=harness();
 h.run(`view='assist';liveEvents=[{seq:0,start:0,analysis:{topic:'材料的屈服强度'}},{seq:1,start:5,analysis:{topic:'未识别'}},{seq:2,start:8,analysis:{topic:'课堂片段'}}];updateTopicDisplay();`);
 assert.equal(h.el('currentTopic').textContent,'材料的屈服强度');
 assert.match(h.run(`questionDetectionSummary({analysis:{isQuestion:false,questionType:'lecture'}})`),/判为讲解/);
});

test("late sentence correction replaces only covered chunks and leaves raw source intact", () => {
  const h = harness();
  h.run(`view='assist';options.live.correctTranscript=true;
    liveTranscripts.set(0,{seq:0,start:0,segments:[{start:0,end:3,text:'机圆内没有建开线。'}]});
    liveTranscripts.set(1,{seq:1,start:3,segments:[{start:3,end:6,text:'后面一句完整保留。'}]});
    displayCorrection({revision:'fixed-0',sequences:[0],correctionState:'corrected',segments:[{seq:0,start:0,end:3,text:'基圆内没有渐开线。'}]});`);
  assert.match(h.run("assistTranscriptMarkup()"), /基圆内没有渐开线/);
  assert.match(h.run("assistTranscriptMarkup()"), /后面一句完整保留/);
  assert.equal(h.run("liveTranscripts.get(0).segments[0].text"), "机圆内没有建开线。");
  assert.match(h.run("transcriptEntries(true)[0].text"), /机圆/);
});
test("live classroom display and text export select the same corrected or original source", () => {
  const h = harness();
  h.run(`view='transcript';recording=true;tabKind='verbatim';options.live.correctTranscript=true;
    detailData.revisions=[{id:'raw-0',kind:'transcript-chunk',content:{seq:0,start:0,segments:[{start:0,end:3,text:'机圆'}]}}];
    displayCorrection({revision:'fixed-0',sequences:[0],correctionState:'corrected',segments:[{seq:0,start:0,end:3,text:'基圆'}]});`);
  assert.match(h.run("readingRevision().content.text"), /基圆/);
  assert.ok(h.run("readingRevision().synthetic"));
  h.run("tabKind='raw'");
  assert.match(h.run("readingRevision().content.text"), /机圆/);
  assert.match(h.run("correctionStatus()"), /1 段已完成/);
});
test("failed correction stays visible as raw text with an explicit failure count", () => {
  const h = harness();
  h.run(`view='assist';options.live.correctTranscript=true;
    liveTranscripts.set(0,{seq:0,start:0,segments:[{start:0,end:3,text:'完整原句'}]});
    displayCorrection({revision:'failed-0',sequences:[0],correctionState:'failed',segments:[{seq:0,start:0,end:3,text:'完整原句'}]});`);
  assert.match(h.run("assistTranscriptMarkup()"), /完整原句/);
  assert.match(h.run("correctionStatus()"), /1 段失败，保留原文/);
});
test("classroom ASR continues while the previous sentence correction remains pending", async () => {
  const h=harness();
  h.run(`view='transcript';options.live.correctTranscript=true;options.live.chunkSeconds=3;
    var releaseCorrection;var correctionBarrier=new Promise(r=>releaseCorrection=r);
    jobs=async(path,body,progress)=>{sent.push({path,body});progress({transcript:{seq:body.seq,revision:'r'+body.seq}});await correctionBarrier;return {seq:body.seq,revision:'r'+body.seq};};`);
  await h.run('beginRecording()');
  for(let i=0;i<2;i++){
    h.utterance();
    await h.run('queue');await h.run('liveQueue');
  }
  assert.equal(h.run('sent.length'),2);
  assert.equal(h.run('analysisTasks.size'),2);
  assert.equal(h.run('tabKind'),'verbatim');
  h.run('releaseCorrection()');await h.run('Promise.allSettled([...analysisTasks])');
});
test("classroom assistant can compare raw text and return to the corrected view", () => {
  const h=harness();
  h.run(`view='assist';liveTranscripts.set(0,{seq:0,start:0,segments:[{start:0,end:3,text:'机圆'}]});
    displayCorrection({revision:'fixed',sequences:[0],correctionState:'corrected',segments:[{seq:0,start:0,end:3,text:'基圆'}]});`);
  assert.match(h.run('assistTranscriptMarkup()'),/基圆/);
  h.run('assistOriginal=true');assert.match(h.run('assistTranscriptMarkup()'),/机圆/);
  h.run('assistOriginal=false');assert.match(h.run('assistTranscriptMarkup()'),/基圆/);
});
test("answer text is readable while streaming and final answers cannot regress to partial text", () => {
  const h=harness();
  h.run(`notifyQuestion({questionId:'streamed',start:0,analysis:{isQuestion:true,question:'测试流式问题是什么？',answerPending:true,answerStreaming:true,answer:'已收到的第一句'}});`);
  h.run("selectQuestion('streamed')");
  assert.equal(h.el('answerText').textContent,'已收到的第一句');
  h.run(`notifyQuestion({questionId:'streamed',analysis:{isQuestion:true,answerPending:false,answerStreaming:false,answer:'最终完整答案'}});
    notifyQuestion({questionId:'streamed',analysis:{isQuestion:true,answerPending:true,answerStreaming:true,answer:'迟到的旧片段'}});`);
  assert.equal(h.el('answerText').textContent,'最终完整答案');
});
test("interrupted streamed answers show partial text and an explicit incompleteness warning", () => {
  const h=harness();
  h.run(`notifyQuestion({questionId:'interrupted',start:0,analysis:{isQuestion:true,question:'测试中断的问题是什么？',answerPending:false,answerStreaming:false,answer:'只有前半句',answerIncomplete:true,answerError:'synthetic disconnect'}});`);
  assert.equal(h.el('answerText').textContent,'只有前半句');
  assert.match(h.el('evidenceText').textContent,/未完成/);
});

test("active classroom can return from settings and appearance without reloading or losing its recorder", async () => {
  const h=harness();
  h.run(`view='assist';detailData.mode='live';var reloads=0;load=async()=>reloads++;`);
  await h.run('beginRecording()');
  h.run(`elapsed=123;liveTranscripts.set(7,{seq:7,text:'现有逐字稿'});var sameEngine=ctx;
    lastSessions.assist='an-older-record';allSessions=[{id:'an-older-record'}];`);
  await h.run("navigate('settings')");await h.run("navigate('design')");await h.run("navigate('assist')");
  assert.equal(h.run('view'),'assist');assert.equal(h.run('recording'),true);
  assert.equal(h.run('current'),'synthetic');assert.equal(h.run('elapsed'),123);
  assert.equal(h.run('liveTranscripts.get(7).text'),'现有逐字稿');assert.equal(h.run('ctx===sameEngine'),true);assert.equal(h.run('reloads'),0);
});
test("other recording pages remain browsable while capture retains its original session and mode", async () => {
  const h=harness();h.run("view='assist';detailData.mode='live'");await h.run('beginRecording()');
  await h.run("navigate('settings')");await h.run("navigate('transcript')");
  assert.equal(h.run('view'),'transcript');assert.equal(h.run('recording'),true);assert.equal(h.run('recordingSessionId'),'synthetic');assert.equal(h.run('recordingPage'),'assist');
  await h.run("navigate('assist')");assert.equal(h.run('view'),'assist');
});
test('opening an old record keeps capture, uploads and new transcripts attached to the active session',async()=>{
 const h=harness();await h.run('beginRecording()');h.run(`var engineBeforeBrowse=ctx;api=async path=>({id:path.split('/').at(-1),mode:'class',status:'saved',hasAudio:true,chunks:[],documents:[],marks:[],revisions:[]});jobs=async(path,body,progress)=>{sent.push({path,body});const r={seq:body.seq,start:0,revision:'capture-raw',segments:[{start:0,end:4,text:'CURRENT_CAPTURE_ONLY'}]};progress?.({transcript:r});return r;};`);
 await h.run("actualLoad('older')");h.utterance();await h.run('queue');await h.run('liveQueue');await h.run('Promise.allSettled([...analysisTasks])');
 assert.equal(h.run('current'),'older');assert.equal(h.run('saved[0].sid'),'synthetic');assert.match(h.run('sent[0].path'),/sessions\/synthetic\//);assert.doesNotMatch(h.run('JSON.stringify(detailData)'),/CURRENT_CAPTURE_ONLY/);assert.equal(h.run('ctx===engineBeforeBrowse'),true);
 await h.run("actualLoad('synthetic')");assert.match(h.run('JSON.stringify(detailData)'),/CURRENT_CAPTURE_ONLY/);assert.equal(h.run('recording'),true);
});
test('resuming an interrupted local session appends audio after saved sequence and duration',async()=>{
 const store=new MemoryStore(),runtime=new MobileRuntime({store,keyring:{}}),sid=(await runtime.api('/api/sessions',{mode:'record'})).id;
 const original=wavFromPCM(new Int16Array(32000));await runtime.api('/api/sessions/'+sid+'/chunk',original,{'X-Sequence':'0','X-Start':'0','X-Analyze':'0'});
 const h=harness();h.c.runtime=runtime;h.c.resumeSid=sid;h.c.resumedDetail=await runtime.detail(sid);
 h.run("window.LectureMobile=runtime;current=resumeSid;detailData=resumedDetail;view='record'");await h.run('beginRecording(true)');
 assert.equal(h.run('seq'),1);assert.equal(h.run('samplesSent'),32000);assert.equal(h.run('elapsed'),2);assert.equal(h.run('recordingSessionId'),sid);
 h.utterance();await h.run('queue');assert.equal(h.run('saved[0].seq'),1);assert.equal(h.run('saved[0].start'),2);assert.equal(h.run('saved[0].sid'),sid);
 assert.deepEqual(await (await store.get('chunks',sid+':0')).blob.arrayBuffer(),await original.arrayBuffer());
});
test('stopping from an older record finalizes the capture owner without changing the viewed record',async()=>{
 const h=harness();await h.run('beginRecording()');h.run(`var routes=[];api=async path=>{routes.push(path);return path.endsWith('/finish')?{seconds:4}:{id:path.split('/').at(-1),mode:'class',status:'saved',hasAudio:true,chunks:[],documents:[],marks:[],revisions:[]};};`);
 await h.run("actualLoad('older')");h.utterance();await h.run('queue');await h.run('liveQueue');await h.run('stop()');
 assert.equal(h.run('current'),'older');assert.equal(h.run('detailData.id'),'older');assert.equal(h.run('recording'),false);assert.equal(h.run('recordingSessionId'),null);
 assert.equal(h.run("routes.filter(p=>p.endsWith('/finish')).join()"),'/api/sessions/synthetic/finish');
});
test("microphone permission wait keeps the original recording mode even when viewing settings", async () => {
  const h=harness();
  h.run(`var releaseMic;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>releaseMic=r);view='transcript';detailData.mode='class';var opening=start();`);
  await h.run('Promise.resolve()');await h.run('Promise.resolve()');
  assert.equal(h.run('starting'),true);await h.run("navigate('settings')");
  h.run(`releaseMic({getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{}]})`);await h.run('opening');
  assert.equal(h.run('liveConfig.realtimeKind'),'transcript');await h.run("navigate('transcript')");assert.equal(h.run('recording'),true);
});

test("recorded audio is assembled before waiting for slow analysis", async () => {
  const h=harness();
  h.run(`view='assist';detailData.mode='live';pending=async()=>[];displayLive=()=>{};
    var releaseSlow;var slow=new Promise(r=>releaseSlow=r);var apiCalls=[];
    api=async(path,body)=>{apiCalls.push({path,body});return {seconds:0}};`);
  await h.run('beginRecording()');h.run('analysisTasks.add(slow);var stopping=stop()');
  for(let i=0;i<8;i++)await h.run('Promise.resolve()');
  assert.ok(h.run("apiCalls.some(r=>r.path.endsWith('/finish') && r.body.finalized===false)"));
  assert.equal(h.run('detailData.hasAudio'),true);
  assert.equal(h.run('finishing'),true);
  h.run('releaseSlow()');await h.run('stopping');
  assert.ok(h.run("apiCalls.some(r=>r.path.endsWith('/complete-live'))"));
});
test("home model labels use the actual recording snapshot and health explains missing input", async () => {
  const h=harness();await h.run('beginRecording()');
  h.run("options.asr.model='next-recording-model';lastAudioAt=0;recordingStartedAt=Date.now()-4000;updatePipelineStatus()");
  assert.equal(h.run('runtimeConfig().asr.model'),'mock');
  assert.match(h.el('pipelineStatus').textContent,/麦克风尚未返回音频/);
  h.run("lastAudioAt=Date.now();pipelineStage(0,'asr',{rawReady:false})");
  assert.match(h.el('pipelineStatus').textContent,/语音识别处理中/);
});
test("record button unlocks the audio context before asynchronous permission and session work", async () => {
  const h=harness();
  h.run(`var order=[];AudioContext.prototype.resume=async function(){order.push('resume')};ensure=async()=>{order.push('session');return current};`);
  await h.run('start()');
  assert.equal(h.run('order[0]'),'resume');assert.equal(h.run('recording'),true);
});

test('capture status distinguishes actual input, waiting threshold, pause and interruption',()=>{
 const h=harness();
 h.run(`recording=true;starting=false;paused=false;lastAudioAt=Date.now();liveSession=true;options.silence={enabled:true,minSilence:1.5,padding:.35};effectiveThreshold=-40;lastInputDb=-30;belowThresholdSeconds=0;`);
 assert.equal(h.run('captureStatusState().kind'),'active');
 // A short pause keeps the lamp on; standby only after the full silence hold.
 h.run('lastInputDb=-60;belowThresholdSeconds=1');
 assert.equal(h.run('captureStatusState().kind'),'active');
 h.run('belowThresholdSeconds=3');
 assert.match(h.run('captureStatusState().title'),/待机/);
 h.run('lastInputDb=-30;belowThresholdSeconds=0');assert.equal(h.run('captureStatusState().kind'),'active');
 h.run('modelPaused=true');assert.equal(h.run('captureStatusState().kind'),'paused');
 h.run('modelPaused=false;lastAudioAt=Date.now()-5000');assert.equal(h.run('captureStatusState().kind'),'warning');
 h.run('recording=false');assert.equal(h.run('captureStatusState().kind'),'idle');
});
test('transcript presentation hides silence placeholders while preserving real source times',()=>{
 const h=harness();const r=h.run(`paragraphSegments([{start:0,end:2,text:'第一段。'},{start:2,end:8,skipped:true,text:'【静音跳过，原录音保留】'},{start:8,end:10,text:'第二段。'}])`);
 assert.equal(r.length,2);assert.equal(r[1].start,8);assert.ok(r.every(x=>!x.skipped));
});

test('live transcript follows the bottom but preserves a reader scrolling above',()=>{
 const h=harness();h.run(`view='assist';current='x';`);
 const node={scrollTop:200,scrollHeight:500,clientHeight:300};
 h.c.scrollNode=node;
 h.run('rememberTranscriptScroll(scrollNode)');node.scrollHeight=800;
 h.run('restoreTranscriptScroll(scrollNode)');assert.equal(node.scrollTop,800);
 node.scrollTop=100;h.run('rememberTranscriptScroll(scrollNode)');node.scrollHeight=1000;
 h.run('restoreTranscriptScroll(scrollNode)');assert.equal(node.scrollTop,100);
});

test('ordinary recording submits live transcript chunks without classroom question requests',async()=>{
 const h=harness();h.run("view='record';options.live.retainTranscript=false");await h.run('beginRecording()');
 assert.equal(h.run('liveSession'),true);assert.equal(h.run('liveConfig.realtimeKind'),'transcript');assert.equal(h.run('liveConfig.live.retainTranscript'),true);
 h.utterance();
 await h.run('queue');await h.run('liveQueue');await h.run('Promise.allSettled([...analysisTasks])');
 assert.equal(h.run("sent.filter(x=>x.path.endsWith('/realtime-transcribe')).length"),1);
 assert.equal(h.run("sent.filter(x=>x.path.endsWith('/live')).length"),0);
 assert.equal(h.run('saved.length'),1);assert.equal(h.run("tabKind"),'raw');
});
test('ordinary live text is visible immediately and corrections can be compared without overwriting raw',()=>{
 const h=harness();h.run("view='record';recording=true;tabKind='raw';actualDisplayTranscript({seq:0,start:0,revision:'chunk-0',text:'raw voice words',segments:[{start:0,end:3,text:'raw voice words'}]})");
 assert.match(h.run('recordTranscriptMarkup()'),/raw voice words/);
 h.run("displayCorrection({revision:'fix-0',sequences:[0],correctionState:'corrected',segments:[{seq:0,start:0,end:3,text:'corrected voice words'}]})");
 assert.match(h.run('recordTranscriptMarkup()'),/corrected voice words/);
 h.run("action('toggleRecordSource',null)");assert.match(h.run('recordTranscriptMarkup()'),/raw voice words/);
 assert.equal(h.run("detailData.revisions.find(r=>r.id==='chunk-0').content.segments[0].text"),'raw voice words');
});
test('ordinary live finish snapshots existing text and does not start another paid full transcription',async()=>{
 const h=harness();h.run("view='record';var finishedCalls=[];var reviewCalls=0;api=async(path)=>{finishedCalls.push(path);return {seconds:1};};reviewAudio=async()=>reviewCalls++");
 await h.run('beginRecording()');h.run('processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000)}})');
 await h.run('finishRecording()');
 assert.equal(h.run('reviewCalls'),0);
 assert.equal(h.run("finishedCalls.some(p=>p.endsWith('/transcript-snapshot'))"),true);
 assert.equal(h.run("sent.filter(p=>p.path.endsWith('/realtime-transcribe')).length"),1);
 assert.equal(h.run("sent.some(p=>p.path.endsWith('/transcribe'))"),false);
});
test('ordinary records keep explicitly selected historical text versions readable',()=>{
 const h=harness();h.run("view='record';recording=false;tabKind='raw';recordVersionPinned=true;activeRevision='old';detailData.revisions=[{id:'old',kind:'raw',content:{text:'old saved source'}},{id:'new',kind:'verbatim',content:{text:'new corrected source'}}]");
 assert.equal(h.run('readingRevision().content.text'),'old saved source');
 h.run('recordVersionPinned=false');assert.equal(h.run('readingRevision().content.text'),'new corrected source');
});

 test('lamp updates without an expanded details panel and follows current capture state',()=>{
 const h=harness();h.run("var realGet=document.getElementById;document.getElementById=id=>id==='captureStatus'?null:realGet(id); recording=true;lastAudioAt=Date.now();lastInputDb=-20;effectiveThreshold=-40;updateCaptureStatus()");
 assert.equal(h.el('lamp').dataset.state,'active');assert.equal(h.el('micStatus').textContent,'正在收音');
 h.run('lastInputDb=-65;belowThresholdSeconds=1;updateCaptureStatus()');assert.equal(h.el('lamp').dataset.state,'active');
 h.run('belowThresholdSeconds=options.silence.minSilence;updateCaptureStatus()');assert.equal(h.el('lamp').dataset.state,'gated');
 h.run('lastAudioAt=0;updateCaptureStatus()');assert.equal(h.el('lamp').dataset.state,'warning');
 h.run('recording=false;updateCaptureStatus()');assert.equal(h.el('lamp').dataset.state,'idle');
 });
 test('live record organization snapshots corrected text and uses frozen models without stopping capture',async()=>{
 const h=harness();h.run("view='record';recording=true;boot.prompts.record='keep all';pendingKind='record';liveConfig=structuredClone(options);var liveCalls=[];api=async path=>{liveCalls.push(path);return path.endsWith('/transcript-snapshot')?{revision:'raw'}:{revisions:[{id:'fixed',kind:'verbatim',content:{text:'corrected conversation'}}]};};recordTranscriptRevision=()=>({content:{text:'corrected conversation'}});$('promptText').value='keep all';jobs=async(path,body)=>{sent.push({path,body});return {revision:'organized'};}");
 await h.run('runPrompt()');assert.equal(h.run('recording'),true);assert.equal(h.run('sent[0].body.source'),'fixed');assert.equal(h.run('tabKind'),'record');
 assert.equal(h.run("liveCalls[0].endsWith('/transcript-snapshot')"),true);
 await h.run('organizeLiveRecord()');assert.equal(h.run('sent.length'),1);
 h.run("liveOrganization.nextAt=0;recordTranscriptRevision=()=>({content:{text:'new complete paragraph'}})");await h.run('organizeLiveRecord()');assert.equal(h.run('sent.length'),2);
 h.run('finishing=true;liveOrganization.nextAt=0');await h.run('organizeLiveRecord()');assert.equal(h.run('sent.length'),2);
 });
 test('failed live organization stops retries but preserves recording and source',async()=>{
 const h=harness();h.run("recording=true;liveOrganization={sid:current,nextAt:0,body:{}};recordTranscriptRevision=()=>({content:{text:'source'}});api=async()=>{throw Error('HTTP 402')}");
 await assert.rejects(h.run('organizeLiveRecord()'),/402/);assert.equal(h.run('recording'),true);assert.equal(h.run('liveOrganization'),null);
 });

test('compact usage computes cache percentage and preserves unknown prices and empty states',()=>{
 const h=harness();
 assert.deepEqual(Array.from(h.run('usageMetrics(null)')),['—','—','—','—','—']);
 assert.deepEqual(Array.from(h.run('usageMetrics({audioSeconds:12.34,inputTokens:2000,outputTokens:50,cachedTokens:500,requests:2,amounts:{CNY:.123456}})')),['12.3 s','2,000','50','25.0%','CNY 0.123456']);
 assert.equal(h.run('usageMetrics({inputTokens:0,cachedTokens:20})[3]'),'—');
 assert.equal(h.run('usageMetrics({requests:1})[4]'),'单价或用量待补全');
 assert.equal(h.run('usageMetrics({requests:0})[4]'),'尚无请求');
 const nodes=Array.from({length:5},(_,i)=>({dataset:{usageMetric:String(i)},textContent:''}));
 h.c.metricNodes=nodes;
 h.run("document.querySelectorAll=()=>metricNodes;usageData={inputTokens:80,cachedTokens:20,outputTokens:9};renderUsage()");
 assert.equal(nodes[3].textContent,'25.0%');
 h.run('current=null;renderUsage()');assert.ok(nodes.every(n=>n.textContent==='—'));
});

test('quick models save idle defaults atomically and retain non-model settings',()=>{
 const h=harness();
 h.run(`boot.providers=[{id:'new',name:'New',models:['one',{id:'two'}]}];options.text.temperature=.3;
 var change={asr:{providerId:'new',model:' next-asr '},correction:{providerId:'new',model:'next-correction'},text:{providerId:'new',model:'next-text'}};
 applyQuickModels(change)`);
 assert.equal(h.run('options.asr.model'),'next-asr');assert.equal(h.run('options.text.temperature'),.3);
 assert.equal(h.run('liveConfig'),null);
 h.run("change.text.model=' '");assert.throws(()=>h.run('applyQuickModels(change)'),/模型 ID/);
 assert.equal(h.run('options.text.model'),'next-text');
 assert.match(h.run('quickModelsMarkup()'),/quick-correction-model/);
 assert.match(h.run('sessionSetupMarkup()'),/data-action="openQuickModels"/);
 assert.match(h.run('modelListMarkup(boot.providers[0])'),/value="two"/);
});

test('quick SiliconFlow model picker exposes verified free candidates and price states',()=>{
 const h=harness();h.run(`boot.providers=[{id:'siliconflow',name:'硅基流动',baseURL:'https://api.siliconflow.cn/v1',models:[]}];
 boot.priceQuotes={};options.asr={...options.asr,providerId:'siliconflow',model:'Qwen/Qwen3-ASR-1.7B'};
 options.correction={...options.correction,providerId:'siliconflow',model:'XingChenAGI/Xing4.0-29B'};
 options.text={...options.text,providerId:'siliconflow',model:'unknown/model'};`);
 assert.match(h.run(`quickPriceText('asr','siliconflow','Qwen/Qwen3-ASR-1.7B')`),/0\.00022.*0\.792/);
 assert.doesNotMatch(h.run(`quickPriceText('asr','siliconflow','Qwen/Qwen3-ASR-1.7B')`),/免费/);
 assert.equal(h.run(`quickPriceText('correction','siliconflow','XingChenAGI/Xing4.0-29B')`),'免费 · 硅基流动公开价格页');
 assert.match(h.run(`quickPriceText('text','siliconflow','unknown/model')`),/价格待核对/);
 const html=h.run('quickModelsMarkup()');assert.match(html,/官方当前免费/);assert.match(html,/siliconflow\.cn\/pricing/);
});

test('short idle ordinary transcripts collapse the empty canvas but active recording keeps full workspace',()=>{
 const h=harness();h.run("view='record';tabKind='raw';current=null;detailData=null;recording=false;starting=false;finishing=false");
 assert.match(h.run('recordPage()'),/sparse-record-grid/);
 h.run('recording=true');assert.doesNotMatch(h.run('recordPage()'),/sparse-record-grid/);
});

test('recording model changes affect subsequent chunks while pending requests retain all model snapshots',async()=>{
 const h=harness();h.run(`view='record';boot.providers=[{id:'mock',name:'Mock'},{id:'new',name:'New'}];options.correction={providerId:'mock',model:'old-correction'};`);
 await h.run('beginRecording()');
 h.utterance();
 await h.run('queue');await h.run('liveQueue');
 assert.equal(h.run('sent.length'),1);
 h.run(`applyQuickModels(Object.fromEntries(['asr','correction','text'].map(role=>[role,{providerId:'new',model:'new-'+role}])));`);
 assert.equal(h.run('recording'),true);
 for(const role of ['asr','correction','text']){
  assert.equal(h.run(`options.${role}.model`),'new-'+role);
  assert.equal(h.run(`liveConfig.${role}.model`),'new-'+role);
  assert.equal(h.run(`sent[0].body.config.${role}.providerId`),'mock');
 }
 h.utterance();
 await h.run('queue');await h.run('liveQueue');await h.run('Promise.allSettled([...analysisTasks])');
 assert.equal(h.run('sent.length'),2);
 for(const role of ['asr','correction','text']) assert.equal(h.run(`sent[1].body.config.${role}.model`),'new-'+role);
});

test('live organization freezes in-flight configuration and takes new models on its next run',async()=>{
 const h=harness();h.run(`recording=true;boot.providers=[{id:'new',name:'New'}];liveConfig=structuredClone(options);
 liveOrganization={sid:current,text:'',nextAt:0,body:{config:structuredClone(options)}};
 recordTranscriptRevision=()=>({content:{text:'paragraph'}});
 var releaseSnapshot;var snapshotWait=new Promise(r=>releaseSnapshot=r);var snapshotCount=0;
 api=async path=>path.endsWith('/transcript-snapshot')?(++snapshotCount===1?await snapshotWait:{}):{revisions:[{id:'source',kind:'raw'}]};
 jobs=async(path,body)=>{sent.push({path,body});return {revision:'source'}};
 var firstOrganization=organizeLiveRecord();`);
 h.run(`applyQuickModels(Object.fromEntries(['asr','correction','text'].map(role=>[role,{providerId:'new',model:'new-'+role}])));releaseSnapshot({})`);
 await h.run('firstOrganization');assert.equal(h.run('sent[0].body.config.text.model'),'mock');
 h.run("liveOrganization.nextAt=0;recordTranscriptRevision=()=>({content:{text:'second paragraph'}})");
 await h.run('organizeLiveRecord()');assert.equal(h.run('sent[1].body.config.text.model'),'new-text');
 assert.equal(h.run('sent[0].body.config.text.model'),'mock');
});
