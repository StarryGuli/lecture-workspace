export const LIVE_TIMEOUTS={asrTimeoutSeconds:45,detectTimeoutSeconds:20,answerTimeoutSeconds:45};
export function upgradeTimeouts(config){
 const out=structuredClone(config);out.live={...(out.live||{})};
 if(out.live.timeoutMode==null){
  const old={asrTimeoutSeconds:[8,12,45],detectTimeoutSeconds:[8,20],answerTimeoutSeconds:[12,45]};
  out.live.timeoutMode=Object.entries(old).some(([k,v])=>out.live[k]!=null&&!v.includes(out.live[k]))||out.correction?.timeout!=null&&![10,30].includes(out.correction.timeout)?'manual':'auto';
 }
 if(out.live.timeoutPolicyVersion!==3){
  for(const [key,value] of Object.entries(LIVE_TIMEOUTS))if(out.live[key]==null||({asrTimeoutSeconds:[8,12],detectTimeoutSeconds:[8],answerTimeoutSeconds:[12]}[key]).includes(out.live[key]))out.live[key]=value;
  if(out.correction&&(out.correction.timeout==null||out.correction.timeout===10))out.correction.timeout=30;
  out.live.timeoutPolicyVersion=3;
 }
 return out;
}
export function requestWait({config,role,provider,seconds=0,body,warm=false}){
 const configured=Number(config[role]?.timeout)||Number(config.timeout)||120;
 // Gateway-relayed own GPU: the gateway waits ~10s+0.8x audio, then may retry on the paid fallback.
 // It never waits for a cold model load (it falls back instead), so no load allowance here.
 if(provider?.privateRelay&&role==='asr')return Math.max(30,Math.min(600,Math.ceil(40+1.5*Math.max(0,seconds))));
 if(config.live?.timeoutMode!=='auto')return Math.max(2,Math.min(600,configured));
 const local=provider.auth==='No key (local server)'||provider.isLocalModel===true;
 let wait;
 if(role==='asr')wait=local?Math.min(300,25+Math.max(0,seconds)):Math.min(120,8+.6*Math.max(0,seconds));
 else {
  const chars=(body?.messages||[]).reduce((n,m)=>n+(typeof m.content==='string'?m.content.length:JSON.stringify(m.content||'').length),0);
  const stage=config._timeoutStage||role;
  wait=stage==='correction'?(local?15+Math.min(165,chars*.1):10+Math.min(80,chars*.06)):(local?20+Math.min(160,chars*.04):20+Math.min(90,chars*.025));
 }
 // Speakless grants additional model-loading time for self-hosted models.
 if(local&&!warm)wait+=Math.max(0,Math.min(300,Number(provider.loadAllowanceSeconds??120)));
 return Math.max(8,Math.min(local?600:120,Math.ceil(wait)));
}
