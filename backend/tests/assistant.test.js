import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io as client} from 'socket.io-client';
import {createApplication} from '../src/app.js';
import {geminiClient} from '../src/assistant.js';
import {createIdentity} from '../../shared/crypto.js';
const origin='http://localhost:5173';
const event=(socket,name,match=()=>true)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timeout: ${name}`)),4000);const on=value=>{if(!match(value))return;clearTimeout(timer);socket.off(name,on);resolve(value);};socket.on(name,on);});
async function listen(app){await new Promise(resolve=>app.http.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.http.address().port}`;}
async function request(base,path,{cookie,body,method=body?'POST':'GET'}={}){
 const response=await fetch(`${base}/api${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function setup(t,generate){
 const dir=mkdtempSync(join(tmpdir(),'commonroom-ai-'));
 const app=createApplication({databasePath:join(dir,'test.sqlite'),origins:[origin],generate,reminderIntervalMs:60_000});
 const base=await listen(app),sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await app.close();rmSync(dir,{recursive:true,force:true});});
 const account=async username=>{const r=await request(base,'/auth/register',{body:{username,name:username.toUpperCase(),password:'test-password-123'}});const keys=await createIdentity(r.data.user.id);await request(base,'/identity',{cookie:r.cookie,body:keys.record});return {cookie:r.cookie,user:r.data.user};};
 const connect=async cookie=>{const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},autoConnect:false,reconnection:false});sockets.push(s);const ready=event(s,'connect');s.connect();await ready;return s;};
 return {app,base,account,connect};
}
test('without a key the assistant explains how to turn it on',async t=>{
 const {base,account}=await setup(t,null);
 const alice=await account('alice');
 assert.equal((await request(base,'/ai/status',{cookie:alice.cookie})).data.configured,false);
 const r=await request(base,'/ai/ask',{cookie:alice.cookie,body:{prompt:'hello'}});
 assert.equal(r.status,200);
 assert.match(r.data.messages.at(-1).body,/GROQ_API_KEY/);
});
test('private AI chat, mentions with and without context, reminders and tasks',async t=>{
 const calls=[];let completeId='';
 const generate=async input=>{calls.push(input);const text=input.contents.at(-1).parts[0].text;
  if(/mark it done/.test(text))return {reply:'Marked done.',actions:[{type:'complete',id:completeId}]};
  if(/remind/i.test(text))return {reply:'Reminder set.',actions:[{type:'reminder',title:'Call mom',dueAt:new Date(Date.now()-1000).toISOString()},{type:'task',title:'Buy milk',dueAt:''},{type:'reminder',title:'No time',dueAt:''}]};
  return {reply:`Echo: ${text.slice(-40)}`,actions:[]};};
 const {app,base,account,connect}=await setup(t,generate);
 const alice=await account('alice'),bob=await account('bob'),eve=await account('eve');
 const a=await connect(alice.cookie),b=await connect(bob.cookie),e=await connect(eve.cookie);
 // Private chat: history is saved per person and is never visible to others.
 const dm=await request(base,'/ai/ask',{cookie:alice.cookie,body:{prompt:'What is 2+2?',offsetMinutes:-330,timezone:'Asia/Kolkata'}});
 assert.deepEqual(dm.data.messages.map(m=>m.role),['user','assistant']);
 assert.match(calls[0].system,/\+05:30/);
 assert.equal((await request(base,'/ai/messages',{cookie:alice.cookie})).data.messages.length,2);
 assert.equal((await request(base,'/ai/messages',{cookie:bob.cookie})).data.messages.length,0);
 // Mention in a direct chat: only members get the reply, and only the question is sent without consent.
 const {data:{id}}=await request(base,'/conversations',{cookie:alice.cookie,body:{userId:bob.user.id}});
 const seen=event(b,'ai:message',m=>m.conversationId===id);
 let eveGot=false;e.on('ai:message',()=>{eveGot=true;});
 await request(base,'/ai/ask',{cookie:alice.cookie,body:{conversationId:id,prompt:'what time is it?'}});
 const reply=await seen;
 assert.equal(reply.askedBy.id,alice.user.id);
 assert.match(calls.at(-1).system,/can’t see that chat/);
 assert.equal(calls.at(-1).contents.length,1);
 await request(base,'/ai/ask',{cookie:alice.cookie,body:{conversationId:id,prompt:'summarize the chat',context:[{name:'BOB',text:'meet at 5'}]}});
 assert.match(calls.at(-1).contents[0].parts[0].text,/BOB: meet at 5/);
 assert.equal((await request(base,'/ai/messages?conversationId='+id,{cookie:bob.cookie})).data.messages.length,2);
 assert.equal((await request(base,'/ai/messages?conversationId='+id,{cookie:eve.cookie})).status,404);
 assert.equal((await request(base,'/ai/ask',{cookie:eve.cookie,body:{conversationId:id,prompt:'hi'}})).status,404);
 assert.equal(eveGot,false);
 // Reminders/tasks: a reminder without a time is skipped; due reminders are announced once.
 const changed=event(a,'items:changed');
 await request(base,'/ai/ask',{cookie:alice.cookie,body:{prompt:'remind me to call mom'}});
 await changed;
 let items=(await request(base,'/items',{cookie:alice.cookie})).data.items;
 assert.deepEqual(items.map(i=>i.title).sort(),['Buy milk','Call mom']);
 assert.equal((await request(base,'/items',{cookie:bob.cookie})).data.items.length,0);
 const due=event(a,'reminder:due');
 assert.equal(app.assistant.checkReminders(),1);
 assert.equal((await due).title,'Call mom');
 assert.equal(app.assistant.checkReminders(),0);
 assert.match((await request(base,'/ai/messages',{cookie:alice.cookie})).data.messages.at(-1).body,/Reminder: Call mom/);
 // Manual items and ownership checks.
 assert.equal((await request(base,'/items',{cookie:alice.cookie,body:{kind:'reminder',title:'x'}})).status,400);
 const task=(await request(base,'/items',{cookie:alice.cookie,body:{kind:'task',title:'Write report',dueAt:null}})).data.item;
 assert.equal((await request(base,`/items/${task.id}`,{cookie:bob.cookie,method:'PATCH',body:{done:true}})).status,404);
 assert.equal((await request(base,`/items/${task.id}`,{cookie:alice.cookie,method:'PATCH',body:{done:true}})).data.item.done,true);
 assert.equal((await request(base,`/items/${task.id}`,{cookie:bob.cookie,method:'DELETE'})).status,404);
 assert.equal((await request(base,`/items/${task.id}`,{cookie:alice.cookie,method:'DELETE'})).status,200);
 // The bot can mark items done by id, but only the asker's own.
 const milk=items.find(i=>i.title==='Buy milk');
 completeId=milk.id;
 await request(base,'/ai/ask',{cookie:bob.cookie,body:{prompt:'mark it done'}});
 assert.equal((await request(base,'/items',{cookie:alice.cookie})).data.items.find(i=>i.id===milk.id).done,false);
 await request(base,'/ai/ask',{cookie:alice.cookie,body:{prompt:'mark it done'}});
 assert.equal((await request(base,'/items',{cookie:alice.cookie})).data.items.find(i=>i.id===milk.id).done,true);
 assert.equal((await request(base,'/ai/messages',{cookie:alice.cookie,method:'DELETE'})).status,200);
 assert.equal((await request(base,'/ai/messages',{cookie:alice.cookie})).data.messages.length,0);
});
test('gemini client sends the key in a header and parses JSON answers',async()=>{
 let seen;
 const generate=geminiClient({apiKey:'k123',model:'m1',fetchImpl:async(url,init)=>{seen={url,init};return new Response(JSON.stringify({candidates:[{content:{parts:[{thought:true,text:'hmm'},{text:'{"reply":"hi","actions":[]}'}]}}]}),{status:200});}});
 assert.deepEqual(await generate({system:'s',contents:[{role:'user',parts:[{text:'q'}]}]}),{reply:'hi',actions:[]});
 assert.match(seen.url,/models\/m1:generateContent$/);
 assert.equal(seen.init.headers['x-goog-api-key'],'k123');
 assert.ok(!seen.url.includes('k123'));
 const failing=geminiClient({apiKey:'k',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'quota'}}),{status:429})});
 await assert.rejects(failing({system:'',contents:[]}),/quota/);
 assert.equal(geminiClient({apiKey:''}),null);
});
test('groq client uses a bearer key, JSON mode, and falls back when JSON fails',async()=>{
 const {groqClient}=await import('../src/assistant.js');
 const seen=[];
 const ok=groqClient({apiKey:'gsk_1',fetchImpl:async(url,init)=>{seen.push({url,init,body:JSON.parse(init.body)});return new Response(JSON.stringify({choices:[{message:{content:'{"reply":"hi","actions":[{"type":"task","title":"x","dueAt":""}]}'}}]}),{status:200});}});
 assert.equal(ok.provider,'Groq');
 const answer=await ok({system:'s',contents:[{role:'user',parts:[{text:'q'}]},{role:'model',parts:[{text:'a'}]}]});
 assert.equal(answer.reply,'hi');assert.equal(answer.actions.length,1);
 assert.match(seen[0].url,/api\.groq\.com\/openai\/v1\/chat\/completions$/);
 assert.equal(seen[0].init.headers.Authorization,'Bearer gsk_1');
 assert.equal(seen[0].body.model,'openai/gpt-oss-120b');
 assert.deepEqual(seen[0].body.messages.map(m=>m.role),['system','user','assistant']);
 assert.equal(seen[0].body.response_format.type,'json_object');
 let calls=0;
 const retry=groqClient({apiKey:'k',model:'m',fetchImpl:async(_u,init)=>{calls++;const body=JSON.parse(init.body);return body.response_format?new Response(JSON.stringify({error:{code:'json_validate_failed',message:'Failed to generate JSON'}}),{status:400}):new Response(JSON.stringify({choices:[{message:{content:'Sure! {"reply":"plain","actions":[]}'}}]}),{status:200});}});
 assert.equal((await retry({system:'',contents:[{role:'user',parts:[{text:'q'}]}]})).reply,'plain');
 assert.equal(calls,2);
 const bad=groqClient({apiKey:'k',fetchImpl:async()=>new Response(JSON.stringify({error:{message:'Invalid API Key'}}),{status:401})});
 await assert.rejects(bad({system:'',contents:[]}),/GROQ_API_KEY/);
});
