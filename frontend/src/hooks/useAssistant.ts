import {useCallback,useEffect,useRef,useState} from 'react';
import type {Socket} from 'socket.io-client';
import {api,post,put} from '../lib/api';
import type {AiMessage,Item} from '../lib/types';
export const AI_NAME='Common Room AI';
// "@ai", "@gemini" or "@assistant" anywhere in a message asks Common Room AI.
export const MENTION=/(^|\s)@(ai|gemini|assistant)\b/i;
// The AI only sees earlier messages when the question asks it to read them.
export const READ_REQUEST=/\b(read|summari[sz]e|summary|recap|catch (me )?up|tl;?dr|above|earlier|previous|so far|what (did|have|has|were) (we|they|people|everyone|\w+) (say|said|talk|discuss|decide|agree)|this (chat|conversation|thread|group)|the (chat|conversation|thread|messages|discussion))\b/i;
export const CONTEXT_SIZE=30;
const merge=(a:AiMessage[],b:AiMessage[])=>[...new Map([...a,...b].map(m=>[m.id,m])).values()].sort((x,y)=>x.id-y.id);
const zone=()=>({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,offsetMinutes:new Date().getTimezoneOffset()});
export function useAssistant(socket:Socket|null,onDue:(item:Item)=>void){
  const [dm,setDm]=useState<AiMessage[]>([]),[byConversation,setByConversation]=useState<Record<string,AiMessage[]>>({});
  const [items,setItems]=useState<Item[]>([]),[thinking,setThinking]=useState<Record<string,boolean>>({}),[configured,setConfigured]=useState<boolean|null>(null),[provider,setProvider]=useState<string|null>(null);
  const dueRef=useRef(onDue);dueRef.current=onDue;
  const store=useCallback((messages:AiMessage[])=>{
    const direct=messages.filter(m=>!m.conversationId);
    if(direct.length)setDm(current=>merge(current,direct));
    const shared=messages.filter(m=>m.conversationId);
    if(shared.length)setByConversation(current=>{const next={...current};for(const m of shared)next[m.conversationId!]=merge(next[m.conversationId!]||[],[m]);return next;});
  },[]);
  const loadItems=useCallback(async()=>setItems((await api<{items:Item[]}>('/items')).items),[]);
  const loadDm=useCallback(async()=>setDm((await api<{messages:AiMessage[]}>('/ai/messages')).messages),[]);
  const loadConversation=useCallback(async(id:string)=>{const {messages}=await api<{messages:AiMessage[]}>(`/ai/messages?conversationId=${id}`);setByConversation(current=>({...current,[id]:merge(current[id]||[],messages)}));},[]);
  useEffect(()=>{void api<{configured:boolean;provider:string|null}>('/ai/status').then(s=>{setConfigured(s.configured);setProvider(s.provider);}).catch(()=>{});},[]);
  useEffect(()=>{
    if(!socket)return;
    const reload=()=>{void loadItems().catch(()=>{});void loadDm().catch(()=>{});};
    const onMessage=(m:AiMessage)=>store([m]);
    const onThinking=(e:{conversationId:string|null;active:boolean})=>setThinking(current=>({...current,[e.conversationId||'dm']:e.active}));
    const onItems=()=>{void loadItems().catch(()=>{});};
    const onDueItem=(item:Item)=>dueRef.current(item);
    const onCleared=()=>setDm([]);
    socket.on('connect',reload);socket.on('ai:message',onMessage);socket.on('ai:thinking',onThinking);socket.on('items:changed',onItems);socket.on('reminder:due',onDueItem);socket.on('ai:cleared',onCleared);
    reload();
    return()=>{socket.off('connect',reload);socket.off('ai:message',onMessage);socket.off('ai:thinking',onThinking);socket.off('items:changed',onItems);socket.off('reminder:due',onDueItem);socket.off('ai:cleared',onCleared);};
  },[socket,store,loadItems,loadDm]);
  async function ask(prompt:string,conversationId?:string,context?:{name:string;text:string}[]){
    const key=conversationId||'dm';
    setThinking(current=>({...current,[key]:true}));
    try{store((await post<{messages:AiMessage[]}>('/ai/ask',{prompt,...(conversationId?{conversationId}:{}),...(context?.length?{context}:{}),...zone()})).messages);}
    finally{setThinking(current=>({...current,[key]:false}));}
  }
  async function addItem(kind:'reminder'|'task',title:string,dueAt:string|null){await post('/items',{kind,title,dueAt});await loadItems();}
  async function toggleItem(item:Item){setItems(current=>current.map(i=>i.id===item.id?{...i,done:!i.done}:i));try{await put(`/items/${item.id}`,{done:!item.done},'PATCH');}finally{await loadItems();}}
  async function removeItem(item:Item){setItems(current=>current.filter(i=>i.id!==item.id));try{await api(`/items/${item.id}`,{method:'DELETE'});}finally{await loadItems();}}
  async function clearDm(){await api('/ai/messages',{method:'DELETE'});setDm([]);}
  return {dm,byConversation,items,thinking,configured,provider,ask,loadConversation,addItem,toggleItem,removeItem,clearDm,openCount:items.filter(i=>!i.done).length};
}
