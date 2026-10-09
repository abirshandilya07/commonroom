import express from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { createServer } from 'node:http';
import { randomUUID, createPublicKey } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, rmSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Server } from 'socket.io';
import { z } from 'zod';
import { openDatabase } from './db.js';
import { hashPassword, verifyPassword, publicUser, findSession, createSession, clearSession } from './auth.js';
import { conversationFor, saveMessage, membersFor, identityInput, viewsFor, editMessage, deleteMessage, reactionsFor, avatarUrl } from './chat.js';

import { registerAssistant } from './assistant.js';
import { registerModeration } from './moderation.js';
import { registerGifs } from './gifs.js';
import {MAX_GROUP_MEMBERS, MAX_ENCRYPTED_PACKET_BYTES} from '../../shared/limits.js';

const credentials = z.object({username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/), password: z.string().min(8).max(128)});
const registration = credentials.extend({name: z.string().trim().min(2).max(40)});
const room = (id) => `user:${id}`;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const STATUSES = ['online', 'invisible', 'dnd'];


export function createApplication({databasePath = './data/commonroom.sqlite', origins = ['http://localhost:5173'], secureCookie = false, trustProxy = false, generate = null, reminderIntervalMs, giphyKey = '', gifFetch} = {}) {
  const db = openDatabase(databasePath);
  const uploads = databasePath === ':memory:' ? join(tmpdir(), `commonroom-uploads-${process.pid}`) : join(dirname(databasePath), 'uploads');
  mkdirSync(uploads, {recursive: true});
  const filePath = (id) => join(uploads, `${id}.bin`);
  const app = express();
  const http = createServer(app);
  const io = new Server(http, {
    transports: ['websocket'], maxHttpBufferSize: MAX_ENCRYPTED_PACKET_BYTES,
    allowRequest: (req, done) => done(null, origins.includes(req.headers.origin)),
  });
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', 1);
  app.use(helmet({contentSecurityPolicy: {directives: {imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:']}}}));
  app.use(express.json({limit: MAX_ENCRYPTED_PACKET_BYTES}));
  app.use('/api', (_req, res, next) => {res.setHeader('Cache-Control', 'no-store'); next();});
  // Campus Wi-Fi puts many people behind one IP, so valid sessions get their own budget.
  const limiterKey = (req) => {const user = findSession(db, req.headers); return user ? `session:${user.token_hash}` : ipKeyGenerator(req.ip);};
  app.use('/api', rateLimit({windowMs: 60_000, limit: 240, keyGenerator: limiterKey, standardHeaders: 'draft-8', legacyHeaders: false, message: {error: 'Too many requests. Try again in a minute.'}}));
  app.use('/api', (req, res, next) => {
    // Browser writes must come from our own frontend. No permissive CORS.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !origins.includes(req.headers.origin)) return res.status(403).json({error: 'Origin not allowed.'});
    next();
  });
  const authLimiter = rateLimit({windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: {error: 'Too many sign-in attempts. Please try again later.'}});
  const requireUser = (req, res, next) => {
    req.user = findSession(db, req.headers);
    if (!req.user) return res.status(401).json({error: 'Please sign in again.'});
    next();
  };
  const contactsOf = (userId) => db.prepare('SELECT DISTINCT b.user_id AS id FROM conversation_members a JOIN conversation_members b ON b.conversation_id=a.conversation_id WHERE a.user_id=? AND b.user_id!=?').all(userId, userId).map(r => r.id);
  const online = new Map();
  // What others see: "invisible" looks offline; Do not disturb is shown as such.
  const visibleStatus = (userId) => {
    if (!online.has(userId)) return 'offline';
    const status = db.prepare('SELECT status FROM users WHERE id=?').get(userId)?.status;
    return status === 'invisible' ? 'offline' : status === 'dnd' ? 'dnd' : 'online';
  };
  // Presence is only shared with people who already have a conversation with you.
  const presenceList = (userId) => contactsOf(userId).map(id => ({id, status: visibleStatus(id)})).filter(p => p.status !== 'offline');
  const sendPresence = (userId) => io.to(room(userId)).emit('presence:update', presenceList(userId));
  const announcePresence = (userId) => io.to(contactsOf(userId).map(room)).emit('presence:change', {userId, status: visibleStatus(userId)});
  const avatarVersion = (id) => db.prepare('SELECT updated_at FROM avatars WHERE user_id=?').get(id)?.updated_at;
  const selfView = (user) => ({...publicUser(user), avatarUrl: avatarUrl(user.id, avatarVersion(user.id)), status: STATUSES.includes(user.status) ? user.status : 'online', joinedAt: user.created_at});
  const profileChanged = (userId) => {io.to([userId, ...contactsOf(userId)].map(room)).emit('conversation:changed'); io.to(room(userId)).emit('profile:changed');};
  app.get('/api/health', (_req, res) => res.json({ok: true}));
  app.post('/api/auth/register', authLimiter, async (req, res) => {
    const input = registration.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const user = {id: randomUUID(), name: input.name, username: input.username};
    // The UNIQUE constraint also handles two concurrent registrations.
    try {
      db.prepare('INSERT INTO users(id,name,username,password_hash,created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, user.name, user.username, passwordHash, new Date().toISOString());
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return res.status(409).json({error: 'That username is already taken.'});
      throw error;
    }
    createSession(db, user.id, res, secureCookie);
    res.status(201).json({user: selfView(db.prepare('SELECT * FROM users WHERE id=?').get(user.id))});
  });
  app.post('/api/auth/login', authLimiter, async (req, res) => {
    const input = credentials.parse(req.body);
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(input.username);
    if (!user || !(await verifyPassword(input.password, user.password_hash))) return res.status(401).json({error: 'Username or password is incorrect.'});
    createSession(db, user.id, res, secureCookie);
    res.json({user: selfView(user)});
  });
  app.get('/api/auth/me', requireUser, (req, res) => res.json({user: selfView(req.user)}));
  app.patch('/api/me', requireUser, (req, res) => {
    const {name} = z.object({name: z.string().trim().min(2).max(40)}).strict().parse(req.body);
    db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
    profileChanged(req.user.id);
    res.json({user: selfView(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id))});
  });
  app.put('/api/me/status', requireUser, (req, res) => {
    const {status} = z.object({status: z.enum(STATUSES)}).strict().parse(req.body);
    db.prepare('UPDATE users SET status=? WHERE id=?').run(status, req.user.id);
    announcePresence(req.user.id);
    io.to(room(req.user.id)).emit('profile:changed');
    res.json({status});
  });
  // Profile pictures arrive already resized by the browser; keep the server copy small.
  app.put('/api/me/avatar', requireUser, express.raw({type: AVATAR_TYPES, limit: 512 * 1024}), (req, res) => {
    const mime = req.headers['content-type'];
    if (!AVATAR_TYPES.includes(mime) || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({error: 'Choose a PNG, JPEG, WebP or GIF image.'});
    db.prepare('INSERT INTO avatars VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,data=excluded.data,updated_at=excluded.updated_at').run(req.user.id, mime, req.body, Date.now());
    profileChanged(req.user.id);
    res.json({user: selfView(req.user)});
  });
  app.delete('/api/me/avatar', requireUser, (req, res) => {
    db.prepare('DELETE FROM avatars WHERE user_id=?').run(req.user.id);
    profileChanged(req.user.id);
    res.json({user: selfView(req.user)});
  });
  app.get('/api/avatars/:id', requireUser, (req, res) => {
    const avatar = db.prepare('SELECT mime,data FROM avatars WHERE user_id=?').get(req.params.id);
    if (!avatar) return res.status(404).json({error: 'No profile picture.'});
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.type(avatar.mime).send(Buffer.from(avatar.data));
  });
  app.get('/api/users/:id', requireUser, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({error: 'User not found.'});
    const note = db.prepare('SELECT body FROM notes WHERE owner_id=? AND target_id=?').get(req.user.id, user.id)?.body || '';
    res.json({profile: {...publicUser(user), avatarUrl: avatarUrl(user.id, avatarVersion(user.id)), joinedAt: user.created_at, status: user.id === req.user.id ? user.status : visibleStatus(user.id), note}});
  });
  // Private notes are visible only to their author.
  app.put('/api/notes/:userId', requireUser, (req, res) => {
    const {body} = z.object({body: z.string().max(1000)}).strict().parse(req.body);
    if (!db.prepare('SELECT id FROM users WHERE id=?').get(req.params.userId)) return res.status(404).json({error: 'User not found.'});
    if (body.trim()) db.prepare('INSERT INTO notes VALUES(?,?,?,?) ON CONFLICT(owner_id,target_id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at').run(req.user.id, req.params.userId, body, new Date().toISOString());
    else db.prepare('DELETE FROM notes WHERE owner_id=? AND target_id=?').run(req.user.id, req.params.userId);
    res.json({note: body.trim() ? body : ''});
  });
  // Attachments are encrypted in the browser before upload; the server only stores opaque bytes.
  app.post('/api/conversations/:id/attachments', requireUser, express.raw({type: 'application/octet-stream', limit: MAX_ATTACHMENT_BYTES + 1024}), (req, res) => {
    if (!conversationFor(db, req.params.id, req.user.id)) return res.status(404).json({error: 'Conversation not found.'});
    if (!Buffer.isBuffer(req.body) || req.body.length < 16) return res.status(400).json({error: 'Empty attachment.'});
    const id = randomUUID();
    writeFileSync(filePath(id), req.body);
    db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?)').run(id, req.params.id, req.user.id, req.body.length, new Date().toISOString());
    res.status(201).json({id});
  });
  app.get('/api/attachments/:id', requireUser, (req, res) => {
    const file = db.prepare('SELECT * FROM attachments WHERE id=?').get(req.params.id);
    if (!file || !conversationFor(db, file.conversation_id, req.user.id) || !existsSync(filePath(file.id))) return res.status(404).json({error: 'Attachment not found.'});
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type('application/octet-stream');
    createReadStream(filePath(file.id)).pipe(res);
  });
  app.post('/api/auth/logout', requireUser, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.user.token_hash);
    io.in(`session:${req.user.token_hash}`).disconnectSockets(true);
    clearSession(res, secureCookie);
    res.json({ok: true});
  });
  app.get('/api/identity', requireUser, (req,res) => {
    const record=db.prepare('SELECT * FROM identities WHERE user_id=?').get(req.user.id);
    res.json({identity:record?{...JSON.parse(record.public_keys),vault:JSON.parse(record.vault)}:null});
  });
  app.post('/api/identity', requireUser, (req,res) => {
    const input=identityInput.parse(req.body);
    const publicKeys={encryptionKey:input.encryptionKey,signingKey:input.signingKey};
    try {
      const rsa=createPublicKey({key:input.encryptionKey,format:'jwk'});
      const ec=createPublicKey({key:input.signingKey,format:'jwk'});
      if(rsa.asymmetricKeyDetails?.modulusLength!==2048 || ec.asymmetricKeyType!=='ec') throw new Error();
    } catch {return res.status(400).json({error:'Invalid public keys.'});}
    if(db.prepare('SELECT user_id FROM identities WHERE user_id=?').get(req.user.id)) return res.status(409).json({error:'Encryption is already set up. Use your existing recovery key.'});
    db.prepare('INSERT INTO identities VALUES(?,?,?,?)').run(req.user.id,JSON.stringify(publicKeys),JSON.stringify(input.vault),new Date().toISOString());
    io.to(contactsOf(req.user.id).map(room)).emit('conversation:changed');
    res.status(201).json({ok:true});
  });
  // Password backup: a blob wrapped in the browser; only the owner can read or replace it.
  const b64=z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
  const backupInput=z.object({version:z.literal(1),salt:b64.length(24),iv:b64.length(16),ciphertext:b64.min(24).max(400),iterations:z.number().int().min(100000).max(5000000)}).strict();
  app.get('/api/identity/backup', requireUser, (req,res) => {const row=db.prepare('SELECT key_backup FROM users WHERE id=?').get(req.user.id);res.json({backup:row?.key_backup?JSON.parse(row.key_backup):null});});
  app.put('/api/identity/backup', requireUser, (req,res) => {const backup=backupInput.parse(req.body);db.prepare('UPDATE users SET key_backup=? WHERE id=?').run(JSON.stringify(backup),req.user.id);res.json({ok:true});});
  app.get('/api/users', requireUser, (req,res) => {
    const query=typeof req.query.q==='string'?req.query.q.slice(0,40):'';
    const offset=z.coerce.number().int().min(0).max(1000000).parse(req.query.offset ?? 0);
    const users=db.prepare(`SELECT u.id,u.name,u.username, i.public_keys, a.updated_at AS avatar FROM users u LEFT JOIN identities i ON i.user_id=u.id LEFT JOIN avatars a ON a.user_id=u.id WHERE u.id!=? AND (instr(lower(u.name),lower(?))>0 OR instr(u.username,lower(?))>0) ORDER BY u.name,u.id LIMIT 51 OFFSET ?`).all(req.user.id,query,query,offset).map(u=>({id:u.id,name:u.name,username:u.username,avatarUrl:avatarUrl(u.id,u.avatar),encryptionReady:!!u.public_keys}));
    res.json({users:users.slice(0,50),hasMore:users.length>50});
  });
  app.get('/api/conversations', requireUser, (req,res) => {
    const rows=db.prepare(`SELECT c.*,
      (SELECT MAX(id) FROM messages WHERE conversation_id=c.id) AS last_message_id,
      (SELECT encrypted_payload IS NOT NULL FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1) AS encrypted,
      COALESCE((SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY id DESC LIMIT 1),c.created_at) AS updated_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND id>m.last_read_id AND sender_id!=?) AS unread_count
      FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=? ORDER BY updated_at DESC`).all(req.user.id,req.user.id);
    res.json({conversations:rows.map(c=>{
      const members=membersFor(db,c.id);
      return {id:c.id,kind:c.kind,title:c.title,members,createdBy:c.created_by,
        peer:c.kind==='direct'?members.find(m=>m.id!==req.user.id):{id:c.id,name:c.title,username:`${members.length} members`},
        lastMessage:c.last_message_id?(c.encrypted?'Encrypted message':'Earlier unencrypted message'):null,
        // The newest envelope lets each member's browser decrypt a sidebar preview locally.
        lastWire:c.last_message_id?viewsFor(db,[db.prepare('SELECT * FROM messages WHERE id=?').get(c.last_message_id)])[0]:null,lastMessageId:c.last_message_id||0,unreadCount:c.unread_count,updatedAt:c.updated_at};
    })});
  });
  app.post('/api/conversations', requireUser, (req,res) => {
    const {userId}=z.object({userId:z.string().uuid()}).parse(req.body);
    if(userId===req.user.id) return res.status(400).json({error:'Choose another person.'});
    if(!db.prepare('SELECT id FROM users WHERE id=?').get(userId)) return res.status(404).json({error:'User not found.'});
    const [a,b]=[req.user.id,userId].sort();
    const existing=db.prepare("SELECT id FROM conversations WHERE kind='direct' AND user_a=? AND user_b=?").get(a,b);
    if(existing) return res.json(existing);
    if(![a,b].every(id=>db.prepare('SELECT user_id FROM identities WHERE user_id=?').get(id))) return res.status(409).json({error:'Both people need to set up encryption first.'});
    const id=randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("INSERT INTO conversations(id,user_a,user_b,created_at,kind,created_by) VALUES(?,?,?,?,'direct',?)").run(id,a,b,new Date().toISOString(),req.user.id);
      for(const user of [a,b]) db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)').run(id,user);
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    io.to(room(a)).to(room(b)).emit('conversation:changed'); [a,b].forEach(sendPresence); res.status(201).json({id});
  });
  app.post('/api/groups', requireUser, (req,res) => {
    const input=z.object({title:z.string().trim().min(2).max(60),memberIds:z.array(z.string().uuid()).min(2).max(MAX_GROUP_MEMBERS - 1).refine(a=>new Set(a).size===a.length)}).strict().parse(req.body);
    if(input.memberIds.includes(req.user.id)) return res.status(400).json({error:'You are included automatically.'});
    const users=[req.user.id,...input.memberIds];
    if(!users.every(id=>db.prepare('SELECT user_id FROM identities WHERE user_id=?').get(id))) return res.status(409).json({error:'Every selected person needs to set up encryption first.'});
    const id=randomUUID();db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("INSERT INTO conversations(id,created_at,kind,title,created_by) VALUES(?,?,'group',?,?)").run(id,new Date().toISOString(),input.title,req.user.id);
      for(const user of users) db.prepare('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)').run(id,user);
      db.exec('COMMIT');
    } catch(e) {db.exec('ROLLBACK');throw e;}
    io.to(users.map(room)).emit('conversation:changed');users.forEach(sendPresence);res.status(201).json({id});
  });
  // Group membership: the creator adds or removes people; anyone can leave.
  // Each message is encrypted for the members at send time, so new members can't read
  // earlier messages and removed members can't read later ones.
  const groupFor=(id,userId)=>{const c=conversationFor(db,id,userId);return c&&c.kind==='group'?c:null;};
  const membershipChanged=(id,affected)=>{const ids=[...new Set([...membersFor(db,id).map(m=>m.id),...affected])];io.to(ids.map(room)).emit('conversation:changed');ids.forEach(sendPresence);};
  app.post('/api/groups/:id/members', requireUser, (req,res) => {
    const group=groupFor(req.params.id,req.user.id);
    if(!group) return res.status(404).json({error:'Group not found.'});
    if(group.created_by!==req.user.id) return res.status(403).json({error:'Only the group creator can add people.'});
    const {memberIds}=z.object({memberIds:z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS-1).refine(a=>new Set(a).size===a.length)}).strict().parse(req.body);
    const current=new Set(membersFor(db,group.id).map(m=>m.id));
    const added=memberIds.filter(id=>!current.has(id));
    if(!added.length) return res.status(400).json({error:'Those people are already in the group.'});
    if(current.size+added.length>MAX_GROUP_MEMBERS) return res.status(400).json({error:`Groups can have up to ${MAX_GROUP_MEMBERS} people.`});
    if(!added.every(id=>db.prepare('SELECT user_id FROM identities WHERE user_id=?').get(id))) return res.status(409).json({error:'Every selected person needs to open their chats once first.'});
    const latest=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM messages WHERE conversation_id=?').get(group.id).id;
    db.exec('BEGIN IMMEDIATE');
    try {for(const id of added) db.prepare('INSERT INTO conversation_members(conversation_id,user_id,last_read_id) VALUES(?,?,?)').run(group.id,id,latest);db.exec('COMMIT');}
    catch(e){db.exec('ROLLBACK');throw e;}
    membershipChanged(group.id,added);
    res.status(201).json({added:added.length});
  });
  app.delete('/api/groups/:id/members/:userId', requireUser, (req,res) => {
    const group=groupFor(req.params.id,req.user.id);
    if(!group) return res.status(404).json({error:'Group not found.'});
    const leaving=req.params.userId===req.user.id;
    if(!leaving && group.created_by!==req.user.id) return res.status(403).json({error:'Only the group creator can remove people.'});
    if(!db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id=?').get(group.id,req.params.userId)) return res.status(404).json({error:'That person is not in this group.'});
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM conversation_members WHERE conversation_id=? AND user_id=?').run(group.id,req.params.userId);
      // If the creator leaves, the longest-standing remaining member takes over.
      if(leaving && group.created_by===req.user.id){const next=db.prepare('SELECT user_id FROM conversation_members WHERE conversation_id=? ORDER BY rowid LIMIT 1').get(group.id);if(next) db.prepare('UPDATE conversations SET created_by=? WHERE id=?').run(next.user_id,group.id);}
      db.exec('COMMIT');
    } catch(e){db.exec('ROLLBACK');throw e;}
    membershipChanged(group.id,[req.params.userId]);
    res.json({ok:true});
  });
  app.post('/api/conversations/:id/read',requireUser,(req,res)=>{
    if(!conversationFor(db,req.params.id,req.user.id)) return res.status(404).json({error:'Conversation not found.'});
    const {messageId}=z.object({messageId:z.number().int().positive()}).parse(req.body);
    if(!db.prepare('SELECT id FROM messages WHERE id=? AND conversation_id=?').get(messageId,req.params.id)) return res.status(400).json({error:'Invalid message cursor.'});
    db.prepare('UPDATE conversation_members SET last_read_id=MAX(last_read_id,?) WHERE conversation_id=? AND user_id=?').run(messageId,req.params.id,req.user.id);
    const {unread}=db.prepare('SELECT COUNT(*) AS unread FROM messages m JOIN conversation_members c ON c.conversation_id=m.conversation_id AND c.user_id=? WHERE m.conversation_id=? AND m.id>c.last_read_id AND m.sender_id!=?').get(req.user.id,req.params.id,req.user.id);
    io.to(room(req.user.id)).emit('read:changed',{conversationId:req.params.id,unreadCount:unread});
    // Read receipts: other members learn how far this person has read.
    const {last_read_id}=db.prepare('SELECT last_read_id FROM conversation_members WHERE conversation_id=? AND user_id=?').get(req.params.id,req.user.id);
    io.to(membersFor(db,req.params.id).filter(m=>m.id!==req.user.id).map(m=>room(m.id))).emit('read:receipt',{conversationId:req.params.id,userId:req.user.id,lastReadId:last_read_id});
    res.json({ok:true});
  });
  app.get('/api/conversations/:id/messages', requireUser, (req, res) => {
    if (!conversationFor(db, req.params.id, req.user.id)) return res.status(404).json({error: 'Conversation not found.'});
    const before = z.coerce.number().int().positive().safeParse(req.query.before ?? Number.MAX_SAFE_INTEGER);
    if (!before.success) return res.status(400).json({error: 'Invalid message cursor.'});
    const rows = db.prepare('SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT 51').all(req.params.id, before.data);
    const hasMore = rows.length > 50;
    res.json({messages: viewsFor(db, rows.slice(0, 50).reverse()), hasMore});
  });

  io.use((socket, next) => {
    const user = findSession(db, socket.request.headers);
    if (!user) return next(new Error('Please sign in again.'));
    socket.data.user = user;
    next();
  });
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(room(user.id));
    socket.join(`session:${user.token_hash}`);
    const wasOnline = online.has(user.id);
    online.set(user.id, (online.get(user.id) || 0) + 1);
    if (!wasOnline) announcePresence(user.id);
    socket.emit('presence:update', presenceList(user.id));
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, user.expires_at - Date.now()));
    // Re-check the session for every action, including on already-connected sockets.
    socket.use((_packet, next) => {
      if (!findSession(db, socket.request.headers)) {socket.disconnect(true); return;}
      next();
    });
    let messageWindow = Date.now();
    let messageCount = 0;
    socket.on('message:send', (input, callback) => {
      const reply = typeof callback === 'function' ? callback : () => {};
      if (Date.now() - messageWindow >= 60_000) {messageWindow = Date.now(); messageCount = 0;}
      if (++messageCount > 60) return reply({ok: false, error: 'Slow down a little. Try again in a minute.'});
      try {
        const result = saveMessage(db, user.id, input);
        if (result.isNew) io.to(result.members.map(m=>room(m.id))).emit('message:new', result.message);
        reply({ok: true, message: result.message});
      } catch (error) {
        reply({ok: false, error: error instanceof z.ZodError ? 'Invalid encrypted message. Update your client; plaintext sends are disabled.' : error.message});
      }
    });
    const action = (handler) => (input, callback) => {
      const reply = typeof callback === 'function' ? callback : () => {};
      if (Date.now() - messageWindow >= 60_000) {messageWindow = Date.now(); messageCount = 0;}
      if (++messageCount > 60) return reply({ok: false, error: 'Slow down a little. Try again in a minute.'});
      try {reply({ok: true, ...handler(input)});}
      catch (error) {reply({ok: false, error: error instanceof z.ZodError ? 'Invalid request.' : error.message});}
    };
    socket.on('message:edit', action((input) => {
      const result = editMessage(db, user.id, input);
      io.to(result.members.map(m => room(m.id))).emit('message:updated', result.message);
      return {message: result.message};
    }));
    socket.on('message:delete', action((input) => {
      const {messageId} = z.object({messageId: z.number().int().positive()}).strict().parse(input);
      const result = deleteMessage(db, user.id, messageId);
      if (result.attachmentId) rmSync(filePath(result.attachmentId), {force: true});
      io.to(result.members.map(m => room(m.id))).emit('message:updated', result.message);
      return {message: result.message};
    }));
    socket.on('reaction:toggle', action((input) => {
      const {messageId, emoji} = z.object({messageId: z.number().int().positive(), emoji: z.string().min(1).max(16).refine(e => /\p{Extended_Pictographic}/u.test(e))}).strict().parse(input);
      const message = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
      if (!message || message.deleted_at || !conversationFor(db, message.conversation_id, user.id)) throw new Error('Message not found.');
      const removed = db.prepare('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?').run(messageId, user.id, emoji).changes;
      if (!removed) {
        if (db.prepare('SELECT COUNT(DISTINCT emoji) AS n FROM reactions WHERE message_id=?').get(messageId).n >= 20) throw new Error('Too many different reactions on this message.');
        db.prepare('INSERT INTO reactions VALUES(?,?,?,?)').run(messageId, user.id, emoji, new Date().toISOString());
      }
      const reactions = reactionsFor(db, [messageId]).get(messageId);
      io.to(membersFor(db, message.conversation_id).map(m => room(m.id))).emit('reactions:changed', {conversationId: message.conversation_id, messageId, reactions});
      return {reactions};
    }));
    let lastTyping = 0;
    socket.on('typing:set', (input) => {
      const parsed = z.object({conversationId: z.string().uuid(), typing: z.boolean()}).safeParse(input);
      if (!parsed.success) return;
      // Only "started typing" is throttled; dropping "stopped typing" would leave a stale indicator.
      if (parsed.data.typing) {if (Date.now() - lastTyping < 500) return; lastTyping = Date.now();}
      const c = conversationFor(db, parsed.data.conversationId, user.id);
      if (!c) return;
      io.to(membersFor(db,c.id).filter(m=>m.id!==user.id).map(m=>room(m.id))).emit('typing:update', {conversationId:c.id,userId:user.id,name:user.name,typing:parsed.data.typing});
    });
    socket.on('disconnect', () => {
      clearTimeout(expiry);
      const count = (online.get(user.id) || 1) - 1;
      if (count > 0) {online.set(user.id, count); return;}
      online.delete(user.id);
      announcePresence(user.id);
    });
  });

  registerModeration({app, io, db, requireUser, room});
  registerGifs({app, requireUser, apiKey: giphyKey, ...(gifFetch ? {fetchImpl: gifFetch} : {})});
  const assistant = registerAssistant({app, io, db, requireUser, room, generate, reminderIntervalMs});
  app.use('/api', (_req, res) => res.status(404).json({error: 'Endpoint not found.'}));
  const dist = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  if (existsSync(dist)) app.use(express.static(dist));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({error: 'Invalid input. Check the fields and try again.'});
    if (error.type === 'entity.parse.failed') return res.status(400).json({error: 'Invalid JSON.'});
    if (error.type === 'entity.too.large') return res.status(413).json({error: 'Request is too large.'});
    console.error(error);
    res.status(500).json({error: 'Something went wrong. Please try again.'});
  });
  return {app, http, io, db, assistant, close: async () => {
    assistant.stop();
    await new Promise((resolve) => io.close(resolve));
    db.close();
  }};
}
