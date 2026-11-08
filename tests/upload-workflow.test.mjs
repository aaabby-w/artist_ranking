import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = readFileSync(new URL('../app.js', import.meta.url),'utf8').replace(/\ninit\(\);\s*$/, '\n');
const els = new Map();
const el = key => {
  if (!els.has(key)) els.set(key, {innerHTML:'',textContent:'',hidden:false,disabled:false,isConnected:true,open:true,dataset:{},events:{},
    classList:{add(){},remove(){},toggle(){}},setAttribute(){},remove(){},scrollIntoView(){},before(){},append(){},
    addEventListener(type,fn){this.events[type]=fn;},removeEventListener(type){delete this.events[type];},
    querySelector(){return null;},querySelectorAll(){return [];},showModal(){this.open=true;},close(){this.open=false;}});
  return els.get(key);
};
const doc={querySelector:el,querySelectorAll:()=>[],addEventListener(){},createElement:()=>el('feedback'),body:el('body')};
const form=el('#submit-form'), button=el('submit-button'), fileControl=el('file'), noteControl=el('note');
form.elements={image:{files:[]}}; form.values={url:'https://example.com/art.png',note:'作品说明'};
form.querySelector=selector=>selector.startsWith('button')?button:null;
el('#dialog').querySelectorAll=selector=>selector==='button'?[button]:selector==='button, input, textarea, select'?[button,fileControl,noteControl]:[];
const ctx=vm.createContext({document:doc,window:{GUILD_CONFIG:{supabaseUrl:'https://x.supabase.co',supabaseKey:'pk'}},
  localStorage:{getItem(){return null;}},setTimeout,clearTimeout,URL,console,Date,Uint8Array,
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},FormData:class{constructor(f){this.values={...f.values};}get(k){return this.values[k];}}});
vm.runInContext(source+`\nglobalThis.T={detail,set(v){data=v.data;user=v.user;profile=v.profile;client=v.client;busy=false;},isBusy:()=>busy};load=async()=>true;toast=()=>{};`,ctx);
const T=ctx.T, task={id:'task',title:'测试卡',status:'imported',source_record:{artist:'画师甲',system:'灵卡',status:''},points:20};
const calls=[];let uploads=0, holdUpload, failCommit=false;
const client={rpc:async(name)=>{calls.push(name);return {error:failCommit&&name==='guild_admin_submit'?new Error('临时失败'):null};},storage:{from:()=>({upload:async()=>{uploads++;if(holdUpload)await holdUpload;return {error:null};}})}};
const reset=()=>{calls.length=0;task.status='imported';T.set({user:{id:'admin'},profile:{id:'admin',role:'admin',active:true},client,data:{tasks:[task],profiles:[],aliases:[],submissions:[],awards:[]}});T.detail(task.id);};
const submit=()=>form.events.submit({preventDefault(){},currentTarget:form});
reset();form.values.note='   ';await submit();assert.equal(calls.length,0);assert.equal(task.status,'imported');
form.values.note='作品说明';form.values.url='javascript:alert(1)';await submit();assert.equal(calls.length,0);
form.elements.image.files=[{size:12,name:'bad.png',slice:()=>({arrayBuffer:async()=>new Uint8Array(8).buffer})}];await submit();assert.equal(calls.length,0);assert.equal(uploads,0);
const file={size:12,name:'valid.png',slice:()=>({arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer})};
form.elements.image.files=[file];form.values.url='';reset();
let resolveUpload;holdUpload=new Promise(resolve=>{resolveUpload=resolve;});
const first=submit();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(uploads,1);assert.equal(T.isBusy(),true);assert.equal(button.disabled,true);
await submit();assert.equal(uploads,1);failCommit=true;resolveUpload();await first;
assert.equal(T.isBusy(),false);assert.equal(button.disabled,false);assert.equal(el('#dialog').open,true);
failCommit=false;holdUpload=null;await submit();assert.equal(uploads,1,'retry reuses the successful upload');assert.equal(el('#dialog').open,false);
assert.equal(calls.filter(c=>c==='guild_admin_submit').length,2);
console.log('PASS: validate before mutation, block duplicate submit, restore controls on failure, reuse upload on retry');

T.set({user:undefined,profile:null,client,data:{tasks:[{id:'guest-task',title:'游客任务',status:'active'}],profiles:[],submissions:[],awards:[]}});
T.detail('guest-task');
assert.doesNotMatch(el('#dialog-body').innerHTML,/submit-form|归还任务/);
console.log('PASS: missing guest and assignee IDs do not grant owner controls');
