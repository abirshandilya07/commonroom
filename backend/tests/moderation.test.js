import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io as client} from 'socket.io-client';
import {createApplication} from '../src/app.js';
import {membersFor} from '../src/chat.js';
import {createIdentity,encryptMessage} from '../../shared/crypto.js';
const origin='http://localhost:5173';
const event=(socket,name)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timeout: ${name}`)),4000);socket.once(name,value=>{clearTimeout(timer);resolve(value);});});
async function request(base,path,{cookie,body,method=body?'POST':'GET'}={}){
 const response=await fetch(`${base}/api${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('blocking, reporting and group moderation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-mod-'));
 const app=createApplication({databasePath:join(dir,'test.sqlite'),origins:[origin]});
 await new Promise(r=>app.http.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.http.address().port}`;
 const sockets=[];t.after(async()=>{sockets.forEach(s=>s.disconnect());await app.close();rmSync(dir,{recursive:true,force:true});});
 const account=async username=>{const r=await request(base,'/auth/register',{body:{username,name:username.toUpperCase(),password:'test-password-123'}});const keys=await createIdentity(r.data.user.id);await request(base,'/identity',{cookie:r.cookie,body:keys.record});return {cookie:r.cookie,user:r.data.user,keys};};
 const connect=async cookie=>{const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},autoConnect:false,reconnection:false});sockets.push(s);const ready=event(s,'connect');s.connect();await ready;return s;};
 const send=async(owner,socket,id,body='hello')=>{const clientId=randomUUID();const encrypted=await encryptMessage(owner.keys.unlocked,id,clientId,body,membersFor(app.db,id));return new Promise(r=>socket.emit('message:send',{conversationId:id,clientId,encrypted},r));};
 const alice=await account('alice'),bob=await account('bob'),carol=await account('carol');
 const a=await connect(alice.cookie),b=await connect(bob.cookie),c=await connect(carol.cookie);
 const direct=(await request(base,'/conversations',{cookie:alice.cookie,body:{userId:bob.user.id}})).data.id;
 assert.equal((await send(bob,b,direct)).ok,true);
 // Blocking stops direct messages both ways until unblocked.
 assert.deepEqual((await request(base,`/blocks/${bob.user.id}`,{cookie:alice.cookie,method:'PUT',body:{}})).data.blocked,[bob.user.id]);
 assert.match((await send(bob,b,direct)).error,/can’t message/);
 assert.match((await send(alice,a,direct)).error,/You blocked/);
 assert.equal((await request(base,`/blocks/${alice.user.id}`,{cookie:alice.cookie,method:'PUT',body:{}})).status,400);
 await request(base,`/blocks/${bob.user.id}`,{cookie:alice.cookie,method:'DELETE'});
 assert.equal((await send(bob,b,direct)).ok,true);
 // Reports in a group reach its creator, who can delete the message.
 const group=(await request(base,'/groups',{cookie:alice.cookie,body:{title:'Club',memberIds:[bob.user.id,carol.user.id]}})).data.id;
 const sent=await send(bob,b,group,'spam spam');
 assert.equal((await request(base,`/messages/${sent.message.id}/report`,{cookie:bob.cookie,body:{reason:'spam'}})).status,400);
 const notified=event(a,'reports:changed');
 assert.equal((await request(base,`/messages/${sent.message.id}/report`,{cookie:carol.cookie,body:{reason:'spam',excerpt:'spam spam'}})).status,201);
 await notified;
 assert.equal((await request(base,`/messages/${sent.message.id}/report`,{cookie:carol.cookie,body:{reason:'spam'}})).status,409);
 assert.equal((await request(base,`/conversations/${group}/reports`,{cookie:carol.cookie})).status,403);
 const reports=(await request(base,`/conversations/${group}/reports`,{cookie:alice.cookie})).data.reports;
 assert.equal(reports.length,1);assert.equal(reports[0].excerpt,'spam spam');assert.equal(reports[0].sender.id,bob.user.id);
 assert.match((await new Promise(r=>c.emit('message:delete',{messageId:sent.message.id},r))).error,/only delete your own/);
 const removed=await new Promise(r=>a.emit('message:delete',{messageId:sent.message.id},r));
 assert.equal(removed.ok,true);assert.equal(removed.message.deleted,true);
 assert.equal((await request(base,`/conversations/${group}/reports/${reports[0].id}/resolve`,{cookie:alice.cookie,body:{}})).status,200);
 assert.equal((await request(base,`/conversations/${group}/reports`,{cookie:alice.cookie})).data.reports.length,0);
});
test('GIF search proxies GIPHY results and only fetches GIPHY media',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-gif-'));
 const fetched=[];
 const gifFetch=async(url)=>{fetched.push(String(url));if(String(url).includes('api.giphy.com'))return new Response(JSON.stringify({data:[{id:'1',title:'cat',images:{fixed_width_small:{url:'https://media1.giphy.com/a.gif'},downsized:{url:'https://media1.giphy.com/b.gif'}}}]}),{status:200});return new Response(Buffer.from('GIF89a....'),{status:200,headers:{'content-type':'image/gif'}});};
 const app=createApplication({databasePath:join(dir,'t.sqlite'),origins:[origin],giphyKey:'secret-key',gifFetch});
 await new Promise(r=>app.http.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.http.address().port}`;
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const {cookie}=await request(base,'/auth/register',{body:{username:'gina',name:'Gina',password:'test-password-123'}});
 const {data}=await request(base,'/gifs/search?q=cat',{cookie});
 assert.equal(data.gifs.length,1);assert.match(data.gifs[0].full,/^\/api\/gifs\/file\?u=/);
 assert.ok(!JSON.stringify(data).includes('secret-key'));
 const file=await fetch(`${base}${data.gifs[0].full}`,{headers:{Cookie:cookie}});assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'image/gif');
 assert.equal((await request(base,`/gifs/file?u=${encodeURIComponent('https://evil.example/x.gif')}`,{cookie})).status,400);
 assert.equal((await request(base,`/gifs/file?u=${encodeURIComponent('http://127.0.0.1/x.gif')}`,{cookie})).status,400);
 assert.equal((await request(base,'/gifs/search?q=cat')).status,401);
});
