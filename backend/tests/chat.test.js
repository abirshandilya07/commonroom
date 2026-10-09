import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {io as client} from 'socket.io-client';
import {createApplication} from '../src/app.js';
import {saveMessage,membersFor} from '../src/chat.js';
import {createIdentity,unlockIdentity,encryptMessage,decryptMessage,unb64,b64} from '../../shared/crypto.js';
const origin='http://localhost:5173';
const event=(socket,name)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Timeout: ${name}`)),4000);socket.once(name,value=>{clearTimeout(timer);resolve(value);});});
async function listen(app){await new Promise(resolve=>app.http.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${app.http.address().port}`;}
async function request(base,path,{cookie,body,method=body?'POST':'GET',requestOrigin=origin}={}){
 const response=await fetch(`${base}/api${path}`,{method,headers:{Origin:requestOrigin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
test('encrypted direct/group messaging, unread state, and authorization',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-v3-')),databasePath=join(dir,'test.sqlite');
 let app=createApplication({databasePath,origins:[origin]}),base=await listen(app);
 const sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await app.close();rmSync(dir,{recursive:true,force:true});});
 async function account(username){const result=await request(base,'/auth/register',{body:{username,name:username.toUpperCase(),password:'test-password-123'}});assert.equal(result.status,201);const keys=await createIdentity(result.data.user.id);assert.equal((await request(base,'/identity',{cookie:result.cookie,body:keys.record})).status,201);return {...result,keys,user:result.data.user};}
 async function connect(cookie){const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,...(cookie?{Cookie:cookie}:{})},autoConnect:false,reconnection:false});sockets.push(s);const ready=event(s,'connect');s.connect();await ready;return s;}
 const alice=await account('alice'),bob=await account('bob'),charlie=await account('charlie'),eve=await account('eve');
 const a=await connect(alice.cookie),b=await connect(bob.cookie),c=await connect(charlie.cookie),e=await connect(eve.cookie);
 let direct,group,first;
 async function envelope(owner,id,body='private text'){return {conversationId:id,clientId:randomUUID(),encrypted:null,...await (async()=>{const clientId=randomUUID();return {clientId,encrypted:await encryptMessage(owner.keys.unlocked,id,clientId,body,membersFor(app.db,id))};})()};}
 await t.test('auth sessions, invalid login, duplicate users, and cross-origin rejection',async()=>{
  assert.equal((await request(base,'/auth/me')).status,401);
  assert.equal((await request(base,'/auth/me',{cookie:alice.cookie})).data.user.id,alice.user.id);
  assert.equal((await request(base,'/auth/login',{body:{username:'alice',password:'wrong-password'}})).status,401);
  assert.equal((await request(base,'/auth/register',{body:{username:'alice',name:'Copy',password:'test-password-123'}})).status,409);
  assert.equal((await request(base,'/auth/login',{body:{username:'alice',password:'test-password-123'},requestOrigin:'https://evil.example'})).status,403);
  assert.equal((await request(base,'/auth/login',{body:{username:'alice',password:'test-password-123'}})).status,200);
 });
 await t.test('anonymous sockets and private key material are rejected; identity is immutable',async()=>{
  const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin},autoConnect:false,reconnection:false});sockets.push(s);const rejected=event(s,'connect_error');s.connect();assert.equal((await rejected).message,'Please sign in again.');
  assert.equal((await request(base,'/identity',{cookie:alice.cookie,body:alice.keys.record})).status,409);
  const invalid=structuredClone(alice.keys.record);invalid.encryptionKey.d='private';assert.equal((await request(base,'/identity',{cookie:alice.cookie,body:invalid})).status,400);
  const own=await request(base,'/identity',{cookie:bob.cookie});assert.equal(own.data.identity.encryptionKey.n,bob.keys.record.encryptionKey.n);
  assert.equal(JSON.stringify(app.db.prepare('SELECT * FROM identities').all()).includes(alice.keys.recoveryKey),false);
 });
 await t.test('direct pair uniqueness and private membership',async()=>{
  direct=(await request(base,'/conversations',{cookie:alice.cookie,body:{userId:bob.user.id}})).data.id;assert.ok(direct);
  assert.equal((await request(base,'/conversations',{cookie:bob.cookie,body:{userId:alice.user.id}})).data.id,direct);
  assert.equal((await request(base,`/conversations/${direct}/messages`,{cookie:eve.cookie})).status,404);
 });
 await t.test('group creation validates membership and keeps unrelated groups separate',async()=>{
  const result=await request(base,'/groups',{cookie:alice.cookie,body:{title:'Hackathon team',memberIds:[bob.user.id,charlie.user.id]}});assert.equal(result.status,201);group=result.data.id;
  const second=await request(base,'/groups',{cookie:alice.cookie,body:{title:'Another group',memberIds:[bob.user.id,charlie.user.id]}});assert.notEqual(second.data.id,group);
  assert.equal((await request(base,'/groups',{cookie:alice.cookie,body:{title:'Bad',memberIds:[bob.user.id,bob.user.id]}})).status,400);
  assert.equal((await request(base,'/groups',{cookie:alice.cookie,body:{title:'Bad',memberIds:[bob.user.id,randomUUID()]}})).status,409);
  assert.equal((await request(base,'/conversations',{cookie:eve.cookie})).data.conversations.length,0);
 });
 await t.test('encrypted DM delivery and idempotent acknowledgement retry',async()=>{
  const input=await envelope(alice,direct,'Hello Bob — encrypted on my device.');
  const received=event(b,'message:new');const ack=await a.timeout(4000).emitWithAck('message:send',input);assert.equal(ack.ok,true);first=await received;
  assert.equal(first.body,undefined);assert.equal(first.senderId,alice.user.id);
  assert.equal(await decryptMessage(bob.keys.unlocked,first,alice.keys.record),'Hello Bob — encrypted on my device.');
  assert.equal((await a.timeout(4000).emitWithAck('message:send',input)).message.id,first.id);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM messages').get().n,1);
  const stored=JSON.stringify(app.db.prepare('SELECT * FROM messages').all());assert.equal(stored.includes('Hello Bob'),false);
 });
 await t.test('all group members decrypt; outsider cannot receive or decrypt',async()=>{
  const input=await envelope(alice,group,'Team-only plan: meet at 5.');let outsider=0;e.on('message:new',()=>outsider++);
  const rb=event(b,'message:new'),rc=event(c,'message:new');assert.equal((await a.timeout(4000).emitWithAck('message:send',input)).ok,true);
  const mb=await rb,mc=await rc;
  assert.equal(await decryptMessage(bob.keys.unlocked,mb,alice.keys.record),'Team-only plan: meet at 5.');
  assert.equal(await decryptMessage(charlie.keys.unlocked,mc,alice.keys.record),'Team-only plan: meet at 5.');
  assert.equal(await decryptMessage(alice.keys.unlocked,mc,alice.keys.record),'Team-only plan: meet at 5.');
  await assert.rejects(decryptMessage(eve.keys.unlocked,mc,alice.keys.record));
  assert.equal((await e.timeout(4000).emitWithAck('message:send',input)).ok,false);assert.equal(outsider,0);
  assert.equal((await request(base,`/conversations/${group}/messages`,{cookie:eve.cookie})).status,404);
 });
 await t.test('plaintext, missing recipients, sender spoofing, and tampering are rejected',async()=>{
  assert.equal((await a.timeout(4000).emitWithAck('message:send',{conversationId:direct,clientId:randomUUID(),body:'plaintext'})).ok,false);
  const good=await envelope(alice,group);const missing=structuredClone(good);missing.encrypted.recipients.pop();assert.equal((await a.timeout(4000).emitWithAck('message:send',missing)).ok,false);
  const tampered=structuredClone(good);const bytes=unb64(tampered.encrypted.ciphertext);bytes[0]^=1;tampered.encrypted.ciphertext=b64(bytes);assert.equal((await a.timeout(4000).emitWithAck('message:send',tampered)).ok,false);
  const forged=structuredClone(good);forged.encrypted.senderId=bob.user.id;assert.equal((await a.timeout(4000).emitWithAck('message:send',forged)).ok,false);
  await assert.rejects(decryptMessage(bob.keys.unlocked,{...first,encrypted:tampered.encrypted},alice.keys.record));
 });
 await t.test('persistent unread cursors are scoped, monotonic, and isolated between members',async()=>{
  const list=await request(base,'/conversations',{cookie:bob.cookie});assert.equal(list.data.conversations.find(c=>c.id===direct).unreadCount,1);
  assert.equal((await request(base,`/conversations/${direct}/read`,{cookie:bob.cookie,body:{messageId:first.id}})).status,200);
  assert.equal((await request(base,'/conversations',{cookie:bob.cookie})).data.conversations.find(c=>c.id===direct).unreadCount,0);
  assert.equal((await request(base,`/conversations/${group}/read`,{cookie:bob.cookie,body:{messageId:first.id}})).status,400);
  assert.equal((await request(base,`/conversations/${group}/read`,{cookie:eve.cookie,body:{messageId:first.id}})).status,404);
  assert.equal((await request(base,'/conversations',{cookie:charlie.cookie})).data.conversations.find(c=>c.id===group).unreadCount,1);
 });
 await t.test('group typing reaches members with correct author',async()=>{
  const rb=event(b,'typing:update'),rc=event(c,'typing:update');a.emit('typing:set',{conversationId:group,typing:true});assert.equal((await rb).userId,alice.user.id);assert.equal((await rc).name,'ALICE');
 });
 await t.test('stopping typing is delivered immediately, even right after starting',async()=>{
  const updates=[];const listener=u=>updates.push(u);b.on('typing:update',listener);
  a.emit('typing:set',{conversationId:direct,typing:true});a.emit('typing:set',{conversationId:direct,typing:false});
  const deadline=Date.now()+2000;while(!updates.some(u=>u.typing===false)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
  b.off('typing:update',listener);assert.ok(updates.some(u=>u.conversationId===direct&&u.typing===false));
 });
 await t.test('read updates carry the conversation and its remaining unread count',async()=>{
  const latest=(await request(base,`/conversations/${group}/messages`,{cookie:charlie.cookie})).data.messages.at(-1);
  const changed=event(c,'read:changed');assert.equal((await request(base,`/conversations/${group}/read`,{cookie:charlie.cookie,body:{messageId:latest.id}})).status,200);
  assert.deepEqual(await changed,{conversationId:group,unreadCount:0});
 });
 await t.test('presence is shared only with people who have a conversation together',async()=>{
  let eveSaw=0;const listener=()=>eveSaw++;e.on('presence:change',listener);
  const offline=event(b,'presence:change');c.disconnect();assert.deepEqual(await offline,{userId:charlie.user.id,status:'offline'});
  const back=event(b,'presence:change');const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:charlie.cookie},autoConnect:false,reconnection:false});sockets.push(s);
  const list=event(s,'presence:update');s.connect();assert.deepEqual(await back,{userId:charlie.user.id,status:'online'});
  assert.deepEqual((await list).map(p=>p.id).sort(),[alice.user.id,bob.user.id].sort());
  await new Promise(r=>setTimeout(r,100));e.off('presence:change',listener);assert.equal(eveSaw,0);
 });
 await t.test('offline history pagination and new-browser recovery',async()=>{
  b.disconnect();for(let i=0;i<51;i++)saveMessage(app.db,alice.user.id,await envelope(alice,direct,`Encrypted history ${i}`));
  const fresh=await unlockIdentity(bob.user.id,bob.keys.record,bob.keys.recoveryKey);
  const latest=await request(base,`/conversations/${direct}/messages`,{cookie:bob.cookie});assert.equal(latest.data.messages.length,50);assert.equal(latest.data.hasMore,true);
  assert.equal(await decryptMessage(fresh,latest.data.messages.at(-1),alice.keys.record),'Encrypted history 50');
  const older=await request(base,`/conversations/${direct}/messages?before=${latest.data.messages[0].id}`,{cookie:bob.cookie});assert.equal(older.data.messages.length,2);
  await assert.rejects(unlockIdentity(bob.user.id,bob.keys.record,alice.keys.recoveryKey));
  await connect(bob.cookie);
 });
 await t.test('logout revokes live socket and restart preserves identities, unread state, and ciphertext',async()=>{
  const disconnected=event(a,'disconnect');assert.equal((await request(base,'/auth/logout',{cookie:alice.cookie,body:{}})).status,200);await disconnected;
  assert.equal((await request(base,'/auth/me',{cookie:alice.cookie})).status,401);
  sockets.forEach(s=>s.disconnect());await app.close();app=createApplication({databasePath,origins:[origin]});base=await listen(app);
  const list=await request(base,'/conversations',{cookie:bob.cookie});assert.equal(list.data.conversations.find(c=>c.id===direct).unreadCount,51);
  assert.equal((await request(base,'/identity',{cookie:bob.cookie})).data.identity.encryptionKey.n,bob.keys.record.encryptionKey.n);
 });
});
test('legacy database migrates with a consistent backup and readable labelled history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-migration-')),path=join(dir,'old.sqlite');
 const db=new DatabaseSync(path),a=randomUUID(),b=randomUUID(),cid=randomUUID();const pair=[a,b].sort();
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE conversations(id TEXT PRIMARY KEY,user_a TEXT NOT NULL REFERENCES users(id),user_b TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL,CHECK(user_a<user_b),UNIQUE(user_a,user_b));
 CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,conversation_id TEXT NOT NULL REFERENCES conversations(id),sender_id TEXT NOT NULL REFERENCES users(id),client_id TEXT NOT NULL,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),created_at TEXT NOT NULL,UNIQUE(sender_id,client_id));`);
 for(const id of pair)db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(id,id,id,'old-hash',new Date().toISOString());
 db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(cid,...pair,new Date().toISOString());db.prepare('INSERT INTO messages(conversation_id,sender_id,client_id,body,created_at) VALUES(?,?,?,?,?)').run(cid,a,randomUUID(),'Original plaintext history',new Date().toISOString());db.close();
 const app=createApplication({databasePath:path});
 assert.equal(app.db.prepare('SELECT body FROM messages').get().body,'Original plaintext history');assert.equal(app.db.prepare('SELECT count(*) AS n FROM conversation_members').get().n,2);assert.equal(app.db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(readdirSync(dir).filter(n=>n.includes('pre-v3')).length,1);
 await app.close();rmSync(dir,{recursive:true,force:true});
});

test('256-member boundary, encrypted transport, directory pagination and overflow rejection', async t => {
 const {MAX_GROUP_MEMBERS, MAX_ENCRYPTED_PACKET_BYTES} = await import('../../shared/limits.js');
 const app=createApplication({databasePath:':memory:',origins:[origin]}),base=await listen(app);
 let socket;
 t.after(async()=>{socket?.disconnect();await app.close();});
 const registered=await request(base,'/auth/register',{body:{username:'capacity_owner',name:'Owner',password:'capacity-test-password'}});
 const ownerId=registered.data.user.id,owner=await createIdentity(ownerId);
 assert.equal((await request(base,'/identity',{cookie:registered.cookie,body:owner.record})).status,201);
 // Reuse a test recipient key pair for speed. The earlier group test covers
 // independently generated recipient keys; this one checks packet capacity.
 const recipient=await createIdentity(randomUUID()),ids=[];
 for(let i=0;i<MAX_GROUP_MEMBERS;i++){
  const id=randomUUID();ids.push(id);
  app.db.prepare('INSERT INTO users(id,name,username,password_hash,created_at) VALUES(?,?,?,?,?)').run(id,`Member ${String(i).padStart(3,'0')}`,`member_${i}`,'test-fixture',new Date().toISOString());
  app.db.prepare('INSERT INTO identities VALUES(?,?,?,?)').run(id,JSON.stringify({encryptionKey:recipient.record.encryptionKey,signingKey:recipient.record.signingKey}),JSON.stringify(recipient.record.vault),new Date().toISOString());
 }
 const result=await request(base,'/groups',{cookie:registered.cookie,body:{title:'Campus cohort',memberIds:ids.slice(0,MAX_GROUP_MEMBERS-1)}});
 assert.equal(result.status,201);
 assert.equal(membersFor(app.db,result.data.id).length,256);
 assert.equal((await request(base,'/groups',{cookie:registered.cookie,body:{title:'Too large',memberIds:ids}})).status,400);
 const first=await request(base,'/users',{cookie:registered.cookie}),second=await request(base,'/users?offset=50',{cookie:registered.cookie});
 assert.equal(first.data.users.length,50);assert.equal(first.data.hasMore,true);
 assert.equal(new Set([...first.data.users,...second.data.users].map(u=>u.id)).size,100);
 assert.equal((await request(base,'/users?offset=250',{cookie:registered.cookie})).data.hasMore,false);
 assert.equal((await request(base,'/users?offset=-1',{cookie:registered.cookie})).status,400);
 const conversationId=result.data.id,clientId=randomUUID(),body='界'.repeat(2000);
 const encrypted=await encryptMessage(owner.unlocked,conversationId,clientId,body,membersFor(app.db,conversationId));
 const input={conversationId,clientId,encrypted};
 const bytes=Buffer.byteLength(JSON.stringify(input));assert.ok(bytes>65536);assert.ok(bytes<MAX_ENCRYPTED_PACKET_BYTES);
 socket=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:registered.cookie},autoConnect:false,reconnection:false});
 const connected=event(socket,'connect');socket.connect();await connected;
 const ack=await socket.timeout(8000).emitWithAck('message:send',input);assert.equal(ack.ok,true);
 const lastRecipient={...recipient.unlocked,userId:ids[MAX_GROUP_MEMBERS-2]};
 assert.equal(await decryptMessage(lastRecipient,ack.message,owner.record),body);
 assert.equal(await decryptMessage(owner.unlocked,ack.message,owner.record),body);
 assert.equal(app.db.prepare('SELECT body FROM messages WHERE id=?').get(ack.message.id).body,'[Encrypted message]');
 const oversized=structuredClone(input);oversized.encrypted.recipients.push({userId:ids.at(-1),key:encrypted.recipients[0].key});
 assert.equal((await socket.timeout(4000).emitWithAck('message:send',oversized)).ok,false);
});

test('rate limits are per signed-in session, so people sharing one network are not throttled together',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-limit-')),app=createApplication({databasePath:join(dir,'test.sqlite'),origins:[origin]}),base=await listen(app);
 t.after(async()=>{await app.close();rmSync(dir,{recursive:true,force:true});});
 const one=await request(base,'/auth/register',{body:{username:'busy_user',name:'Busy',password:'test-password-123'}});
 const two=await request(base,'/auth/register',{body:{username:'quiet_user',name:'Quiet',password:'test-password-123'}});
 let status=200;for(let i=0;i<240&&status===200;i++)status=(await request(base,'/auth/me',{cookie:one.cookie})).status;
 assert.equal((await request(base,'/auth/me',{cookie:one.cookie})).status,429);
 assert.equal((await request(base,'/auth/me',{cookie:two.cookie})).status,200);
});

test('profiles, status, private notes, reactions, edits, deletes and encrypted attachments',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-v4-')),app=createApplication({databasePath:join(dir,'test.sqlite'),origins:[origin]}),base=await listen(app);
 const sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await app.close();rmSync(dir,{recursive:true,force:true});});
 async function account(username){const result=await request(base,'/auth/register',{body:{username,name:username.toUpperCase(),password:'test-password-123'}});const keys=await createIdentity(result.data.user.id);await request(base,'/identity',{cookie:result.cookie,body:keys.record});return {...result,keys,user:result.data.user};}
 async function connect(cookie){const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},autoConnect:false,reconnection:false});sockets.push(s);const ready=event(s,'connect');s.connect();await ready;return s;}
 const alice=await account('alice'),bob=await account('bob'),eve=await account('eve');
 const a=await connect(alice.cookie),b=await connect(bob.cookie),e=await connect(eve.cookie);
 const direct=(await request(base,'/conversations',{cookie:alice.cookie,body:{userId:bob.user.id}})).data.id;
 const send=async(owner,socket,body,extra={})=>{const clientId=randomUUID();return socket.timeout(4000).emitWithAck('message:send',{conversationId:direct,clientId,encrypted:await encryptMessage(owner.keys.unlocked,direct,clientId,body,membersFor(app.db,direct)),...extra});};

 // Profile, name change, join date and private notes.
 assert.ok(alice.data.user.joinedAt);assert.equal(alice.data.user.status,'online');
 assert.equal((await request(base,'/me',{cookie:alice.cookie,method:'PATCH',body:{name:'Alice Cooper'}})).data.user.name,'Alice Cooper');
 assert.equal((await request(base,`/notes/${bob.user.id}`,{cookie:alice.cookie,method:'PUT',body:{body:'Owes me notes from lab 3'}})).status,200);
 const seenByAlice=(await request(base,`/users/${bob.user.id}`,{cookie:alice.cookie})).data.profile;
 assert.equal(seenByAlice.note,'Owes me notes from lab 3');assert.ok(seenByAlice.joinedAt);assert.equal(seenByAlice.username,'bob');
 assert.equal((await request(base,`/users/${bob.user.id}`,{cookie:eve.cookie})).data.profile.note,'');
 assert.equal((await request(base,`/users/${alice.user.id}`,{cookie:bob.cookie})).data.profile.name,'Alice Cooper');

 // Profile picture upload is served only to signed-in users.
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5b1d1d20000000049454e44ae426082','hex');
 const upload=await fetch(`${base}/api/me/avatar`,{method:'PUT',headers:{Origin:origin,Cookie:alice.cookie,'Content-Type':'image/png'},body:png});
 const avatarUrl=(await upload.json()).user.avatarUrl;assert.ok(avatarUrl);
 assert.equal((await fetch(`${base}${avatarUrl}`,{headers:{Cookie:bob.cookie}})).status,200);
 assert.equal((await fetch(`${base}${avatarUrl}`)).status,401);
 assert.equal((await request(base,'/conversations',{cookie:bob.cookie})).data.conversations[0].peer.avatarUrl,avatarUrl);

 // Status: Do not disturb is visible to contacts; invisible looks offline.
 let change=event(b,'presence:change');await request(base,'/me/status',{cookie:alice.cookie,method:'PUT',body:{status:'dnd'}});
 assert.deepEqual(await change,{userId:alice.user.id,status:'dnd'});
 change=event(b,'presence:change');await request(base,'/me/status',{cookie:alice.cookie,method:'PUT',body:{status:'invisible'}});
 assert.deepEqual(await change,{userId:alice.user.id,status:'offline'});
 assert.equal((await request(base,'/me/status',{cookie:alice.cookie,method:'PUT',body:{status:'away'}})).status,400);
 await request(base,'/me/status',{cookie:alice.cookie,method:'PUT',body:{status:'online'}});

 // Reactions toggle and reach members only.
 const first=(await send(alice,a,'React to me')).message;
 let reacted=event(a,'reactions:changed');assert.equal((await b.timeout(4000).emitWithAck('reaction:toggle',{messageId:first.id,emoji:'👍'})).ok,true);
 assert.deepEqual((await reacted).reactions,[{emoji:'👍',userIds:[bob.user.id]}]);
 assert.equal((await e.timeout(4000).emitWithAck('reaction:toggle',{messageId:first.id,emoji:'👍'})).ok,false);
 assert.equal((await b.timeout(4000).emitWithAck('reaction:toggle',{messageId:first.id,emoji:'<script>'})).ok,false);
 assert.deepEqual((await request(base,`/conversations/${direct}/messages`,{cookie:alice.cookie})).data.messages[0].reactions,[{emoji:'👍',userIds:[bob.user.id]}]);
 reacted=event(a,'reactions:changed');await b.timeout(4000).emitWithAck('reaction:toggle',{messageId:first.id,emoji:'👍'});assert.deepEqual((await reacted).reactions,[]);

 // Edits are signed by the sender, keep the message id, and only the sender may edit.
 const edited=await encryptMessage(alice.keys.unlocked,direct,first.clientId,'React to me (edited)',membersFor(app.db,direct));
 const updated=event(b,'message:updated');assert.equal((await a.timeout(4000).emitWithAck('message:edit',{messageId:first.id,encrypted:edited})).ok,true);
 const wire=await updated;assert.ok(wire.editedAt);assert.equal(await decryptMessage(bob.keys.unlocked,wire,alice.keys.record),'React to me (edited)');
 const forged=await encryptMessage(bob.keys.unlocked,direct,first.clientId,'Hijacked',membersFor(app.db,direct));
 assert.equal((await b.timeout(4000).emitWithAck('message:edit',{messageId:first.id,encrypted:forged})).ok,false);

 // Attachments: members upload/download opaque bytes; outsiders cannot.
 const blob=Buffer.from('opaque-encrypted-bytes-for-test');
 const up=await fetch(`${base}/api/conversations/${direct}/attachments`,{method:'POST',headers:{Origin:origin,Cookie:alice.cookie,'Content-Type':'application/octet-stream'},body:blob});
 assert.equal(up.status,201);const attachmentId=(await up.json()).id;
 assert.equal((await fetch(`${base}/api/conversations/${direct}/attachments`,{method:'POST',headers:{Origin:origin,Cookie:eve.cookie,'Content-Type':'application/octet-stream'},body:blob})).status,404);
 const withFile=(await send(alice,a,'{"v":2,"text":"photo"}',{attachmentId})).message;assert.ok(withFile);
 assert.equal((await send(alice,a,'reuse',{attachmentId})).ok,false);
 assert.deepEqual(Buffer.from(await (await fetch(`${base}/api/attachments/${attachmentId}`,{headers:{Cookie:bob.cookie}})).arrayBuffer()),blob);
 assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`,{headers:{Cookie:eve.cookie}})).status,404);

 // Deletes are sender-only, remove ciphertext and the attachment.
 assert.equal((await b.timeout(4000).emitWithAck('message:delete',{messageId:withFile.id})).ok,false);
 const removed=event(b,'message:updated');assert.equal((await a.timeout(4000).emitWithAck('message:delete',{messageId:withFile.id})).ok,true);
 assert.equal((await removed).deleted,true);
 assert.equal(app.db.prepare('SELECT encrypted_payload FROM messages WHERE id=?').get(withFile.id).encrypted_payload,null);
 assert.equal((await fetch(`${base}/api/attachments/${attachmentId}`,{headers:{Cookie:bob.cookie}})).status,404);
});

test('group creators add and remove members; new members cannot read earlier messages',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'commonroom-members-')),app=createApplication({databasePath:join(dir,'test.sqlite'),origins:[origin]}),base=await listen(app);
 const sockets=[];
 t.after(async()=>{sockets.forEach(s=>s.disconnect());await app.close();rmSync(dir,{recursive:true,force:true});});
 async function account(username){const result=await request(base,'/auth/register',{body:{username,name:username,password:'test-password-123'}});const keys=await createIdentity(result.data.user.id);await request(base,'/identity',{cookie:result.cookie,body:keys.record});return {...result,keys,user:result.data.user};}
 async function connect(cookie){const s=client(base,{transports:['websocket'],extraHeaders:{Origin:origin,Cookie:cookie},autoConnect:false,reconnection:false});sockets.push(s);const ready=event(s,'connect');s.connect();await ready;return s;}
 const [alice,bob,carol,dave]=await Promise.all(['alice','bob','carol','dave'].map(account));
 const a=await connect(alice.cookie),d=await connect(dave.cookie);
 const group=(await request(base,'/groups',{cookie:alice.cookie,body:{title:'Study group',memberIds:[bob.user.id,carol.user.id]}})).data.id;
 const send=async(owner,socket,body)=>{const clientId=randomUUID();return socket.timeout(4000).emitWithAck('message:send',{conversationId:group,clientId,encrypted:await encryptMessage(owner.keys.unlocked,group,clientId,body,membersFor(app.db,group))});};
 const before=(await send(alice,a,'Before Dave joined')).message;
 assert.equal((await request(base,`/groups/${group}/members`,{cookie:bob.cookie,body:{memberIds:[dave.user.id]}})).status,403);
 const changed=event(d,'conversation:changed');
 assert.equal((await request(base,`/groups/${group}/members`,{cookie:alice.cookie,body:{memberIds:[dave.user.id]}})).status,201);await changed;
 const history=(await request(base,`/conversations/${group}/messages`,{cookie:dave.cookie})).data.messages;
 await assert.rejects(decryptMessage(dave.keys.unlocked,history.find(m=>m.id===before.id),alice.keys.record));
 assert.equal((await request(base,'/conversations',{cookie:dave.cookie})).data.conversations[0].unreadCount,0);
 const after=(await send(alice,a,'Welcome Dave')).message;
 assert.equal(await decryptMessage(dave.keys.unlocked,after,alice.keys.record),'Welcome Dave');
 const staleId=randomUUID(),stale=await encryptMessage(alice.keys.unlocked,group,staleId,'prepared earlier',membersFor(app.db,group));
 // Removal: only the creator removes others; anyone can leave.
 assert.equal((await request(base,`/groups/${group}/members/${carol.user.id}`,{cookie:bob.cookie,method:'DELETE'})).status,403);
 assert.equal((await request(base,`/groups/${group}/members/${carol.user.id}`,{cookie:alice.cookie,method:'DELETE'})).status,200);
 assert.equal((await request(base,`/conversations/${group}/messages`,{cookie:carol.cookie})).status,404);
 assert.equal((await request(base,`/groups/${group}/members/${bob.user.id}`,{cookie:bob.cookie,method:'DELETE'})).status,200);
 // Creator leaving hands the group to the next member.
 assert.equal((await request(base,`/groups/${group}/members/${alice.user.id}`,{cookie:alice.cookie,method:'DELETE'})).status,200);
 assert.equal((await request(base,'/conversations',{cookie:dave.cookie})).data.conversations[0].createdBy,dave.user.id);
 assert.equal((await a.timeout(4000).emitWithAck('message:send',{conversationId:group,clientId:staleId,encrypted:stale})).ok,false);
});
