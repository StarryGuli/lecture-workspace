import {createMobileRuntime} from './mobile-runtime.mjs';
import {decryptBlob} from './mobile-vault.mjs';
import {installAudioExport} from './mobile-audio-export.mjs';
const $=id=>document.getElementById(id);
const runtime=await createMobileRuntime({detector:async pcm=>{const {detectSpeech}=await import('./mobile-vad.mjs');return detectSpeech(pcm);}});
window.LectureMobile=runtime;
const error=(e)=>{const node=$('mobileNotice');if(node)node.textContent=e.message||String(e);};
// The "more" menu closes on choice / outside click / Esc in app.js (shared with the Mac version);
// this early copy only covers the moments before app.js has loaded.
const workspaceMenu=$('workspaceMenu');
if(workspaceMenu&&!window.__menuCloseInstalled){
 window.__menuCloseInstalled=true;
 workspaceMenu.addEventListener('click',e=>{
  if(e.target.closest('input,select,textarea,label'))return;
  if(e.target.closest('#workspaceMenuPanel button,#workspaceMenuPanel a[href]'))workspaceMenu.open=false;
 });
 document.addEventListener('click',e=>{if(!workspaceMenu.contains(e.target))workspaceMenu.open=false;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&workspaceMenu.open){workspaceMenu.open=false;workspaceMenu.querySelector('summary').focus();}});
}
function controls(){
 const bar=document.createElement('div');bar.className='mobile-device-bar';bar.innerHTML='<details class="mobile-device-info"><summary>设备状态</summary><span id="deviceStorageState">本设备原音 · 检查存储中</span><span id="mobileSpeechState">自动收音：准备中</span></details><div><button id="mobileVaultButton">解锁密钥</button><button id="mobileSyncButton">连接／同步</button><button id="mobileUpdateButton" title="加载网站新版；请先结束录音并保存编辑" hidden>加载新版</button></div><small id="mobileNotice" role="status"></small>';
 $('workspaceMenuPanel').append(bar);
 const modal=document.createElement('dialog');modal.id='mobileConnect';modal.className='mobile-connect-dialog';modal.innerHTML=`<div class="dialog-header"><h2>此设备的密钥与同步</h2><button id="mobileConnectClose">关闭</button></div><p>录音保留在录制设备；只有文稿和设置参与加密同步。密钥保险库密码只用于此设备解锁。</p><section><h3>解锁／创建本机保险库</h3><label>设备保险库密码（至少 8 字符）<input type="password" id="mobileVaultPassword" autocomplete="current-password"></label><button id="mobileUnlock">解锁保险库</button><button id="mobileLock">锁定密钥</button><label>硅基流动 API Key（已同步可不填）<input id="mobileSiliconKey" type="password" autocomplete="off"></label><button id="mobileSaveSilicon">保存本机硅基流动密钥</button></section><section><h3>从 Mac 导入同步连接</h3><p>在 Mac 项目里运行 <code>python3 tools/mobile_pairing.py</code>，将生成的加密连接文件传到手机；口令只在本设备解密。</p><label>加密连接文件<input id="mobilePairFile" type="file" accept=".lecture,.json,application/octet-stream"></label><label>连接文件的解锁口令<input id="mobilePairPassword" type="password" autocomplete="off"></label><button id="mobileImportPair">导入连接</button></section><section><h3>手动加密同步</h3><p>下拉会解密已有文稿、模型配置和密钥；上传只发送已结束记录的密文，不含录音或教材正文。</p><button id="mobilePull">拉取设置与文稿</button><label class="check"><input type="checkbox" id="mobilePushConfig">同时上传本设备设置、平台与密钥（加密；冲突不覆盖）</label><button id="mobilePush">上传本设备已结束记录</button></section><p id="mobileConnectStatus" role="status"></p>`;document.body.append(modal);
 const status=s=>{$('mobileConnectStatus').textContent=s;};
 const action=fn=>async()=>{try{status('正在处理…');await fn();await updateStorage();}catch(e){status(e.message);}};
 $('mobileVaultButton').onclick=$('mobileSyncButton').onclick=()=>modal.showModal();$('mobileConnectClose').onclick=()=>modal.close();
 $('mobileUnlock').onclick=action(async()=>{await runtime.keyring.unlock($('mobileVaultPassword').value);await runtime.keyring.save();$('mobileVaultPassword').value='';$('mobileVaultButton').textContent='密钥已解锁';status('保险库已解锁。可关闭此窗口，到设置 → 接入平台添加 API Key，或导入加密同步连接。');document.dispatchEvent(new Event('lecture-mobile-unlocked'));});
 $('mobileLock').onclick=()=>{runtime.keyring.lock();$('mobileVaultButton').textContent='解锁密钥';status('密钥已从当前页面内存锁定，已保存录音和文稿仍留在设备。');};
 $('mobileSaveSilicon').onclick=action(async()=>{const key=$('mobileSiliconKey').value.trim();if(!key)throw Error('请填写 API Key');await runtime.keyring.setKey('siliconflow',key);$('mobileSiliconKey').value='';status('密钥已加密保存到本机保险库，当前默认识别/校订模型可直接使用。');document.dispatchEvent(new Event('lecture-mobile-unlocked'));});
 $('mobileImportPair').onclick=action(async()=>{if(!runtime.keyring.unlocked)throw Error('先创建或解锁本设备保险库');const file=$('mobilePairFile').files[0];if(!file)throw Error('请选择 Mac 导出的加密连接文件');const payload=JSON.parse(new TextDecoder().decode(await decryptBlob(new Uint8Array(await file.arrayBuffer()),$('mobilePairPassword').value)));if(payload.type!=='lecture-mobile-pairing-v1'||!payload.url||!payload.token||!payload.passphrase)throw Error('连接文件格式不正确');if(new URL(payload.url).origin!==location.origin)throw Error('连接文件的站点地址与当前网站不一致');runtime.keyring.values.sync={url:payload.url,token:payload.token,passphrase:payload.passphrase};await runtime.keyring.save();$('mobilePairPassword').value='';$('mobilePairFile').value='';status('连接已加密保存到本机保险库。点击“拉取设置与文稿”完成同步。');});
 $('mobilePull').onclick=action(async()=>{if(document.documentElement.dataset.recording==='true')throw Error('请先结束录音再拉取，避免切换当前模型');const count=await runtime.syncPull();const settings=(await runtime.store.get('meta','settings'))?.value;if(settings){let prior={};try{prior=JSON.parse(localStorage.getItem('speakless-web-config')||'{}');}catch{}localStorage.setItem('speakless-web-config',JSON.stringify({...prior,...settings}));}document.dispatchEvent(new Event('lecture-mobile-unlocked'));status(`已拉取 ${count} 项。录音仍只在各自的录制设备。关闭窗口后刷新以载入同步的模型与记录。`);});
 $('mobilePush').onclick=action(async()=>status(`已加密上传 ${await runtime.syncPush($('mobilePushConfig').checked)} 项记录／设置，未上传音频。`));
 window.addEventListener('pagehide',()=>{runtime.keyring.lock();});
 installAudioExport({runtime,notify:message=>{error(Error(message));document.dispatchEvent(new CustomEvent('lecture-audio-export-status',{detail:message}));}});
}
async function updateStorage(){try{const estimate=await navigator.storage?.estimate?.();const persisted=await navigator.storage?.persisted?.();$('deviceStorageState').textContent=`本设备原音 · 已用 ${((estimate?.usage||0)/1048576).toFixed(1)} MB${estimate?.quota?' / 配额 '+(estimate.quota/1073741824).toFixed(1)+' GB':''} · ${persisted?'已获持久存储':'建议课后导出原音'}`;}catch{}}
// Public boot completes before app.js reads config or initializes settings.
const earlySW='serviceWorker' in navigator?navigator.serviceWorker.register('/sw.js',{type:'module',scope:'/'}).catch(()=>null):null;
let startApp,appLoaded=false;
const accountGate=new Promise(resolve=>{startApp=resolve;});
function accountSheet(){
 const sheet=document.createElement('dialog');sheet.className='mobile-account-sheet';sheet.innerHTML=`<form><h2>登录</h2><p data-account-message>使用共享密码登录，原音保存在本设备。</p><label>密码<input name="password" type="password" minlength="6" maxlength="128" autocomplete="current-password" placeholder="输入登录密码，也可用数字密码" required></label><label class="check"><input name="remember" type="checkbox" checked>记住登录</label><button type="submit">登录</button><button type="button" data-retry hidden>重新连接</button><button type="button" data-offline hidden>使用本设备已有记录</button><p role="status" data-account-error></p></form>`;document.body.append(sheet);
 const form=sheet.querySelector('form'),message=sheet.querySelector('[data-account-message]'),notice=sheet.querySelector('[data-account-error]'),retry=sheet.querySelector('[data-retry]'),offline=sheet.querySelector('[data-offline]');
 sheet.addEventListener('cancel',e=>e.preventDefault());
 const show=()=>{if(!sheet.open)sheet.showModal();};runtime.account.onRequired=()=>{form.elements.password.disabled=false;form.querySelector('[type=submit]').hidden=false;message.textContent='使用共享密码登录，原音仍保存在本设备。';show();if($('mobileVaultButton')){$('mobileVaultButton').textContent='登录';$('mobileVaultButton').hidden=false;}};
 const success=()=>{sheet.close();if(appLoaded&&document.documentElement.dataset.recording!=='true'){location.reload();return;}startApp();if($('mobileVaultButton'))$('mobileVaultButton').hidden=true;document.dispatchEvent(new Event('lecture-mobile-unlocked'));};
 const connect=async()=>{try{notice.textContent='正在连接…';const enabled=await runtime.account.boot();if(!enabled){sheet.close();startApp();return;}if(runtime.account.authenticated){success();return;}notice.textContent='';message.textContent='\u8f93\u5165\u5df2\u8bbe\u7f6e\u7684\u5bc6\u7801\u767b\u5f55\uff0c\u65e0\u9700\u91cd\u65b0\u8bbe\u7f6e\u3002';retry.hidden=false;form.elements.password.disabled=false;form.querySelector('[type=submit]').hidden=false;if(runtime.account.configured===false){message.textContent='登录密码尚未设置。请在电脑上打开的密码设置页完成一次设置，再点“重新连接”。';form.elements.password.disabled=true;form.querySelector('[type=submit]').hidden=true;}show();}catch(e){notice.textContent=e.message;retry.hidden=false;offline.hidden=false;form.elements.password.disabled=true;form.querySelector('[type=submit]').hidden=true;show();}};
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');button.disabled=true;try{await runtime.account.login(form.elements.password.value,form.elements.remember.checked);form.elements.password.value='';notice.textContent='';success();}catch(e){notice.textContent=e.message;}finally{button.disabled=false;}};
 retry.onclick=connect;offline.onclick=()=>{sheet.close();startApp();};return connect();
}
await accountSheet();await accountGate;
controls();appLoaded=true;await updateStorage();
if(runtime.account.enabled){
 document.addEventListener('change',e=>{if(e.isTrusted&&e.target.closest('.settings-layout'))runtime.account.settingsWritable=true;},true);
 const bar=$('mobileVaultButton');bar.textContent='登录';bar.hidden=runtime.account.authenticated;bar.onclick=()=>{if(!runtime.account.authenticated)runtime.account.onRequired();};
 $('mobileSyncButton').textContent='同步记录';$('mobileSyncButton').title='同步文字记录到其他设备，不含完整录音';$('mobileSyncButton').onclick=async()=>{try{if(document.documentElement.dataset.recording==='true')throw Error('请先结束录音再同步');await runtime.syncPull();const count=await runtime.syncPush();error(Error(`已同步文字（上传 ${count} 条），原音留在本设备`));document.dispatchEvent(new Event('lecture-mobile-unlocked'));}catch(e){error(e);}};
 const logout=document.createElement('button');logout.textContent='退出登录';logout.className='mobile-account-logout';logout.onclick=async()=>{try{await runtime.account.logout();}catch(e){error(e);}};bar.after(logout);
 // Only mobile settings copy is adapted; recording and native server UI stay intact.
 const replacements=new Map([['密钥只保存在本机','密钥由服务器保管'],['只保存在本机，不回传已有密钥','保存到服务器，不回传已有密钥'],['浏览器网络（跟随系统）','服务器代理'],['原音、音频片段、资料与文字版本均在本机服务的数据目录中。','原音、音频片段与资料保存在本设备，文字可同步。'],['当前只监听本机；跨设备使用还需 HTTPS、登录与私有存储。','已使用共享密码登录；跨设备同步文字，原音留在录制设备。'],['尚未部署','账户服务']]);
 const adapt=()=>{for(const el of document.querySelectorAll('.settings-layout small,.settings-layout .hint,.settings-layout .badge,.page-heading .description,.settings-layout option')){for(const node of [...el.childNodes])if(node.nodeType===3){let text=node.textContent;for(const [from,to] of replacements)text=text.replaceAll(from,to);if(text!==node.textContent)node.textContent=text;}}for(const input of document.querySelectorAll('input[placeholder]'))for(const [from,to] of replacements)if(input.placeholder.includes(from))input.placeholder=input.placeholder.replaceAll(from,to);};
 new MutationObserver(adapt).observe(document.querySelector('main')||document.body,{childList:true,subtree:true});adapt();
}

// Windows GPU recognition through the account gateway: warm it when recording starts,
// show its state, and say when a segment used the paid fallback instead.
const privateASR=runtime.account.enabled&&(runtime.account.providers||[]).find(p=>p.privateRelay);
if(privateASR){
 const line=document.createElement('span');line.id='privateAsrState';$('mobileSpeechState')?.after(line);
 const labels={ready:'已就绪',loading:'正在加载模型（约 1–3 分钟，期间改用硅基流动）',idle:'空闲，开始录音时自动加载',offline:'离线，改用硅基流动'};
 const selected=()=>{try{return JSON.parse(localStorage.getItem('speakless-web-config')||'{}').asr?.providerId===privateASR.id;}catch{return false;}};
 const refresh=async(warm=false)=>{try{const s=await runtime.account.request('private-asr',{method:warm?'POST':'GET',body:warm?{}:undefined});line.textContent=`${privateASR.name}：${labels[s.state]||s.state}`;return s;}catch{line.textContent=`${privateASR.name}：状态未知`;}};
 refresh();
 document.getElementById('start')?.addEventListener('click',()=>{if(selected())refresh(true);},{capture:true});
 let lastBackend=null;
 document.addEventListener('lecture-asr-backend',e=>{
  const {backend,reason}=e.detail||{};if(!backend||backend===lastBackend)return;lastBackend=backend;
  const why={loading:'Windows 模型加载中',offline:'Windows 离线',busy:'Windows 显卡被占用',backlog:'Windows 排队过长',timeout:'Windows 响应超时',error:'Windows 识别出错'}[reason]||'Windows 不可用';
  const message=backend===privateASR.id?`已使用 ${privateASR.name}，不产生平台费用`:`${why}，本段改用 ${privateASR.fallbackProvider?.name||backend}（按量计费）`;
  line.textContent=`${privateASR.name}：${backend===privateASR.id?labels.ready:why+'，暂用备用平台'}`;
  document.dispatchEvent(new CustomEvent('lecture-runtime-notice',{detail:message}));
 });
}
// Ask only on a user gesture; a refusal never prevents local recording.
document.getElementById('start')?.addEventListener('click',()=>{navigator.storage?.persist?.().then(updateStorage).catch(()=>{});},{capture:true});
if('serviceWorker' in navigator){try{const registration=await earlySW;if(!registration)throw Error('离线注册未完成');await navigator.serviceWorker.ready;const update=()=>{if(registration.waiting){$('mobileUpdateButton').hidden=false;$('mobileUpdateButton').onclick=()=>{if(document.documentElement.dataset.recording==='true'||document.querySelector('.save-editor')||document.querySelector('.title-editor.dirty')){error(Error('请结束录音并保存编辑后再更新'));return;}registration.waiting.postMessage({type:'ACTIVATE'});};}};const watch=()=>registration.installing?.addEventListener('statechange',update);registration.addEventListener('updatefound',watch);watch();update();let started=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(started&&document.documentElement.dataset.recording!=='true')location.reload();});if(!navigator.serviceWorker.controller)await new Promise(resolve=>{const timer=setTimeout(resolve,5000);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timer);resolve();},{once:true});});started=true;}catch(e){error(Error('离线缓存未启用；本设备录音仍会保存，请保持页面打开。'));}}
document.addEventListener('lecture-vad-state',e=>{$('mobileSpeechState').textContent=e.detail==='ready'?'自动收音：已就绪':'自动收音：保守模式';if(e.detail==='unavailable')error(Error('本地人声模型暂不可用，自动模式会保守保留轻声；手动阈值仍可使用。'));});
import('./mobile-vad.mjs').then(m=>m.warmSpeechDetector()).catch(()=>{});
const script=document.createElement('script');script.src='/app.js';script.onerror=()=>error(Error('界面资源加载失败，请检查网络后刷新'));document.body.append(script);
