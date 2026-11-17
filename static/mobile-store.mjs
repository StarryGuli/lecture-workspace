// Device-owned records and audio. No server uploads are performed by this module.
export const DB_NAME='lecture-workspace-mobile';
export const TABLES=['sessions','chunks','revisions','documents','marks','usage','meta'];
export async function openMobileStore(indexedDB=globalThis.indexedDB){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>{for(const table of TABLES)if(!r.result.objectStoreNames.contains(table))r.result.createObjectStore(table,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const run=(table,mode,fn)=>new Promise((resolve,reject)=>{const tx=db.transaction(table,mode);let value;const req=fn(tx.objectStore(table));req.onsuccess=()=>{value=req.result;};req.onerror=()=>reject(req.error);tx.oncomplete=()=>resolve(value);tx.onabort=()=>reject(tx.error||Error('设备存储写入失败'));tx.onerror=()=>reject(tx.error);});
 // Safari Private Browsing (and other ephemeral WebKit sessions) refuse Blob/File values in
 // IndexedDB ("Error preparing Blob/File data…"). Then the same bytes are stored as an
 // ArrayBuffer and turned back into a Blob on read; normal browsers keep storing Blobs.
 const put=async(t,value)=>{try{return await run(t,'readwrite',s=>s.put(value));}catch(e){if(!hasBlob(value))throw e;const packed=await packBlobs(value);return run(t,'readwrite',s=>s.put(packed));}};
 return {get:async(t,id)=>unpackBlobs(await run(t,'readonly',s=>s.get(id))),all:async t=>(await run(t,'readonly',s=>s.getAll())).map(unpackBlobs),put,delete:(t,id)=>run(t,'readwrite',s=>s.delete(id)),close:()=>db.close()};
}
const PACKED='__lectureBlob';
const isPlain=v=>v&&typeof v==='object'&&(Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype);
function hasBlob(v,depth=0){if(typeof Blob!=='undefined'&&v instanceof Blob)return true;if(depth>4||!isPlain(v))return false;return Object.values(v).some(x=>hasBlob(x,depth+1));}
export async function packBlobs(v,depth=0){
 if(typeof Blob!=='undefined'&&v instanceof Blob)return {[PACKED]:await v.arrayBuffer(),type:v.type,...(typeof File!=='undefined'&&v instanceof File?{name:v.name}:{})};
 if(depth>4||!isPlain(v))return v;
 const out=Array.isArray(v)?[]:{};for(const [k,x] of Object.entries(v))out[k]=await packBlobs(x,depth+1);return out;
}
export function unpackBlobs(v,depth=0){
 if(!v||typeof v!=='object'||depth>5)return v;
 if(v[PACKED]instanceof ArrayBuffer)return v.name&&typeof File!=='undefined'?new File([v[PACKED]],v.name,{type:v.type}):new Blob([v[PACKED]],{type:v.type});
 if(!isPlain(v))return v;
 let changed=false;const out=Array.isArray(v)?[]:{};for(const [k,x] of Object.entries(v)){out[k]=unpackBlobs(x,depth+1);if(out[k]!==x)changed=true;}return changed?out:v;
}
export class MemoryStore{constructor(){this.tables=Object.fromEntries(TABLES.map(t=>[t,new Map()]));}async get(t,id){return structuredClone(this.tables[t].get(id));}async all(t){return structuredClone([...this.tables[t].values()]);}async put(t,v){this.tables[t].set(v.id,structuredClone(v));return v.id;}async delete(t,id){this.tables[t].delete(id);}}
export const uuid=()=>crypto.randomUUID().replaceAll('-','');
export const dateNow=()=>new Date().toISOString();
export async function audioBlob(store,sid){
 const session=await store.get('sessions',sid);if(!session)throw Error('记录不存在');
 const saved=await store.get('meta','audio:'+sid);if(saved?.blob)return saved.blob;
 const chunks=(await store.all('chunks')).filter(x=>x.session===sid&&!x.temporary).sort((a,b)=>a.seq-b.seq);
 if(!chunks.length)throw Error('原音不在此设备，请回到录制设备或导入原音');
 if(chunks.some((x,i)=>x.seq!==i))throw Error('录音缺块，保留已收到的片段，尚不能导出完整原音');
 const size=chunks.reduce((n,x)=>n+x.blob.size-44,0),buffer=new ArrayBuffer(44),v=new DataView(buffer);
 const str=(at,s)=>{for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));};
 str(0,'RIFF');v.setUint32(4,36+size,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,size,true);
 return new Blob([buffer,...chunks.map(x=>x.blob.slice(44))],{type:'audio/wav'});
}
