import {createHmac,timingSafeEqual} from 'node:crypto';
const name='qsd_admin', age=30*24*60*60;
const sign=(payload,key)=>createHmac('sha256',key).update(payload).digest('base64url');
export function adminSession(req,key,now=Date.now()){
 if(!key)return false;
 const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'';
 const [expiry,signature]=cookie.split('.');
 if(!/^\d+$/.test(expiry||'')||Number(expiry)<=now||!signature)return false;
 const expected=sign(expiry,key);return signature.length===expected.length&&timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
}
export function setAdminCookie(res,key,secure,logout=false){
 const expiry=String(Date.now()+age*1000);
 res.setHeader('Set-Cookie',`${name}=${logout?'':expiry+'.'+sign(expiry,key)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${logout?0:age}${secure?'; Secure':''}`);
}
