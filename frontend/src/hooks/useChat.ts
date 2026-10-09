import {useCallback,useEffect,useRef,useState} from 'react';
import {io,type Socket} from 'socket.io-client';
import {api,ApiError,post,upload} from '../lib/api';
import {encodeBody,encryptFile,MAX_ATTACHMENT_BYTES} from '../lib/media';
import {checkOutgoing} from '../lib/fileSafety';
import {decrypt,encrypt,type UnlockedIdentity} from '../lib/encryption';
import type {Attachment,Conversation,Message,MessagePage,Presence,Reaction,SendAck,User,WireMessage} from '../lib/types';
import type {Envelope} from '../../../shared/crypto';
const merge=(a:Message[],b:Message[])=>[...new Map([...a,...b].map(m=>[m.id,m])).values()].sort((x,y)=>x.id-y.id);
export type Outgoing = {file:Blob;name:string;duration?:number};
export function useChat(user:User,identity:UnlockedIdentity,onExpired:()=>void,onIncoming:(m:WireMessage,c:Conversation)=>void,onProfileChanged:()=>void) {
  const [conversations,setConversations]=useState<Conversation[]>([]),[activeId,setActiveId]=useState<string|null>(null);
  const [messages,setMessages]=useState<Record<string,Message[]>>({}),[hasMore,setHasMore]=useState<Record<string,boolean>>({});
  const [online,setOnline]=useState<Record<string,Presence>>({}),[connected,setConnected]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const [previews,setPreviews]=useState<Record<string,{id:number;text:string}>>({});
  const [typing,setTyping]=useState<Record<string,Record<string,{name:string;until:number}>>>({});
  const [socketState,setSocketState]=useState<Socket|null>(null);
  const socket=useRef<Socket|null>(null),activeRef=useRef(activeId),conversationRef=useRef(conversations),incomingRef=useRef(onIncoming),profileRef=useRef(onProfileChanged);
  activeRef.current=activeId;incomingRef.current=onIncoming;profileRef.current=onProfileChanged;
  const pending=useRef(new Map<string,{body:string;file?:Blob;encrypted:Envelope;attachmentId?:string;payload?:string}>());
  const decodeBodyForResend=(entry:{body:string;payload?:string})=>entry.payload??entry.body;
  const fail=useCallback((e:unknown)=>{if(e instanceof ApiError&&e.status===401)onExpired();else setError(e instanceof Error?e.message:'Unable to connect.');},[onExpired]);
  const preview=useCallback((m:Message,c:Conversation)=>{
    const media=m.attachment?{image:'📷 Photo',video:'🎥 Video',audio:'🎤 Voice note',file:`📎 ${m.attachment.name}`}[m.attachment.kind]:'';
    const text=m.deleted?'Message deleted':m.decryptionError?'Encrypted message':[media,m.body].filter(Boolean).join(' · ')||'Message';
    const who=m.senderId===user.id?'You':c.kind==='group'?c.members.find(x=>x.id===m.senderId)?.name.split(' ')[0]:'';
    setPreviews(current=>current[c.id]&&current[c.id].id>m.id?current:{...current,[c.id]:{id:m.id,text:who?`${who}: ${text}`:text}});
  },[user.id]);
  const refreshConversations=useCallback(async()=>{
    const data=await api<{conversations:Conversation[]}>('/conversations');conversationRef.current=data.conversations;setConversations(data.conversations);
    // Decrypt sidebar previews in the browser; the server only ever sees ciphertext.
    void Promise.all(data.conversations.filter(c=>c.lastWire&&!c.lastWire.legacy).map(async c=>preview(await decrypt(identity,c.lastWire!,c),c))).catch(()=>{});
    return data.conversations;
  },[identity,preview]);
  // Apply a local change to the list (unread, ordering) without reloading every member key from the server.
  const patchConversations=useCallback((update:(list:Conversation[])=>Conversation[])=>{
    setConversations(current=>{const next=update(current);conversationRef.current=next;return next;});
  },[]);
  const findConversation=useCallback(async(id:string)=>{
    const list=conversationRef.current.some(c=>c.id===id)?conversationRef.current:await refreshConversations();
    const conversation=list.find(c=>c.id===id);if(!conversation)throw new Error('Conversation unavailable.');return conversation;
  },[refreshConversations]);
  const refreshHistory=useCallback(async(id:string)=>{
    const c=await findConversation(id),data=await api<MessagePage>(`/conversations/${id}/messages`);
    const decoded=await Promise.all(data.messages.map(m=>decrypt(identity,m,c))),newest=decoded.at(-1)?.id||0;
    setMessages(current=>({...current,[id]:merge(decoded,(current[id]||[]).filter(m=>m.id>newest))}));
    setHasMore(current=>({...current,[id]:data.hasMore}));
  },[identity,findConversation]);
  useEffect(()=>{
    const connection=io({transports:['websocket'],autoConnect:false});socket.current=connection;setSocketState(connection);
    let alive=true,queue=Promise.resolve();
    connection.on('connect',()=>{setConnected(true);setError('');void refreshConversations().then(()=>{if(activeRef.current)return refreshHistory(activeRef.current);}).catch(fail);});
    connection.on('disconnect',(reason)=>{setConnected(false);setOnline({});setTyping({});if(reason==='io server disconnect')onExpired();});
    connection.on('connect_error',e=>{setConnected(false);if(e.message==='Please sign in again.')onExpired();});
    connection.on('message:new',(wire:WireMessage)=>{
      queue=queue.then(async()=>{
        const known=conversationRef.current.find(c=>c.id===wire.conversationId);
        const c=known||(await refreshConversations()).find(c=>c.id===wire.conversationId);if(!c||!alive)return;
        const message=await decrypt(identity,wire,c);if(!alive)return;
        setMessages(current=>({...current,[c.id]:merge(current[c.id]||[],[message])}));preview(message,c);
        setTyping(current=>({...current,[c.id]:{...current[c.id],[wire.senderId]:{name:'',until:0}}}));
        // A freshly loaded list already counts this message; otherwise count it here.
        if(known)patchConversations(list=>{
          const current=list.find(x=>x.id===c.id);if(!current||current.lastMessageId>=wire.id)return list;
          const updated={...current,lastMessage:'Encrypted message',lastMessageId:wire.id,updatedAt:wire.createdAt,unreadCount:current.unreadCount+(wire.senderId===user.id?0:1)};
          return [updated,...list.filter(x=>x.id!==c.id)];
        });
        if(wire.senderId!==user.id && (activeRef.current!==c.id||document.hidden||!document.hasFocus()))incomingRef.current(wire,c);
      }).catch(fail);
    });
    connection.on('conversation:changed',()=>{void refreshConversations().catch(fail);});
    connection.on('read:changed',(e?:{conversationId:string;unreadCount:number})=>{
      if(e?.conversationId)patchConversations(list=>list.map(c=>c.id===e.conversationId?{...c,unreadCount:e.unreadCount}:c));
      else void refreshConversations().catch(fail);
    });
    connection.on('presence:update',(list:{id:string;status:Presence}[])=>setOnline(Object.fromEntries(list.map(p=>[p.id,p.status]))));
    connection.on('presence:change',(e:{userId:string;status:Presence})=>setOnline(current=>{const next={...current};if(e.status==='offline')delete next[e.userId];else next[e.userId]=e.status;return next;}));
    // Edits and deletes replace the message in place; reactions patch just their list.
    connection.on('message:updated',(wire:WireMessage)=>{
      queue=queue.then(async()=>{
        const c=conversationRef.current.find(c=>c.id===wire.conversationId);if(!c||!alive)return;
        const message=await decrypt(identity,wire,c);if(!alive)return;
        setMessages(current=>current[c.id]?{...current,[c.id]:current[c.id].map(m=>m.id===message.id?message:m)}:current);
        if(c.lastMessageId<=message.id)preview(message,c);
      }).catch(fail);
    });
    connection.on('reactions:changed',(e:{conversationId:string;messageId:number;reactions:Reaction[]})=>setMessages(current=>current[e.conversationId]?{...current,[e.conversationId]:current[e.conversationId].map(m=>m.id===e.messageId?{...m,reactions:e.reactions}:m)}:current));
    connection.on('profile:changed',()=>profileRef.current());
    connection.on('read:receipt',(e:{conversationId:string;userId:string;lastReadId:number})=>patchConversations(list=>list.map(c=>c.id===e.conversationId?{...c,members:c.members.map(m=>m.id===e.userId?{...m,lastReadId:Math.max(m.lastReadId||0,e.lastReadId)}:m)}:c)));
    connection.on('typing:update',(e:{conversationId:string;userId:string;name:string;typing:boolean})=>setTyping(current=>({...current,[e.conversationId]:{...current[e.conversationId],[e.userId]:{name:e.name,until:e.typing?Date.now()+3500:0}}})));
    connection.connect();
    const timer=setInterval(()=>setTyping(current=>Object.fromEntries(Object.entries(current).map(([id,people])=>[id,Object.fromEntries(Object.entries(people).filter(([,p])=>p.until>Date.now()))]))),1000);
    return()=>{alive=false;clearInterval(timer);connection.removeAllListeners();connection.disconnect();socket.current=null;setSocketState(null);};
  },[identity,user.id,fail,refreshConversations,refreshHistory,onExpired,patchConversations,preview]);
  useEffect(()=>{if(!activeId)return;let cancelled=false;setLoading(true);void refreshHistory(activeId).catch(fail).finally(()=>{if(!cancelled)setLoading(false);});return()=>{cancelled=true;};},[activeId,refreshHistory,fail]);
  const lastRead=useRef(new Map<string,number>());
  const latest=activeId?messages[activeId]?.at(-1)?.id:undefined;
  useEffect(()=>{
    const read=()=>{
      if(!activeId||!latest||loading||document.hidden||!document.hasFocus()||(lastRead.current.get(activeId)||0)>=latest)return;
      lastRead.current.set(activeId,latest);
      void post(`/conversations/${activeId}/read`,{messageId:latest}).catch(e=>{lastRead.current.delete(activeId);fail(e);});
    };read();window.addEventListener('focus',read);document.addEventListener('visibilitychange',read);return()=>{window.removeEventListener('focus',read);document.removeEventListener('visibilitychange',read);};
  },[activeId,latest,loading,fail]);
  async function startChat(peer:User){const {id}=await post<{id:string}>('/conversations',{userId:peer.id});await refreshConversations();setActiveId(id);}
  async function addMembers(conversationId:string,memberIds:string[]){await post(`/groups/${conversationId}/members`,{memberIds});await refreshConversations();}
  async function removeMember(conversationId:string,userId:string){await api(`/groups/${conversationId}/members/${userId}`,{method:'DELETE'});if(userId===user.id)setActiveId(null);await refreshConversations();}
  async function createGroup(title:string,memberIds:string[]){const {id}=await post<{id:string}>('/groups',{title,memberIds});await refreshConversations();setActiveId(id);}
  async function older(){if(!activeId||!messages[activeId]?.length)return;const id=activeId,c=await findConversation(id),data=await api<MessagePage>(`/conversations/${id}/messages?before=${messages[id][0].id}`);const decoded=await Promise.all(data.messages.map(m=>decrypt(identity,m,c)));setMessages(current=>({...current,[id]:merge(decoded,current[id]||[])}));setHasMore(current=>({...current,[id]:data.hasMore}));}
  // Message search runs in the browser, so "search all history" first loads and decrypts every earlier page.
  async function loadAll(){
    if(!activeId)return;const id=activeId,c=await findConversation(id);
    let before=messages[id]?.[0]?.id,more=true,pages=0;
    while(more&&before&&pages++<40){const data=await api<MessagePage>(`/conversations/${id}/messages?before=${before}`);const decoded=await Promise.all(data.messages.map(m=>decrypt(identity,m,c)));setMessages(current=>({...current,[id]:merge(decoded,current[id]||[])}));more=data.hasMore;before=decoded[0]?.id;}
    setHasMore(current=>({...current,[id]:more}));
  }
  function emitAck<T>(event:string,payload:unknown,timeoutMessage='Delivery not confirmed. Retry unchanged to check safely.'){
    if(!socket.current?.connected)throw new Error('You’re offline. Reconnect and retry.');
    return new Promise<T>((resolve,reject)=>socket.current!.timeout(7000).emit(event,payload,(err:Error|null,result:T)=>err?reject(new Error(timeoutMessage)):resolve(result)));
  }
  const storeMessage=(conversationId:string,message:Message)=>setMessages(current=>({...current,[conversationId]:merge(current[conversationId]||[],[message])}));
  async function send(conversationId:string,body:string,clientId:string,outgoing?:Outgoing){
    if(!socket.current?.connected)throw new Error('You’re offline. Reconnect and retry.');
    const c=await findConversation(conversationId);
    const cached=pending.current.get(clientId);
    if(cached&&(cached.body!==body||cached.file!==outgoing?.file))throw new Error('Retry text changed. Start a new message.');
    let entry=cached;
    if(!entry){
      let attachment:Attachment|undefined,attachmentId:string|undefined;
      if(outgoing){
        if(outgoing.file.size>MAX_ATTACHMENT_BYTES)throw new Error('Files can be up to 25 MB.');
        const {mime,kind,name}=await checkOutgoing(outgoing.file,outgoing.name);
        // Encrypt in the browser, upload opaque bytes, and keep the key inside the encrypted message.
        const sealed=await encryptFile(outgoing.file);
        attachmentId=(await upload<{id:string}>(`/conversations/${conversationId}/attachments`,sealed.ciphertext,'application/octet-stream')).id;
        attachment={id:attachmentId,key:sealed.key,iv:sealed.iv,mime,name,size:outgoing.file.size,kind,duration:outgoing.duration};
      }
      const payload=encodeBody(body,attachment);
      entry={body,file:outgoing?.file,attachmentId,payload,encrypted:await encrypt(identity,c,clientId,payload)};
      pending.current.set(clientId,entry);
    }
    let ack=await emitAck<SendAck>('message:send',{conversationId,clientId,encrypted:entry.encrypted,...(entry.attachmentId?{attachmentId:entry.attachmentId}:{})});
    // Someone joined or left while this was being prepared: re-encrypt for the current members once.
    if(!ack.ok&&ack.error==='Encrypt for exactly the conversation members.'){
      const fresh=(await refreshConversations()).find(x=>x.id===conversationId);
      if(!fresh)throw new Error('You are no longer in this conversation.');
      entry={...entry,encrypted:await encrypt(identity,fresh,clientId,decodeBodyForResend(entry))};pending.current.set(clientId,entry);
      ack=await emitAck<SendAck>('message:send',{conversationId,clientId,encrypted:entry.encrypted,...(entry.attachmentId?{attachmentId:entry.attachmentId}:{})});
    }
    if(!ack.ok)throw new Error(ack.error);
    const sent=await decrypt(identity,ack.message,c);storeMessage(conversationId,sent);preview(sent,c);pending.current.delete(clientId);
  }
  async function edit(message:Message,text:string){
    const c=await findConversation(message.conversationId);
    const encrypted=await encrypt(identity,c,message.clientId,encodeBody(text,message.attachment));
    const ack=await emitAck<SendAck>('message:edit',{messageId:message.id,encrypted},'Edit not confirmed. Try again.');
    if(!ack.ok)throw new Error(ack.error);
    const updated=await decrypt(identity,ack.message,c);
    setMessages(current=>({...current,[c.id]:(current[c.id]||[]).map(m=>m.id===updated.id?updated:m)}));if(c.lastMessageId<=updated.id)preview(updated,c);
  }
  async function remove(message:Message){
    const ack=await emitAck<SendAck>('message:delete',{messageId:message.id},'Delete not confirmed. Try again.');
    if(!ack.ok)throw new Error(ack.error);
    setMessages(current=>({...current,[message.conversationId]:(current[message.conversationId]||[]).map(m=>m.id===message.id?{...m,deleted:true,body:'',attachment:undefined,encrypted:null,reactions:[]}:m)}));
  }
  async function react(message:Message,emoji:string){
    const ack=await emitAck<{ok:true;reactions:Reaction[]}|{ok:false;error:string}>('reaction:toggle',{messageId:message.id,emoji},'Reaction not confirmed. Try again.');
    if(!ack.ok)throw new Error(ack.error);
    setMessages(current=>({...current,[message.conversationId]:(current[message.conversationId]||[]).map(m=>m.id===message.id?{...m,reactions:ack.reactions}:m)}));
  }
  // One "typing" ping every 2s while typing, and "stopped" only once, instead of an event per keystroke.
  const typingSent=useRef(new Map<string,number>());
  function emitTyping(conversationId:string,value:boolean){
    if(!socket.current?.connected)return;
    const last=typingSent.current.get(conversationId)||0;
    if(value){if(Date.now()-last<2000)return;typingSent.current.set(conversationId,Date.now());}
    else{if(!last)return;typingSent.current.delete(conversationId);}
    socket.current.emit('typing:set',{conversationId,typing:value});
  }
  const conversationsWithPreview=conversations.map(c=>previews[c.id]?{...c,lastMessage:previews[c.id].text}:c);
  const typingNames=activeId?Object.values(typing[activeId]||{}).filter(p=>p.until>Date.now()).map(p=>p.name):[];
  return {conversations:conversationsWithPreview,activeId,setActiveId,messages:activeId?messages[activeId]||[]:[],hasMore:activeId?!!hasMore[activeId]:false,typing:typingNames.length?`${typingNames.join(', ')} ${typingNames.length===1?'is':'are'} typing…`:'',online,connected,error,setError,loading,startChat,createGroup,addMembers,removeMember,older,loadAll,send,edit,remove,react,refreshConversations,
    emitTyping,socket:socketState};
}
