// Browser/Node Web Crypto only. Versioned prototype protocol; see docs/ENCRYPTION.md.
const encode = new TextEncoder();
const decode = new TextDecoder();
export function b64(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))); }
export function unb64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }
const json = value => encode.encode(JSON.stringify(value));
const aes = bytes => crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
export function canonicalPublic(identity) {
  const r = identity.encryptionKey, s = identity.signingKey;
  return JSON.stringify({encryptionKey: {kty: r.kty, n: r.n, e: r.e}, signingKey: {kty: s.kty, crv: s.crv, x: s.x, y: s.y}});
}
export async function fingerprint(identity) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(canonicalPublic(identity))))].map(b => b.toString(16).padStart(2, '0')).join('').match(/.{1,4}/g).join(' ');
}
export async function createIdentity(userId) {
  const encryption = await crypto.subtle.generateKey({name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256'}, true, ['encrypt','decrypt']);
  const signing = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign','verify']);
  const identity = JSON.parse(canonicalPublic({encryptionKey: await crypto.subtle.exportKey('jwk', encryption.publicKey), signingKey: await crypto.subtle.exportKey('jwk', signing.publicKey)}));
  const privateBundle = {encryptionKey: await crypto.subtle.exportKey('jwk', encryption.privateKey), signingKey: await crypto.subtle.exportKey('jwk', signing.privateKey)};
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const recoveryKey = b64(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData: json({purpose:'commonroom-vault-v1',userId,identity:canonicalPublic(identity)})}, await aes(secret), json(privateBundle));
  const vault = {version:1, iv:b64(iv), ciphertext:b64(ciphertext)};
  const record = {...identity, vault};
  return {record, recoveryKey, unlocked: await unlockIdentity(userId, record, recoveryKey)};
}
export async function unlockIdentity(userId, record, recoveryKey) {
  const raw = await crypto.subtle.decrypt({name:'AES-GCM', iv:unb64(record.vault.iv), additionalData:json({purpose:'commonroom-vault-v1',userId,identity:canonicalPublic(record)})}, await aes(unb64(recoveryKey.trim())), unb64(record.vault.ciphertext));
  const bundle = JSON.parse(decode.decode(raw));
  const encryptionPrivate = await crypto.subtle.importKey('jwk', bundle.encryptionKey, {name:'RSA-OAEP',hash:'SHA-256'}, false, ['decrypt']);
  const signingPrivate = await crypto.subtle.importKey('jwk', bundle.signingKey, {name:'ECDSA',namedCurve:'P-256'}, false, ['sign']);
  // Verify that this vault actually corresponds to the published public keys.
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const encPublic = await crypto.subtle.importKey('jwk', record.encryptionKey, {name:'RSA-OAEP',hash:'SHA-256'}, false, ['encrypt']);
  const probe = await crypto.subtle.encrypt({name:'RSA-OAEP'}, encPublic, challenge);
  if (b64(await crypto.subtle.decrypt({name:'RSA-OAEP'}, encryptionPrivate, probe)) !== b64(challenge)) throw new Error('Encryption identity mismatch.');
  const signPublic = await crypto.subtle.importKey('jwk', record.signingKey, {name:'ECDSA',namedCurve:'P-256'}, false, ['verify']);
  const signature = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, signingPrivate, challenge);
  if (!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, signPublic, signature, challenge)) throw new Error('Signing identity mismatch.');
  return {userId, encryptionPrivate, signingPrivate, publicIdentity:{encryptionKey:record.encryptionKey,signingKey:record.signingKey}};
}
export function unsignedEnvelope(payload) {
  return JSON.stringify({version:1, conversationId:payload.conversationId, senderId:payload.senderId, clientId:payload.clientId,
    iv:payload.iv, ciphertext:payload.ciphertext, recipients:[...payload.recipients].sort((a,b)=>a.userId.localeCompare(b.userId)).map(r=>({userId:r.userId,key:r.key}))});
}
function aad(payload) {
  return json({version:1,conversationId:payload.conversationId,senderId:payload.senderId,clientId:payload.clientId,recipients:payload.recipients.map(r=>r.userId).sort()});
}
export async function encryptMessage(identity, conversationId, clientId, body, members) {
  // The body may be a structured payload (text plus attachment metadata); the UI limits text to 2,000 characters.
  if (!body.trim() || body.length > 6000) throw new Error('Messages must contain 1–2,000 characters.');
  if (!members.some(m=>m.id===identity.userId)) throw new Error('Sender is not a member.');
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const recipients = await Promise.all([...members].sort((a,b)=>a.id.localeCompare(b.id)).map(async m=>{
    const key = await crypto.subtle.importKey('jwk', m.identity.encryptionKey, {name:'RSA-OAEP',hash:'SHA-256'}, false, ['encrypt']);
    return {userId:m.id,key:b64(await crypto.subtle.encrypt({name:'RSA-OAEP'},key,secret))};
  }));
  const payload = {version:1,conversationId,senderId:identity.userId,clientId,iv:b64(crypto.getRandomValues(new Uint8Array(12))),ciphertext:'',recipients};
  payload.ciphertext = b64(await crypto.subtle.encrypt({name:'AES-GCM',iv:unb64(payload.iv),additionalData:aad(payload)},await aes(secret),encode.encode(body)));
  return {...payload,signature:b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},identity.signingPrivate,encode.encode(unsignedEnvelope(payload))))};
}
export async function decryptMessage(identity, message, senderIdentity) {
  const payload=message.encrypted;
  if (!payload || payload.version!==1 || payload.conversationId!==message.conversationId || payload.senderId!==message.senderId || payload.clientId!==message.clientId) throw new Error('Message context mismatch.');
  const key = await crypto.subtle.importKey('jwk', senderIdentity.signingKey, {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if (!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unb64(payload.signature),encode.encode(unsignedEnvelope(payload)))) throw new Error('Message signature is invalid.');
  const wrapped=payload.recipients.find(r=>r.userId===identity.userId);
  if (!wrapped) throw new Error('This message was not encrypted for your account.');
  const secret=await crypto.subtle.decrypt({name:'RSA-OAEP'},identity.encryptionPrivate,unb64(wrapped.key));
  return decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(payload.iv),additionalData:aad(payload)},await aes(secret),unb64(payload.ciphertext)));
}
