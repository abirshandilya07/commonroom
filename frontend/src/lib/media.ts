import {b64,unb64} from '../../../shared/crypto';
import type {Attachment} from './types';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT = 2000;

// Message bodies are plain text, or a small JSON payload when they carry an attachment.
// Both are encrypted end to end; the attachment key never reaches the server.
export function encodeBody(text:string, attachment?:Attachment) {
  return attachment ? JSON.stringify({v:2,text,attachment}) : text;
}
export function decodeBody(body:string):{text:string;attachment?:Attachment} {
  if(body.startsWith('{"v":2')) {
    try {const value=JSON.parse(body);if(typeof value.text==='string')return {text:value.text,attachment:value.attachment};} catch {/* plain text that merely looks like JSON */}
  }
  return {text:body};
}
export function kindOf(mime:string):Attachment['kind']|null {
  if(mime.startsWith('image/'))return 'image';
  if(mime.startsWith('video/'))return 'video';
  if(mime.startsWith('audio/'))return 'audio';
  return null;
}
export async function encryptFile(data:Blob) {
  const raw=crypto.getRandomValues(new Uint8Array(32)),iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,await data.arrayBuffer());
  return {ciphertext,key:b64(raw),iv:b64(iv)};
}
const urls=new Map<string,Promise<string>>();
// Downloads and decrypts once per page; repeated renders reuse the same object URL.
export function attachmentUrl(attachment:Attachment) {
  let url=urls.get(attachment.id);
  if(!url) {
    url=(async()=>{
      const response=await fetch(`/api/attachments/${attachment.id}`,{credentials:'same-origin'});
      if(!response.ok)throw new Error(response.status===404?'This file is no longer available.':'Could not load this file.');
      const key=await crypto.subtle.importKey('raw',unb64(attachment.key) as Uint8Array<ArrayBuffer>,'AES-GCM',false,['decrypt']);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(attachment.iv) as Uint8Array<ArrayBuffer>},key,await response.arrayBuffer());
      return URL.createObjectURL(new Blob([plain],{type:attachment.mime}));
    })();
    urls.set(attachment.id,url);url.catch(()=>urls.delete(attachment.id));
  }
  return url;
}
export const formatBytes=(n:number)=>n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(0)} KB`:`${(n/1024/1024).toFixed(1)} MB`;
export const formatDuration=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
// Shrink profile pictures in the browser so the server stores a small square image.
export async function resizeAvatar(file:File):Promise<Blob> {
  const bitmap=await createImageBitmap(file);
  const size=256,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const side=Math.min(bitmap.width,bitmap.height);
  canvas.getContext('2d')!.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,size,size);
  bitmap.close();
  return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not process that image.')),'image/jpeg',0.85));
}
