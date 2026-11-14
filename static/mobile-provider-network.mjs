export const DEVICE_NETWORK='本设备直连（浏览器发请求）';
export function localHost(host){
 const h=host.toLowerCase();if(h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h==='[::1]'||/^\[(fc|fd|fe80:)/i.test(h))return true;
 const p=h.split('.').map(Number);if(p.length!==4||p.some(x=>!Number.isInteger(x)||x<0||x>255))return false;
 return p[0]===127||p[0]===10||p[0]===192&&p[1]===168||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===100&&p[1]>=64&&p[1]<=127;
}
export function deviceURL(value){
 let u;try{u=new URL(value);}catch{throw Error('Base URL 格式不正确');}
 if(u.username||u.password||u.search||u.hash||/[\s\\]/.test(value))throw Error('Base URL 不得包含密钥、账号、查询参数或锚点');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&localHost(u.hostname)))throw Error('公网平台必须使用 HTTPS；HTTP 仅限本设备、局域网或 Tailscale 内网地址');
 return u;
}
export function serverURL(value){const u=deviceURL(value);if(u.protocol!=='https:'||localHost(u.hostname))throw Error('服务器代理只支持公网 HTTPS 平台。内网 / Tailscale 地址请选择“本设备直连”。');return u;}
