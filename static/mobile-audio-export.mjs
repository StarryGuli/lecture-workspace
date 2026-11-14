import {audioBlob} from './mobile-store.mjs';

export function installAudioExport({runtime,document=globalThis.document,navigator=globalThis.navigator,URL=globalThis.URL,notify=()=>{}}){
 const prepared=new Map();
 const label=(link,text)=>{link.textContent=text;};
 const download=entry=>{const a=document.createElement('a');a.href=entry.url;a.download=entry.file.name;document.body.append(a);a.click();a.remove();};
 const handler=e=>{
  const link=e.target.closest?.('a[href^="/api/sessions/"]');if(!link?.href.endsWith('/audio'))return;
  e.preventDefault();
  if(document.documentElement.dataset.recording==='true'){notify('请先结束录音，再导出完整原音。');return;}
  const sid=new URL(link.href).pathname.split('/')[3],entry=prepared.get(sid);
  if(entry?.loading){notify('正在从本设备准备录音，请稍候…');return;}
  if(entry?.file){
   if(entry.downloadOnly){download(entry);notify('已发起 WAV 下载，原音仍保留在本设备。');return;}
   // No await before share: the second tap supplies a fresh user activation.
   let shareable=false;try{shareable=typeof navigator.share==='function'&&navigator.canShare?.({files:[entry.file]})===true;}catch{}
   if(shareable){
    try{Promise.resolve(navigator.share({files:[entry.file],title:entry.title})).then(()=>notify('已交给系统分享面板；选择“存储到文件”可保存录音。')).catch(error=>{
     if(error.name==='AbortError'){notify('已取消分享，原音仍在本设备。');return;}
     // Next tap stays a user gesture and uses download instead of looping.
     entry.downloadOnly=true;label(link,'分享未完成，点此下载 WAV');notify('系统分享未完成：'+error.message+'。可再次点击尝试下载，原音仍保留。');
    });}catch(error){entry.downloadOnly=true;label(link,'点此下载 WAV');notify(error.message);}
   }else{download(entry);notify('已发起下载；可在浏览器下载列表查看文件。');}
   return;
  }
  prepared.set(sid,{loading:true});label(link,'正在准备录音…');
  (async()=>{
   try{
    const session=await runtime.store.get('sessions',sid),blob=await audioBlob(runtime.store,sid),title=session?.title||'课堂录音';
    const name=title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,70)||'课堂录音';
    const file=new File([blob],name+'-'+sid.slice(0,8)+'.wav',{type:blob.type||'audio/wav'}),ready={file,title,url:URL.createObjectURL(file)};
    prepared.set(sid,ready);label(link,'录音已就绪 · 点此保存／分享');notify('录音已准备好，请再点一次；iPhone 可在分享面板选择“存储到文件”。');
   }catch(error){prepared.delete(sid);label(link,'重新导出录音');notify('导出失败：'+error.message+'。未删除原音。');}
  })();
 };
 document.addEventListener('click',handler);
 return ()=>{document.removeEventListener('click',handler);for(const value of prepared.values())if(value.url)URL.revokeObjectURL(value.url);prepared.clear();};
}
