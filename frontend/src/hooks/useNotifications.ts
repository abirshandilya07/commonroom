import {useCallback,useEffect,useRef,useState} from 'react';
import type {Conversation,WireMessage} from '../lib/types';
type Settings={sound:boolean;desktop:boolean};
export type Notice={id:number;conversationId:string;title:string};
export function useNotifications(userId:string,muted=false) {
  const key=`commonroom-notifications:${userId}`;
  const [settings,setSettings]=useState<Settings>(()=>{try{return {...{sound:false,desktop:false},...JSON.parse(localStorage.getItem(key)||'{}')};}catch{return {sound:false,desktop:false};}});
  const [toast,setToast]=useState<Notice|null>(null),[error,setError]=useState('');
  const refs=useRef(settings);refs.current=settings;
  // Do not disturb: unread counts still update, but no toasts, sounds or desktop alerts.
  const mutedRef=useRef(muted);mutedRef.current=muted;
  const audio=useRef<AudioContext|null>(null),lastSound=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const delivered=useRef(new Set<number>());
  const desktopNotices=useRef(new Set<Notification>());
  const [target,setTarget]=useState<string|null>(null);
  const save=(next:Settings)=>{setSettings(next);try{localStorage.setItem(key,JSON.stringify(next));}catch{/* preferences remain for this page */}};
  const play=useCallback(async()=>{
    try {
      audio.current ||= new AudioContext();
      if(audio.current.state==='suspended')await audio.current.resume();
      if(audio.current.state!=='running')return;
      const start=audio.current.currentTime;
      for(const [offset,hz] of [[0,660],[0.13,880]]) {
        const osc=audio.current.createOscillator(),gain=audio.current.createGain();osc.type='sine';osc.frequency.value=hz;
        gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(0.07,start+offset+0.015);gain.gain.exponentialRampToValueAtTime(0.001,start+offset+0.16);
        osc.connect(gain);gain.connect(audio.current.destination);osc.start(start+offset);osc.stop(start+offset+0.18);osc.onended=()=>{osc.disconnect();gain.disconnect();};
      }
    }catch{setError('Sound is unavailable in this browser. In-app alerts still work.');}
  },[]);
  const notify=useCallback((message:WireMessage,conversation:Conversation)=>{
    if(delivered.current.has(message.id))return;delivered.current.add(message.id);
    if(mutedRef.current)return;
    if(delivered.current.size>500)delivered.current.delete(delivered.current.values().next().value!);
    const sender=conversation.members.find(m=>m.id===message.senderId)?.name||'Someone';
    const title=conversation.kind==='group'?`${sender} in ${conversation.peer.name}`:sender;
    setToast({id:message.id,conversationId:conversation.id,title});
    if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>setToast(null),6500);
    if(refs.current.sound && Date.now()-lastSound.current>1200){lastSound.current=Date.now();void play();}
    if(refs.current.desktop && 'Notification' in window && Notification.permission==='granted' && (document.hidden||!document.hasFocus())) {
      try {
        const notice=new Notification('Commonroom · New message',{body:`${title} sent a message.`,tag:`commonroom:${conversation.id}`});
        desktopNotices.current.add(notice);
        notice.onclick=()=>{window.focus();setTarget(conversation.id);notice.close();};
        notice.onclose=()=>desktopNotices.current.delete(notice);
      }catch{/* mobile browser may require a service worker; keep the in-app alert */}
    }
  },[play]);
  useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);void audio.current?.close();desktopNotices.current.forEach(n=>n.close());},[]);
  // Audio requires a user gesture in some browsers, including after a page reload.
  useEffect(()=>{const resume=()=>{if(refs.current.sound && 'AudioContext' in window){audio.current ||= new AudioContext();void audio.current.resume().catch(()=>{});}};window.addEventListener('pointerdown',resume);window.addEventListener('keydown',resume);return()=>{window.removeEventListener('pointerdown',resume);window.removeEventListener('keydown',resume);};},[]);
  return {settings,toast,error,target,setTarget,setToast,notify,play,
    toggleSound:()=>{const next=!settings.sound;save({...settings,sound:next});if(next)void play();},
    toggleDesktop:async()=>{setError('');if(settings.desktop){save({...settings,desktop:false});return;}
      if(!('Notification' in window)){setError('Desktop notifications are not supported here. In-app alerts remain available.');return;}
      try{const permission=await Notification.requestPermission();if(permission==='granted')save({...settings,desktop:true});else setError('Desktop permission was not granted. You can change this in your browser’s site settings.');}catch{setError('Could not request desktop notification permission.');}},
  };
}
