import {check} from './game.mjs';
const TTL=7*24*60*60;
export class MemoryStore {
  values=new Map();
  async read(key){return this.values.get(key)||null;}
  async create(key,value){if(this.values.has(key))return false;this.values.set(key,value);return true;}
  async swap(key,old,value){if(this.values.get(key)!==old)return false;this.values.set(key,value);return true;}
}
const globalFallback = (globalThis.__QSD_DELUXE_STORE__ ||= new Map());
export class RedisStore {
  constructor(env=process.env){
    this.url=env.UPSTASH_REDIS_REST_URL||env.KV_REST_API_URL;
    this.secret=env.UPSTASH_REDIS_REST_TOKEN||env.KV_REST_API_TOKEN;
    this.allowFallback=(env===process.env);
  }
  async command(args){
    check(this.url&&this.secret,'Falta conectar Upstash Redis en Vercel y volver a desplegar.',503);
    const res=await fetch(this.url,{method:'POST',headers:{Authorization:`Bearer ${this.secret}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(8000)});
    check(res.ok,'La base de datos no está disponible.',503);const data=await res.json();check(!data.error,'No se pudo consultar la base de datos.',503);return data.result;
  }
  async read(k){
    if(!this.url&&this.allowFallback)return globalFallback.get('qsd:v2:'+k)||null;
    return this.command(['GET','qsd:v2:'+k]);
  }
  async create(k,v){
    if(!this.url&&this.allowFallback){const full='qsd:v2:'+k;if(globalFallback.has(full))return false;globalFallback.set(full,v);return true;}
    return (await this.command(['SET','qsd:v2:'+k,v,'NX','EX',TTL]))==='OK';
  }
  async swap(k,old,v){
    if(!this.url&&this.allowFallback){const full='qsd:v2:'+k;if(globalFallback.get(full)!==old)return false;globalFallback.set(full,v);return true;}
    return (await this.command(['EVAL',"if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 else return 0 end",1,'qsd:v2:'+k,old,v,TTL]))===1;
  }
}
export async function update(store,key,fn){
  for(let i=0;i<60;i++){
    const old=await store.read(key);check(old,'Sala no encontrada o caducada.',404);
    const r=JSON.parse(old),result=fn(r);
    if(await store.swap(key,old,JSON.stringify(r)))return result;
    await new Promise(resolve=>setTimeout(resolve,10+Math.random()*80));
  }
  check(false,'Hay muchos envíos. Intenta confirmar otra vez.',503);
}
