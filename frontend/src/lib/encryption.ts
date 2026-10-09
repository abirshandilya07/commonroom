import {fingerprint,decryptMessage,encryptMessage,type PublicIdentity,type UnlockedIdentity,type Envelope} from '../../../shared/crypto';
import type {Conversation,Member,WireMessage,Message} from './types';
import {decodeBody} from './media';
export {createIdentity,unlockIdentity,fingerprint} from '../../../shared/crypto';
export type {UnlockedIdentity,IdentityRecord} from '../../../shared/crypto';
export function sessionRecovery(userId:string, value?:string|null) {
  try {const key=`commonroom-unlock:${userId}`;if(value===null) sessionStorage.removeItem(key);else if(value!==undefined) sessionStorage.setItem(key,value);return sessionStorage.getItem(key);}catch{return null;}
}
export async function pinIdentity(owner:string, member:Member) {
  if(!member.identity) throw new Error(`${member.name} has not set up encryption yet.`);
  const print=await fingerprint(member.identity);
  const key=`commonroom-pin:${owner}:${member.id}`;
  let known:string|null=null;
  try {known=localStorage.getItem(key);}catch{throw new Error('Browser storage is needed to remember verified encryption identities.');}
  if(known && known!==print) throw new Error(`Security alert: ${member.name}’s encryption identity changed. Sending is blocked.`);
  localStorage.setItem(key,print);return print;
}
export async function decrypt(identity:UnlockedIdentity, wire:WireMessage, conversation:Conversation):Promise<Message> {
  if(wire.deleted) return {...wire,body:''};
  if(!wire.encrypted) return {...wire,body:wire.body||'',legacy:true};
  // Group messages are encrypted for the members at send time; later joiners can't read them.
  if(!wire.encrypted.recipients.some(r=>r.userId===identity.userId)) return {...wire,body:'Sent before you joined this group.',beforeJoin:true};
  try {
    const member=conversation.members.find(m=>m.id===wire.senderId);
    if(!member?.identity) throw new Error('Sender identity not available.');
    await pinIdentity(identity.userId,member);
    const {text,attachment}=decodeBody(await decryptMessage(identity,{...wire,encrypted:wire.encrypted},member.identity));
    return {...wire,body:text,attachment};
  } catch(e) {return {...wire,body:e instanceof Error?`Unable to decrypt: ${e.message}`:'Unable to decrypt this message.',decryptionError:true};}
}
export async function encrypt(identity:UnlockedIdentity, conversation:Conversation, clientId:string,body:string):Promise<Envelope> {
  for(const member of conversation.members) await pinIdentity(identity.userId,member);
  return encryptMessage(identity,conversation.id,clientId,body,conversation.members.map(m=>({id:m.id,identity:m.identity as PublicIdentity})));
}
