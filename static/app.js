"use strict";
document.addEventListener('lecture-audio-export-status',e=>tell(e.detail));
let currentTimeoutBudget=null;
document.addEventListener('lecture-timeout-budget',e=>{if(e.detail.sid===current){currentTimeoutBudget=e.detail;updatePipelineStatus();}});
// Keep the work area and fixed recorder tied to the actual browser viewport.
// No device-name checks: iPad split views use the same width rules as any window.
let responsiveFrame = 0;
let responsiveObserver;
function scheduleResponsiveLayout() {
  if (typeof requestAnimationFrame !== "function") return;
  if (responsiveFrame) return;
  responsiveFrame = requestAnimationFrame(() => {
    responsiveFrame = 0;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const unzoomed = !vv || Math.abs(vv.scale - 1) < .05;
    const visibleHeight = unzoomed && vv ? vv.height : window.innerHeight;
    const visibleTop = unzoomed && vv ? vv.offsetTop : 0;
    const keyboardLift = unzoomed ? Math.max(0, window.innerHeight - visibleHeight - visibleTop) : 0;
    root.style.setProperty('--visible-height', `${visibleHeight}px`);
    root.style.setProperty('--visible-top', `${visibleTop}px`);
    root.style.setProperty('--keyboard-lift', `${keyboardLift}px`);
    root.dataset.keyboardOpen = String(keyboardLift > 120);
    const dock = document.getElementById('recorder');
    const dockHeight = dock && !dock.hidden ? dock.getBoundingClientRect().height : 0;
    // CSS applies the bottom safe area to the dock. Measure its actual lower gap.
    const bottomGap = dockHeight ? Math.max(0, window.innerHeight - dock.getBoundingClientRect().bottom) : 0;
    const reserve = dockHeight ? Math.ceil(dockHeight + bottomGap + 20) : 24;
    root.style.setProperty('--recorder-reserve', `${reserve}px`);
    const header = document.querySelector('.app-header');
    root.style.setProperty('--header-height', `${Math.ceil(header?.getBoundingClientRect().height || 0)}px`);
    const work = document.querySelector('.assist-workbench,.transcript-layout,.record-grid');
    if (work) {
      // Document position avoids making a panel grow as the user scrolls down.
      const top = work.getBoundingClientRect().top + window.scrollY;
      const available = Math.max(240, window.innerHeight - top - reserve - 12);
      root.style.setProperty('--work-area-height', `${Math.floor(available)}px`);
    }
  });
}
function refreshResponsiveObservers() {
  if (typeof ResizeObserver === 'function') {
    responsiveObserver ||= new ResizeObserver(scheduleResponsiveLayout);
    responsiveObserver.disconnect();
    for (const element of document.querySelectorAll('#recorder,.app-header,.page-heading,#usageStrip,.topbar,.session-setup,#pipelineStatus,.mobile-device-bar'))
      responsiveObserver.observe(element);
  }
  scheduleResponsiveLayout();
}
window.addEventListener('resize', scheduleResponsiveLayout, {passive:true});
window.addEventListener('orientationchange', scheduleResponsiveLayout, {passive:true});
window.visualViewport?.addEventListener('resize', scheduleResponsiveLayout, {passive:true});
window.visualViewport?.addEventListener('scroll', scheduleResponsiveLayout, {passive:true});
document.addEventListener('focusin', scheduleResponsiveLayout);
document.addEventListener('focusout', scheduleResponsiveLayout);
refreshResponsiveObservers();

// Original Phosphor Icons SVG assets, MIT. See THIRD_PARTY_NOTICES.md.
const ICONS = {
  "chat-circle-text":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M168,112a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,112Zm-8,24H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Zm72-8A104,104,0,0,1,79.12,219.82L45.07,231.17a16,16,0,0,1-20.24-20.24l11.35-34.05A104,104,0,1,1,232,128Zm-16,0A88,88,0,1,0,51.81,172.06a8,8,0,0,1,.66,6.54L40,216,77.4,203.53a7.85,7.85,0,0,1,2.53-.42,8,8,0,0,1,4,1.08A88,88,0,0,0,216,128Z"/></svg>',
  "text-align-left":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M32,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H40A8,8,0,0,1,32,64Zm8,48H168a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16Zm176,24H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm-48,40H40a8,8,0,0,0,0,16H168a8,8,0,0,0,0-16Z"/></svg>',
  "book-open-text":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64ZM160,88h40a8,8,0,0,1,0,16H160a8,8,0,0,1,0-16Zm48,40a8,8,0,0,1-8,8H160a8,8,0,0,1,0-16h40A8,8,0,0,1,208,128Zm0,32a8,8,0,0,1-8,8H160a8,8,0,0,1,0-16h40A8,8,0,0,1,208,160Z"/></svg>',
  microphone:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V240a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z"/></svg>',
  "folder-simple":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,72H130.67L102.93,51.2a16.12,16.12,0,0,0-9.6-3.2H40A16,16,0,0,0,24,64V200a16,16,0,0,0,16,16H216.89A15.13,15.13,0,0,0,232,200.89V88A16,16,0,0,0,216,72Zm0,128H40V64H93.33L123.2,86.4A8,8,0,0,0,128,88h88Z"/></svg>',
  "sliders-horizontal":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M40,88H73a32,32,0,0,0,62,0h81a8,8,0,0,0,0-16H135a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16Zm64-24A16,16,0,1,1,88,80,16,16,0,0,1,104,64ZM216,168H199a32,32,0,0,0-62,0H40a8,8,0,0,0,0,16h97a32,32,0,0,0,62,0h17a8,8,0,0,0,0-16Zm-48,24a16,16,0,1,1,16-16A16,16,0,0,1,168,192Z"/></svg>',
  sun: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>',
  moon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z"/></svg>',
};
const icon = (name) =>
  `<span class="icon" aria-hidden="true">${ICONS[name] || ""}</span>`;
document
  .querySelectorAll("[data-icon]")
  .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clock = (s) =>
  `${String(Math.floor((s || 0) / 60)).padStart(2, "0")}:${String(Math.floor((s || 0) % 60)).padStart(2, "0")}`;
const names = {
  record: "普通记录",
  transcript: "课堂逐字稿",
  assist: "听课辅助",
  settings: "模型与设置",
  design: "外观模式",
};
const kinds = {
  raw: "识别原稿",
  record: "整理稿",
  verbatim: "校订逐字稿",
  summary: "课堂笔记",
  edited: "人工校订",
  live: "实时分析",
  chapters: "话题章节",
};
const read = (k, f) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? f;
  } catch {
    return f;
  }
};
let boot,
  options,
  current = null,
  detailData = null,
  allSessions = [],
  view = location.pathname.slice(1) || "record",
  tabKind = "raw",
  activeRevision = null,
  editing = false,
  searchText = "",
  settingsTab = "models",
  format = "auto",
  speakers = "",
  pendingKind = "record",
  gate = null,
  docData = null,
  docPage = 1,
  locked = false,
  liveEvents = [],
  busy = 0;
let starting = false,
  loadVersion = 0;
let recording = false,
  recordingPage = null,
  recordingSessionId = null,
  paused = false,
  stream,
  ctx,
  preparedAudioContext = null,
  processor,
  muteGain,
  blocks = [],
  frames = 0,
  seq = 0,
  samplesSent = 0,
  queue = Promise.resolve(),
  liveQueue = Promise.resolve(),
  liveConfig = null,
  liveSession = false,
  modelPaused = false,
  finishing = false,
  reviewSession = null,
  effectiveThreshold = -80,
  lastInputDb = -96,
  belowThresholdSeconds = 0,
  lastGateResult = null,
  transcriptScroll = new Map(),
  liveBacklog = 0,
  pipelineJobs = new Map(),
  lastAudioAt = 0,
  recordingStartedAt = 0,
  pipelineSession = null,
  savedAudioEnd = 0,
  returnedAudioEnd = 0,
  alertedSeq = null,
  analysisTasks = new Set(),
  seenTranscripts = new Set(),
  seenQuestions = new Set(),
  currentQuestionKey = null,
  questionRecords = new Map(),
  questionAliases = new Map(),
  questionUnread = new Set(),
  questionOrder = [],
  questionSession = undefined,
  questionAttentionLocked = false,
  questionCloseAllowsAuto = false,
  questionResumeGraceUntil = 0,
  lastAutoQuestionAt = -Infinity,
  questionPointer = null,
  questionDemoTimers = [],
  questionAlertKey = null,
  questionAlertQueue = [],
  followupEditorKey = null,
  liveTranscripts = new Map(),
  liveCorrections = new Map(),
  assistOriginal = false,
  recordOriginal = false,
  recordVersionPinned = false,
  quietSeconds = 0,
  speechPeak = -96,
  lastTopicStart = -1,
  usageData = null,
  costTimer = 0,
  costTicket = 0,
  elapsed = 0,
  lastMeter = 0,
  meterHistory = [],
  db,
  curveTimer = 0;
const player = document.createElement("audio");
player.controls = true;
player.preload = "metadata";
player.id = "player";
let lastSessions = read("speakless-web-last", {}),
  promptOverrides = read("speakless-web-prompts", {});
const systemTheme = matchMedia("(prefers-color-scheme: dark)");
const legacyTheme = read("speakless-web-theme", null);
let appearance =
  read("speakless-web-appearance", null) ||
  { studio: "light", night: "dark", paper: "light" }[legacyTheme] ||
  "system";
if (!["light", "dark", "system"].includes(appearance)) appearance = "system";
function syncAppearanceControls() {
  document.querySelectorAll("[data-appearance]").forEach((el) => {
    const selected = el.dataset.appearance === appearance;
    el.classList.toggle("active", selected);
    el.setAttribute("aria-pressed", String(selected));
  });
  const toggle = $("themeToggle");
  if (toggle) {
    const label =
      document.documentElement.dataset.theme === "night"
        ? "浅色模式"
        : "深色模式";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.innerHTML =
      icon(
        document.documentElement.dataset.theme === "night" ? "sun" : "moon",
      ) +
      `<span class="theme-label">${document.documentElement.dataset.theme === "night" ? "浅色模式" : "深色模式"}</span>`;
  }
}
function applyAppearance(save = false) {
  const dark =
    appearance === "dark" || (appearance === "system" && systemTheme.matches);
  document.documentElement.dataset.theme = dark ? "night" : "studio";
  document.querySelector('meta[name="theme-color"]').content = dark
    ? "#171a22"
    : "#f7f8fa";
  if (save)
    localStorage.setItem(
      "speakless-web-appearance",
      JSON.stringify(appearance),
    );
  syncAppearanceControls();
  // Update colors in place: changing appearance must not discard an unfinished edit or interrupt recording.
  drawWave();
  if ($("silenceDialog").open) drawCurve();
}
systemTheme.addEventListener("change", () => {
  if (appearance === "system") applyAppearance();
});
applyAppearance();
function tell(s, error = false) {
  $("status").textContent = s;
  $("status").classList.toggle("error", error);
}
async function guard(f) {
  try {
    return await f();
  } catch (e) {
    tell(e.message, true);
    console.error(e.message);
  }
}
async function api(path, body, headers = {}) {
  if(window.LectureMobile)return window.LectureMobile.api(path,body,headers);
  const binary = body instanceof Blob || body instanceof ArrayBuffer;
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined
        ? {}
        : {
            "X-Lecture-Demo": "1",
            ...(binary ? {} : { "Content-Type": "application/json" }),
            ...headers,
          },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || r.status);
  return d;
}
const failedAnalysisTasks=new Map();
let retryAnalysisRunning=false;
function failedTaskKey(path,b){return 'failed-analysis:'+path+':'+(b.seq??b.source??'final')+':'+(b.kind||'')+':'+(b.style||'');}
async function rememberFailedTask(path,body,error){
  if(!/\/(live|realtime-transcribe|live-finalize|organize|review-live-audio|transcribe|question-followup)$/.test(path))return;
  const id=failedTaskKey(path,body),value={id,path,body:structuredClone(body),error:String(error),session:path.split('/')[3]};
  failedAnalysisTasks.set(id,value);if(window.LectureMobile?.store)await window.LectureMobile.store.put('meta',value);
}
function retryableAnalysisError(message){
  const text=String(message);
  if(/401|402|403|404|HTTP 400|余额|额度|密钥|登录|CORS|跨域|本设备直连失败|不支持|输出达到上限/i.test(text))return false;
  return /超时|timeout|timed out|连接|网络|network|fetch|中断|429|50[0234]|暂时|排队|JSON|解析|校订.*(?:未完成|不完整)|模型没有返回/i.test(text);
}
async function jobs(path, b, onProgress) {
  busy++;
  try {
    for(let attempt=0;attempt<3;attempt++){
      let terminalFailure=false;
      try {
        const d=await api(path,attempt?{...b,retryFailed:true}:b);
        for(;;){
          await new Promise(r=>setTimeout(r,onProgress?250:500));
          const j=await api('/api/jobs/'+d.job);tell(j.message);if(onProgress)onProgress(j);
          if(j.status==='error'){terminalFailure=true;throw Error(j.message);}
          if(j.status==='done'){
            const failure=j.result?.analysisError||j.result?.analysis?.answerError||(j.result?.correction?.correctionState==='failed'&&j.result.correction.correctionError)||(j.result?.failedCorrections&&(j.result.correctionError||'全文校订未完成'));
            if(failure){terminalFailure=true;const e=Error(failure);e.result=j.result;throw e;}
            const key=failedTaskKey(path,b);failedAnalysisTasks.delete(key);if(window.LectureMobile?.store)await window.LectureMobile.store.delete('meta',key);
            return j.result;
          }
        }
      }catch(error){
        await rememberFailedTask(path,b,error.message);
        // Unknown POST / polling transport failures may leave a job running.
        // Never start another billable job unless failure is confirmed terminal.
        if(!terminalFailure||attempt===2||!retryableAnalysisError(error.message)){
          if(error.result)return error.result;throw error;
        }
        const message='分析暂未完成，正在自动重试 '+(attempt+1)+'/2；原音与已有转录保留。';tell(message);
        onProgress?.({stage:'retry-wait',retryAttempt:attempt+1,message});
        await new Promise(r=>setTimeout(r,/429/.test(error.message)?(attempt?5000:2000):(attempt?1500:500)));
      }
    }
  }finally{busy--;updateControls();}
}
function cfg() {
  return structuredClone(options);
}
function saveOptions() {
  localStorage.setItem("speakless-web-config", JSON.stringify(options));
  if(window.LectureMobile)window.LectureMobile.saveSettings(options).catch(e=>tell(e.message,true));
}
function modeFor(v) {
  return (
    { record: "record", transcript: "class", assist: "live" }[v] || "record"
  );
}
function pageFor(mode) {
  return (
    { record: "record", class: "transcript", live: "assist" }[mode] || "record"
  );
}
function silenceConfig() {
  return {
    holdBeforeSkip:true,
    gatePolicyVersion:2,
    enabled: $("silenceEnabled").checked,
    thresholdDb: +$("silenceThreshold").value,
    minSilence: +$("silenceDuration").value,
    padding: +$("silencePadding").value,
    preRoll: +$("silencePreRoll").value,
    thresholdMode: $("thresholdMode").value,
  };
}
function silenceUI() {
  options.silence = silenceConfig();
  saveOptions();
  $("thresholdLabel").textContent = options.silence.thresholdDb + " dBFS";
  effectiveThreshold = options.silence.thresholdDb;
  updateGateState();
  for (const id of ["silenceThreshold", "silenceDuration", "silencePadding", "silencePreRoll"])
    $(id).disabled = !options.silence.enabled;
  drawCurve();
  scheduleCost();
  scheduleLessonEstimate();
  if (gate) {
    const p = gate.curve.find((p) => p.db === options.silence.thresholdDb);
    gateNumbers(p?.sentSeconds ?? gate.sentSeconds, gate.duration);
  }
}
function applySilence() {
  const s = options.silence;
  $("silenceEnabled").checked = s.enabled;
  $("thresholdMode").value = s.thresholdMode || "auto";
  $("silenceThreshold").value = s.thresholdDb;
  $("silenceDuration").value = s.minSilence;
  $("silencePadding").value = s.padding;
  $("silencePreRoll").value = s.preRoll ?? s.padding;
  silenceUI();
}
function revision() {
  return detailData?.revisions.find((r) => r.id === activeRevision) || null;
}
function sources() {
  return (detailData?.revisions || []).filter((r) =>
    ["raw", "verbatim", "edited"].includes(r.kind),
  );
}
function sourceRevision() {
  const ss = sources();
  return ss.find((r) => r.id === activeRevision) || ss[ss.length - 1];
}
function chooseTab(kind) {
  recordVersionPinned=false;
  tabKind = kind;
  activeRevision =
    [...(detailData?.revisions || [])].reverse().find((r) => r.kind === kind)
      ?.id || null;
  editing = false;
  render();
}
function sessionTitle() {
  return (
    detailData?.title ||
    {
      record: "新建对话记录",
      transcript: "新建课堂逐字稿",
      assist: "新建听课记录",
    }[view] ||
    ""
  );
}
function dated(s) {
  return s
    ? new Date(s).toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
function duration() {
  return detailData?.chunks.reduce((n, c) => n + c.duration, 0) || 0;
}
let lessonPlan = read("speakless-lesson-plan", {minutes:45,speechPercent:75,segmentSeconds:6,questions:10,inputTokens:1500,outputTokens:250,answerInputTokens:1000,answerOutputTokens:200});
let lessonTimer=0,lessonTicket=0,lessonCache=null;
let endpointDetector=null,endpointVoicedSeconds=0;
let endpointSourceTail=new Float32Array(),endpointSourceQuantum=1;
function feedSpeechEndpoint(samples){
  const combined=new Float32Array(endpointSourceTail.length+samples.length);
  combined.set(endpointSourceTail);combined.set(samples,endpointSourceTail.length);
  const take=Math.floor(combined.length/endpointSourceQuantum)*endpointSourceQuantum;
  endpointSourceTail=combined.slice(take);
  if(take)endpointDetector.push(pcm16(combined.subarray(0,take),ctx.sampleRate));
}
function runtimeConfig() {return (recording || starting || finishing) && liveConfig ? liveConfig : options;}
const SILICONFLOW_FREE_MODELS={
  asr:['FunAudioLLM/SenseVoiceSmall','XingChenAGI/XingChenASR-V3.2-Ultra','XingChenAGI/XingChenASR-Diarize-V3.0','XingChenAGI/XingChenASR-V3.2'],
  correction:['XingChenAGI/Xing4.0-29B','Qwen/Qwen3.5-4B'],
  text:['XingChenAGI/Xing4.0-29B','Qwen/Qwen3.5-4B'],
};
function isSiliconFlow(provider) {
  if(!provider)return false;
  try{return ['api.siliconflow.cn','api.siliconflow.com.cn'].includes(new URL(provider.baseURL).hostname);}catch{return false;}
}
function quickPriceText(role,providerId,model) {
  const provider=boot.providers?.find(p=>p.id===providerId);
  if(isSiliconFlow(provider)&&role==='asr'&&model==='Qwen/Qwen3-ASR-1.7B')return 'CNY 0.00022 / 秒 · 0.792 / 音频小时';
  if(isSiliconFlow(provider)&&SILICONFLOW_FREE_MODELS[role]?.includes(model))return '免费 · 硅基流动公开价格页';
  const c=runtimeConfig(),price=c[role]?.providerId===providerId&&c[role]?.model===model?boot.priceQuotes?.[role]:null;
  if(price?.audioPerSecond===0 || price?.inputPerMillion===0&&price?.outputPerMillion===0)return '免费 · 已核实单价';
  if(price?.audioPerSecond!=null)return `${price.currency||'CNY'} ${(price.audioPerSecond*3600).toFixed(4)} / 音频小时`;
  if(price?.inputPerMillion!=null&&price?.outputPerMillion!=null)return `${price.currency||'CNY'} ${price.inputPerMillion} 输入 / ${price.outputPerMillion} 输出（每 M tokens）`;
  return isSiliconFlow(provider)?'价格待核对 · 打开官方价格页查看':'价格未知 · 可在费用设置中填写';
}
function quickFreeModelsMarkup(role,provider) {
  if(!isSiliconFlow(provider))return '';
  return `<div class="quick-free-models"><small>官方当前免费</small>${(SILICONFLOW_FREE_MODELS[role]||[]).map(model=>`<button type="button" data-quick-free="${role}" data-model="${esc(model)}" title="切换为 ${esc(model)}">${esc(model.split('/').at(-1))}</button>`).join('')}</div><a class="quick-price-link" href="https://www.siliconflow.cn/pricing" target="_blank" rel="noopener noreferrer">查看硅基流动完整价格 ↗</a>`;
}
function quickModelsMarkup() {
  const c=runtimeConfig();
  return `<details class="quick-models"><summary>调整当前模型</summary><p class="hint">保存后用于后续请求；录音中也可更改。已发送及已排队请求保留各自配置快照。</p><div class="quick-model-grid">${[['asr','语音识别'],['correction','实时校订'],['text','文本 / 整理']].map(([role,label])=>{
    const provider=boot.providers?.find(p=>p.id===c[role]?.providerId);
    return `<fieldset><legend>${label}</legend><label>平台<select id="quick-${role}-provider" data-quick-provider="${role}">${(boot.providers||[]).map(p=>`<option value="${esc(p.id)}" ${p.id===provider?.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label>模型 ID<input id="quick-${role}-model" data-quick-model="${role}" list="quick-${role}-models" value="${esc(c[role]?.model||'')}"></label><datalist id="quick-${role}-models">${modelListMarkup(provider)}</datalist><p class="quick-model-price" data-quick-price="${role}">${esc(quickPriceText(role,provider?.id,c[role]?.model||''))}</p><div data-quick-free-list="${role}">${quickFreeModelsMarkup(role,provider)}</div></fieldset>`;
  }).join('')}</div><button data-action="saveQuickModels">保存模型</button></details>`;
}
function modelListMarkup(provider) {
  return (provider?.models||[]).map(m=>`<option value="${esc(typeof m==='string'?m:m.id)}">`).join('');
}
function applyQuickModels(models) {
  for(const role of ['asr','correction','text']) {
    if(!boot.providers?.some(p=>p.id===models[role]?.providerId) || !models[role]?.model?.trim())throw Error('请选择平台并填写模型 ID');
  }
  for(const role of ['asr','correction','text']) {
    const patch={providerId:models[role].providerId,model:models[role].model.trim()};
    options[role]={...options[role],...patch};
    if((recording||starting||finishing)&&liveConfig&&(!recordingSessionId||current===recordingSessionId))liveConfig[role]={...liveConfig[role],...patch};
  }
  // This is an explicit settings action, so account-backed clients may sync it.
  if(window.LectureMobile?.account)window.LectureMobile.account.settingsWritable=true;
  saveOptions();
}
function updateQuickModelPrice(role) {
  const providerId=$(`quick-${role}-provider`)?.value,model=$(`quick-${role}-model`)?.value.trim();
  const target=document.querySelector(`[data-quick-price="${role}"]`),free=document.querySelector(`[data-quick-free-list="${role}"]`);
  if(target)target.textContent=quickPriceText(role,providerId,model);
  if(free)free.innerHTML=quickFreeModelsMarkup(role,boot.providers.find(p=>p.id===providerId));
  wireQuickFreeModels();
}
function wireQuickFreeModels() {
  document.querySelectorAll('[data-quick-free]').forEach(el=>el.onclick=()=>{
    const role=el.dataset.quickFree;
    $(`quick-${role}-model`).value=el.dataset.model;
    updateQuickModelPrice(role);
  });
}
function usageMetrics(u) {
  const money=Object.entries(u?.amounts||{}).map(([c,n])=>`${c} ${n.toFixed(6)}`).join(' / ') || (u?.requests?'单价或用量待补全':'尚无请求');
  return [u?`${(u.audioSeconds||0).toFixed(1)} s`:'—',u?(u.inputTokens||0).toLocaleString():'—',u?(u.outputTokens||0).toLocaleString():'—',u?.inputTokens>0?`${((u.cachedTokens||0)/u.inputTokens*100).toFixed(1)}%`:'—',u?money:'—'];
}
function compactUsageMarkup() {
  return `<section id="recordUsageMetrics" class="record-usage-metrics" aria-label="本次用量概览">${['已送出 ASR','输入 tokens','输出 tokens','缓存命中率','估算金额 · 非账单'].map((label,i)=>`<div><small>${label}</small><strong data-usage-metric="${i}">—</strong></div>`).join('')}</section>`;
}
function sessionSetupMarkup() {
  const c=runtimeConfig();
  const provider=role=>boot.providers?.find(p=>p.id===c[role]?.providerId)?.name || c[role]?.providerId || "未选择平台";
  const chip=(role,label)=>`<span class="runtime-model"><small>${label}</small><strong>${esc(c[role]?.model || "未选择模型")}</strong><span>${esc(provider(role))}</span></span>`;
  const role=recordingPage || view;
  const same=c.live?.correctTranscript!==false && role!=="record" && c.correction?.providerId===c.text?.providerId && c.correction?.model===c.text?.model;
  return `<section class="session-setup" aria-label="本次模型与课时预算"><div class="runtime-models"><span class="runtime-label">${recording || starting || finishing ? "本次录音模型" : "当前将使用"}</span>${chip("asr","语音识别")}${c.live?.correctTranscript!==false && role!=="record" && !same ? chip("correction","实时校订") : ""}${chip("text",same?(role==="assist"?"校订 / 判题 / 答题":"校订 / 整理"):role==="assist"?"判题 / 答题":"内容整理")}<button class="quick-model-launch" data-action="openQuickModels">切换模型</button></div>${quickModelsMarkup()}<details class="lesson-planner"><summary><span>课时与费用预估</span><strong id="lessonTotal">${lessonPlan.minutes} 分钟 · 计算中…</strong><span class="hint">调整时长 / 查看假设</span></summary><div class="lesson-plan-body"><div class="form-grid">${[["minutes","预计时长（分钟）",1,480],["speechPercent","预计送出语音占比（%）",0,100],["segmentSeconds","预计完整句段间隔（秒）",2,60],["questions","预计提问数",0,200]].map(([key,label,min,max])=>`<label>${label}<input type="number" data-lesson="${key}" min="${min}" max="${max}" value="${lessonPlan[key]}"></label>`).join("")}</div><details><summary>文字用量假设（可调整）</summary><div class="form-grid">${[["inputTokens","每段校订/判题输入 tokens"],["outputTokens","每段校订/判题输出 tokens"],["answerInputTokens","每题答题输入 tokens"],["answerOutputTokens","每题答题输出 tokens"]].map(([key,label])=>`<label>${label}<input type="number" min="1" max="${key.includes('Output') || key==='outputTokens'?16000:100000}" data-lesson="${key}" value="${lessonPlan[key]}"></label>`).join("")}</div></details><div id="lessonBreakdown" class="lesson-breakdown"></div><p id="lessonNotes" class="hint">按当前模型和费率估算，不调用 AI。实际用量取决于讲话、停顿和提问。</p></div></details></section><div id="pipelineStatus" class="pipeline-status" role="status"></div>`;
}
function scheduleLessonEstimate() {
  clearTimeout(lessonTimer);
  if (!$("lessonTotal")) return;
  const c=structuredClone(runtimeConfig());c.silence=structuredClone(options.silence);
  const page=recordingPage || view;
  const plan={...lessonPlan,mode:page==='record'?'transcript':page,recordStyle:format};
  const key=JSON.stringify([c,plan,Math.floor(Date.now()/3600000),current,usageData?.requests]),ticket=++lessonTicket;
  const show=r=>{
    if (!$("lessonTotal")) return;
    const money=Object.entries(r.amounts||{}).map(([currency,n])=>`${currency} ${n.toFixed(2)}`).join(" + ");
    const speechInput=document.querySelector('[data-lesson="speechPercent"]');
    if(speechInput){speechInput.disabled=c.silence?.enabled===false;speechInput.value=c.silence?.enabled===false?100:lessonPlan.speechPercent;}
    const observed=r.observed;
    const observedMoney=Object.entries(observed?.amounts||{}).map(([currency,n])=>`${currency} ${n.toFixed(2)}`).join(" + ");
    $("lessonTotal").textContent=observed?.available ? `${plan.minutes} 分钟 · 按本次速度 ${observedMoney}${observed.unpricedRequests ? "（部分费用）":""}` : `${plan.minutes} 分钟 · ${r.complete ? "预计 " : "已知部分 "}${money || "单价待配置"}${r.complete ? "" : "（未完整计入）"}`;
    $("lessonBreakdown").innerHTML=(r.rows||[]).map(x=>`<div><span>${esc(x.label)}${x.requests==null?' · 按音频量估算':` · 约 ${x.requests} 次`}</span><strong>${x.amount===null?"单价未配置":esc(x.currency)+" "+x.amount.toFixed(3)}</strong></div>`).join("");
    if(observed?.available)$("lessonBreakdown").innerHTML=`<div><span>按本次 ${Math.round(observed.elapsedSeconds)} 秒实测推算 · ${esc(Object.entries(observed.perMinute||{}).map(([c,v])=>`${c} ${v.toFixed(3)}/分钟`).join(" + "))}</span><strong>${esc(observedMoney)}</strong></div><p class="hint">${esc(observed.note)}</p><p class="hint">下面为录前参数估算，未使用实测速度：${esc(money)}</p>`+$("lessonBreakdown").innerHTML;
    $("lessonNotes").textContent=(r.unpriced?.length ? `未计入：${r.unpriced.join("、")}。` : "")+r.note+" 当前分时费率用于整节预估，跨费率时段可能变化。";
  };
  if (lessonCache?.key===key) {show(lessonCache.value);return;}
  lessonTimer=setTimeout(async()=>{
    try {const value=await api('/api/lesson-estimate',{config:c,plan,session:current});if(ticket!==lessonTicket)return;lessonCache={key,value};show(value);}
    catch(e){if(ticket===lessonTicket && $("lessonTotal"))$("lessonTotal").textContent="预估暂不可用："+e.message;}
  },250);
}
function updatePipelineStatus() {
  updateCaptureStatus();
  const node=$("pipelineStatus");if(!node)return;
  const jobs=[...pipelineJobs.values()],active=jobs.filter(j=>!['done','error'].includes(j.stage));
  const failed=jobs.filter(j=>j.stage==='error');
  if(starting&&!recording){node.textContent="正在准备麦克风，请确认浏览器授权；尚未开始收音。";return;}
  if (!recording && !finishing && (!jobs.length || current!==pipelineSession)) {node.textContent="录音后显示收音、上传、识别和校订进度。";return;}
  let state="";
  const stale=recording&&!paused&&Date.now()-(lastAudioAt||recordingStartedAt)>2500;
  if(stale)state=lastAudioAt?"收音暂停：麦克风未继续返回音频，请检查设备或系统中断。":"麦克风尚未返回音频，请检查授权和输入设备。";
  else if(paused)state="录音已手动暂停。";
  else if(modelPaused)state="模型已暂停，原音继续保存。";
  else if(active.length){
    const first=active.find(j=>!j.rawReady)||active[0];
    const labels={uploading:'正在上传原音','asr-queued':'语音识别排队中',queued:'等待工作线程',asr:'语音识别处理中','analysis-queued':'校订/判题排队中',correction:'自动校订处理中',detect:'课堂判题处理中',answer:'答案生成中'};
    state=`${labels[first.stage]||'处理中'} ${Math.max(0,Math.floor((Date.now()-first.since)/1000))}s · ${active.length} 段待完成。`;
  } else state=recording?"正在收音，等待停顿或发送间隔。":finishing?(detailData?.hasAudio?"原音已保存，正在收尾。":"正在保存原音。"):"本次处理已结束。";
  node.textContent=`${state} 已收音 ${clock(elapsed)} · 原音已上传至 ${clock(savedAudioEnd)} · 最近返回片段至 ${clock(returnedAudioEnd)}${failed.length?` · ${failed.length} 段失败，原音保留；${/timed? ?out|timeout/i.test(failed.at(-1).error||'')?'模型响应超时，可课后重试':String(failed.at(-1).error||'可课后重新识别').slice(0,120)}`:''}`;
  node.dataset.warning=String(stale||failed.length>0);
  if(currentTimeoutBudget?.sid===current&&active.length)node.textContent+=' · 最近'+({asr:'识别',correction:'校订',text:'分析'}[currentTimeoutBudget.role]||'模型')+'请求上限 '+currentTimeoutBudget.seconds+' 秒'+(currentTimeoutBudget.cold?'（含模型加载余量）':'');
}
function pipelineStage(seq,stage,extra={}) {
  const old=pipelineJobs.get(seq)||{};
  pipelineJobs.set(seq,{...old,...extra,stage,since:old.stage===stage?old.since:Date.now()});
  updatePipelineStatus();
}
function heading(kicker, subtitle) {
  const title = sessionTitle();
  return `<header class="page-heading"><div class="title-block">${current ? `<h1 class="sr-only">${esc(title)}</h1><div class="title-editor"><textarea id="recordTitle" class="title-input" rows="1" aria-label="记录标题">${esc(title)}</textarea><button class="title-save text-button" data-action="rename">保存</button></div>` : `<h1>${esc(title)}</h1>`}<p class="description">${subtitle}</p><div class="session-meta">${current ? `${dated(detailData.created)}<span>${detailData.hasAudio ? "原录音已保存" : detailData.status === "sample" ? "人工示例，未调用模型" : "音频分段保存中"}</span><span>${detailData.revisions.filter((r) => !["live", "transcript-chunk", "live-transcript", "corrected-transcript", "question-followup"].includes(r.kind)).length} 个文字版本</span>` : "完整保留原音，可修改提示词重新整理"}</div></div><div class="page-actions"><button data-action="new">新建记录</button></div></header>`;
}
function resizeTitle() {
  const el = $("recordTitle");
  if (el) {
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }
}
window.addEventListener("resize", resizeTitle);
function audioBox() {
  return `<div class="audio-box"><div class="row spread"><span class="section-label">原始录音</span>${detailData?.hasAudio ? `<a class="link-like" href="/api/sessions/${current}/audio" download>下载 WAV</a>` : ""}</div><div id="audioSlot"></div>${detailData?.hasAudio ? '<div class="audio-controls"><button class="link-like" data-action="transcribe">换模型重新识别</button><select id="playbackRate" aria-label="回放速度"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div>' : '<p class="hint">当前服务设备没有可回听的原音；仅同步文字的记录需回到录制设备，或重新选择原音文件。</p>'}<div id="outbox" class="outbox-note"></div><button class="link-like" data-action="retry">重传尚未保存的片段</button></div>`;
}
function versionList() {
  const rs = (detailData?.revisions || [])
    .filter((r) => !["live", "live-transcript", "transcript-chunk", "corrected-transcript", "question-followup"].includes(r.kind))
    .slice()
    .reverse();
  return `<div class="versions">${rs.length ? rs.map((r) => `<button data-revision="${r.id}" class="${r.id === activeRevision ? "active" : ""}"><span>${kinds[r.kind] || r.kind}</span><span>${dated(r.created)}</span></button>`).join("") : '<p class="hint">生成的每个版本都会留在这里。</p>'}</div>`;
}
function emptyResult(title, desc) {
  return `<div class="empty"><div class="empty-symbol">${icon(view === "record" ? "microphone" : view === "transcript" ? "text-align-left" : "book-open-text")}</div><h2>${title}</h2><p>${desc}</p>${detailData?.hasAudio ? '<button class="primary" data-action="transcribe">从录音生成逐字原稿</button>' : '<button data-action="sample">用示例体验流程</button>'}</div>`;
}
function resultTools(r = revision()) {
  return `<div class="result-tools">${r ? `${r.synthetic ? "" : '<button data-action="edit">编辑</button>'}<button data-action="copy">复制全文</button><button data-action="exportText">下载文字</button>${r.content.segments ? '<button data-action="exportSRT">字幕</button>' : ""}` : ""}</div>`;
}
function editView(r) {
  return `<div class="save-editor">${r.content.segments ? r.content.segments.map((s, i) => `<div class="edit-segment"><small>${clock(s.start)} — ${clock(s.end)}</small><br><input data-speaker="${i}" aria-label="第 ${i + 1} 段角色" placeholder="角色标签（可选）" value="${esc(s.speaker || "")}"><textarea data-segment="${i}" aria-label="第 ${i + 1} 段原文">${esc(s.text)}</textarea></div>`).join("") : `<textarea id="textEditor" aria-label="编辑当前文字">${esc(r.content.text)}</textarea>`}<div class="row" style="margin-top:18px"><button class="primary" data-action="saveEdit">保存为新版本</button><button data-action="cancelEdit">取消</button></div></div>`;
}
const recordFormats = [
  ['auto','自动整理','按内容选择结构，完整保留信息','适合日常沟通'],
  ['points','完整分点','观点、理由、例子逐点保留','适合直接发群'],
  ['paragraphs','对话记录','按话题分段，保留完整对话','适合长对话'],
  ['speakers','按角色记录','按已确认角色区分发言','不猜测说话人'],
  ['meeting','会议纪要','议题、讨论、决定、行动与待办','保留分歧与依据'],
  ['actions','行动清单','待办、负责人、期限与原话依据','未明确就标明'],
  ['email','邮件草稿','主题、称呼、正文与落款','不虚构收件人'],
  ['notice','通知 / 公告','事项、对象、时间与注意事项','保留必要细节'],
  ['ai-prompt','AI 指令','目标、背景、要求与限制','适合编程与任务描述'],
  ['verbatim','全文保留','不总结，保留逐字内容与时间','交给其他 AI 继续处理'],
];
function formattedText(text) {
  // A small escaped renderer for model headings/lists; no model HTML executes.
  let fence=false, code=[],html=[],list=null;
  const endList=()=>{if(list){html.push(`</${list}>`);list=null;}};
  for(const line of String(text || '').split('\n')) {
    if(/^```/.test(line)){endList();if(fence){html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);code=[];}fence=!fence;continue;}
    if(fence){code.push(line);continue;}
    const heading=line.match(/^#{1,4}\s+(.+)$/);
    const ordered=line.match(/^\s*(?:\d+[.)、]|[一二三四五六七八九十]+、)\s*(.+)$/);
    const bullet=line.match(/^\s*[-*•]\s+(.+)$/);
    const item=ordered || bullet;
    if(item){const type=ordered?'ol':'ul';if(list!==type){endList();html.push(`<${type}${ordered && /^\s*\d/.test(line) ? ` start="${parseInt(line.trim(),10)}"` : ""}>`);list=type;}html.push(`<li>${esc(item[1])}</li>`);}
    else {endList();if(heading)html.push(`<h3>${esc(heading[1])}</h3>`);else if(line.trim()) html.push(`<p>${esc(line)}</p>`);}
  }
  if(fence)html.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  endList();return html.join('');
}
function recordResult(r) {
  if(!r) return emptyResult('录下对话，留下完整记录','开始录音或导入文件，再选择适合这段内容的整理方式。');
  if(tabKind === 'raw') return `<article class="text-output original-output">${esc(r.content.text)}</article>`;
  const style=r.content.style || 'auto';
  const meta=recordFormats.find(f=>f[0]===style) || recordFormats[0];
  return `<div class="record-result-heading"><span class="badge">${esc(meta[1])}</span><span class="hint">${r.content.passthrough?'全文保留，未调用整理模型':'来自所选原稿 · 原文独立保留'}</span></div><article class="text-output organized-output result-${esc(style)}">${formattedText(r.content.text)}</article>${versionMeta(r)}`;
}
const captureViews=new Map();
let interruptedRecordingId=null,endpointBaseFrames=0,scheduledCaptureParts=new Set(),resumingCapture=false;
function recordingHere(){return recording&&(!recordingSessionId||current===recordingSessionId);}
function finishingHere(){return finishing&&(!recordingSessionId||current===recordingSessionId);}
function captureView(sid){if(!captureViews.has(sid))captureViews.set(sid,{transcripts:new Map(),corrections:new Map()});return captureViews.get(sid);}
function recordTranscriptRevision() {
  const recording=recordingHere(),finishing=finishingHere();
  const revisions=detailData?.revisions || [];
  if(!recording && !finishing){
    const active=revision();
    if(recordVersionPinned&&active&&['raw','verbatim','edited'].includes(active.kind))return active;
    if(active?.kind==='edited' && !recordOriginal)return active;
    const saved=[...revisions].reverse().find(r=>r.kind===(recordOriginal?'raw':'verbatim')) || [...revisions].reverse().find(r=>r.kind==='raw');
    if(saved)return saved;
  }
  const parts=revisions.filter(r=>r.kind==='transcript-chunk').map(r=>r.content).sort((a,b)=>a.start-b.start);
  if(!parts.length)return null;
  const segments=correctedEntries(parts,recordOriginal).flatMap(r=>r.segments || []).sort((a,b)=>a.start-b.start);
  return {synthetic:true,kind:'raw',content:{segments,text:segments.filter(s=>s.text&&!s.skipped).map(s=>`[${clock(s.start)}] ${s.text}`).join('\n')}};
}
function recordTranscriptMarkup() {
  const r=recordTranscriptRevision();
  if(r?.content.segments)return paragraphSegments(r.content.segments).map(s=>`<div class="transcript-segment" data-start="${s.start}" data-end="${s.end}"><button class="timestamp" data-seek="${s.start}">${clock(s.start)}</button><div class="segment-text">${s.speaker?`<span class="speaker">${esc(s.speaker)}</span>`:''}${esc(s.text)}</div></div>`).join('') || '<p class="hint transcript-placeholder">等待这一段识别结果…</p>';
  if(r?.content.text)return `<article class="text-output original-output">${esc(r.content.text)}</article>`;
  return `<p class="hint transcript-placeholder">${recording?'正在录音，停顿或本段结束后文字会出现在这里。':'开始录音，文字会逐段出现在这里。'}</p>`;
}
function refreshRecordTranscript() {
  const node=$('record-live-output');if(!node||editing)return;
  const saved=rememberTranscriptScroll(node);node.innerHTML=recordTranscriptMarkup();restoreTranscriptScroll(node,saved);
  if($('correctionStatus'))$('correctionStatus').textContent=correctionStatus();
}
function recordPage() {
  const recording=recordingHere(),finishing=finishingHere();
  const showingTranscript=tabKind!=='record';
  const r=showingTranscript?recordTranscriptRevision():revision();
  const transcriptLength=r?.content?.text?.length || r?.content?.segments?.reduce((n,s)=>n+(s.text?.length||0),0) || 0;
  const sparseTranscript=showingTranscript&&!recording&&!starting&&!finishing&&transcriptLength<1200;
  const chosen=recordFormats.find(f=>f[0]===format) || recordFormats[0];
  return heading('CONVERSATION NOTES','录音 → 完整原文 → 按用途整理，可随时更换提示词重新生成。') +
    `<div class="record-grid ${sparseTranscript?'sparse-record-grid':''}"><section class="panel writing-sheet ${showingTranscript?'record-live-panel':''} ${sparseTranscript?'sparse-record-panel':''}"><div class="panel-head"><div class="pill-tabs"><button data-tab="raw" class="${showingTranscript?'active':''}">${recording||finishing||!current?'实时转录':'完整原文'}</button><button data-tab="record" class="${showingTranscript?'':'active'}">整理结果</button></div>${showingTranscript?`<details class="inline-text-actions"><summary aria-label="文字操作">\u22ef</summary><div>${resultTools(r||{synthetic:true,content:{segments:[]}})}</div></details>`:resultTools(r)}</div>${!showingTranscript?compactUsageMarkup():''}${editing&&r?editView(r):showingTranscript?`<div class="record-live-transcript"><div class="record-live-toolbar"><small id="correctionStatus" role="status">${esc(correctionStatus())}</small><button class="text-button" data-action="toggleRecordSource">${recordOriginal?'返回校订稿':'核对识别原文'}</button><button id="followTranscript" data-action="followTranscript" hidden>回到最新 ↓</button></div>${compactUsageMarkup()}<div id="record-live-output" class="transcript-segments record-live-output">${recordTranscriptMarkup()}</div></div>`:recordResult(r)}</section>
    <aside class="record-inspector"><section class="panel format-workbench"><details ${r ? "" : "open"}><summary>整理方式：${esc(chosen[1])}<span class="hint">更换用途 / 查看结构</span></summary><div class="format-heading"><div><h2>这次记录用来做什么？</h2><p class="hint">选择用途查看整理结构；切换不会改动已有结果，点击生成后另存一个版本。</p></div><span class="badge">保留原文和录音</span></div>
    <div class="format-cards">${recordFormats.map(([v,name,desc,use])=>`<button data-format="${v}" aria-pressed="${format===v}" class="format-card ${format===v?'active':''}"><strong>${name}</strong><span>${desc}</span><small>${use}</small></button>`).join('')}</div></details></section><section class="panel inspector-section"><p class="section-label">当前整理方式</p><h3>${esc(chosen[1])}</h3><p class="hint">${esc(chosen[2])}。</p><div class="format-outline">${({meeting:['讨论议题与不同意见','已作决定及依据','行动项、负责人和期限','未决事项'],actions:['要做的事','原话中的负责人','明确期限或“未明确”','来源依据'],email:['主题与称呼','正文与必要背景','明确请求或下一步'],notice:['通知事项与对象','时间、地点和要求','注意事项'], 'ai-prompt':['任务目标','必要背景','操作要求与限制','预期输出'],speakers:['已确认角色','每个人的原话与观点','无法确认的角色明确标注']})[format]?.map(x=>`<span>${x}</span>`).join('') || '<span>内容完整、保留细节</span><span>不臆造身份或结论</span>'}</div><textarea id="speakerNotes" rows="2" placeholder="可选：人物角色、术语、邮件对象或背景" aria-label="角色和背景说明">${esc(speakers)}</textarea><button class="primary" data-action="prompt" data-kind="record">${recording?'开启边录边整理':sources().length?'生成这一版记录':'查看提示词与生成设置'}</button><p class="hint">生成前可修改提示词；原音和旧版本不会被覆盖。</p></section><section class="panel inspector-section"><details><summary>录音与版本</summary>${audioBox()}${versionList()}</details></section></aside></div>`;
}
function realtimeStrip() {
  return `<section class="realtime-strip" aria-label="实时模型控制">
    <div><strong>${view === "assist" ? "实时听课分析" : "实时逐字转录"}</strong>
    ${view === "transcript" ? `<label class="check"><input id="realtimeEnabled" type="checkbox" ${options.realtimeTranscript ? "checked" : ""} ${recording || starting ? "disabled" : ""}>边录边转录</label>` : ""}
    <small id="correctionStatus" role="status">${esc(correctionStatus())}</small>
    <small id="gateState">${gateStateText()}</small></div>
    <div class="row">${view==="assist"?`<label class="check">提问提醒<select aria-label="提问提醒灵敏度" data-config="live.questionSensitivity">${[["conservative","保守"],["balanced","常规"],["sensitive","敏感"]].map(([v,n])=>`<option value="${v}" ${options.live.questionSensitivity===v?"selected":""}>${n}</option>`).join("")}</select></label>`:""}<button data-action="silence">自动阈值 / 收音曲线</button></div>
  </section>`;
}
function gateStateText() {
  if(!recording && !finishing && options?.silence?.thresholdMode==="auto" && !gate)return "自动阈值：开始录音后按本次声音校准，尚未校准。";
  if (modelPaused)
    return "模型已暂停；原音与计时继续。已发出的请求可能仍会完成。";
  return `${options?.silence?.thresholdMode === "auto" ? "自动校准" : "手动阈值"} · ${effectiveThreshold} dBFS · 低于阈值持续足够久时不发送模型`;
}
function captureStatusState() {
  if(starting)return {kind:"pending",title:"正在准备麦克风",detail:"尚未开始收音，请留意浏览器授权。"};
  if(!recording)return {kind:"idle",title:finishing?"正在保存录音":"未在录音",detail:finishing?"等待原音与文字保存完成。":(window.LectureMobile?"点击底部开始录音。原音保存在当前录制设备；云端只同步文字结果。":"点击底部开始录音。原音保存到运行本地服务的设备；云端只同步文字结果。")};
  if(paused)return {kind:"paused",title:"录音已暂停",detail:"当前没有写入新的声音。"};
  if(Date.now()-lastAudioAt>2500)return {kind:"warning",title:"收音中断",detail:"没有收到新的麦克风音频，请检查设备或权限。"};
  if(modelPaused)return {kind:"paused",title:"模型输入已暂停",detail:"原始录音和计时继续，暂停期间不会自动补发。"};
  const level=`当前 ${lastInputDb.toFixed(1)} / 阈值 ${effectiveThreshold} dBFS`;
  if(options.silence.enabled && lastInputDb<effectiveThreshold){
    const wait=options.silence.minSilence;
    return {kind:"gated",title:belowThresholdSeconds>=wait?"低音量 · 模型输入待机":"低于阈值 · 等待静音判定",detail:level+" · 原音和计时继续；实际跳过量以本段判定为准。"};
  }
  return {kind:"active",title:"正在收音",detail:level+(liveSession?" · 声音保存后进入实时处理。":" · 原音完整保存，结束后再整理。")};
}
function updateCaptureStatus() {
  const el=$("captureStatus");
  const state=captureStatusState();if(el)el.dataset.state=state.kind;
  const recent=lastGateResult?`最近处理：送出 ${lastGateResult.sentSeconds.toFixed(1)} 秒 / 静音跳过 ${lastGateResult.skippedSeconds.toFixed(1)} 秒。`:"";
  const label={idle:finishing?'保存中':'未在录音',pending:'准备收音',active:'正在收音',gated:'低音量待机',paused:modelPaused?'模型暂停':'录音暂停',warning:'收音中断'}[state.kind]||state.title;
  $('lamp').dataset.state=state.kind;
  if(recording||starting||finishing){$('micStatus').textContent=label;$('micStatus').title=state.detail;}
  if(!el)return;
  el.title=state.detail+' '+recent;el.setAttribute('aria-label',state.title+'。'+state.detail+' '+recent);
  if(!el.querySelector?.('strong'))el.innerHTML='<span class="capture-dot" aria-hidden="true"></span><div><strong></strong><small></small></div>';
  const strong=el.querySelector?.('strong'),small=el.querySelector?.('small');
  if(strong&&strong.textContent!==label)strong.textContent=label;
  if(small)small.textContent='详细进度在录音详情中';
}
function updateGateState() {
  if ($("gateState")) $("gateState").textContent = gateStateText();
  updateCaptureStatus();
}
function transcriptPage() {
  const recording=recordingHere(),finishing=finishingHere();
  const r = readingRevision();
  const q = searchText.toLowerCase();
  const segs = r?.content.segments;
  const summary = [...(detailData?.revisions || [])]
    .reverse()
    .find((r) => r.kind === "summary");
  return (
    heading(
      "LECTURE TRANSCRIPT",
      "句段完成后自动校订，原位更新；原始识别稿始终保留，可点时间回听。",
    ) +
    `<div class="transcript-layout"><section class="panel transcript-sheet"><div class="transcript-panel-head"><div class="segment-tabs">${[
      ["raw", "逐字原文"],
      ["verbatim", "AI 校订稿"],
      ["edited", "我的修改"],
    ]
      .filter(([k]) => k === "raw" || k === "verbatim" && (recording || correctionGroups().length) || detailData?.revisions?.some(r => r.kind === k))
      .map(
        ([k, n]) =>
          `<button data-tab="${k}" class="${tabKind === k ? "active" : ""}">${n}</button>`,
      )
      .join(
        "",
      )}</div><details class="inline-text-actions"><summary aria-label="\u67e5\u627e\u4e0e\u5bfc\u51fa">\u22ef</summary><div class="transcript-toolbar"><input id="transcriptSearch" type="search" placeholder="在逐字稿中查找" aria-label="在逐字稿中查找" value="${esc(searchText)}">${resultTools(r)}</div></details></div>${
      editing && r
        ? editView(r)
        : segs
          ? `<div class="transcript-segments">${
              paragraphSegments(segs)
                .filter((s) => !q || s.text.toLowerCase().includes(q))
                .map(
                  (s) =>
                    `<div class="transcript-segment" data-start="${s.start}" data-end="${s.end}"><button class="timestamp" data-seek="${s.start}">${clock(s.start)}</button><div class="segment-text">${s.speaker ? `<span class="speaker">${esc(s.speaker)}</span>` : ""}${esc(s.text)}</div></div>`,
                )
                .join("") || '<p class="hint">没有找到匹配内容。</p>'
            }</div>`
          : r
            ? `<article class="text-output" style="padding:26px">${esc(r.content.text)}</article>`
            : emptyResult(
                "完整逐字稿，从这里开始",
                "录音、导入已有音频，或者载入课堂示例。时间标签始终对应原录音。",
              )
    }<button id="followTranscript" class="follow-transcript-overlay" data-action="followTranscript" hidden>\u56de\u5230\u6700\u65b0 \u2193</button></section><aside class="transcript-side"><section class="panel inspector-section"><div class="row spread"><h3>课堂笔记</h3><span class="badge">独立生成</span></div>${summary ? `<div class="text-output organized-output" style="font-size:13px">${formattedText(summary.content.text)}</div>` : '<p class="hint">知识点、公式与复习问题放在这里，不会替换逐字稿。</p>'}<div class="row" style="margin-top:17px"><button data-action="prompt" data-kind="summary">生成课堂笔记</button><button data-action="prompt" data-kind="verbatim">修正错字与断句</button></div>${audioBox()}</section><section class="panel inspector-section"><div class="row spread"><h3>时间打点</h3><button class="text-button" data-action="addMark">添加</button></div><div class="bookmark-list">${(detailData?.marks || []).map((m) => `<button data-seek="${m.seconds}"><span>${clock(m.seconds)}</span>${esc(m.label)}</button>`).join("") || '<p class="hint">录音中可打点；回听时也能给当前时刻加书签。</p>'}</div><details open><summary>话题章节</summary><div class="bookmark-list">${([...(detailData?.revisions || [])].reverse().find((r) => r.kind === "chapters")?.content.chapters || []).map((ch) => `<button data-seek="${ch.start}"><span>${clock(ch.start)}</span>${esc(ch.title)}</button>`).join("")}</div><button class="link-like" data-action="prompt" data-kind="chapters">智能生成目录</button></details><details><summary>版本记录</summary>${versionList()}</details></section></aside></div>`
  );
}
function docMarkup() {
  if (!docData)
    return `<div class="paper-page">${emptyResult("把教材放在眼前", "导入含文字的 PDF、笔记或教材。识别到知识点后，显示真实页码与匹配依据。")}</div>`;
  const text = docData.pages[docPage - 1] || "";
  return docData.name.toLowerCase().endsWith(".pdf")
    ? `<iframe title="教材 PDF 第 ${docPage} 页" src="/api/documents/${docData.id}#page=${docPage}"></iframe>`
    : `<article class="paper-page"><div class="page-kicker">${esc(docData.name)} / 阅读视图</div><h2>${esc(text.split("\n")[0].slice(0, 50))}</h2><pre>${esc(text.split("\n").slice(1).join("\n").trim() || text)}</pre><footer>${docPage + docData.offset}</footer></article>`;
}
function correctionGroups() {
  const groups = new Map();
  for (const r of detailData?.revisions || [])
    if (r.kind === "corrected-transcript") groups.set(r.content.sequences.join(","), r.content);
  for (const [key, group] of liveCorrections) groups.set(key, group);
  return [...groups.values()];
}
function correctedEntries(parts, original = false) {
  const replaced=new Set(parts.flatMap(p=>p.replacedSequences||[]));
  parts=parts.filter(p=>!replaced.has(p.seq));
  const corrections = new Map();
  if (!original) for (const group of correctionGroups())
    for (const seq of group.sequences) corrections.set(seq, group);
  return parts.map(part => {
    const group = corrections.get(part.seq);
    const segments = group ? group.segments.filter(s => s.seq === part.seq) : part.segments;
    return {...part, segments, text: segments?.map(s => s.text).join("\n") || part.text,
      correctionState: group?.correctionState || (options.live.correctTranscript === false ? "off" : "pending")};
  });
}
function readingRevision() {
  const recording=recordingHere(),finishing=finishingHere();
  if(view==='record'&&tabKind!=='record')return recordTranscriptRevision();
  const parts = (detailData?.revisions || []).filter(r => r.kind === "transcript-chunk").map(r => r.content);
  if (view !== "transcript" || !parts.length || !(recording || finishing || !revision())) return revision();
  const segments = correctedEntries(parts, tabKind === "raw").flatMap(r => r.segments || []).sort((a,b) => a.start-b.start);
  return {synthetic:true,kind:tabKind,content:{segments,text:segments.map(s => `[${clock(s.start)}] ${s.text}`).join("\n")}};
}
function correctionStatus() {
  const parts = view !== "assist" ? (detailData?.revisions || []).filter(r => r.kind === "transcript-chunk").map(r => r.content) : transcriptEntries(true);
  const states = correctedEntries(parts).filter(r => r.segments?.some(s => s.text && !s.skipped));
  const done = states.filter(r => r.correctionState === "corrected").length;
  const failed = states.filter(r => r.correctionState === "failed").length;
  const pending = states.filter(r => r.correctionState === "pending").length;
  if (options.live.correctTranscript === false && !done && !failed) return "自动校订已关闭 · 显示识别原文";
  return `自动校订 · ${done} 段已完成${pending ? ` · ${pending} 段${recording || finishing ? "待校订" : "尚未校订，保留原文"}` : ""}${failed ? ` · ${failed} 段失败，保留原文` : ""}`;
}
function transcriptScrollKey(){return (current||"new")+":"+view;}
function rememberTranscriptScroll(node){
  const state={top:node.scrollTop,follow:node.scrollHeight-node.clientHeight-node.scrollTop<80};
  transcriptScroll.set(transcriptScrollKey(),state);return state;
}
function restoreTranscriptScroll(node,state){
  if(!node)return;
  const saved=state||transcriptScroll.get(transcriptScrollKey())||{follow:true,top:0};
  node.scrollTop=saved.follow?node.scrollHeight:saved.top;
  node.onscroll=()=>{rememberTranscriptScroll(node);updateFollowButton();};
  updateFollowButton(saved.follow);
}
function updateFollowButton(follow){
  const button=$("followTranscript");if(!button)return;
  button.hidden=follow ?? (transcriptScroll.get(transcriptScrollKey())?.follow!==false);
}
function updateAssistTranscript(){
  const node=$("assistTranscript");if(!node)return;
  const state=rememberTranscriptScroll(node);node.innerHTML=assistTranscriptMarkup();restoreTranscriptScroll(node,state);
}
function refreshTranscriptParagraphs() {
  const node = document.querySelector(".transcript-segments");
  if (!node || editing) return render();
  const scrollState=rememberTranscriptScroll(node);
  const q = searchText.toLowerCase();
  node.innerHTML = paragraphSegments(readingRevision()?.content.segments || [])
    .filter(s => !q || s.text.toLowerCase().includes(q))
    .map(s => `<div class="transcript-segment" data-start="${s.start}" data-end="${s.end}"><button class="timestamp" data-seek="${s.start}">${clock(s.start)}</button><div class="segment-text">${s.speaker ? `<span class="speaker">${esc(s.speaker)}</span>` : ""}${esc(s.text)}</div></div>`).join("") || '<p class="hint">没有找到匹配内容。</p>';
  restoreTranscriptScroll(node,scrollState);
  if ($("correctionStatus")) $("correctionStatus").textContent = correctionStatus();
}
function displayCorrection(group) {
  const key = group.sequences.join(",");
  if (liveCorrections.get(key)?.revision === group.revision && liveCorrections.has(key)) return;
  liveCorrections.set(key, group);
  if (group.revision && !detailData.revisions.some(r => r.id === group.revision))
    detailData.revisions.push({id:group.revision,kind:"corrected-transcript",content:group});
  if (view === "transcript") {
    refreshTranscriptParagraphs();
  } else if(view==='record'){
    refreshRecordTranscript();
  } else if ($("assistTranscript")) {
    updateAssistTranscript();
  }
  if ($("correctionStatus")) $("correctionStatus").textContent = correctionStatus();
}
function transcriptEntries(original = false) {
  const recording=recordingHere();
  if(!recording){
    const reviewed=[...(detailData?.revisions||[])].reverse().find(r=>r.kind===(original?'raw':'verbatim')&&r.content.audioReviewed);
    if(reviewed)return [{seq:-1,start:reviewed.content.segments[0]?.start||0,...reviewed.content}];
  }
  const parts = new Map();
  for (const r of detailData?.revisions || []) {
    if (r.kind === "live-transcript") parts.set(r.content.seq, r.content);
    else if (r.kind === "live" && r.content.text && !parts.has(r.content.seq))
      parts.set(r.content.seq, r.content);
  }
  for (const [key, r] of liveTranscripts) parts.set(key, r);
  return correctedEntries([...parts.values()].sort((a, b) => a.start - b.start), original);
}
// Presentation grouping only: saved segments, exports and source offsets stay intact.
function cleanTranscriptText(text) {
  return String(text || "").replace(/^\s*\[\d{1,3}:\d{2}(?::\d{2})?(?:[—–-]\d{1,3}:\d{2}(?::\d{2})?)?\]\s*/gm, "").trim();
}
function paragraphSegments(segments) {
  const groups = [];
  for (const original of segments) {
    const s = { ...original, text: cleanTranscriptText(original.text) };
    if (!s.text || s.skipped) continue;
    const prev = groups.at(-1);
    const boundary = !prev || s.skipped || prev.skipped ||
      (s.speaker || "") !== (prev.speaker || "") ||
      s.start - (prev.end ?? prev.start) >= 2.5 ||
      s.start - prev.start >= 75 ||
      (prev.text.length >= 350 && /[。！？.!?]$/.test(prev.text));
    if (boundary) groups.push(s);
    else {
      // Keep the word boundary for Latin text, join Chinese ASR chunks naturally.
      const separator = /[a-z0-9]$/i.test(prev.text) && /^[a-z0-9]/i.test(s.text) ? " " : "";
      prev.text += separator + s.text;
      prev.end = s.end ?? s.start;
    }
  }
  return groups;
}
function assistTranscriptMarkup() {
  const segments = transcriptEntries(assistOriginal).flatMap(r =>
    r.segments?.length ? r.segments : [{start:r.start,end:r.end,text:r.text}]);
  const groups = paragraphSegments(segments);
  return groups.length ? groups.map(r =>
    `<div class="live-transcript-line"><button class="timestamp" data-seek="${r.start}">${clock(r.start)}</button><p>${esc(r.text)}</p></div>`
  ).join("") : '<p class="hint transcript-placeholder">开始录音后，老师的原话会按段出现在这里。每段时间可用于回听。</p>';
}
function classroomEvents() {
  const entries = new Map((detailData?.revisions || []).filter(r => r.kind === "live").map(r => [r.content.seq,r.content]));
  for (const e of liveEvents) entries.set(e.seq,e);
  return [...entries.values()].sort((a,b) => a.start-b.start);
}
function validTopic(e) {
  const topic = e.analysis?.topic?.trim();
  return !e.deferred && !e.skipped && topic &&
    !/^(准备好|等待|正在听课|继续听课|逐字转录中|静音|分析结果待核对|未识别|未明确|未确定|暂无|无明确知识点|课堂片段)/.test(topic);
}
function activeTopic() {
  const events = classroomEvents().filter(validTopic);
  const latest = events.at(-1);
  if (!latest) return null;
  let since = latest.start;
  for (let i=events.length-2; i>=0 && events[i].analysis.topic.trim() === latest.analysis.topic.trim(); i--) since=events[i].start;
  return {title:latest.analysis.topic.trim(),since};
}
function topicAgeMarkup(topic) {
  if (!topic) return "尚无知识点记录";
  const reference = recording || finishing ? elapsed : Math.max(duration(),...classroomEvents().map(e => e.start || 0));
  const seconds = Math.max(0,Math.floor(reference-topic.since));
  return `${seconds < 60 ? seconds+" 秒前" : Math.floor(seconds/60)+" 分钟前"}开始 · 录音 ${clock(topic.since)}`;
}
function updateTopicDisplay() {
  const topic = activeTopic();
  if ($("currentTopic")) $("currentTopic").textContent = topic?.title || "尚未识别到知识点";
  if ($("liveState")) $("liveState").textContent = topicAgeMarkup(topic);
}
function displayAssistTranscript(r) {
  if (seenTranscripts.has(r.seq)) return;
  seenTranscripts.add(r.seq);
  liveTranscripts.set(r.seq, r);
  displayCalibration(r.silence);
  if ($("mobileTranscript"))
    $("mobileTranscript").textContent =
      r.text || "静音片段未发送 AI，原音继续保存。";
  if ($("assistTranscript"))
    updateAssistTranscript();
  if ($("correctionStatus")) $("correctionStatus").textContent = correctionStatus();
}
function assistPage() {
  const recording=recordingHere(),finishing=finishingHere();
  const events=classroomEvents();const topic=activeTopic();
  const match=[...events].reverse().find(e=>e.analysis?.match)?.analysis.match;
  return heading('LIVE CLASSROOM','实时原文、知识点与提问集中在这里，笔记和电子书继续用你自己的 App。') +
    `<div class="assist-layout assist-workbench"><section class="panel assist-main"><div class="assist-main-heading"><div><h2>实时逐字稿</h2><p class="hint">自动校订后原位更新 · 点击时间回听 · ${options.live.retainTranscript?'原文与校订稿分别保存':'文本仅本次显示'}</p></div><div class="row"><button class="text-button" data-action="toggleTranscriptSource">${assistOriginal?"返回校订稿":"核对原文"}</button><button class="text-button" data-action="copyLiveTranscript">复制全文</button></div></div><div id="assistTranscript" class="assist-transcript">${assistTranscriptMarkup()}</div><button id="followTranscript" class="follow-transcript-overlay" data-action="followTranscript" hidden>\u56de\u5230\u6700\u65b0 \u2193</button></section>
    <aside class="assist-side"><section class="live-topic"><p class="section-label">当前知识点</p><h2 id="currentTopic">${esc(topic?.title || '尚未识别到知识点')}</h2><p id="liveState">${esc(topicAgeMarkup(topic))}</p></section>
    <section class="panel classroom-events"><div class="row spread"><h3>课堂动态与提问</h3><button class="text-button" data-action="questionDemo">提问演示</button></div><p id="questionPipelineStatus" class="question-pipeline-status" role="status">${esc(questionDetectionSummary(events.at(-1)))}</p><div id="liveOutput" class="live-events">${events.filter(e=>!e.deferred).slice().reverse().slice(0,20).map(eventMarkup).join('') || '<p class="hint">知识点变化、资料页码和课堂提问会按时间保留。</p>'}</div></section>
    <section class="panel classroom-materials"><div class="row spread"><h3>资料定位</h3><label class="upload-button">导入资料<input id="docUpload" type="file" accept=".pdf,.txt,.md" hidden></label></div><select id="documentSelect" ${detailData?.documents?.length > 1 ? "" : "hidden"} aria-label="选择课堂资料"><option value="">未导入资料</option>${(detailData?.documents||[]).map(d=>`<option value="${d.id}" ${d.id===docData?.id?'selected':''}>${esc(d.name)}</option>`).join('')}</select><p class="material-match" id="pageMatch">${match?`${esc(match.name)} · 文件第 ${match.page} 页 / 印刷 P${match.printedPage}`:'尚无页码匹配'}</p></section>
</aside></div><details class="assist-session-tools"><summary>原音、页码与保存设置</summary><div class="session-tools-content"><label class="check">当前资料页码<input id="pageNumber" type="number" min="1" value="${docPage}" aria-label="资料页码"></label><label class="check"><input id="pageLock" type="checkbox" ${locked?'checked':''}>锁定页码</label><label class="check">印刷页偏移<input id="pageOffset" type="number" value="0" aria-label="印刷页偏移"></label><label class="check"><input id="retainTranscript" type="checkbox" ${options.live.retainTranscript?'checked':''}>保存实时逐字文本</label>${audioBox()}</div></details>`;
}
function questionDetectionSummary(event) {
  if (!event) return "开始录音后显示转录与判题进度";
  if (event.analysisError) return "提问检测失败，原文已保留";
  if (event.skipped) return "本段静音，未发送模型";
  if (event.deferred) return "原文已返回，等待停顿或汇总判题";
  const a = event.analysis || {};
  if (a.isQuestion === true) return "本段确认为提问";
  if (a.suppressedReason) return "未提醒：" + a.suppressedReason;
  const types = {lecture:"判为讲解，未触发提醒",rhetorical:"判为反问，未触发提醒",'self-answered':"判为已自问自答，未触发提醒",admin:"判为课堂管理用语，未触发提醒"};
  return types[a.questionType] || "本段未确认新的待答提问";
}
function setQuestionPipelineStatus(text) {
  if ($("questionPipelineStatus")) $("questionPipelineStatus").textContent = text;
}
function eventMarkup(e) {
  return `<div class="live-event"><small>${clock(e.start)} ${e.sample ? "· 人工示例" : ""}</small><p><strong>${esc(e.analysis?.topic || (e.analysisError ? "分析未完成" : e.skipped ? "静音已跳过" : "课堂片段"))}</strong></p>${e.analysisError ? `<p class="error">${esc(e.analysisError)}</p>` : ""}${e.analysis?.match ? `<p>资料 P${e.analysis.match.printedPage} · ${esc(e.analysis.evidence || "待核对")}</p>` : ""}<p class="detection-note">${esc(questionDetectionSummary(e))}</p>${e.analysis?.isQuestion ? `<p>${esc(e.analysis.question)}</p><button data-event="${e.seq}">查看参考回答</button>` : ""}${options.live.retainTranscript && e.text ? `<details><summary>本段转录</summary><p>${esc(e.text)}</p></details>` : ""}</div>`;
}
function effectiveNetwork(p) {
  if (!p) return "—";
  if (p.network && p.network !== "Auto") return p.network;
  try {
    const host = new URL(p.baseURL).hostname;
    return (
      "Auto → " +
      (host.endsWith(".cn") || ["localhost", "127.0.0.1"].includes(host)
        ? "Direct (no proxy)"
        : "System proxy")
    );
  } catch {
    return "待填写完整平台 URL";
  }
}
function correctionModelCard(c) {
  const p = boot.providers.find(p => p.id === c.providerId);
  const noThinking = new URL(p?.baseURL || "http://localhost").hostname === "api.siliconflow.cn" && /^(Pro\/)?deepseek-ai\//.test(c.model);
  return `<section class="panel settings-section"><div class="row spread"><h2>实时逐字稿校订</h2><span class="badge">${p?.hasKey ? "已配置密钥" : "未配置密钥"}</span></div><p class="hint">每句段自动修正错字、术语和断句；不概括、不省略。与内容分析可使用不同平台和模型。</p><label class="check"><input type="checkbox" data-config="live.correctTranscript" ${options.live.correctTranscript !== false ? "checked" : ""}>启用自动校订（默认开启）</label><div class="form-grid"><label>平台<select data-config="correction.providerId">${boot.providers.map(p => `<option value="${esc(p.id)}" ${p.id === c.providerId ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><label>模型 ID<input data-config="correction.model" list="correctionModels" value="${esc(c.model)}"><button class="link-like" data-action="fetchModels" data-role="correction">获取平台模型列表</button><datalist id="correctionModels">${(p?.models || []).map(m => `<option value="${esc(typeof m === "string" ? m : m.id)}">`).join("")}</datalist></label><label>温度<input data-config="correction.temperature" type="number" min="0" max="1" step="0.1" value="${c.temperature ?? 0}"></label><label>最大输出 tokens<input data-config="correction.maxTokens" type="number" min="256" max="16000" value="${c.maxTokens ?? 4000}"></label><label>校订超时（秒）<input data-config="correction.timeout" type="number" min="2" max="60" value="${c.timeout ?? 10}"></label></div><details class="request-details"><summary>查看实际请求参数</summary><div class="actual-params">POST ${esc((p?.baseURL || "") + (p?.chatPath || "/chat/completions"))}\nmodel: ${esc(c.model)}\ntemperature: ${c.temperature ?? 0} · max_tokens: ${c.maxTokens ?? 4000}\nstream: false · ${noThinking ? "enable_thinking: false" : "thinking 参数不发送（平台默认）"}\ntimeout: ${Math.min(options.timeout,c.timeout ?? 10)}s · network: ${esc(effectiveNetwork(p))}</div></details><p class="hint">校订失败保留原文并显示状态；已发出的下一段识别不等待校订。原文可核对，音频时间不改变。</p></section>`;
}
function modelCard(role, label, desc) {
  const c = options[role];
  if (role === "correction") return correctionModelCard(c);
  const p = boot.providers.find((p) => p.id === c.providerId);
  return `<section class="panel settings-section"><div class="row spread"><h2>${label}</h2><span class="badge">${p?.hasKey ? "已配置密钥" : "未配置密钥"}</span></div><p class="hint">${desc}</p><div class="form-grid"><label>平台<select data-config="${role}.providerId">${boot.providers.map((p) => `<option value="${esc(p.id)}" ${c.providerId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><div class="model-field"><label>模型 ID<input data-config="${role}.model" list="${role}Models" value="${esc(c.model)}"></label><button class="link-like" data-action="fetchModels" data-role="${role}">获取平台模型列表</button><datalist id="${role}Models">${(
    p?.models || []
  )
    .slice(0, 200)
    .map((m) => `<option value="${esc(typeof m === "string" ? m : m.id)}">`)
    .join(
      "",
    )}</datalist></div>${role === "asr" ? `<label>识别接口<select data-config="asr.protocol"><option value="transcriptions">音频转录（multipart）</option></select></label><label>语言提示<input data-config="asr.language" value="${esc(c.language || "auto")}" placeholder="auto / zh / en"></label>` : `<label>参数模式<select id="parameterMode"><option value="auto" ${options.parameterMode === "auto" ? "selected" : ""}>自动填入（实际值如下）</option><option value="manual" ${options.parameterMode === "manual" ? "selected" : ""}>手动设置</option></select></label><label>温度<input data-config="temperature" type="number" min="0" max="2" step="0.1" value="${options.temperature}" ${options.parameterMode === "auto" ? "disabled" : ""}></label><label>最大输出 tokens<input data-config="maxTokens" type="number" min="256" max="16000" value="${options.maxTokens}" ${options.parameterMode === "auto" ? "disabled" : ""}></label><label>思考参数<select data-config="thinking" ${options.parameterMode === "auto" ? "disabled" : ""}><option value="omit" ${options.thinking === "omit" ? "selected" : ""}>不发送（平台默认）</option><option value="off" ${options.thinking === "off" ? "selected" : ""}>enable_thinking=false</option></select></label>`}</div><details class="request-details"><summary>查看实际请求参数</summary><div class="actual-params">${role === "asr" ? "POST " + esc((p?.baseURL || "") + (p?.transcriptionPath || "/audio/transcriptions")) + "\nmodel: " + esc(c.model) + " · 16 kHz / mono / PCM16 WAV" : "POST " + esc((p?.baseURL || "") + (p?.chatPath || "/chat/completions")) + "\ntemperature: " + options.temperature + " · max_tokens: " + options.maxTokens + "\nstream: false · thinking: " + esc(options.thinking)}\nauth: ${esc(p?.auth || "—")}\nnetwork: ${esc(effectiveNetwork(p))} · timeout: ${options.timeout}s</div></details><p class="hint">${role === "asr" ? "纯文字转录接口不保证说话人分离。时间段是本机音频切片边界，不冒充逐词时间戳。" : "每段请求独立，不带其他录音的聊天历史。自动模式只填入界面所见的固定保守参数，不擅自换模型。"}</p></section>`;
}
function priceKey(role) {
  return options[role].providerId + "/" + options[role].model;
}
function basePrice(role) {
  const match =
    boot.config[role]?.providerId === options[role].providerId &&
    boot.config[role]?.model === options[role].model;
  return match ? boot.priceQuotes?.[role] || {} : {};
}
function pricingSettings() {
  const cards = ["asr", "correction", "text", "search"]
    .map((role) => {
      const p = { ...basePrice(role), ...options.prices?.[priceKey(role)] };
      const fields =
        role === "asr"
          ? [
              ["audioPerSecond", "每秒音频单价"],
              ["minimumAudioSeconds", "每次最少计费秒数"],
              ["roundAudioSeconds", "每次按几秒取整（0 为不取整）"],
            ]
          : role === "search"
            ? [["perThousandRequests", "每千次搜索单价"]]
            : [
                ["inputPerMillion", "输入 / 百万 tokens"],
                ["cachedPerMillion", "缓存命中 / 百万 tokens"],
                ["outputPerMillion", "输出 / 百万 tokens"],
              ];
      return `<section class="panel settings-section"><h2>${role === "asr" ? "语音识别计价" : role === "search" ? "联网搜索计价" : role === "correction" ? "实时校订计价" : "内容分析计价"}</h2><p class="hint">${esc(options[role].providerId)} / ${esc(options[role].model)}</p><div class="form-grid"><label>币种<select data-price-role="${role}" data-price-field="currency">${["CNY", "USD", "EUR"].map((c) => `<option ${c === (p.currency || "CNY") ? "selected" : ""}>${c}</option>`).join("")}</select></label>${fields.map(([k, n]) => `<label>${n}<input type="number" min="0" step="any" data-price-role="${role}" data-price-field="${k}" value="${p[k] ?? ""}" placeholder="未配置"></label>`).join("")}</div><p class="hint price-source">${p.source ? "参考来源：" + esc(p.source) + "（" + esc(p.checked || "") + "）" : "此模型没有已核实单价，请手动填写；未知价格不会按 0 元处理。"}<br>手动单价仅对应当前平台与模型；切换模型后分别配置。官方分时价格按请求时刻计算，手动填写后按固定单价计算。</p><button data-action="resetPrice" data-role="${role}">恢复参考单价</button></section>`;
    })
    .join("");
  return `<p class="hint">API 返回的 tokens 是实际报告用量；金额按已核实或手填单价估算，不等于平台实际扣费。不同币种分开累计。语音识别通常按音频秒数计价，未返回 tokens 时不虚构 token 数。</p><div class="model-grid">${cards}</div>`;
}
let usageRequest = false,
  lastUsageFetch = 0;
async function refreshUsage() {
  if (!current || usageRequest || Date.now() - lastUsageFetch < 1200) return;
  const sid = current;
  usageRequest = true;
  lastUsageFetch = Date.now();
  try {
    const value = await api(`/api/sessions/${sid}/usage`);
    if (current === sid) {
      usageData = value;
      renderUsage();
      scheduleLessonEstimate();
    }
  } finally {
    usageRequest = false;
  }
}
function renderUsage() {
  const metrics=usageMetrics(current?usageData:null);
  document.querySelectorAll('[data-usage-metric]').forEach(el=>{el.textContent=metrics[Number(el.dataset.usageMetric)];});
  const target = $("usageStrip");
  if (!target) return;
  if (!current) {
    target.innerHTML =
      "<small>开始后显示本次音频用量、API 返回的 tokens 与估算金额。</small>";
    return;
  }
  const u = usageData;
  if (!u) {
    target.innerHTML = "<small>正在读取本次用量…</small>";
    return;
  }
  const money =
    Object.entries(u.amounts || {})
      .map(([c, n]) => `${c} ${n.toFixed(6)}`)
      .join(" / ") || (u.requests ? "单价或用量待补全" : "尚无请求");
  target.innerHTML = `<div><strong>${(u.audioSeconds || 0).toFixed(1)} s</strong><small>已送出 ASR 音频</small></div><div><strong>${(u.inputTokens || 0).toLocaleString()}</strong><small>输入 tokens</small></div><div><strong>${(u.cachedTokens || 0).toLocaleString()}</strong><small>缓存命中 tokens</small></div><div><strong>${(u.outputTokens || 0).toLocaleString()}</strong><small>输出 tokens</small></div><div><strong>${esc(money)}</strong><small>按单价估算 · 非平台账单</small></div><details class="usage-detail"><summary>${u.requests} 次模型请求${u.unpricedRequests ? ` · ${u.unpricedRequests} 次金额未完整计入` : ""}${u.unreportedTokenRequests ? ` · ${u.unreportedTokenRequests} 次未返回完整 tokens` : ""}</summary><p class="hint">只统计本版本启用后的调用；接口返回结果后更新，不预测尚未返回的 tokens。搜索按已配置的每千次单价估算；未知费用不计为 0。</p>${(
    u.rows || []
  )
    .slice(-30)
    .reverse()
    .map(
      (r) =>
        `<p>${esc(r.created)} · ${r.role === "correction" ? "实时校订 · " : ""}${esc(r.model)} · ${r.role === "asr" ? r.seconds.toFixed(1) + " 秒" : r.role === "search" ? "1 次搜索" : (r.usage.inputTokens ?? "未报告") + " 输入 / " + (r.usage.outputTokens ?? "未报告") + " 输出"} · ${r.cost === null ? "金额未知" : esc(r.price.currency) + " " + r.cost.toFixed(6)}</p>`,
    )
    .join("")}</details>`;
}
function scheduleCost() {
  clearTimeout(costTimer);
  const ticket=++costTicket;
  if (!current || !gate || !detailData?.hasAudio || recording) {
    if ($("costEstimate"))
      $("costEstimate").textContent = "实时用量与估算金额显示在页面用量栏。";
    return;
  }
  const sid = current;
  const config = cfg();
  $("costEstimate").textContent="正在按当前阈值计算语音识别费用…";
  config.silence.thresholdMode = "manual";
  costTimer = setTimeout(
    () =>
      guard(async () => {
        const estimate = await api(`/api/sessions/${sid}/cost-preview`, {
          config,
        });
        if (current !== sid || ticket!==costTicket) return;
        $("costEstimate").textContent =
          estimate.asrEstimate === null
            ? "本次语音识别成本：当前模型单价未配置；可在设置 → 用量与单价填写。整理、答题和搜索另计。"
            : `本次语音识别预计 ${estimate.price.currency} ${estimate.asrEstimate.toFixed(6)} · 送出 ${estimate.sentSeconds.toFixed(1)} 秒 / ${estimate.requests} 次请求。${estimate.note}`;
      }),
    350,
  );
}

function settingsPage() {
  const tabs = [
    ["models", "识别与分析模型"],
    ["platforms", "平台与密钥"],
    ["prompts", "整理提示词"],
    ["audio", "收音与静音"],
    ["live", "听课辅助"],
    ["billing", "用量与单价"],
    ["storage", "录音与数据"],
    ["appearance", "外观"],
  ];
  let content = "";
  if (settingsTab === "models")
    content =
      '<div class="model-grid">' +
      modelCard(
        "asr",
        "语音识别",
        "把声音变成逐字原稿。可独立选择平台与模型。",
      ) +
      modelCard(
        "text",
        "内容分析",
        "整理对话、总结课堂、识别提问与生成答案。",
      ) +
      modelCard("correction", "实时校订", "") +
      `</div><section class="panel settings-section request-timeout"><label>请求超时（秒）<input data-config="timeout" type="number" min="10" max="300" value="${options.timeout}"></label><p class="hint">设置由本项目独立保存。每次生成的参数随版本保存。</p></section>`;
  if (settingsTab === "platforms")
    content = `<section class="panel settings-section"><h2>接入平台</h2><p class="hint">平台和密钥由本项目独立保存，不依赖其他 App。网页只收到“密钥是否就绪”，不会收到已有密钥。</p>${boot.providers.map((p) => `<div class="platform"><div class="row spread"><strong>${esc(p.name)}</strong><span class="badge">${p.hasKey ? "密钥就绪" : "未设置密钥"} · 本项目平台</span></div><small>${esc(p.baseURL)}</small><small>${esc(p.auth)} · ${esc(p.network)}</small></div>`).join("")}</section><section class="panel settings-section"><h2>添加网页专用平台</h2><p class="hint">${window.LectureMobile?'服务器代理用于公网 HTTPS，密钥由服务器保管。本设备直连用于内网 / Tailscale，平台只保存在当前浏览器；HTTP 直连还受本地网络权限及服务端 CORS 限制。':'OpenAI 兼容接口；密钥由本机服务以 0600 权限保存。'}</p><div class="form-grid"><label>平台名称<input id="providerName" placeholder="例如：硅基流动备用"></label><label>Base URL<input id="providerURL" placeholder="https://api.example.com/v1"></label><label>认证方式<select id="providerAuth"><option>Authorization: Bearer &lt;key&gt;</option><option>x-api-key: &lt;key&gt;</option><option>No key (local server)</option></select></label><label>API Key<input id="providerKey" type="password" autocomplete="new-password" placeholder="按所选网络方式保存密钥"></label><label>转录路径<input id="providerASRPath" value="/audio/transcriptions"></label><label>分析路径<input id="providerChatPath" value="/chat/completions"></label><label>网络<select id="providerNetwork"><option>Direct (no proxy)</option><option>System proxy</option></select></label></div><button data-action="saveProvider" class="primary" style="margin-top:22px">保存平台</button></section>`;
  if (settingsTab === "prompts")
    content = `<section class="panel settings-section"><h2>三个任务，各有自己的规则</h2><p class="hint">更改默认提示词只影响后续生成。每份旧版本保留当时的提示词。</p>${Object.entries(
      boot.prompts,
    )
      .map(
        ([k, v]) =>
          `<label style="margin-top:24px">${kinds[k]}<textarea data-prompt="${k}" rows="6">${esc(promptOverrides[k] ?? v)}</textarea></label>`,
      )
      .join(
        "",
      )}<button data-action="savePrompts" class="primary" style="margin-top:20px">保存默认提示词</button></section>`;
  if (settingsTab === "audio")
    content = `<section class="panel settings-section"><h2>保留完整录音，只过滤送往 AI 的静音</h2><p class="hint">时长与书签使用原始录音时间轴，不因静音跳过而前移。连续静音时长与语音前后保护都会参与曲线计算。</p><div class="setting-row"><div>当前静音阈值<small>越负越保守，适合远处或轻声的老师。</small></div><strong>${options.silence.thresholdDb} dBFS</strong></div><div class="setting-row"><span>最短连续静音</span><span>${options.silence.minSilence} 秒</span></div><div class="setting-row"><span>前后保护</span><span>${options.silence.padding} 秒</span></div><button data-action="silence" style="margin-top:20px">打开收音与阈值曲线</button></section>`;
  if (settingsTab === "live")
    content = `<section class="panel settings-section"><h2>课堂中，少操作一步</h2><p class="hint">实时理解仍需在内存中进行语音识别。选择不保存逐字文本并不意味着模型不处理音频。</p><div class="setting-row"><div>提问灵敏度<small>保守档过滤讲解反问和自问自答，弱关键词先做语义确认；所有新题保留在题目历史。</small></div><select data-config="live.questionSensitivity">${[
      ["conservative", "保守（推荐）"],
      ["balanced", "均衡"],
      ["sensitive", "灵敏"],
    ]
      .map(
        ([v, n]) =>
          `<option value="${v}" ${options.live.questionSensitivity === v ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></div>${[["asrTimeoutSeconds","实时识别等待上限（秒）",45],["detectTimeoutSeconds","实时判题等待上限（秒）",20],["answerTimeoutSeconds","实时答题等待上限（秒）",45]].map(([k,label,fallback])=>`<div class="setting-row"><div>${label}<small>网络等待超时后保留原音并继续后续片段，避免分钟级积压。</small></div><input type="number" min="2" max="600" data-config="live.${k}" value="${options.live[k]??fallback}"></div>`).join("")}<div class="setting-row"><div>新题自动答题<small>关闭 Thinking，题目并发请求；新提问全屏提醒。需要深入分析时，在题目内追问并选择思考强度。</small></div><span class="badge">Thinking 关闭</span></div><div class="setting-row"><div>校订与判题合并<small>平台和模型相同且快速检测开启时，一次请求完成两步，使用校订温度和超时；不同模型仍分别调用。${options.correction?.providerId === options.text.providerId && options.correction?.model === options.text.model && options.live.correctTranscript !== false && options.live.fastDetection !== false ? "当前模型可合并。" : "当前模型分别调用。"}不跳过校订或放宽提问门限。</small></div><input type="checkbox" data-config="live.fastPipeline" ${options.live.fastPipeline !== false ? "checked" : ""}></div><div class="setting-row"><div>答案流式显示<small>收到正文就显示，不等待全文结束；不支持流式接口的平台可关闭。新题保持关闭 Thinking。</small></div><input type="checkbox" data-config="live.streamAnswers" ${options.live.streamAnswers !== false ? "checked" : ""}></div><div class="setting-row"><div>快速检测关闭思考<small>仅对已支持的中国站 SiliconFlow DeepSeek 生效，其他平台沿用模型设置；只影响提问/知识点初步检测；答题由独立的 Thinking 选项控制。</small></div><input type="checkbox" data-config="live.fastDetection" ${options.live.fastDetection ? "checked" : ""}></div><div class="setting-row"><div>按停顿发送<small>根据声音停顿分段，不是语义断句；完整原音继续保存。</small></div><input type="checkbox" data-config="live.sentenceMode" ${options.live.sentenceMode ? "checked" : ""}></div><div class="setting-row"><div>停顿时长（秒）</div><input data-config="live.pauseSeconds" type="number" min="0.3" max="3" step="0.1" value="${options.live.pauseSeconds}"></div><div class="setting-row"><div>关键词优先提醒<small>先做短段 ASR，命中关键词便提醒，不等待答案。会增加 ASR 请求次数，并仍有 ASR 网络延迟；这不是本地逐采样关键词检测。</small></div><input type="checkbox" data-config="live.keywordEnabled" ${options.live.keywordEnabled ? "checked" : ""}></div><div class="setting-row"><div>关键词快检间隔</div><select data-config="live.keywordProbeSeconds">${[2, 3, 4, 6].map((x) => `<option value="${x}" ${options.live.keywordProbeSeconds === x ? "selected" : ""}>${x} 秒</option>`).join("")}</select></div><label>提醒关键词（逗号分隔）<textarea id="keywordList" rows="2">${esc(options.live.keywords.join(", "))}</textarea></label><div class="setting-row"><div>最长分析间隔<small>按停顿或最长间隔合并文字做语义分析；关键词快检独立进行。检测最多 700、答题最多 1200 输出 tokens，均不超过模型设置。</small></div><select data-config="live.chunkSeconds">${[6, 12, 20, 30].map((x) => `<option value="${x}" ${options.live.chunkSeconds === x ? "selected" : ""}>${x} 秒</option>`).join("")}</select></div><div class="setting-row"><div>保存实时逐字文本<small>关闭时，只保存知识点与提问分析；不保存本段逐字文本。</small></div><input type="checkbox" data-config="live.retainTranscript" ${options.live.retainTranscript ? "checked" : ""}></div><div class="setting-row"><div>资料定位最低置信度<small>没有可靠匹配时不更新页码；资料在其他 App 阅读。</small></div><input data-config="live.pageConfidence" type="number" min="0.5" max="1" step="0.05" value="${options.live.pageConfidence}" style="width:80px"></div><div class="setting-row"><div>检测到提问后联网搜索<small>将提问发往 Brave Search，再让分析模型结合来源回答。${boot.searchReady ? "搜索密钥已配置。" : "尚未配置搜索密钥。"}</small></div><input data-config="live.webSearch" type="checkbox" ${options.live.webSearch ? "checked" : ""} ${boot.searchReady ? "" : "disabled"}></div><label style="margin-top:18px">Brave Search API Key<input id="searchKey" type="password" autocomplete="new-password" placeholder="只保存在本机，不回传已有密钥"></label><button data-action="saveSearch" style="margin-top:12px">保存搜索密钥</button><p class="hint">后台、锁屏或接听电话可能被浏览器暂停。当前版本不能承诺手机后台连续录制。</p></section>`;
  if (settingsTab === "billing") content = pricingSettings();
  if (settingsTab === "storage")
    content = `<section class="panel settings-section"><h2>录音与版本</h2><p class="hint">原音、音频片段、资料与文字版本均在本机服务的数据目录中。模型请求只在你确认后发往所选平台。</p><div class="setting-row"><div>原始录音<small>结束后保留，可换模型、改提示词重新识别与整理。</small></div><span class="badge">默认保留</span></div><div class="setting-row"><div>分段保存与重传<small>未上传的片段缓存在当前浏览器 IndexedDB。</small></div><button data-action="retry">重传待保存片段</button></div><div class="setting-row"><div>文字版本<small>重新生成与人工编辑均另存版本，不覆盖原稿。</small></div><span class="badge">保留历史</span></div><div class="setting-row"><div>手机访问<small>当前只监听本机；跨设备使用还需 HTTPS、登录与私有存储。</small></div><span class="badge">尚未部署</span></div>${current ? `<a href="/api/sessions/${current}/export" target="_blank" style="display:inline-block;margin-top:20px">导出当前记录全部数据 JSON</a>` : ""}</section>`;
  if (settingsTab === "appearance") content = themeGallery();
  if(settingsTab==='live')content=`<section class="panel settings-section"><h2>模型等待策略</h2><select data-config="live.timeoutMode"><option value="auto" ${options.live.timeoutMode!=='manual'?'selected':''}>自动：按实际音频与文字长度</option><option value="manual" ${options.live.timeoutMode==='manual'?'selected':''}>手动：使用下方固定上限</option></select><p class="hint">自建 ASR：25 秒＋实际发送音频秒数（基础最多 300 秒），未预热额外留 120 秒；公网 ASR：8 秒＋音频时长的 0.6 倍，课堂长音频最多 120 秒。校订和分析按输入文字长度计算。正常返回立即显示，不会等满上限。录音进度中可见最近请求的实际上限。</p></section>`+content;
  if(settingsTab==='audio')content+=`<section class="panel settings-section"><h2>普通记录 / 会议的讲话停顿</h2><label>停顿多久后发送（秒）<input data-config="live.meetingPauseSeconds" type="number" min="0.35" max="3" step="0.05" value="${options.live.meetingPauseSeconds??.6}"></label><p class="hint">默认 0.6 秒；越小越快发送。仅用于普通记录和会议，下次开始录音生效，不改变课堂设置。没有停顿时可点“发送当前段”。</p></section>`;
  return `<div class="page-heading"><div><h1>模型与设置</h1><p class="description">分别设置语音识别、实时校订与内容分析，密钥只保存在本机。</p></div></div><div class="settings-layout"><nav class="settings-nav" aria-label="设置分类">${tabs.map(([v, n]) => `<button data-settings="${v}" class="${settingsTab === v ? "active" : ""}">${n}</button>`).join("")}</nav><div class="settings-content">${content}</div></div>`;
}
function themeGallery() {
  return `<section class="appearance-preference"><h2>外观模式</h2><p class="hint">浅色使用清晰工作台，深色使用深色专注。选择会在当前浏览器保存。</p><div class="pill-tabs appearance-switch" role="group" aria-label="外观模式">${[
    ["light", "浅色"],
    ["dark", "深色"],
    ["system", "跟随系统"],
  ]
    .map(([v, n]) => `<button data-appearance="${v}">${n}</button>`)
    .join("")}</div></section><div class="theme-options">${[
    [
      "light",
      "studio",
      "清晰工作台 · 浅色",
      "浅灰、墨色、紫色强调，用于白天与明亮环境。",
    ],
    [
      "dark",
      "night",
      "深色专注 · 深色",
      "深色表面与高对比文字，用于夜间与暗光环境。",
    ],
  ]
    .map(
      ([v, preview, n, d]) =>
        `<button data-appearance="${v}" class="theme-card"><div class="theme-preview ${preview}"><div class="theme-mini-nav" aria-hidden="true"><b>记录工作台</b><span>普通记录</span><span>课堂逐字稿</span><span>听课辅助</span></div><div class="theme-mini-content"><h3>把值得的对话留下。</h3><p>00:42　关于下一次讨论<br>每一句原话，都可以回到声音里。</p></div></div><div><h3>${n}</h3><small>${d}</small></div></button>`,
    )
    .join("")}</div>`;
}
function designPage() {
  return `<div class="page-heading"><div><h1>白天清晰，夜晚专注。</h1><p class="description">同一套工作区，浅色与深色两种模式。</p></div></div>${themeGallery()}<div class="design-explainer"><h2>为三个工作流程保留各自的布局。</h2><p>普通记录突出完整文稿，课堂逐字稿结合时间轴与笔记，听课辅助以教材和课堂动态为中心。切换外观会保留当前内容与录音状态。</p><div class="design-links"><a href="/record" data-route="record">普通记录</a><a href="/transcript" data-route="transcript">课堂逐字稿</a><a href="/assist" data-route="assist">听课辅助</a></div></div>`;
}
function render() {
  const previousTranscript=document.querySelector("#assistTranscript, .transcript-segments");
  if(previousTranscript)rememberTranscriptScroll(previousTranscript);
  document.documentElement.dataset.view = view;
  document.querySelectorAll("[data-route]").forEach((a) => {
    const active = a.dataset.route === view;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  $("breadcrumb").textContent = names[view];
  $("sampleBadge").hidden =
    detailData?.status !== "sample" || ["settings", "design"].includes(view);
  $("recorder").hidden = ["settings", "design"].includes(view) && !recording;
  $("sample").hidden = ["settings", "design"].includes(view);
  $("workspace").innerHTML = (
    {
      record: recordPage,
      transcript: transcriptPage,
      assist: assistPage,
      settings: settingsPage,
      design: designPage,
    }[view] || recordPage
  )();
  if ($("audioSlot")) {
    if (detailData?.hasAudio) {
      if (player.dataset.sid !== current) {
        if(window.LectureMobile){const sid=current;window.LectureMobile.fileURL(sid).then(url=>{if(player.dataset.sid===sid)player.src=url;}).catch(e=>tell(e.message,true));}
        else player.src = "/api/sessions/" + current + "/audio";
        player.dataset.sid = current;
      }
      $("audioSlot").append(player);
    } else {
      player.pause();
      player.removeAttribute("src");
      delete player.dataset.sid;
    }
  }
  if ($("recordTitle"))
    $("recordTitle").onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        guard(saveTitle);
      }
    };
  if ($("speakerNotes"))
    $("speakerNotes").oninput = (e) => (speakers = e.target.value);
  if ($("transcriptSearch"))
    $("transcriptSearch").oninput = (e) => {
      const cursor = e.target.selectionStart;
      searchText = e.target.value;
      render();
      $("transcriptSearch").focus();
      $("transcriptSearch").setSelectionRange(cursor, cursor);
    };
  if ($("documentSelect"))
    $("documentSelect").onchange = (e) => guard(() => openDoc(e.target.value));
  if ($("pageNumber"))
    $("pageNumber").onchange = (e) => setPage(+e.target.value);
  if ($("pageLock"))
    $("pageLock").onchange = (e) => (locked = e.target.checked);
  if ($("docUpload")) $("docUpload").onchange = () => guard(importDoc);
  if ($("retainTranscript")) $("retainTranscript").disabled = recording;
  if ($("retainTranscript"))
    $("retainTranscript").onchange = (e) => {
      options.live.retainTranscript = e.target.checked;
      saveOptions();
      render();
    };
  if ($("playbackRate"))
    $("playbackRate").onchange = (e) => (player.playbackRate = +e.target.value);
  if ($("parameterMode"))
    $("parameterMode").onchange = (e) => {
      options.parameterMode = e.target.value;
      if (e.target.value === "auto")
        Object.assign(options, {
          temperature: 0,
          maxTokens: 6000,
          thinking: "omit",
        });
      saveOptions();
      render();
    };
  document.querySelectorAll("[data-config]").forEach((el) => {
    if(/^live\.(asrTimeoutSeconds|detectTimeoutSeconds|answerTimeoutSeconds)$/.test(el.dataset.config)&&options.live.timeoutMode!=='manual')el.disabled=true;
    if (
      (recording || starting || finishing) &&
      ![
        "live.questionSensitivity",
        "live.questionCooldownSeconds",
        "live.answerThinking",
        "live.fastDetection",
      ].includes(el.dataset.config)
    )
      el.disabled = true;
    const update = () => {
      if (el.type === "number" && (!el.value || !el.validity.valid)) return;
      const keys = el.dataset.config.split(".");
      const obj = keys.length === 2 ? options[keys[0]] : options;
      obj[keys[keys.length - 1]] =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number" ||
              ["live.chunkSeconds", "live.keywordProbeSeconds"].includes(
                el.dataset.config,
              )
            ? +el.value
            : el.value;
      saveOptions();
    };
    el.oninput = update;
    el.onchange = () => {
      update();
      render();
    };
  });
  countPending();
  if ($("keywordList"))
    $("keywordList").oninput = (e) => {
      options.live.keywords = e.target.value
        .split(/[,，\n]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 40);
      saveOptions();
    };
  document.querySelectorAll("[data-price-field]").forEach(
    (el) =>
      (el.onchange = () => {
        const role = el.dataset.priceRole,
          key = priceKey(role);
        options.prices ||= {};
        options.prices[key] = {
          ...basePrice(role),
          ...options.prices[key],
          [el.dataset.priceField]:
            el.dataset.priceField === "currency"
              ? el.value
              : el.value === ""
                ? null
                : Number(el.value),
        };
        saveOptions();
        const note = el
          .closest(".settings-section")
          ?.querySelector(".price-source");
        if (note)
          note.textContent =
            "手动固定单价，仅作用于当前平台与模型；最终费用以平台账单为准。";
      }),
  );
  const h = document.querySelector(".page-heading");
  if (h && ['record','transcript','assist'].includes(view)) {
    $('workspace').insertAdjacentHTML('beforeend',`<details id="sessionDetails" class="session-details"><summary>\u5f55\u97f3\u8be6\u60c5\u4e0e\u6a21\u578b\u8d39\u7528</summary><div id="captureStatus" class="capture-status" role="status" aria-live="polite"></div>${view!=='record'?realtimeStrip():''}${sessionSetupMarkup()}${current?'<button data-action="export">\u5bfc\u51fa\u5b8c\u6574\u8bb0\u5f55 JSON</button>':''}<section id="usageStrip" class="usage-strip" aria-label="\u672c\u6b21\u6a21\u578b\u7528\u91cf"></section></details>`);
  }
  document.querySelectorAll('[data-quick-provider]').forEach(el=>el.onchange=()=>{
    const role=el.dataset.quickProvider;
    $(`quick-${role}-models`).innerHTML=modelListMarkup(boot.providers.find(p=>p.id===el.value));
    updateQuickModelPrice(role);
  });
  document.querySelectorAll('[data-quick-model]').forEach(el=>el.oninput=()=>updateQuickModelPrice(el.dataset.quickModel));
  wireQuickFreeModels();
  // Legacy controls cannot re-enable fixed-duration audio cutting.
  for(const key of ['sentenceMode','keywordEnabled','keywordProbeSeconds','chunkSeconds'])
    document.querySelector(`[data-config="live.${key}"]`)?.closest('.setting-row')?.remove();
  document.getElementById('keywordList')?.closest('label')?.remove();
  const pauseControl=document.querySelector('[data-config="live.pauseSeconds"]');
  if(pauseControl){pauseControl.min='.8';const label=pauseControl.closest('.setting-row')?.querySelector('div');if(label)label.innerHTML='说话结束确认（秒）<small>本机连续检测人声，停顿达到此时长后发送整段；短换气会继续等待。不会按固定时长截断。</small>';}
  scheduleLessonEstimate();
  updatePipelineStatus();
  document.querySelectorAll("[data-lesson]").forEach(el=>el.oninput=()=>{
    if(!el.value || !el.validity.valid)return;
    lessonPlan[el.dataset.lesson]=Number(el.value);localStorage.setItem("speakless-lesson-plan",JSON.stringify(lessonPlan));scheduleLessonEstimate();
  });
  renderUsage();
  listSidebar();
  updateControls();
  restoreTranscriptScroll(document.querySelector("#assistTranscript, .transcript-segments"));
  syncAppearanceControls();
  if(window.LectureMobile && $("providerNetwork")){
    $("providerNetwork").innerHTML=(window.LectureMobile.account?.enabled?'<option>服务器代理</option>':'')+'<option>本设备直连（浏览器发请求）</option>';
    $("providerNetwork").disabled=false;
  }
  if ($("realtimeEnabled"))
    $("realtimeEnabled").onchange = (e) => {
      options.realtimeTranscript = e.target.checked;
      saveOptions();
    };
  if ($("recordTitle")) $("recordTitle").oninput = resizeTitle;
  resizeTitle();
  if (typeof refreshResponsiveObservers === "function") refreshResponsiveObservers();
}
function listSidebar() {
  const q = $("sessionSearch").value.toLowerCase();
  const filtered = allSessions.filter((s) => s.title.toLowerCase().includes(q));
  $("sessions").innerHTML =
    filtered
      .map(
        (s) =>
          `<button class="session ${s.id === current ? "selected" : ""}" data-session="${s.id}">${esc(s.title)}<small>${esc(new Date(s.created).toLocaleString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}))} · 时长 ${s.durationSeconds==null?"未保存":clock(s.durationSeconds)} · ${s.status === "sample" ? "人工示例" : s.status === "saved" ? (s.audioAvailable?(window.LectureMobile?"原音在此设备":"原音在服务设备"):"此设备无原音") : s.status === "audio-deleted" ? "仅文字" : "录音分段"}</small></button>`,
      )
      .join("") || '<p class="session-empty">这里会留下你的记录。</p>';
  if ($("mobileSessions"))
    $("mobileSessions").innerHTML = $("sessions").innerHTML;
}
async function list() {
  allSessions = await api("/api/sessions");
  listSidebar();
}
async function load(sid, select = true) {
  if(starting&&current&&sid!==current)throw Error('请等待麦克风启动后再切换记录');
  const ticket = ++loadVersion;
  current = sid;
  if(window.LectureMobile&&sid!==recordingSessionId){
    try{for(const item of (await pending()).filter(x=>x.sid===sid))await uploadChunk(item);await window.LectureMobile.recoverRecording(sid);}catch(e){tell('已保留音频缓存，但恢复未完成：'+e.message,true);}
  }
  if(ticket!==loadVersion||current!==sid)return;
  const loaded = await api("/api/sessions/" + sid);
  if (ticket !== loadVersion || current !== sid) return;
  detailData = loaded;
  const cachedCapture=captureView(sid);
  for(const r of loaded.revisions)if(r.kind==='corrected-transcript')cachedCapture.corrections.set(r.content.sequences.join(','),r.content);
  for(const r of cachedCapture.transcripts.values())if(!loaded.revisions.some(x=>x.content?.seq===r.seq&&['live-transcript','transcript-chunk'].includes(x.kind)))loaded.revisions.push({id:r.revision||'memory:'+sid+':'+r.seq,kind:detailData.mode==='live'?'live-transcript':'transcript-chunk',content:r});
  restoreQuestionInbox();
  usageData = loaded.usage || null;
  guard(refreshUsage);
  lastSessions[pageFor(detailData.mode)] = sid;
  localStorage.setItem("speakless-web-last", JSON.stringify(lastSessions));
  if (select) {
    const r = [...detailData.revisions]
      .reverse()
      .find(
        (r) =>
          ![
            "live",
            "summary",
            "chapters",
            "transcript-chunk",
            "live-transcript",
            "corrected-transcript",
            "question-followup",
          ].includes(r.kind),
      );
    activeRevision = r?.id || null;
    tabKind = r?.kind || "raw";
    editing = false;
    gate = null;
    docData = null;
    docPage = 1;
    liveEvents = [];
    liveTranscripts = cachedCapture.transcripts;
    liveCorrections = cachedCapture.corrections;
    assistOriginal = false;
    recordOriginal = false;
    recordVersionPinned = false;
  }
  await list();
  if (ticket !== loadVersion || current !== sid) return;
  render();
  if (view === "assist" && detailData.documents.length && !docData)
    await openDoc(
      [...detailData.revisions]
        .reverse()
        .find((r) => r.kind === "live" && r.content.analysis?.match)?.content
        .analysis.match.document || detailData.documents[0].id,
      [...detailData.revisions]
        .reverse()
        .find((r) => r.kind === "live" && r.content.analysis?.match)?.content
        .analysis.match.page || 1,
    );
}
async function navigate(v, push = true) {
  if (!names[v]) v = "record";
  if((recording||starting||finishing)&&v===recordingPage&&(current===recordingSessionId||starting)){
    view=v;if(push)history.pushState({},'', '/'+v);render();return;
  }
  view = v;
  if (push) history.pushState({}, "", "/" + v);
  searchText = "";
  editing = false;
  if (["record", "transcript", "assist"].includes(v)) {
    const sid = lastSessions[v];
    if (sid && allSessions.some((s) => s.id === sid)) await load(sid);
    else {
      loadVersion++;
      current = null;
      detailData = null;
      docData = null;
      activeRevision = null;
      tabKind = "raw";
      render();
    }
  } else render();
}
async function newRecord() {
  if (recording || starting || finishing || busy)
    throw Error("请先结束录音并等待任务完成");
  loadVersion++;
  current = null;
  detailData = null;
  resetQuestionInbox(null);
  activeRevision = null;
  gate = null;
  docData = null;
  liveEvents = [];
  modelPaused = false;
  recordOriginal = false;
  recordVersionPinned = false;
  if (options.silence.thresholdMode === "auto") {
    options.silence.thresholdDb = -80;
    applySilence();
  }
  editing = false;
  elapsed = 0;
  tabKind = "raw";
  delete lastSessions[view];
  localStorage.setItem("speakless-web-last", JSON.stringify(lastSessions));
  player.pause();
  $("clock").textContent = "00:00";
  render();
  tell("新记录已准备好，开始录音或导入音频。");
}
async function ensure() {
  if (current) return current;
  const d = await api("/api/sessions", {
    title:
      (view === "record"
        ? "对话记录"
        : view === "assist"
          ? "听课记录"
          : "课堂逐字稿") +
      " · " +
      new Date().toLocaleDateString("zh-CN"),
    mode: modeFor(view),
  });
  await load(d.id);
  return current;
}
function confirmCall(msg) {
  const asr = options.asr,
    text = options.text;
  return confirm(
    msg +
      "\n\n语音：" +
      asr.providerId +
      " / " +
      asr.model +
      "\n分析：" +
      text.providerId +
      " / " +
      text.model +
      "\n将发送音频或文字到所选平台，可能产生 API 费用。确认执行？",
  );
}
async function runTranscribe() {
  if (recording || finishing || busy) throw Error("请先结束录音并等待任务完成");
  if (!detailData?.hasAudio) throw Error("请先录音或导入音频");
  await reviewAudio();
}
function prepareGateAudio() {
  $("liveMeter").hidden = !recording;
  const available = !!detailData?.hasAudio && !recording;
  $("reviewAudioBox").hidden = !available;
  const audio = $("reviewPlayer");
  audio.pause();
  if (available) {if(window.LectureMobile){const sid=current;window.LectureMobile.fileURL(sid).then(url=>{if(current===sid)audio.src=url;}).catch(e=>tell(e.message,true));}else audio.src = `/api/sessions/${current}/audio`;}
  else audio.removeAttribute("src");
}
async function reviewAudio() {
  reviewSession = current;
  prepareGateAudio();
  gate = null;
  $("costEstimate").textContent =
    "正在本机计算本次录音的识别费用，尚未发送模型…";
  $("curveCaption").textContent = "正在本机扫描这次录音，尚未向模型发送…";
  $("continueTranscribe").hidden = false;
  $("continueTranscribe").disabled = true;
  $("silenceDialog").showModal();
  drawCurve();
  try {
    await previewGate();
  } catch (e) {
    reviewSession = null;
    throw e;
  } finally {
    $("continueTranscribe").disabled = !gate;
  }
}
async function executeTranscribe() {
  if (
    !reviewSession ||
    reviewSession !== current ||
    !gate ||
    recording ||
    finishing ||
    busy
  )
    throw Error("请先完成当前录音的本机曲线分析");
  const sid = current;
  if (
    !confirmCall(
      `按本次选择转录：${options.silence.enabled ? options.silence.thresholdDb + " dBFS" : "保留全部音频"}。时间戳仍对应原音。`,
    )
  )
    return;
  const config = cfg();
  // Freeze the explicitly reviewed threshold; do not silently recalibrate after selection.
  config.silence.thresholdMode = "manual";
  $("silenceDialog").close();
  await jobs(`/api/sessions/${sid}/transcribe`, { config, consent: true });
  if (current !== sid) return;
  await load(sid);
  chooseTab("raw");
  tell("识别原稿已保存。可保守校订，或单独生成整理稿。");
}

let liveOrganization=null, organizingRecord=false;
function openPrompt(kind) {
  pendingKind = kind;
  $("promptTitle").textContent = {
    record: "整理这段对话",
    verbatim: "保守校订逐字稿",
    summary: "生成独立课堂笔记",
    chapters: "生成话题章节目录",
  }[kind];
  $("promptText").value = promptOverrides[kind] ?? boot.prompts[kind];
  const ss = sources();
  const liveSource=recording && kind==='record' && recordTranscriptRevision();
  $("promptSource").innerHTML =
    ss
      .map(
        (r) =>
          `<option value="${r.id}">${kinds[r.kind]} · ${dated(r.created)}</option>`,
      )
      .join("") || (liveSource ? '<option value="live">截至当前的校订稿</option>' : '<option value="">请先生成识别原稿</option>');
  const s = sourceRevision();
  if (s) $("promptSource").value = s.id;
  $("runPrompt").disabled = !ss.length && !liveSource;
  $("promptDialog").showModal();
}
async function organizeLiveRecord() {
  const run=liveOrganization;
  if(!run || !recording || finishing || current!==run.sid || organizingRecord)return;
  const text=recordTranscriptRevision()?.content.text||'';
  if(!text || text===run.text || Date.now()<run.nextAt)return;
  organizingRecord=true;
  const requestConfig=structuredClone(liveConfig||run.body.config||cfg());
  try {
    await api(`/api/sessions/${run.sid}/transcript-snapshot`,{});
    const sourceData=await api(`/api/sessions/${run.sid}`);
    const source=[...sourceData.revisions].reverse().find(r=>r.kind==='verbatim') || [...sourceData.revisions].reverse().find(r=>r.kind==='raw');
    if(!source)throw Error('等待第一段转录完成后再整理');
    const result=await jobs(`/api/sessions/${run.sid}/organize`,{...run.body,config:requestConfig,source:source.id});
    run.text=text;run.nextAt=Date.now()+30000;
    const saved=await api(`/api/sessions/${run.sid}`);
    if(current===run.sid){for(const r of saved.revisions)if(!detailData.revisions.some(x=>x.id===r.id))detailData.revisions.push(r);activeRevision=result.revision;tabKind='record';render();}
  } catch(e){if(liveOrganization===run)liveOrganization=null;throw Error('实时整理已暂停，可手动重试：'+e.message);}
  finally {organizingRecord=false;}
}
async function runPrompt() {
  if(recording && pendingKind==='record'){
    if(organizingRecord)throw Error('当前整理仍在进行，录音继续');
    if(!confirmCall('开启边录边整理：先整理当前校订稿，之后有新增文字时最多每 30 秒更新一次完整整理稿，会增加文本模型费用。原稿和旧版本保留。'))return;
    liveOrganization={sid:current,text:'',nextAt:0,body:{kind:'record',prompt:$('promptText').value,style:format,speakers,config:structuredClone(liveConfig||cfg()),consent:true}};
    $('promptDialog').close();await organizeLiveRecord();return;
  }
  if (recording || finishing || busy) throw Error("请先结束录音并等待任务完成");
  if (!$("promptSource").value) throw Error("请选择来源版本");
  if (!confirmCall("将选定版本和提示词发送给整理模型；会另存新版本。")) return;
  $("promptDialog").close();
  await jobs(`/api/sessions/${current}/organize`, {
    source: $("promptSource").value,
    kind: pendingKind,
    prompt: $("promptText").value,
    style: format,
    speakers,
    config: cfg(),
    consent: true,
  });
  await load(current);
  if (["summary", "chapters"].includes(pendingKind) && view === "transcript") {
    const ss = sources();
    activeRevision = ss[ss.length - 1]?.id || null;
    tabKind = ss[ss.length - 1]?.kind || "raw";
  } else {
    tabKind = pendingKind;
    activeRevision = [...detailData.revisions]
      .reverse()
      .find((r) => r.kind === pendingKind)?.id;
  }
  render();
  tell("新版本已保存。原稿、原音与旧版本均保留。");
}
async function saveEdit() {
  const r = revision();
  const b = { source: r.id };
  if (r.content.segments)
    b.segments = r.content.segments.map((s, i) => ({
      ...s,
      text: document.querySelector(`[data-segment="${i}"]`).value,
      speaker: document.querySelector(`[data-speaker="${i}"]`).value,
    }));
  else b.text = $("textEditor").value;
  await api(`/api/sessions/${current}/edit`, b);
  await load(current);
  tell("人工校订已另存新版本。");
}
async function sample() {
  if (recording || finishing || busy) throw Error("请先结束录音并等待当前任务");
  const d = await api("/api/sample", { mode: modeFor(view) });
  await load(d.id);
  tell("已载入人工示例，非真实识别结果；未调用任何付费 API。");
}
function downloadText(text, extension = "txt") {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = (detailData?.title || "记录") + "." + extension;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function addMark() {
  const sid=recording?recordingSessionId||current:current;
  if (!sid) throw Error("请先创建记录");
  const time = recording ? elapsed : player.currentTime || 0;
  const label = prompt("为这个时间点写一句备注", "重点");
  if (label === null) return;
  await api(`/api/sessions/${sid}/mark`, {
    seconds: time,
    label: label.slice(0, 150) || "重点",
  });
  if(current===sid)detailData = await api("/api/sessions/" + sid);
  if (!recording) render();
  tell(clock(time) + " 已打点：" + label);
}
async function openDoc(id, page = 1) {
  if (!id) {
    docData = null;
    render();
    return;
  }
  const sid = current;
  const loaded = await api("/api/documents/" + id + "/pages");
  if (current !== sid) return;
  docData = loaded;
  docPage = page;
  render();
}
function setPage(n) {
  if (!docData) return;
  docPage = Math.max(1, Math.min(docData.pages.length, n));
  if ($("readerContent")) $("readerContent").innerHTML = docMarkup();
  $("pageNumber").value = docPage;
}
function versionMeta(r) {
  return r
    ? `<details class="version-meta"><summary>本版本提示词与参数</summary><pre>${esc(r.content.note || "")}${r.content.prompt ? "\n" + esc(r.content.prompt) : ""}\n\n语音模型：${esc(r.config.asr?.model || "—")}\n分析模型：${esc(r.config.text?.model || "—")}\n${esc(JSON.stringify(r.config, null, 2))}</pre></details>`
    : "";
}
async function importDoc() {
  const f = $("docUpload").files[0];
  if (!f) return;
  const offset = +$("pageOffset").value;
  await ensure();
  tell("提取资料页码中…");
  const d = await api(`/api/sessions/${current}/document`, f, {
    "Content-Type": "application/octet-stream",
    "X-Filename": encodeURIComponent(f.name),
    "X-Page-Offset": String(offset),
  });
  detailData = await api("/api/sessions/" + current);
  await openDoc(d.id);
  tell("资料已导入 " + d.pages + " 页。扫描 PDF 暂需先 OCR。");
}
function displayCalibration(g) {
  if (!g) return;
  lastGateResult=g;
  const report = g.calibration;
  effectiveThreshold =
    options.silence.thresholdMode === "manual"
      ? options.silence.thresholdDb
      : g.settings.thresholdDb;
  if (
    options.silence.thresholdMode === "auto" &&
    g.settings.thresholdMode === "auto"
  ) {
    options.silence.thresholdDb = effectiveThreshold;
    $("silenceThreshold").value = effectiveThreshold;
    $("thresholdLabel").textContent = effectiveThreshold + " dBFS";
  }
  if (report) {
    gate = { ...report, duration: report.windowSeconds || report.duration };
    renderGate();
  }
  updateGateState();
}
function displayTranscript(r) {
  if (detailData.revisions.some(x => x.id === r.revision)) {
    if (r.correction) displayCorrection(r.correction);
    return;
  }
  displayCalibration(r.silence);
  if (!detailData.revisions.some((x) => x.id === r.revision))
    detailData.revisions.push({
      id: r.revision,
      kind: "transcript-chunk",
      content: r,
    });
  if (view === "transcript") refreshTranscriptParagraphs();
  else if(view==='record')refreshRecordTranscript();
  if (r.correction) displayCorrection(r.correction);
}
function questionKey(r) {
  return String(r.questionId ?? r.seq ?? `sample-${questionOrder.length}`);
}
function normalizedQuestion(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_+\-*/=<>≤≥]/gu, "");
}
function similarQuestion(a, b) {
  if (Math.min(a.length, b.length) < 10) return false;
  const signature = (s) =>
    JSON.stringify(
      s.match(
        /\d+(?:\.\d+)?|第[一二三四五六七八九十百]+[题问]|[a-zα-ω_]+|[+\-*/=<>≤≥]/g,
      ) || [],
    );
  if (signature(a) !== signature(b)) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  const grams = (s) =>
    new Set([...s].slice(1).map((_, i) => s.slice(i, i + 2)));
  const x = grams(a),
    y = grams(b),
    same = [...x].filter((g) => y.has(g)).length;
  return same / Math.max(x.size, y.size) >= 0.92;
}
function rememberQuestion(r) {
  const alias = questionKey(r),
    normal = normalizedQuestion(r.analysis?.question);
  let key = questionAliases.get(alias) || alias;
  let rec = questionRecords.get(key);
  if (!rec) {
    rec = questionOrder
      .slice(-30)
      .map((k) => questionRecords.get(k))
      .find(
        (x) =>
          Math.abs((x.r.start || 0) - (r.start || 0)) <= 45 &&
          similarQuestion(x.normal, normal),
      );
    if (rec) key = rec.key;
  }
  const fresh = !rec;
  if (!rec) {
    rec = {
      key,
      r: { ...r, analysis: { ...r.analysis } },
      normal,
      number: questionOrder.length,
    };
    questionRecords.set(key, rec);
    questionOrder.push(key);
  } else {
    const previous = rec.r.analysis,
      incoming = r.analysis || {};
    const analysis = { ...previous, ...incoming };
    if (
      previous.answer &&
      previous.answerPending === false &&
      incoming.answerPending === true &&
      !incoming.suppressedReason
    ) {
      for (const field of [
        "answer",
        "answerPending",
        "answerStreaming",
        "answerIncomplete",
        "answerRequest",
        "sources",
        "searchStatus",
        "searchError",
      ])
        if (field in previous) analysis[field] = previous[field];
    }
    rec.r = {
      ...rec.r,
      ...r,
      analysis,
      timings: { ...rec.r.timings, ...r.timings },
      start: Math.min(rec.r.start ?? r.start ?? 0, r.start ?? rec.r.start ?? 0),
    };
    if (normal.length >= rec.normal.length) rec.normal = normal;
  }
  questionAliases.set(alias, key);
  questionOrder.sort(
    (a, b) =>
      (questionRecords.get(a).r.start || 0) -
        (questionRecords.get(b).r.start || 0) ||
      questionRecords.get(a).number - questionRecords.get(b).number,
  );
  return { rec, fresh };
}
function questionStatus(r) {
  if (
    r.analysis.suppressedReason ||
    (r.analysis.keywordTentative && r.analysis.isQuestion === false)
  )
    return "已撤回";
  if (r.analysis.answerPending)
    return r.analysis.waitingForSentence || r.deferred
      ? "等待完整题目"
      : "正在答题";
  if (r.analysis.answerError) return "答题失败";
  return r.analysis.answer ? "已回答" : "待回答";
}
function questionActivity() {
  if (questionAttentionLocked) return;
  questionAttentionLocked = true;
  renderQuestionChrome();
}
function setQuestionText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}
function renderQuestionHistory() {
  const list = $("questionHistory");
  const existing = new Map(
    [...list.querySelectorAll("[data-question-key]")].map((el) => [
      el.dataset.questionKey,
      el,
    ]),
  );
  for (const [key, button] of existing) if (!questionRecords.has(key)) button.remove();
  questionOrder.forEach((key, i) => {
    const rec = questionRecords.get(key);
    let button = existing.get(key);
    if (!button) {
      button = document.createElement("button");
      button.dataset.questionKey = key;
      button.type = "button";
    }
    const value = `${i + 1}. ${rec.r.analysis.question || "待补充题目"}\n${questionStatus(rec.r)} · ${clock(rec.r.start)}${questionUnread.has(key) ? " · 新题" : ""}`;
    if (button.textContent !== value) button.textContent = value;
    button.setAttribute("aria-pressed", String(key === currentQuestionKey));
    if (list.children[i] !== button)
      list.insertBefore(button, list.children[i] || null);
  });
}
function renderQuestionChrome() {
  const index = questionOrder.indexOf(currentQuestionKey),
    count = questionOrder.length,
    unread = questionUnread.size;
  setQuestionText(
    "questionPosition",
    count ? `第 ${Math.max(0, index) + 1} / ${count} 题` : "暂无题目",
  );
  $("previousQuestion").disabled = index <= 0;
  $("nextQuestion").disabled = index < 0 || index >= count - 1;
  $("questionNewNotice").hidden = !unread;
  setQuestionText(
    "questionNewCount",
    `${unread} 道新题已排队，当前题目保持不变`,
  );
  $("questionInboxLauncher").hidden = !unread;
  setQuestionText(
    "questionInboxCount",
    unread
      ? `${unread} 道新题待查看 · 共 ${count} 题`
      : `题目历史 · 共 ${count} 题`,
  );
  setQuestionText(
    "questionAutoToggle",
    "收起题目，继续听课",
  );
  setQuestionText(
    "questionAttentionStatus",
    questionAttentionLocked
      ? "阅读位置已保留；新提问仍会全屏提醒，关闭提醒后回到本题。"
      : "新提问全屏提醒；答案和历史题目不会被覆盖。",
  );
  renderQuestionHistory();
}
function renderCurrentQuestion() {
  const rec = questionRecords.get(currentQuestionKey);
  if (!rec) return;
  const r = rec.r,
    a = r.analysis;
  setQuestionText(
    "questionBadge",
    r.sample
      ? "人工示例 · 题目工作台"
      : a.keywordTentative
        ? "直接邀答提示 · 等待确认"
        : "课堂提问",
  );
  setQuestionText("questionText", a.question || "老师提出了一个问题");
  setQuestionText(
    "answerText",
    a.answerStreaming && a.answer
      ? a.answer
      : a.answerPending
      ? a.waitingForSentence || r.deferred
        ? "已识别到邀答，继续收齐题目…"
        : "题目已确认，正在生成参考回答…"
      : a.answer || "尚无参考回答",
  );
  let evidence = String(a.evidence || "AI 参考回答，需核对。")
    .replace(/previousContext/g,"此前课堂原话").replace(/classroomContext/g,"当前句段").replace(/classroomTimeline/g,"课堂时间线");
  if (a.answerPending)
    evidence = a.answerStreaming ? "回答正在生成，已收到的正文实时显示；其他题目继续在后台处理。" : "提醒已发出，正在准备本题回答。";
  if (a.answerIncomplete) evidence = "连接中断或输出达到上限；下面是未完成的回答，不能当作完整结论。";
  if (a.searchStatus === "done")
    evidence = "已联网检索；来源见下方，仍需核对。";
  if (a.searchStatus === "error")
    evidence = a.searchError || "联网搜索失败，保留资料参考回答。";
  setQuestionText("evidenceText", evidence);
  const sources = (a.sources || [])
    .filter((s) => /^https?:\/\//.test(s.url || ""))
    .map(
      (s, i) =>
        `<p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">[${i + 1}] ${esc(s.title)}</a></p>`,
    )
    .join("");
  if ($("questionSources").innerHTML !== sources)
    $("questionSources").innerHTML = sources;
  setQuestionText("questionContextText", r.context || r.text || "此历史题目未保存上下文。");
  const policy = a.answerRequest;
  const timing = r.timings || {};
  setQuestionText(
    "answerRequestInfo",
    r.sample
      ? "人工演示，未调用模型"
      : [
          policy
            ? policy.thinking === "off"
              ? "答题 Thinking：已关闭"
              : "答题 Thinking：沿用模型设置"
            : "",
          timing.transcriptionSeconds != null
            ? `转录处理 ${timing.transcriptionSeconds.toFixed(1)}s`
            : "",
          timing.analysisMode === "fused"
            ? `校订与判题合并 ${Number(timing.correctionSeconds || 0).toFixed(1)}s`
            : timing.detectionSeconds != null
            ? `检测 ${timing.detectionSeconds.toFixed(1)}s`
            : "",
          policy?.stream ? "答案流式显示" : "",
          timing.firstAnswerSeconds != null ? `首字 ${timing.firstAnswerSeconds.toFixed(1)}s` : "",
          timing.answerSeconds != null
            ? `答题 ${timing.answerSeconds.toFixed(1)}s`
            : "",
        ]
          .filter(Boolean)
          .join(" · "),
  );
  renderFollowups();
  renderQuestionChrome();
}
function selectQuestion(key, { automatic = false } = {}) {
  saveFollowupDraft();
  if (!questionRecords.has(key)) return;
  if (!automatic) questionAttentionLocked = true;
  currentQuestionKey = key;
  questionUnread.delete(key);
  renderCurrentQuestion();
  if (!$("questionDialog").open) $("questionDialog").showModal();
  guard(loadFollowupModes);
}
function notifyQuestion(r, { silent = false } = {}) {
  const { rec, fresh } = rememberQuestion(r);
  if (fresh && !silent) questionUnread.add(rec.key);
  if (rec.r.analysis.suppressedReason) questionUnread.delete(rec.key);
  if (fresh && !silent && rec.r.analysis.isQuestion === true) {
    if (!currentQuestionKey) {
      currentQuestionKey = rec.key;
      renderCurrentQuestion();
    }
    if (!questionAlertQueue.includes(rec.key)) questionAlertQueue.push(rec.key);
    showNextQuestionAlert();
  }
  if (questionAlertKey === rec.key) renderQuestionAlert();
  if ($("questionDialog").open && currentQuestionKey === rec.key) renderCurrentQuestion();
  renderQuestionChrome();
}
function renderQuestionAlert() {
  const rec = questionRecords.get(questionAlertKey);
  if (!rec) return;
  setQuestionText("questionAlertText",rec.r.analysis.question || "老师提出了一个问题");
  setQuestionText("questionAlertBadge",rec.r.sample ? "人工示例 · 新提问" : rec.r.analysis.keywordTentative ? "老师正在邀答 · 待确认" : "老师提问了");
  setQuestionText("questionAlertState",questionStatus(rec.r) === "已撤回" ? "本次提示未被后续语义分析确认为提问" : rec.r.analysis.answerPending ? "参考回答正在生成，提醒不等待答案。" : rec.r.analysis.answerError ? "参考回答生成失败；题目已保留。" : rec.r.analysis.answer ? "参考回答已更新，可进入本题查看。" : "提问已记录，暂无参考回答。");
  setQuestionText("questionAlertQueued",questionAlertQueue.length > 1 ? `另有 ${questionAlertQueue.length-1} 道新提问` : "新题和回答都保留在历史中 · ← ↑ 上一题 / → ↓ 下一题");
  setQuestionText("dismissQuestionAlert",$("questionDialog").open ? "返回正在阅读的题目" : "继续听课");
}
function showNextQuestionAlert() {
  if (!questionAlertKey) questionAlertKey = questionAlertQueue[0] || null;
  if (!questionAlertKey) return;
  renderQuestionAlert();
  if (!$("questionAlertDialog").open) $("questionAlertDialog").showModal();
}
function dismissQuestionAlert({viewAnswer=false}={}) {
  const key = questionAlertKey;
  questionAlertQueue = [];
  questionAlertKey = null;
  $("questionAlertDialog").close();
  if (viewAnswer && key) selectQuestion(key);
  // Other questions stay unread in history; closing a reminder really returns to reading.
}
function saveFollowupDraft() {
  const rec = questionRecords.get(followupEditorKey);
  if (rec) {
    rec.draft = $("questionFollowupText").value;
    rec.thinking = $("questionFollowupThinking").value;
  }
}
function renderFollowups() {
  const rec = questionRecords.get(currentQuestionKey);
  if (!rec) return;
  if (followupEditorKey !== rec.key) {
    followupEditorKey = rec.key;
    $("questionFollowupText").value = rec.draft || "";
  }
  const modes = rec.modes || [{id:'off',label:'关闭 Thinking',params:{enable_thinking:false}}];
  const markup = modes.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join("");
  const select = $("questionFollowupThinking");
  if (select.innerHTML !== markup) select.innerHTML = markup;
  select.value = rec.thinking || 'off';
  select.disabled = !!rec.followupPending || !!rec.r.sample;
  $("sendQuestionFollowup").disabled = !!rec.followupPending || !!rec.r.sample;
  $("sendQuestionFollowup").textContent = rec.followupPending ? "本题回答中…" : "发送追问";
  const params = modes.find(m => m.id === select.value)?.params || {enable_thinking:false};
  setQuestionText('followupParameters', `本次参数：${JSON.stringify(params)} · 带上本题原文、课堂上下文与本题追问记录`);
  const historyMarkup = (rec.followups || []).map(turn => `<article class="followup-turn"><h4>${esc(turn.question)}</h4><p>${esc(turn.answer)}</p><small>Thinking：${esc(turn.thinking)} · ${Number(turn.seconds || 0).toFixed(1)}s</small></article>`).join('');
  if ($('questionFollowupHistory').innerHTML !== historyMarkup) $('questionFollowupHistory').innerHTML = historyMarkup;
  setQuestionText('followupStatus', rec.followupError || (rec.r.sample ? '人工示例不发送模型。真实题目可独立追问。' : rec.followupPending ? '本题追问处理中；其他题目仍会并发答题。' : '追问单独计费；发送前确认。本题记录与其他题目分开。'));
}
async function loadFollowupModes() {
  const rec = questionRecords.get(currentQuestionKey);
  if (!rec || rec.r.sample) return;
  const snapshot = cfg();
  const modelKey = JSON.stringify(snapshot.text);
  if (rec.modesKey === modelKey) return;
  rec.modesKey = modelKey;
  try {
    const result = await api(`/api/sessions/${current}/followup-modes`,{config:snapshot});
    rec.modes = result.modes;
    if (!rec.modes?.some(m => m.id === rec.thinking)) rec.thinking = 'off';
    if (currentQuestionKey === rec.key) renderFollowups();
  } catch (error) { rec.modesKey = null; throw error; }
}
async function sendQuestionFollowup() {
  saveFollowupDraft();
  const rec = questionRecords.get(currentQuestionKey), sid = current;
  if (!rec || rec.followupPending || rec.r.sample) return;
  const text = (rec.draft || '').trim();
  if (!text) throw Error('请先输入这道题的追问');
  const mode = rec.thinking || 'off';
  if (!confirmCall(`仅发送这道题的课堂上下文、题目、原回答、本题追问记录和本次追问。Thinking：${mode}，会产生新的模型费用。`)) return;
  const requestId = crypto.randomUUID();
  rec.followupPending = true;
  rec.followupError = '';
  rec.draft = '';
  $('questionFollowupText').value = '';
  renderFollowups();
  try {
    const result = await jobs(`/api/sessions/${sid}/question-followup`,{questionId:rec.r.questionId,requestId,text,thinking:mode,config:cfg(),consent:true});
    rec.followups ||= [];
    rec.followups.push(result);
    if (current === sid && detailData) detailData.revisions.push({id:result.revision,kind:'question-followup',content:result});
  } catch (error) { rec.followupError = error.message; rec.draft = text; if (currentQuestionKey === rec.key) $('questionFollowupText').value = text; }
  finally {
    rec.followupPending = false;
    if (current === sid && currentQuestionKey === rec.key) renderFollowups();
    if (current === sid) guard(refreshUsage);
  }
}
function handleQuestionNavigation(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) return;
  const target = event.target;
  if (target?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"],audio,video')) return;
  if (typeof window.getSelection === 'function' && String(window.getSelection())) return;
  const isAlert = $('questionAlertDialog').open;
  if (!isAlert && !$('questionDialog').open) return;
  const key = isAlert ? questionAlertKey : currentQuestionKey;
  const i = questionOrder.indexOf(key);
  const next = i + (['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 1);
  if (next < 0 || next >= questionOrder.length) return;
  event.preventDefault();
  if (isAlert) {
    questionAlertKey = questionOrder[next];
    renderQuestionAlert();
  } else selectQuestion(questionOrder[next]);
}
function showQuestion(r) {
  const { rec } = rememberQuestion(r);
  selectQuestion(rec.key);
}
function resetQuestionInbox(sid) {
  if (questionSession === sid) return;
  questionSession = sid;
  questionRecords = new Map();
  questionAliases = new Map();
  questionOrder = [];
  questionUnread = new Set();
  currentQuestionKey = null;
  questionAttentionLocked = false;
  lastAutoQuestionAt = -Infinity;
  questionPointer = null;
  questionAlertKey = null;
  questionAlertQueue = [];
  followupEditorKey = null;
  if ($("questionAlertDialog").open) $("questionAlertDialog").close();
  for (const timer of questionDemoTimers) clearTimeout(timer);
  questionDemoTimers = [];
  if ($("questionDialog").open) $("questionDialog").close();
  renderQuestionChrome();
}
function restoreQuestionInbox() {
  if (!detailData) return;
  resetQuestionInbox(current);
  for (const rev of detailData.revisions)
    if (rev.kind === "live" && rev.content.analysis?.isQuestion === true)
      notifyQuestion(rev.content, { silent: true });
  for (const rev of detailData.revisions) if (rev.kind === 'question-followup') {
    const key = questionAliases.get(String(rev.content.questionId)) || String(rev.content.questionId);
    const rec = questionRecords.get(key);
    if (rec) {
      rec.followups ||= [];
      if (!rec.followups.some(x => x.requestId === rev.content.requestId)) rec.followups.push(rev.content);
    }
  }
}
function questionDemo() {
  const prefix = `demo-${Date.now()}`;
  const make = (i, pending) => ({
    sample: true,
    questionId: prefix + "-" + i,
    seq: i,
    start: i * 45,
    analysis: {
      isQuestion: true,
      question: [
        "为什么基圆内没有渐开线？",
        "机构自由度与原动件数量有什么关系？",
        "怎样判断齿轮能够连续传动？",
      ][i],
      answerPending: pending,
      answer: pending
        ? ""
        : `第 ${i + 1} 题演示参考：请结合本题教材中的定义、形成过程与适用条件回答。`,
      evidence: "人工制作的界面示例，未调用模型或联网搜索。",
    },
  });
  showQuestion(make(0, true));
  questionDemoTimers.push(setTimeout(() => notifyQuestion(make(1, true)), 600));
  questionDemoTimers.push(
    setTimeout(() => notifyQuestion(make(2, false)), 1000),
  );
  questionDemoTimers.push(
    setTimeout(() => notifyQuestion(make(0, false)), 1400),
  );
  questionDemoTimers.push(
    setTimeout(() => notifyQuestion(make(1, false)), 2200),
  );
}

function displayLive(r) {
  displayCalibration(r.silence);
  const index = liveEvents.findIndex((x) => x.seq === r.seq);
  if (index < 0) liveEvents.push(r);
  else liveEvents[index] = r;
  if (view !== "assist") return;
  const a = r.analysis;
  setQuestionPipelineStatus(questionDetectionSummary(classroomEvents().at(-1)));
  updateTopicDisplay();
  if (validTopic(r)) lastTopicStart = Math.max(lastTopicStart,r.start);
  $("liveOutput").innerHTML = liveEvents
    .filter((e) => !e.deferred)
    .slice()
    .reverse()
    .slice(0, 20)
    .map(eventMarkup)
    .join("");
  if (a.match && r.start >= lastTopicStart) {
    $("pageMatch").textContent =
      `${a.match.name} · 文件第 ${a.match.page} 页 / 印刷 P${a.match.printedPage} · ${a.evidence || "需核对"}`;
    if (!locked && Number(a.confidence) >= options.live.pageConfidence)
      guard(async () => {
        if (docData?.id !== a.match.document)
          docData = await api("/api/documents/" + a.match.document + "/pages");
        setPage(a.match.page);
      });
  }
  if (a.isQuestion === true) notifyQuestion(r);
}

function gateNumbers(sent, total) {
  const effective = options.silence.enabled ? sent : total;
  $("gateNumbers").innerHTML = [
    [clock(total), "原始录音"],
    [clock(effective), "预计送出"],
    [
      Math.round(((total - effective) / Math.max(0.001, total)) * 100) + "%",
      "跳过时长占比",
    ],
  ]
    .map(([v, n]) => `<div><strong>${v}</strong><small>${n}</small></div>`)
    .join("");
}
async function previewGate() {
  if (!current) throw Error("先录制至少 12 秒或导入音频");
  const sid = current;
  const result = await jobs(`/api/sessions/${sid}/silence-preview`, {
    config: cfg(),
    recent: recording && liveSession,
  });
  if (current !== sid) return;
  gate = result;
  if (options.silence.thresholdMode === "auto") {
    options.silence.thresholdDb = gate.recommendedDb ?? -80;
    $("silenceThreshold").value = options.silence.thresholdDb;
    $("thresholdLabel").textContent = options.silence.thresholdDb + " dBFS";
    effectiveThreshold = options.silence.thresholdDb;
    updateGateState();
  }
  renderGate();
  tell("本次曲线已由本机脚本重新计算，没有调用付费 API。");
}
function renderGate() {
  if (!gate) return;
  scheduleCost();
  drawCurve();
  const selected = gate.curve.find((p) => p.db === options.silence.thresholdDb);
  gateNumbers(selected?.sentSeconds ?? gate.sentSeconds, gate.duration);
  $("curveCaption").textContent =
    `基于${recording ? "最近的校准窗口" : "本次原音"} ${gate.duration.toFixed(1)} 秒；原录音与时间轴保持完整。`;
  const q = gate.quality;
  $("audioQuality").textContent = q
    ? `低音量 P10 ${q.floorDb} / 中位 ${q.medianDb} / 较响 P90 ${q.loudDb} dBFS · ${q.confidence === "speech-protected" ? "本地人声检测保护轻声" : q.confidence === "separated" ? "存在分离音量组（仅能量依据）" : "分界尚不确定，优先保留轻声"}`
    : "";
  if(q?.dominantBand)$("audioQuality").textContent+=` · 时长占比最高 ${q.dominantBand.fromDb}～${q.dominantBand.toDb} dBFS：${q.dominantBand.percent}%（不等于人声）`;
  $("recommendation").hidden = false;
  $("recommendation").textContent =
    (gate.cliff
      ? `最大下降点 ${gate.cliff.db} dBFS（提高 1 dB，少送出 ${gate.cliff.dropSeconds.toFixed(1)} 秒）。`
      : "") +
    gate.recommendationReason +
    (gate.recommendedDb !== null
      ? ` 本次建议 ${gate.recommendedDb} dBFS。`
      : "");
  $("applyRecommendation").hidden = gate.recommendedDb === null;
  $("curveTable").innerHTML = gate.curve
    .map(
      (p) =>
        `<div><span>${p.db} dBFS</span><span>${p.sentSeconds.toFixed(1)} 秒${p.speechRetained==null?"":` · 疑似人声 ${(p.speechRetained*100).toFixed(1)}%`}</span></div>`,
    )
    .join("");
}

function drawCurve() {
  const canvas = $("gateChart"),
    c = canvas.getContext("2d");
  const w = canvas.width,
    h = canvas.height;
  c.clearRect(0, 0, w, h);
  const color = getComputedStyle(document.documentElement),
    ink = color.getPropertyValue("--muted"),
    line = color.getPropertyValue("--line"),
    accent = color.getPropertyValue("--accent");
  const x = (d) => 54 + ((d + 80) / 60) * (w - 84),
    y = (s) => h - 36 - (s / Math.max(1, gate?.duration || 60)) * (h - 62);
  c.font = "13px -apple-system";
  c.strokeStyle = line;
  c.fillStyle = ink;
  c.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const val = ((gate?.duration || 60) * i) / 4;
    const yy = y(val);
    c.beginPath();
    c.moveTo(54, yy);
    c.lineTo(w - 30, yy);
    c.stroke();
    c.fillText(Math.round(val) + "s", 6, yy + 4);
  }
  for (let db = -80; db <= -20; db += 10)
    c.fillText(db + " dB", x(db) - 17, h - 10);
  if (!gate) {
    c.fillText("先录音，再免费分析阈值曲线", w / 2 - 110, h / 2);
    return;
  }
  c.strokeStyle = accent;
  c.lineWidth = 3;
  c.beginPath();
  gate.curve.forEach((p, i) => {
    i
      ? c.lineTo(x(p.db), y(p.sentSeconds))
      : c.moveTo(x(p.db), y(p.sentSeconds));
  });
  c.stroke();
  const marker = (db, col, label, row) => {
    c.strokeStyle = col;
    c.lineWidth = 1.5;
    c.setLineDash([5, 4]);
    c.beginPath();
    c.moveTo(x(db), 15);
    c.lineTo(x(db), h - 36);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = col;
    const labelX = Math.min(w - 140, Math.max(55, x(db) + 5));
    c.fillStyle = color.getPropertyValue("--panel");
    c.fillRect(labelX - 3, 3 + row * 18, c.measureText(label).width + 6, 17);
    c.fillStyle = col;
    c.fillText(label, labelX, 16 + row * 18);
  };
  if (gate.cliff)
    marker(gate.cliff.db, "#c66a4c", "最大下降（非建议） " + gate.cliff.db, 0);
  if (gate.recommendedDb !== null)
    marker(gate.recommendedDb, "#348977", "保守建议 " + gate.recommendedDb, 1);
  marker(
    options.silence.thresholdDb,
    accent,
    "当前 " + options.silence.thresholdDb,
    2,
  );
}
function drawWave() {
  const c = $("waveform").getContext("2d");
  c.clearRect(0, 0, 200, 38);
  const values = meterHistory.slice(-65);
  c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue(
    "--accent",
  );
  c.lineWidth = 2;
  for (let i = 0; i < 65; i++) {
    const amplitude = values[i] || 0;
    c.beginPath();
    c.moveTo(i * 3 + 2, 19 - amplitude * 16);
    c.lineTo(i * 3 + 2, 19 + amplitude * 16);
    c.stroke();
  }
}
function pcm16(samples, rate) {
  const n = Math.floor((samples.length * 16000) / rate),
    pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * rate) / 16000),
      hi = Math.min(samples.length, Math.floor(((i + 1) * rate) / 16000));
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += samples[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, hi - lo)));
    pcm[i] = v < 0 ? v * 32768 : v * 32767;
  }
  return pcm;
}
function wav(pcm) {
  const b = new ArrayBuffer(44 + pcm.length * 2),
    v = new DataView(b);
  const text = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, b.byteLength - 8, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([b], { type: "audio/wav" });
}
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const t = db.transaction("outbox", mode);
    fn(t.objectStore("outbox"));
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || Error("浏览器缓存中断"));
  });
}
function pending() {
  if (!db) return Promise.resolve([]);
  return new Promise((res, rej) => {
    const r = db.transaction("outbox").objectStore("outbox").getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function countPending() {
  const items = await pending();
  if ($("outbox"))
    $("outbox").textContent = items.length
      ? `${items.length} 段待保存（已缓存在此浏览器）`
      : "已生成的音频片段均已保存";
}
async function uploadChunk(item) {
  await api(`/api/sessions/${item.sid}/chunk`, item.blob, {
    "Content-Type": "audio/wav",
    "X-Sequence": String(item.seq),
    "X-Start": String(item.start),
    "X-Analyze":item.analyze===false?'0':'1',
  });
  if(window.LectureMobile)await window.LectureMobile.journal().commit(item.sid,item.start+item.duration);
  await idb("readwrite", (s) => s.delete(item.key));
  await countPending();
}
function flush(reason = "manual", cutFrames = frames) {
  if (!frames) return;
  cutFrames=Math.min(frames,Math.max(0,Math.round(cutFrames)));
  if(!cutFrames)return;
  const all = new Float32Array(cutFrames),remaining=[];
  let offset = 0;
  for (const b of blocks) {
    const n=Math.min(b.length,cutFrames-offset);
    if(n>0){all.set(b.subarray(0,n),offset);offset+=n;}
    if(n<b.length)remaining.push(b.slice(Math.max(0,n)));
  }
  blocks = remaining;
  frames -= cutFrames;
  const acoustic={pauseSeconds:quietSeconds,endedByPause:reason==="sentence"};
  quietSeconds = 0;
  endpointVoicedSeconds=0;
  const pcm = pcm16(all, ctx.sampleRate),
    item = {
      sid: recordingSessionId||current,
      reason,
      acoustic,
      seq: seq++,
      start: samplesSent / 16000,
      blob: wav(pcm),
      duration: pcm.length / 16000,
    };
  samplesSent += pcm.length;
  item.key = item.sid + ":" + item.seq;
  const shouldAnalyze = liveSession && !modelPaused,
    liveCfg = liveConfig ? structuredClone(liveConfig) : null;
  item.analyze=shouldAnalyze;
  if (liveCfg&&(!recordingSessionId||current===recordingSessionId)) liveCfg.silence = silenceConfig();
  pipelineStage(item.seq,"uploading");
  queue = queue
    .then(async () => {
      await idb("readwrite", (s) => s.put(item));
      try {
        await uploadChunk(item);
        savedAudioEnd=Math.max(savedAudioEnd,item.start+item.duration);
        pipelineStage(item.seq,shouldAnalyze?"asr-queued":"done");
        if (shouldAnalyze) {
          scheduledCaptureParts.add(item.seq);
          liveBacklog++;
          liveQueue = liveQueue.then(() => dispatchLive(item, liveCfg));
        }
        if (
          ($("silenceDialog").open ||
            (shouldAnalyze === false && liveSession)) &&
          Date.now() - curveTimer > 12000
        ) {
          curveTimer = Date.now();
          guard(previewGate);
        }
      } catch (e) {
        pipelineStage(item.seq,"error",{error:"上传失败，音频仍在待重传列表："+e.message});
        tell("音频仍在浏览器待重传：" + e.message, true);
        await countPending();
      }
    })
    .catch((e) => {
      pipelineStage(item.seq,"error",{error:"浏览器缓存失败："+e.message});
      tell("浏览器缓存失败，请结束录音以免继续丢失：" + e.message, true);
      guard(stop);
    });
}
function withQuestionPolicy(config) {
  const live = { ...config.live };
  for (const key of [
    "questionSensitivity",
    "answerThinking",
    "fastDetection",
    "keywords",
  ])
    if (options.live[key] !== undefined)
      live[key] = structuredClone(options.live[key]);
  return { ...config, live };
}
async function enqueueRecoveredCapture(sid,config){
  if(!window.LectureMobile)return;
  const rows=await window.LectureMobile.rows('chunks',sid),revisions=await window.LectureMobile.rows('revisions',sid),transcript=config.realtimeKind==='transcript';
  for(const row of rows){
    if(row.analyze!==true||scheduledCaptureParts.has(row.seq))continue;
    const complete=transcript?revisions.some(r=>r.kind==='corrected-transcript'&&r.content.sequences?.includes(row.seq)&&r.content.correctionState==='corrected')||config.live.correctTranscript===false&&revisions.some(r=>r.kind==='transcript-chunk'&&r.content.seq===row.seq):revisions.some(r=>r.kind==='live'&&r.content.seq===row.seq&&!r.content.analysisError&&!r.content.analysis?.answerError);
    if(complete)continue;scheduledCaptureParts.add(row.seq);liveBacklog++;
    const item={sid,seq:row.seq,start:row.start,duration:row.duration,reason:'resume'};
    liveQueue=liveQueue.then(()=>dispatchLive(item,structuredClone(config)));
  }
}
async function dispatchLive(item, config) {
  config = withQuestionPolicy(config);
  if (modelPaused) {
    pipelineStage(item.seq,"done",{note:"模型暂停，原音保留"});
    liveBacklog--;
    return;
  }
  if(!recordingSessionId||current===recordingSessionId)config.silence = silenceConfig();
  const transcript = config.realtimeKind === "transcript";
  let release;
  const ready = new Promise((resolve) => (release = resolve));
  const task = jobs(
    `/api/sessions/${item.sid}/${transcript ? "realtime-transcribe" : "live"}`,
    { seq: item.seq, reason: item.reason, acoustic:item.acoustic, config, consent: true },
    (j) => {
      if(j.retryAttempt)release();
      if (j.stage) pipelineStage(item.seq,j.stage);
      if (j.transcript) {
        captureView(item.sid).transcripts.set(j.transcript.seq,j.transcript);
        returnedAudioEnd=Math.max(returnedAudioEnd,...(j.transcript.segments||[]).map(s=>s.end||0));
        pipelineStage(item.seq,j.stage||"correction",{rawReady:true});
        if (current === item.sid) {
          transcript ? displayTranscript(j.transcript) : displayAssistTranscript(j.transcript);
          if (!transcript) setQuestionPipelineStatus("原文已返回，正在判定课堂提问…");
        }
        release();
      }
      if(j.transcriptCorrection)captureView(item.sid).corrections.set(j.transcriptCorrection.sequences.join(','),j.transcriptCorrection);
      if (j.transcriptCorrection && current === item.sid) displayCorrection(j.transcriptCorrection);
      if (j.question && current === item.sid) {
        notifyQuestion(j.question);
        setQuestionPipelineStatus(j.question.analysis?.isQuestion === true ? "已识别到提问，提醒不等待答案" : questionDetectionSummary(j.question));
      }
      guard(refreshUsage);
    },
  )
    .then((r) => {
      if (current === item.sid) {
        transcript ? displayTranscript(r) : displayLive(r);
        if (r.correction) displayCorrection(r.correction);
      }
      const error=r.analysisError || (r.correction?.correctionState==="failed" ? r.correction.correctionError : "");
      pipelineStage(item.seq,error?"error":"done",{error});
    })
    .catch((e) => {pipelineStage(item.seq,"error",{error:e.message});tell("实时处理失败，已保存原音：" + e.message, true);})
    .finally(() => {
      release();
      liveBacklog--;
      analysisTasks.delete(task);
      guard(refreshUsage);
    });
  analysisTasks.add(task);
  await ready;
}

function updateControls() {
  if($('retryAnalysis'))$('retryAnalysis').hidden=!current;
  if($('resumeRecording'))$('resumeRecording').hidden=recording||starting||finishing||!window.LectureMobile||!(interruptedRecordingId||detailData?.hasAudio&&['recording','interrupted'].includes(detailData.status));
  if($('resumeRecording'))$('resumeRecording').textContent=detailData?.hasAudio&&['recording','interrupted'].includes(detailData.status)?'继续此录音':'恢复上次录音';
  if($('returnRecording'))$('returnRecording').hidden=!(recording||finishing)||!recordingSessionId||current===recordingSessionId&&view===recordingPage;
  if($('returnRecording'))$('returnRecording').textContent=recording?'录音中 · 返回当前录音':'处理中 · 返回当前记录';
  if($('retranscribeAudio')){
    $('retranscribeAudio').hidden=!current||recording;
    $('retranscribeAudio').disabled=finishing||busy>0||!detailData?.hasAudio;
    $('retranscribeAudio').title=detailData?.hasAudio?'从完整原音重新识别，先预览阈值与费用，确认后才调用模型':'原音不在此设备，请回到录音时的浏览器或导入录音';
  }
  if($('sendCurrent'))$('sendCurrent').hidden=!recording;
  document.documentElement.dataset.recording = String(recording);
  const needsNew =
    current &&
    (detailData?.hasAudio ||
      detailData?.chunks.length ||
      detailData?.status === "sample");
  $("start").textContent = starting
    ? "准备麦克风…"
    : needsNew
      ? "开始新录音"
      : "开始录音";
  $("start").disabled = starting || finishing;
  if ($("realtimeEnabled"))
    $("realtimeEnabled").disabled = starting || recording || finishing;
  if (!recording && !starting) {
    $("clock").textContent =
      detailData?.hasAudio && Number.isFinite(player.duration)
        ? clock(player.duration)
        : "00:00";
    $("micStatus").textContent = detailData?.hasAudio
      ? "原录音已保存"
      : "等待开始录音";
  }

  $("start").hidden = recording;
  $("pause").hidden = !recording;
  $("stop").hidden = !recording;
  $("mark").hidden = !recording;
  $("audioUpload").disabled = recording;
  $("audioUpload").parentElement.hidden = recording;
  $("pause").textContent = liveSession
    ? modelPaused
      ? "继续模型"
      : "暂停模型"
    : paused
      ? "继续录音"
      : "暂停录音";
  $("lamp").classList.toggle("active", recording && !paused);
  updatePipelineStatus();
  updateCaptureStatus();
}
async function start(resume=false) {
  if (recording || starting || finishing) return;
  starting = true;
  liveOrganization=null;
  updateControls();
  try {
    preparedAudioContext ||= new AudioContext();
    preparedAudioContext.resume().catch(()=>{});
    await beginRecording(resume);
  } finally {
    if(!recording && preparedAudioContext) await preparedAudioContext.close().catch(()=>{});
    preparedAudioContext=null;
    starting = false;
    if (!recording && !finishing){recordingPage = null;recordingSessionId=null;stream?.getTracks().forEach(t=>t.stop());if(window.LectureMobile)await window.LectureMobile.releaseCapture();}
    updateControls();
  }
}
async function beginRecording(resume=false) {
  if (recording) return;
  if (!["record", "transcript", "assist"].includes(view))
    throw Error("请先选择一种记录场景");
  if (!navigator.mediaDevices?.getUserMedia)
    throw Error("麦克风需要 HTTPS 或本机 localhost 环境");
  if (!resume&&current && (detailData.hasAudio || detailData.chunks.length))
    throw Error("当前已有录音，请先新建，避免覆盖原音");
  const originView = view;
  recordingPage = originView;
  const live =
    originView === "assist" || originView === "record" || (originView === "transcript" && options.realtimeTranscript);
  if (
    live &&
    !confirmCall(
      `开始本次${originView !== "assist" ? "实时逐字转录" : "实时听课分析"}。本机持续检测人声，确认讲话结束后发送整段，不按固定秒数截断。${options.live.correctTranscript !== false ? `句段自动调用 ${options.correction?.model || options.text.model} 校订（增加文本用量）。` : "自动校订已关闭。"}实时识别会携带此前连续原音上下文，成功请求音频量限制在已处理原音的 3 倍以内（额外重试另计）。低于收音阈值时不发送模型，原音与计时继续。${originView !== "assist" || options.live.retainTranscript ? "逐字稿会保存。" : "当前不保存逐字文本，只在本次显示；原音仍保留。"}${options.live.finalAudioReview!==false&&(originView!=='assist'||options.live.retainTranscript)?'结束后自动用连续完整原音再识别、校订一次，增加一遍 ASR 和校订费用；模型暂停的片段不会补发，原实时稿保留。':''}${originView === "assist" && options.live.webSearch ? "检测到提问后会将问题发送 Brave 并再次调用模型，可能增加费用。" : ""}`,
    )
  )
    return;
  liveConfig=cfg();
  if(originView==='record')liveConfig.live.retainTranscript=true;
  await ensure();
  recordingSessionId=current;
  if(window.LectureMobile)await window.LectureMobile.acquireCapture(recordingSessionId);
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  try {
    ctx = preparedAudioContext || new AudioContext();
    let resumeTimer;
    try {await Promise.race([ctx.resume(),new Promise((_,reject)=>{resumeTimer=setTimeout(()=>reject(Error("浏览器尚未启动收音，请再次点击开始录音")),5000)})]);}
    finally {clearTimeout(resumeTimer);}
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const restored=resume&&window.LectureMobile?await window.LectureMobile.resumeRecording(recordingSessionId):{nextSequence:0,seconds:0};
  seq = restored.nextSequence;
  samplesSent = Math.round(restored.seconds*16000);
  endpointBaseFrames=samplesSent;
  scheduledCaptureParts=new Set();
  if(window.LectureMobile)await window.LectureMobile.store.put('meta',{id:'active-recording',value:{sid:recordingSessionId,page:originView,modelPaused:!!restored.modelPaused}});
  frames = 0;
  blocks = [];
  elapsed = restored.seconds;
  meterHistory = [];
  queue = Promise.resolve();
  liveQueue = Promise.resolve();
  pipelineJobs=new Map();pipelineSession=recordingSessionId;lastAudioAt=0;recordingStartedAt=Date.now();savedAudioEnd=restored.seconds;returnedAudioEnd=0;
  analysisTasks = new Set();
  seenTranscripts = new Set();
  seenQuestions = new Set();
  liveTranscripts = captureView(recordingSessionId).transcripts;
  liveCorrections = captureView(recordingSessionId).corrections;
  assistOriginal = false;
  recordOriginal = false;
  if(live&&originView==='record')tabKind='raw';
  if (live && originView === "transcript" && options.live.correctTranscript !== false) tabKind = "verbatim";
  resetQuestionInbox(current);
  questionAttentionLocked = false;
  lastAutoQuestionAt = -Infinity;
  questionPointer = null;
  quietSeconds = 0;
  endpointVoicedSeconds=0;
  speechPeak = -96;
  lastTopicStart = -1;
  liveSession = live;
  liveConfig.realtimeKind = originView === "assist" ? "assist" : "transcript";
  if(originView==='record')liveConfig.live.pauseSeconds=Number(options.live.meetingPauseSeconds)||.6;
  modelPaused = !!restored.modelPaused;
  effectiveThreshold =
    options.silence.thresholdMode === "auto"
      ? -80
      : options.silence.thresholdDb;
  updateGateState();
  lastInputDb=-96;belowThresholdSeconds=0;lastGateResult=null;
  liveEvents = [];
  alertedSeq = null;
  recording = true;
  paused = false;
  endpointDetector?.close();endpointDetector=null;
  endpointSourceTail=new Float32Array();
  let divisor=ctx.sampleRate,other=16000;while(other){const rest=divisor%other;divisor=other;other=rest;}
  endpointSourceQuantum=ctx.sampleRate/divisor;
  if(typeof Worker==='function'){
    try{
      const {createSpeechEndpoint}=await import('./mobile-endpoint.mjs');
      endpointDetector=createSpeechEndpoint({pauseSeconds:liveConfig.live.pauseSeconds||3,onEnd:endFrame=>{
        if(!recording||paused)return;
        const cut=(endpointBaseFrames+endFrame-samplesSent)*ctx.sampleRate/16000;
        if(cut>0)flush('sentence',cut);
      },onUnavailable:()=>{endpointDetector=null;tell('人声分段暂不可用，改用保守停顿检测；仍在录音。');}});
    }catch{tell('人声分段暂不可用，改用保守停顿检测；仍在录音。');}
  }
  const source = ctx.createMediaStreamSource(stream);
  processor = ctx.createScriptProcessor(4096, 1, 1);
  muteGain = ctx.createGain();
  muteGain.gain.value = 0;
  source.connect(processor);
  processor.connect(muteGain);
  muteGain.connect(ctx.destination);
  processor.onaudioprocess = (e) => {
    if (!recording || paused) return;
    lastAudioAt=Date.now();
    const b = e.inputBuffer.getChannelData(0).slice();
    let frameEnergy = 0;
    for (const x of b) frameEnergy += x * x;
    const frameDb = Math.max(
      -96,
      20 * Math.log10(Math.max(1e-8, Math.sqrt(frameEnergy / b.length))),
    );
    lastInputDb=frameDb;
    belowThresholdSeconds=frameDb<effectiveThreshold ? belowThresholdSeconds+b.length/ctx.sampleRate : 0;
    speechPeak = Math.max(frameDb, speechPeak - b.length / ctx.sampleRate);
    const boundary = Math.max(effectiveThreshold, speechPeak - 18);
    if(frameDb>=boundary&&frameDb>-75)endpointVoicedSeconds+=b.length/ctx.sampleRate;
    quietSeconds =
      frameDb < boundary ? quietSeconds + b.length / ctx.sampleRate : 0;
    if (performance.now() - lastMeter > 100) {
      let energy = 0;
      for (const x of b) energy += x * x;
      const rms = Math.sqrt(energy / b.length),
        dbfs = Math.max(-96, 20 * Math.log10(Math.max(1e-8, rms)));
      $("inputDb").textContent = dbfs.toFixed(1) + " dBFS";
      $("inputMeter").value = dbfs;
      meterHistory.push(Math.max(0.035, Math.min(1, rms * 8)));
      if (meterHistory.length > 65) meterHistory.shift();
      drawWave();
      $("inputGate").textContent = !options.silence.enabled
        ? "静音跳过已关闭，音频全部参与识别"
        : dbfs < effectiveThreshold
          ? "低于阈值，持续足够久才跳过；原音与计时继续"
          : "高于阈值，保留此段声音";
      if (liveSession)
        $("micStatus").textContent = modelPaused
          ? "模型暂停 · 录音继续"
          : options.silence.enabled && dbfs < effectiveThreshold
            ? "低于阈值 · 模型待机，录音继续"
            : "收音中 · 等待本段实时处理";
      updateCaptureStatus();
      lastMeter = performance.now();
    }
    blocks.push(b);
    if(window.LectureMobile){
      const journal=window.LectureMobile.journal();
      journal.append(recordingSessionId,samplesSent/16000+frames/ctx.sampleRate,pcm16(b,ctx.sampleRate),liveSession&&!modelPaused);
      if(journal.error){tell('本地恢复缓存写入失败，请结束录音检查设备空间：'+journal.error.message,true);guard(stop);}
    }
    frames += b.length;
    elapsed = samplesSent / 16000 + frames / ctx.sampleRate;
    $("clock").textContent = clock(elapsed);
    if(endpointDetector)feedSpeechEndpoint(b);
    else if(endpointVoicedSeconds>=.2 && quietSeconds>=Math.max(.35,liveConfig.live.pauseSeconds||3))flush('sentence');
  };
  const track = stream.getAudioTracks()[0];
  track.onmute = () => {
    tell("麦克风被系统中断。可能正在通话或页面进入后台，请检查收音。", true);
    $("micStatus").textContent = "麦克风被系统中断";
  };
  track.onunmute = () => {
    if (recording) $("micStatus").textContent = "收音已恢复，请检查波形";
  };
  track.onended = () => guard(stop);
  ctx.onstatechange = () => {
    if (recording && ctx.state !== "running")
      tell("音频引擎已暂停。计时不能代表已收音，请回到页面恢复。", true);
  };
  updateControls();
  if(resume){restoreQuestionInbox();if(liveSession&&!modelPaused)await enqueueRecoveredCapture(recordingSessionId,liveConfig);}
  $("micStatus").textContent = live
    ? "正在收音"
    : "正在收音";
  tell(
    "正在录音。静音不会暂停录音或计时；保持页面前台，来电与锁屏可能中断收音。",
  );
}
async function stop() {
  if (!recording || finishing) return;
  finishing = true;
  try {
    await finishRecording();
  } finally {
    finishing = false;
    recordingPage = null;
    recordingSessionId=null;
    if(window.LectureMobile)await window.LectureMobile.releaseCapture();
    updateControls();
  }
}
async function finishRecording() {
  const sid = recordingSessionId||current;
  const wasLive = liveSession;
  let audioReviewNotice='';
  flush("final");
  endpointDetector?.close();endpointDetector=null;
  recording = false;
  paused = false;
  processor.disconnect();
  stream.getTracks().forEach((t) => {
    t.onended = null;
    t.stop();
  });
  await ctx.close();
  updateControls();
  $("micStatus").textContent = "收音结束 · 保存中";
  tell("保存最后的音频片段…");
  await queue;
  if(window.LectureMobile)await window.LectureMobile.journal().commit(sid,samplesSent/16000);
  const items = (await pending()).filter((x) => x.sid === sid);
  if (items.length)
    throw Error("还有片段待重传。点击重传后会自动合并完整录音。");
  const saved = await api(`/api/sessions/${sid}/finish`, {finalized:!wasLive});
  if(current===sid){detailData.hasAudio=true;delete player.dataset.sid;}
  if(window.LectureMobile)await window.LectureMobile.store.delete('meta','active-recording');
  interruptedRecordingId=null;
  $("micStatus").textContent="原录音已安全保存 · 文字处理中";
  if (wasLive) {
    tell("原录音已安全保存，等待剩余文字结果…");
    await liveQueue;
    await Promise.allSettled([...analysisTasks]);
    if (liveConfig.realtimeKind === "assist" && !modelPaused) {
      const final = await jobs(
        `/api/sessions/${sid}/live-finalize`,
        { config: withQuestionPolicy(liveConfig), consent: true },
        (j) => {
          if(current!==sid)return;
          if (j.transcriptCorrection) displayCorrection(j.transcriptCorrection);
          if (j.question) notifyQuestion(j.question);
        },
      );
      if (final && current === sid) displayLive(final);
    }
  }
  if(wasLive) await api(`/api/sessions/${sid}/complete-live`, {});
  if (
    wasLive &&
    (liveConfig.realtimeKind === "transcript" ||
      liveConfig.live.retainTranscript)
  )
    await api(`/api/sessions/${sid}/transcript-snapshot`, {});
  if(wasLive&&liveConfig.live.retainTranscript!==false&&liveConfig.live.finalAudioReview!==false){
    try{
      const reviewed=await jobs('/api/sessions/'+sid+'/review-live-audio',{config:liveConfig,consent:true},j=>tell(j.message||'正在用完整原音复核逐字稿…'));
      if(!reviewed.skipped)audioReviewNotice='完整原音复核已保存；时间标记按整块音频显示。'+(reviewed.failedCorrections?'部分文字校订失败，已保留 ASR 复核原文。':'');
    }catch(e){tell('完整原音复核未完成，实时稿和原音已保留：'+e.message,true);if(current===sid)await load(sid);return;}
  }
  if(liveConfig?.live.retainTranscript===false){captureViews.get(sid)?.transcripts.clear();captureViews.get(sid)?.corrections.clear();captureViews.delete(sid);}
  if(current===sid){delete player.dataset.sid;await load(sid);}else await list();
  $("micStatus").textContent = "原录音已保存 · " + clock(saved.seconds);
  tell("原录音已保存，可回听或开始转录。");
  if(audioReviewNotice)tell(audioReviewNotice);
  if (current===sid&&wasLive && liveConfig.realtimeKind === "assist")
    $("keepDialog").showModal();
  else if (current===sid&&!wasLive) await reviewAudio();
}
async function retryFailedAnalysis(){
  if(retryAnalysisRunning)return tell('失败任务正在重试，请稍候。');
  if(!current)throw Error('请先打开需要重试的记录');const sid=current;
  const tasks=new Map([...failedAnalysisTasks].filter(([,t])=>t.session===sid));
  if(window.LectureMobile?.store)for(const task of await window.LectureMobile.store.all('meta'))if(task.id.startsWith('failed-analysis:')&&task.session===sid)tasks.set(task.id,task);
  const latest=new Map();for(const r of detailData?.revisions||[])if(['live','corrected-transcript'].includes(r.kind))latest.set(r.kind+':'+(r.content.seq??r.content.sequences?.[0]),r);
  for(const r of latest.values())if(r.content.analysisError||r.content.analysis?.answerError||r.content.correctionState==='failed'){
    const seq=r.content.seq??r.content.sequences?.[0];if(!Number.isInteger(seq))continue;
    const action=r.kind==='live'?'live':(detailData.revisions.some(x=>x.kind==='live-transcript'&&x.content.seq===seq)?'live':'realtime-transcribe'),path='/api/sessions/'+sid+'/'+action,body={seq,reason:'sentence',config:r.config?.asr?r.config:cfg(),consent:true};
    if(![...tasks.values()].some(t=>t.path===path&&t.body.seq===seq))tasks.set(failedTaskKey(path,body),{path,body});
  }
  if(!tasks.size){
    if(detailData?.hasAudio&&!recording&&!finishing&&!busy){tell('没有待重试的分析，已打开完整录音重新识别；确认后才发送模型。');return runTranscribe();}
    return tell(recording?'当前没有失败任务；结束录音后，可点底部“重新识别录音”。':detailData?.hasAudio?'请等待当前任务结束，再点底部“重新识别录音”。':'原音不在此设备，请回到录音时的浏览器或导入录音。');
  }
  if(!confirmCall('重试 '+tasks.size+' 个失败任务。复用已有转录，缺少转录时才重新 ASR；分析与整理会产生模型费用。'))return;
  retryAnalysisRunning=true;
  try{
  const results=await Promise.allSettled([...tasks.values()].map(t=>jobs(t.path,{...t.body,retryFailed:true,consent:true},j=>{if(current!==sid)return;if(j.transcriptCorrection)displayCorrection(j.transcriptCorrection);if(j.question)notifyQuestion(j.question);})));
  if(current===sid){detailData=await api('/api/sessions/'+sid);if(!recording)render();}
  const failed=results.filter(x=>x.status==='rejected'||x.value?.analysisError||x.value?.analysis?.answerError||x.value?.correction?.correctionState==='failed').length;
  tell(failed?'仍有 '+failed+' 个任务失败，可再次点击重试；原音与原稿保留。':'失败任务已重新处理，结果已保存。',!!failed);
  }finally{retryAnalysisRunning=false;}
}
async function retry() {
  for (const item of await pending()) await uploadChunk(item);
  await countPending();
  if (current && !recording) {
    const d = await api("/api/sessions/" + current);
    if (d.chunks.length && !d.hasAudio) {
      await api(`/api/sessions/${current}/finish`, {});
      if (d.mode === "class")
        await api(`/api/sessions/${current}/transcript-snapshot`, {});
      await load(current, false);
    }
  }
  tell("待保存片段已重传。");
}
async function uploadAudio() {
  const f = $("audioUpload").files[0];
  if (!f) return;
  $("audioUpload").value = "";
  if (recording || finishing || busy) throw Error("请先结束录音并等待任务完成");
  if (current && (detailData.hasAudio || detailData.chunks.length))
    throw Error("当前已有录音，请先新建记录");
  await ensure();
  tell("保存并转换录音中…");
  if(window.LectureMobile)window.LectureMobile.onImportProgress=progress=>tell(`正在转换为 16 kHz 单声道 WAV · ${Math.floor(progress.convertedSeconds/60)}:${String(Math.floor(progress.convertedSeconds%60)).padStart(2,"0")} / ${Math.floor(progress.totalSeconds/60)}:${String(Math.floor(progress.totalSeconds%60)).padStart(2,"0")}`);
  try {
    await api(`/api/sessions/${current}/upload`, f, {
      "Content-Type": "application/octet-stream",
    });
  } finally {
    if(window.LectureMobile)window.LectureMobile.onImportProgress=null;
  }
  await load(current);
  tell("录音已保存，尚未发送 AI。");
  await reviewAudio();
}
async function saveTitle() {
  const sid = current,
    title = $("recordTitle").value;
  await api(`/api/sessions/${sid}/rename`, { title });
  if (current === sid && detailData) detailData.title = title;
  await list();
  tell("标题已保存。");
}
async function saveProvider() {
  const b = {
    name: $("providerName").value,
    baseURL: $("providerURL").value,
    key: $("providerKey").value,
    auth: $("providerAuth").value,
    network: $("providerNetwork").value,
    transcriptionPath: $("providerASRPath").value,
    chatPath: $("providerChatPath").value,
  };
  const r = await api("/api/providers", b);
  $("providerKey").value = "";
  boot.providers = r.providers;
  render();
  tell(window.LectureMobile?.account?.enabled?"平台已保存到服务器，可分别选择识别、校订与分析模型。":"平台已保存在本机，可到识别与分析模型分别选择。");
}
async function action(name, el) {
  switch (name) {
    case "toggleRecordSource":
      recordVersionPinned=false;
      recordOriginal=!recordOriginal;
      if(el)el.textContent=recordOriginal?'返回校订稿':'核对识别原文';
      return refreshRecordTranscript();
    case "followTranscript": {
      transcriptScroll.set(transcriptScrollKey(),{follow:true,top:0});
      restoreTranscriptScroll(document.querySelector("#assistTranscript, .transcript-segments"));
      return;
    }
    case "rename":
      return saveTitle();
    case "new":
      return newRecord();
    case "sample":
      return sample();
    case "transcribe":
      return runTranscribe();
    case "prompt":
      return openPrompt(el.dataset.kind);
    case "edit":
      editing = true;
      return render();
    case "cancelEdit":
      editing = false;
      return render();
    case "saveEdit":
      return saveEdit();
    case "resetPrice":
      delete options.prices[priceKey(el.dataset.role)];
      saveOptions();
      return render();
    case "toggleTranscriptSource":
      assistOriginal = !assistOriginal;
      el.textContent = assistOriginal ? "返回校订稿" : "核对原文";
      if ($("assistTranscript")) updateAssistTranscript();
      return;
    case "copyLiveTranscript":
      await navigator.clipboard.writeText(
        paragraphSegments(transcriptEntries(assistOriginal).flatMap(x=>x.segments?.length?x.segments:[{start:x.start,end:x.end,text:x.text}]))
          .map((x) => x.text)
          .filter(Boolean)
          .join("\n"),
      );
      return tell("已复制当前实时逐字稿。");
    case "copy":
      if (!readingRevision()) throw Error("请先选择文字版本");
      await navigator.clipboard.writeText(readingRevision().content.text);
      return tell("已复制全文，可直接粘贴到微信、QQ 或其他应用。");
    case "exportText":
      if (readingRevision()) downloadText(readingRevision().content.text);
      return;
    case "exportSRT": {
      const r = readingRevision();
      if (!r?.content.segments) return;
      const stamp = (s) =>
        new Date(Math.max(0, s) * 1000)
          .toISOString()
          .slice(11, 23)
          .replace(".", ",");
      downloadText(
        r.content.segments
          .filter((s) => !s.skipped)
          .map(
            (s, i) =>
              `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.speaker ? s.speaker + "：" : ""}${s.text}`,
          )
          .join("\n\n"),
        "srt",
      );
      return;
    }
    case "export":
      if (!current) return;
      downloadText(JSON.stringify(detailData, null, 2), "json");
      return;
    case "retry":
      return retry();
    case "retryAnalysis":
      return retryFailedAnalysis();
    case "sendCurrent":
      if(!recording||paused||modelPaused)throw Error('请先开始或继续录音');flush('manual');return tell('当前片段已进入保存与识别队列，录音继续。');
    case 'returnRecording':{
      if(!recordingSessionId)return;view=recordingPage;history.pushState({},'', '/'+view);return load(recordingSessionId);
    }
    case 'resumeRecording':{
      if(recording||starting||finishing||resumingCapture)throw Error('当前录音正在启动或进行中，请勿重复恢复');
      const sid=detailData?.hasAudio&&['recording','interrupted'].includes(detailData.status)?current:interruptedRecordingId;
      if(!sid)throw Error('没有待恢复的录音');resumingCapture=true;
      preparedAudioContext=new AudioContext();preparedAudioContext.resume().catch(()=>{});
      try{const s=await api('/api/sessions/'+sid);view=pageFor(s.mode);history.pushState({},'', '/'+view);await load(sid);await start(true);}
      finally{resumingCapture=false;if(!recording&&preparedAudioContext){await preparedAudioContext.close();preparedAudioContext=null;}}return;
    }
    case "addMark":
      return addMark();
    case "prevPage":
      return setPage(docPage - 1);
    case "nextPage":
      return setPage(docPage + 1);
    case "questionDemo":
      return questionDemo();
    case "silence":
      return openGate();
    case "saveQuickModels": {
      const models=Object.fromEntries(['asr','correction','text'].map(role=>[role,{providerId:$(`quick-${role}-provider`).value,model:$(`quick-${role}-model`).value}]));
      applyQuickModels(models);render();
      return tell('模型已保存，将用于后续请求；已发送及已排队请求保持原配置。');
    }
    case "openQuickModels": {
      const details=document.querySelector('.quick-models');
      if(details){details.open=true;details.scrollIntoView?.({block:'nearest'});details.querySelector?.('select')?.focus();}
      return;
    }
    case "fetchModels": {
      const role = el.dataset.role;
      const id = options[role].providerId;
      tell("读取平台模型列表中…");
      const result = await api("/api/providers/" + id + "/models", {});
      const provider = boot.providers.find((p) => p.id === id);
      provider.models = result.models;
      render();
      return tell(
        "已获取 " + result.models.length + " 个模型，可下拉选择或手动输入 ID。",
      );
    }
    case "saveProvider":
      return saveProvider();
    case "saveSearch": {
      const r = await api("/api/search-config", { key: $("searchKey").value });
      $("searchKey").value = "";
      boot.searchReady = r.hasKey;
      render();
      return tell(
        "搜索密钥已保存在本机。启用联网搜索后，开始实时分析前会确认费用。",
      );
    }
    case "savePrompts":
      document
        .querySelectorAll("[data-prompt]")
        .forEach((el) => (promptOverrides[el.dataset.prompt] = el.value));
      localStorage.setItem(
        "speakless-web-prompts",
        JSON.stringify(promptOverrides),
      );
      return tell("默认提示词已保存，仅影响后续生成。");
  }
}
document.addEventListener("click", (e) => {
  const el = e.target.closest("button,a");
  if (!el) return;
  if (el.dataset.route) {
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    return guard(() => navigate(el.dataset.route));
  }
  if (el.dataset.close) {
    if (el.dataset.close === "questionDialog") questionActivity();
    $(el.dataset.close).close();
    return;
  }
  if (el.dataset.action) return guard(() => action(el.dataset.action, el));
  if (el.dataset.session)
    return guard(async () => {
      if ($("libraryDialog").open) $("libraryDialog").close();
      const s = allSessions.find((s) => s.id === el.dataset.session);
      if (starting && s.id !== current)throw Error('请等待麦克风启动后再切换记录');
      if (pageFor(s.mode) !== view) {
        view = pageFor(s.mode);
        history.pushState({}, "", "/" + view);
      }
      await load(s.id);
    });
  if (el.dataset.tab) return chooseTab(el.dataset.tab);
  if (el.dataset.revision) {
    recordVersionPinned=true;
    activeRevision = el.dataset.revision;
    tabKind = revision()?.kind || "raw";
    editing = false;
    return render();
  }
  if (el.dataset.format) {
    format = el.dataset.format;
    return render();
  }
  if (el.dataset.pane) {
    document.documentElement.dataset.assistPane = el.dataset.pane;
    return;
  }
  if (el.dataset.settings) {
    settingsTab = el.dataset.settings;
    return render();
  }
  if (el.dataset.appearance) {
    appearance = el.dataset.appearance;
    return applyAppearance(true);
  }
  if (el.dataset.seek)
    return guard(async () => {
      if (!detailData?.hasAudio)
        throw Error("此人工示例没有原录音。真实录音可点击时间跳转。");
      player.currentTime = +el.dataset.seek;
      await player.play();
    });
  if (el.dataset.event) {
    const events = liveEvents.length
      ? liveEvents
      : (detailData?.revisions || [])
          .filter((r) => r.kind === "live")
          .map((r) => r.content);
    const event = events.find((ev) => String(ev.seq) === el.dataset.event);
    if (event) showQuestion(event);
  }
});
$("previousQuestion").onclick = () => {
  const i = questionOrder.indexOf(currentQuestionKey);
  if (i > 0) selectQuestion(questionOrder[i - 1]);
};
$("nextQuestion").onclick = () => {
  const i = questionOrder.indexOf(currentQuestionKey);
  if (i >= 0 && i + 1 < questionOrder.length)
    selectQuestion(questionOrder[i + 1]);
};
$("questionHistory").onclick = (e) => {
  const button = e.target.closest("[data-question-key]");
  if (button) selectQuestion(button.dataset.questionKey);
};
$("showQueuedQuestion").onclick = () => {
  const key = questionOrder.find((k) => questionUnread.has(k));
  if (key) selectQuestion(key);
};
$("openQuestionInbox").onclick = () => {
  const key =
    questionOrder.find((k) => questionUnread.has(k)) ||
    currentQuestionKey ||
    questionOrder.at(-1);
  if (key) selectQuestion(key);
};
$("questionAutoToggle").onclick = () => { questionActivity(); $("questionDialog").close(); };
$('sendQuestionFollowup').onclick = () => guard(sendQuestionFollowup);
$('questionFollowupText').oninput = saveFollowupDraft;
$('questionFollowupThinking').onchange = () => { saveFollowupDraft(); renderFollowups(); };
document.addEventListener('keydown', handleQuestionNavigation);
$("viewQuestionAlert").onclick = () => dismissQuestionAlert({viewAnswer:true});
$("dismissQuestionAlert").onclick = () => dismissQuestionAlert();
$("questionAlertDialog").addEventListener("cancel",e => { e.preventDefault(); dismissQuestionAlert(); });
$("questionDialog").addEventListener("cancel", questionActivity);
$("questionDialog").addEventListener("close", () => {
  if (questionCloseAllowsAuto) questionCloseAllowsAuto = false;
  else if (currentQuestionKey && questionRecords.has(currentQuestionKey))
    questionAttentionLocked = true;
  renderQuestionChrome();
});

function questionWorkActive() {
  return (
    recording ||
    finishing ||
    busy > 0 ||
    questionOrder.length > 0 ||
    $("questionDialog").open
  );
}
function protectQuestionReading(e) {
  if (e.target?.closest?.("#questionAutoToggle")) return;
  if (questionWorkActive()) questionActivity();
}
window.addEventListener("blur", () => {
  if (questionWorkActive()) questionActivity();
});
document.addEventListener("pointerdown", protectQuestionReading, {
  capture: true,
});
document.addEventListener("keydown", protectQuestionReading, { capture: true });
document.addEventListener("wheel", protectQuestionReading, {
  capture: true,
  passive: true,
});
document.addEventListener(
  "pointermove",
  (e) => {
    if (
      questionAttentionLocked ||
      Date.now() < questionResumeGraceUntil ||
      !questionWorkActive()
    )
      return;
    if (!questionPointer) {
      questionPointer = { x: e.clientX, y: e.clientY };
      return;
    }
    if (
      Math.hypot(e.clientX - questionPointer.x, e.clientY - questionPointer.y) >
      24
    )
      questionActivity();
  },
  { passive: true },
);
$("themeToggle").onclick = () => {
  appearance =
    document.documentElement.dataset.theme === "night" ? "light" : "dark";
  applyAppearance(true);
};
$("openLibrary").onclick = () => {
  $("libraryDialog").showModal();
  $("sessionSearch").focus();
};
$("start").onclick = () =>
  guard(async () => {
    if (starting || recording) return;
    if (
      current &&
      (detailData?.hasAudio ||
        detailData?.chunks.length ||
        detailData?.status === "sample")
    )
      await newRecord();
    await start();
  });
$("stop").onclick = () => guard(stop);
$("pause").onclick = () =>
  guard(async () => {
    if (!recording) return;
    if (liveSession) {
      // Seal the interval on either side of a manual model pause. Audio collected
      // while paused must not be sent later as part of the first resumed chunk.
      flush();
      modelPaused = !modelPaused;
      if(window.LectureMobile)await window.LectureMobile.store.put('meta',{id:'active-recording',value:{sid:recordingSessionId,page:recordingPage,modelPaused}});
      if(!modelPaused)await enqueueRecoveredCapture(recordingSessionId,liveConfig);
      updateControls();
      updateGateState();
      tell(
        modelPaused
          ? "只暂停后续模型输入，原音与计时继续。已经发出的请求不会撤回。"
          : "已恢复后续模型输入；暂停期间原音可在课后补转。",
      );
      return;
    }
    paused = !paused;
    if (!paused && ctx.state === "suspended") await ctx.resume();
    $("micStatus").textContent = paused
      ? "手动暂停 · 暂停期间不录音"
      : "录音已恢复";
    updateControls();
    tell(
      paused
        ? "已手动暂停。这与静音跳过不同，暂停期间不写入录音。"
        : "继续录音。",
    );
  });
$("mark").onclick = () => guard(addMark);
$("audioUpload").onchange = () => guard(uploadAudio);
$("new").onclick = () =>
  guard(async () => {
    await newRecord();
    $("libraryDialog").close();
  });
$("sample").onclick = () => guard(sample);
function openGate() {
  prepareGateAudio();
  reviewSession = null;
  $("continueTranscribe").hidden = true;
  $("silenceDialog").showModal();
  drawCurve();
  if (current && (detailData?.hasAudio || recording)) guard(previewGate);
}
$("openSilence").onclick = openGate;
$("continueTranscribe").onclick = () => guard(executeTranscribe);
$("silenceDialog").addEventListener("close", () => {
  reviewSession = null;
  $("reviewPlayer").pause();
});
$("thresholdMode").onchange = () => {
  silenceUI();
  if (gate && options.silence.thresholdMode === "auto") {
    $("silenceThreshold").value = gate.recommendedDb ?? -80;
    silenceUI();
  }
};
$("previewSilence").onclick = () => guard(previewGate);
$("applyRecommendation").onclick = () => {
  if (gate && gate.recommendedDb !== null) {
    $("thresholdMode").value = "auto";
    $("silenceThreshold").value = gate.recommendedDb;
    silenceUI();
    tell("已使用保守建议值；请试听最小声的一段，确认没有漏字。");
  }
};
$("sessionSearch").oninput = listSidebar;
for (const id of [
  "silenceEnabled",
  "silenceThreshold",
  "silenceDuration",
  "silencePadding",
  "silencePreRoll",
])
  $(id).oninput = () => {
    if (id === "silenceThreshold") $("thresholdMode").value = "manual";
    silenceUI();
    if (gate && ["silenceDuration", "silencePadding", "silencePreRoll"].includes(id)) {
      clearTimeout(curveTimer);
      curveTimer = setTimeout(() => guard(previewGate), 400);
    }
  };
$("gateChart").onclick = (e) => {
  if (!gate) return;
  const rect = e.target.getBoundingClientRect();
  const px = ((e.clientX - rect.left) / rect.width) * e.target.width;
  const db = Math.round(-80 + ((px - 54) / (e.target.width - 84)) * 60);
  $("thresholdMode").value = "manual";
  $("silenceThreshold").value = Math.max(-80, Math.min(-20, db));
  silenceUI();
};
$("resetPrompt").onclick = () =>
  ($("promptText").value = boot.prompts[pendingKind]);
$("runPrompt").onclick = () => guard(runPrompt);
$("keepAudio").onclick = () => {
  $("keepDialog").close();
  tell("已保留原录音，可以从原音重新分析。");
};
$("deleteAudio").onclick = () =>
  guard(async () => {
    if (recording || finishing || busy)
      throw Error("还有分析任务，请等待完成后删除");
    if (!confirm("确认删除此记录的原音与分段音频？文字版本保留。")) return;
    await api(`/api/sessions/${current}/delete-audio`, {});
    $("keepDialog").close();
    await load(current, false);
    tell("原音已删除，文字版本保留。");
  });
player.onloadedmetadata = () => updateControls();
player.ontimeupdate = () =>
  document
    .querySelectorAll(".transcript-segment")
    .forEach((el) =>
      el.classList.toggle(
        "playing",
        player.currentTime >= +el.dataset.start &&
          player.currentTime < +el.dataset.end,
      ),
    );
window.addEventListener("popstate", () =>
  guard(() => navigate(location.pathname.slice(1), false)),
);
window.addEventListener("beforeunload", (e) => {
  if(recording&&window.LectureMobile)window.LectureMobile.journal().flush();
  if (recording || finishing || busy) {
    e.preventDefault();
    e.returnValue = "录音或任务仍在进行";
  }
});
document.addEventListener("visibilitychange", () => {
  if(recording&&document.hidden&&window.LectureMobile)window.LectureMobile.journal().flush();
  if (recording && document.hidden)
    tell("页面已进入后台，系统可能暂停麦克风。请回到前台检查收音。", true);
});
async function init() {
  db = await new Promise((res, rej) => {
    const r = indexedDB.open("lecture-demo", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("outbox", { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  boot = await api("/api/bootstrap");
  options = {
    ...boot.config,
    parameterMode: "auto",
    realtimeTranscript: true,
    live: {
      ...boot.config.live,
      chunkSeconds: 12,
      retainTranscript: true,
      pageConfidence: 0.7,
      webSearch: false,
    },
    ...read("speakless-web-config", {}),
  };
  options.correction = { ...boot.config.correction, ...(options.correction || options.text), ...(options.correction || {}) };
  options.prices ||= {};
  options.silence = { ...boot.config.silence, ...options.silence };
  if(options.silence.gatePolicyVersion!==2){
    if(options.silence.minSilence==null||options.silence.minSilence===1.5)options.silence.minSilence=3;
    if(options.silence.preRoll==null||options.silence.preRoll===.35)options.silence.preRoll=1;
  }
  options.silence.holdBeforeSkip=true;
  options.silence.gatePolicyVersion=2;
  options.live = {
    correctTranscript: true,
    fastPipeline: true,
    streamAnswers: true,
    asrTimeoutSeconds:45,detectTimeoutSeconds:20,answerTimeoutSeconds:45,
    chunkSeconds: 12,
    retainTranscript: true,
    pageConfidence: 0.7,
    webSearch: false,
    questionSensitivity: "conservative",
    questionCooldownSeconds: 20,
    answerThinking: "fast",
    fastDetection: true,
    sentenceMode: true,
    pauseSeconds: 0.7,
    keywordEnabled: true,
    keywordProbeSeconds: 3,
    keywords: [
      "请回答",
      "谁来回答",
      "为什么",
      "怎么计算",
      "如何求",
      "是多少",
      "请问",
      "对不对",
      "what",
      "why",
      "how",
    ],
    ...options.live,
  };
  if(options.live.endpointVersion!==2&&(!options.live.endpointVersion||options.live.pauseSeconds===1.2))options.live.pauseSeconds=3;
  options.live.endpointVersion=2;
  if(options.live.acousticContextVersion!==1&&options.live.asrTimeoutSeconds===8)options.live.asrTimeoutSeconds=12;
  options.live.acousticContextVersion=1;
  options=(await import('./mobile-timeouts.mjs')).upgradeTimeouts(options);
  options.live.sentenceMode=true;
  options.live.keywordEnabled=false;
  if (options.live.questionPolicyVersion !== 3) {
    options.live.questionSensitivity = "conservative";
    const old = [
      "请回答",
      "谁来回答",
      "为什么",
      "怎么计算",
      "如何求",
      "是多少",
      "请问",
      "对不对",
      "what",
      "why",
      "how",
    ];
    if (JSON.stringify(options.live.keywords) === JSON.stringify(old))
      options.live.keywords = [
        "请回答",
        "谁来回答",
        "哪位同学",
        "你来回答",
        "请问",
        "回答",
        "can you answer",
      ];
    options.live.questionPolicyVersion = 3;
    saveOptions();
  }
  if (options.live.transcriptDefaultVersion !== 2) {
    options.live.retainTranscript = true;
    options.live.transcriptDefaultVersion = 2;
    saveOptions();
  }
  if (options.silence.thresholdMode === "auto")
    options.silence.thresholdDb = -80;
  applySilence();
  await list();
  await navigate(view, false);
  if(window.LectureMobile)interruptedRecordingId=(await window.LectureMobile.store.get('meta','active-recording'))?.value?.sid||null;
  updateControls();
  drawWave();
  await countPending();
}
setInterval(() => {
  if (view === "assist") updateTopicDisplay();
  if(liveOrganization && recording && !finishing && !organizingRecord)guard(organizeLiveRecord);
  updateCaptureStatus();
  updatePipelineStatus();
  if (current && (recording || busy || !usageData)) guard(refreshUsage);
}, 2000);
guard(init);

if(window.LectureMobile)document.addEventListener("lecture-mobile-unlocked",()=>guard(async()=>{boot=await api("/api/bootstrap");if(!recording&&!finishing)render();}));
