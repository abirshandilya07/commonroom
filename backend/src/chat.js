import { z } from 'zod';
import { createPublicKey, verify } from 'node:crypto';
import { unsignedEnvelope } from '../../shared/crypto.js';
import { MAX_GROUP_MEMBERS } from '../../shared/limits.js';
import { BOT_USER_ID } from './ai.js';

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
const publicRsa = z.object({ kty: z.literal('RSA'), n: z.string().regex(/^[A-Za-z0-9_-]{342}$/), e: z.literal('AQAB') }).strict();
const publicEc = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/), y: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const identityInput = z.object({ encryptionKey: publicRsa, signingKey: publicEc, vault: z.object({ version: z.literal(1), iv: base64.length(16), ciphertext: base64.min(100).max(16000) }).strict() }).strict();
export const messageInput = z.object({
  conversationId: z.string().uuid(),
  clientId: z.string().uuid(),
  encrypted: z.object({
    version: z.literal(1),
    conversationId: z.string().uuid(),
    senderId: z.string().uuid(),
    clientId: z.string().uuid(),
    iv: base64.length(16),
    ciphertext: base64.min(24).max(24000),
    recipients: z.array(z.object({ userId: z.string().uuid(), key: base64.length(344) }).strict()).min(2).max(MAX_GROUP_MEMBERS + 1),
    signature: base64.length(88)
  }).strict(),
  attachmentId: z.string().uuid().optional()
}).strict();

export const avatarUrl = (id, version) => version ? `/api/avatars/${id}?v=${version}` : null;
export const membersFor = (db, id) => db.prepare(`SELECT u.id,u.name,u.username,i.public_keys,a.updated_at AS avatar,m.last_read_id FROM conversation_members m JOIN users u ON u.id=m.user_id LEFT JOIN identities i ON i.user_id=u.id LEFT JOIN avatars a ON a.user_id=u.id WHERE m.conversation_id=? ORDER BY u.id`).all(id).map(u => ({ id: u.id, name: u.name, username: u.username, avatarUrl: avatarUrl(u.id, u.avatar), lastReadId: u.last_read_id, identity: u.public_keys ? JSON.parse(u.public_keys) : null }));
export const conversationFor = (db, id, userId) => db.prepare('SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE c.id=? AND m.user_id=?').get(id, userId);

export function reactionsFor(db, ids) {
  const map = new Map(ids.map(id => [id, []]));
  if (!ids.length) return map;
  const rows = db.prepare(`SELECT message_id,emoji,user_id FROM reactions WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at`).all(...ids);
  for (const r of rows) {
    const list = map.get(r.message_id);
    const entry = list.find(e => e.emoji === r.emoji);
    if (entry) entry.userIds.push(r.user_id);
    else list.push({ emoji: r.emoji, userIds: [r.user_id] });
  }
  return map;
}

export const messageView = (m, reactions = []) => m.deleted_at
  ? { id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, clientId: m.client_id, encrypted: null, legacy: false, deleted: true, createdAt: m.created_at, reactions: [] }
  : { id: m.id, conversationId: m.conversation_id, senderId: m.sender_id, clientId: m.client_id, body: m.encrypted_payload ? undefined : m.body, encrypted: m.encrypted_payload ? JSON.parse(m.encrypted_payload) : null, legacy: !m.encrypted_payload, createdAt: m.created_at, editedAt: m.edited_at || undefined, reactions };

export const viewsFor = (db, rows) => { const reactions = reactionsFor(db, rows.map(r => r.id)); return rows.map(r => messageView(r, reactions.get(r.id))); };

function verifyEnvelope(db, userId, conversationId, clientId, encrypted) {
  const members = membersFor(db, conversationId);
  if (encrypted.senderId !== userId || encrypted.conversationId !== conversationId || encrypted.clientId !== clientId) {
    throw new Error('Invalid encrypted message context.');
  }

  let senderIdentity = null;
  if (userId === BOT_USER_ID) {
    const botRow = db.prepare('SELECT public_keys FROM identities WHERE user_id=?').get(BOT_USER_ID);
    senderIdentity = botRow ? JSON.parse(botRow.public_keys) : null;
  } else {
    senderIdentity = members.find(m => m.id === userId)?.identity;
  }

  if (!senderIdentity) throw new Error('Every member must set up encryption before you can send.');

  const targets = [...encrypted.recipients.map(r => r.userId)].sort();
  const memberIds = [...members.map(m => m.id)].sort();
  const withBotIds = Array.from(new Set([...memberIds, BOT_USER_ID])).sort();

  const matchesMembers = JSON.stringify(targets) === JSON.stringify(memberIds);
  const matchesWithBot = JSON.stringify(targets) === JSON.stringify(withBotIds);

  if (!matchesMembers && !matchesWithBot) {
    throw new Error('Encrypt for exactly the conversation members.');
  }

  const publicKey = createPublicKey({ key: senderIdentity.signingKey, format: 'jwk' });
  if (!verify('sha256', Buffer.from(unsignedEnvelope(encrypted)), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(encrypted.signature, 'base64'))) {
    throw new Error('Invalid message signature.');
  }
  return members;
}

export const editInput = z.object({ messageId: z.number().int().positive(), encrypted: messageInput.shape.encrypted }).strict();

export function editMessage(db, userId, input) {
  const { messageId, encrypted } = editInput.parse(input);
  const existing = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
  if (!existing || !conversationFor(db, existing.conversation_id, userId)) throw new Error('Message not found.');
  if (existing.sender_id !== userId) throw new Error('You can only edit your own messages.');
  if (existing.deleted_at || !existing.encrypted_payload) throw new Error('This message can no longer be edited.');
  const members = verifyEnvelope(db, userId, existing.conversation_id, existing.client_id, encrypted);
  db.prepare('UPDATE messages SET encrypted_payload=?,edited_at=? WHERE id=?').run(JSON.stringify(encrypted), new Date().toISOString(), messageId);
  return { message: viewsFor(db, [db.prepare('SELECT * FROM messages WHERE id=?').get(messageId)])[0], members };
}

export function deleteMessage(db, userId, messageId) {
  const existing = db.prepare('SELECT * FROM messages WHERE id=?').get(messageId);
  if (!existing || !conversationFor(db, existing.conversation_id, userId)) throw new Error('Message not found.');
  if (existing.sender_id !== userId) throw new Error('You can only delete your own messages.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("UPDATE messages SET encrypted_payload=NULL,body='[Deleted]',deleted_at=?,attachment_id=NULL WHERE id=?").run(new Date().toISOString(), messageId);
    db.prepare('DELETE FROM reactions WHERE message_id=?').run(messageId);
    if (existing.attachment_id) db.prepare('DELETE FROM attachments WHERE id=?').run(existing.attachment_id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { message: messageView(db.prepare('SELECT * FROM messages WHERE id=?').get(messageId)), members: membersFor(db, existing.conversation_id), attachmentId: existing.attachment_id };
}

export function saveMessage(db, userId, input) {
  const { conversationId, clientId, encrypted, attachmentId } = messageInput.parse(input);
  const conversation = conversationFor(db, conversationId, userId) || (userId === BOT_USER_ID ? db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId) : null);
  if (!conversation) throw new Error('Conversation not found.');
  const members = verifyEnvelope(db, userId, conversationId, clientId, encrypted);
  const serialized = JSON.stringify(encrypted);
  const existing = db.prepare('SELECT * FROM messages WHERE sender_id=? AND client_id=?').get(userId, clientId);
  if (existing) {
    if (existing.conversation_id !== conversationId || existing.encrypted_payload !== serialized) throw new Error('Message ID already used.');
    return { message: viewsFor(db, [existing])[0], members, isNew: false };
  }
  if (attachmentId) {
    const file = db.prepare('SELECT * FROM attachments WHERE id=?').get(attachmentId);
    if (!file || file.conversation_id !== conversationId || file.uploader_id !== userId) throw new Error('Attachment not found.');
    if (db.prepare('SELECT id FROM messages WHERE attachment_id=?').get(attachmentId)) throw new Error('Attachment already sent.');
  }
  const result = db.prepare('INSERT INTO messages(conversation_id,sender_id,client_id,body,created_at,encrypted_payload,attachment_id) VALUES(?,?,?,?,?,?,?)').run(conversationId, userId, clientId, '[Encrypted message]', new Date().toISOString(), serialized, attachmentId || null);
  return { message: viewsFor(db, [db.prepare('SELECT * FROM messages WHERE id=?').get(result.lastInsertRowid)])[0], members, isNew: true };
}