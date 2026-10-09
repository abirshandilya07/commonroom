import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {io as client} from 'socket.io-client';
import {createApplication} from '../src/app.js';
const origin='http://localhost:5173';
const event=(socket,name)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timeout: ${name}`)),4000);socket.once(name,value=>{clearTimeout(timer);resolve(value);});});
async function request(base,path,{cookie,body,method=body?'POST':'GET'}={}){
 const response=await fetch(`${base}/api${path}`,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('friend requests, accepting, presence and blocking',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-friends-'));
 const app=createApplication({databasePath:join(dir,'test.sqlite'),origins:[origin]});
 await new Promise(r=>app.http.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.http.address().port}`;
 const sockets=[];t.after(async()=>{sockets.forEach(s=>s.disconnect());await app.close();rmSync(dir,{recursive:true,force:true});});
 const account=async username=>{const r=await request(base,'/auth/register',{body:{username,name:username.toUpperCase(),password:'test-password-123'}});return {cookie:r.cookie,user:r.data.user};};
 const connect=async cookie=>{const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},autoConnect:false,reconnection:false});sockets.push(s);const ready=event(s,'connect');s.connect();await ready;return s;};
 const alice=await account('alice'),bob=await account('bob'),carol=await account('carol');
 const a=await connect(alice.cookie);
 // No shared conversation is needed to send a request.
 assert.equal((await request(base,'/friends/requests',{cookie:alice.cookie,body:{userId:alice.user.id}})).status,400);
 assert.equal((await request(base,'/friends/requests',{cookie:alice.cookie,body:{userId:bob.user.id}})).status,201);
 assert.equal((await request(base,'/friends/requests',{cookie:alice.cookie,body:{userId:bob.user.id}})).status,409);
 let bobs=(await request(base,'/friends',{cookie:bob.cookie})).data;
 assert.deepEqual(bobs.incoming.map(u=>u.id),[alice.user.id]);assert.equal(bobs.friends.length,0);
 assert.equal((await request(base,'/friends',{cookie:alice.cookie})).data.outgoing[0].id,bob.user.id);
 assert.equal((await request(base,`/users/${alice.user.id}`,{cookie:bob.cookie})).data.profile.friendship,'incoming');
 // Only the person asked can accept.
 assert.equal((await request(base,`/friends/requests/${bob.user.id}/accept`,{cookie:alice.cookie,body:{}})).status,404);
 const told=event(a,'friends:changed');
 assert.equal((await request(base,`/friends/requests/${alice.user.id}/accept`,{cookie:bob.cookie,body:{}})).status,200);
 await told;
 // Friends see each other's presence and status, online first.
 const online=event(a,'presence:change');
 const b=await connect(bob.cookie);
 assert.deepEqual(await online,{userId:bob.user.id,status:'online'});
 let alices=(await request(base,'/friends',{cookie:alice.cookie})).data;
 assert.deepEqual(alices.friends.map(f=>[f.id,f.status]),[[bob.user.id,'online']]);
 await request(base,'/me/status',{cookie:bob.cookie,method:'PUT',body:{status:'dnd'}});
 assert.equal((await request(base,'/friends',{cookie:alice.cookie})).data.friends[0].status,'dnd');
 await request(base,'/me/status',{cookie:bob.cookie,method:'PUT',body:{status:'invisible'}});
 assert.equal((await request(base,'/friends',{cookie:alice.cookie})).data.friends[0].status,'offline');
 // A request back to someone who already asked you accepts it; declining and cancelling clear it.
 await request(base,'/friends/requests',{cookie:carol.cookie,body:{userId:alice.user.id}});
 assert.equal((await request(base,'/friends/requests',{cookie:alice.cookie,body:{userId:carol.user.id}})).data.friendship,'friends');
 assert.equal((await request(base,`/friends/${carol.user.id}`,{cookie:alice.cookie,method:'DELETE'})).status,200);
 await request(base,'/friends/requests',{cookie:carol.cookie,body:{userId:bob.user.id}});
 assert.equal((await request(base,`/friends/requests/${carol.user.id}`,{cookie:bob.cookie,method:'DELETE'})).status,200);
 assert.equal((await request(base,'/friends',{cookie:carol.cookie})).data.outgoing.length,0);
 // Blocking ends the friendship, and blocked people can't send requests either way.
 await request(base,`/blocks/${bob.user.id}`,{cookie:alice.cookie,method:'PUT',body:{}});
 assert.equal((await request(base,'/friends',{cookie:alice.cookie})).data.friends.length,0);
 assert.equal((await request(base,'/friends/requests',{cookie:bob.cookie,body:{userId:alice.user.id}})).status,403);
 assert.equal((await request(base,'/friends/requests',{cookie:alice.cookie,body:{userId:bob.user.id}})).status,403);
 b.disconnect();
});
