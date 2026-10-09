import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ArrowLeft,Send,Eraser,X,ListTodo,Info} from 'lucide-react';
import type {AiMessage,User} from '../lib/types';
import {AI_NAME} from '../hooks/useAssistant';
import Avatar from './Avatar';
import {AiAvatar,AiText,ItemChips,Thinking} from './AiBits';
const SUGGESTIONS=['Remind me to submit the hackathon deck at 11 PM','Add a task: record the demo video','What’s on my to-do list?','Explain WebSockets in two sentences'];
// Private chat with Common Room AI. Only this person sees it.
export default function AssistantPanel({user,messages,thinking,configured,provider,onAsk,onClear,onBack,onOpenItems}:{user:User;messages:AiMessage[];thinking:boolean;configured:boolean|null;provider?:string|null;onAsk:(prompt:string)=>Promise<void>;onClear:()=>Promise<void>;onBack:()=>void;onOpenItems:()=>void}){
  const [draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const bottom=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
  useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages.length,thinking]);
  useEffect(()=>{input.current?.focus();},[]);
  async function send(text:string){
    const prompt=text.trim();if(!prompt||busy)return;
    setBusy(true);setError('');setDraft('');
    try{await onAsk(prompt);}catch(e){setDraft(prompt);setError(e instanceof Error?e.message:'The AI could not answer.');}
    finally{setBusy(false);input.current?.focus();}
  }
  const submit=(e:FormEvent)=>{e.preventDefault();void send(draft);};
  return <section className="flex h-full min-w-0 flex-1 flex-col bg-canvas text-ink">
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line px-3 sm:px-6">
      <button aria-label="Back to conversations" className="icon-button md:hidden" onClick={onBack}><ArrowLeft size={19}/></button>
      <AiAvatar/>
      <div className="min-w-0 flex-1"><h2 className="truncate text-base font-bold">{AI_NAME}</h2><p className="mt-0.5 text-[11px] text-muted">Your private assistant{provider ? ` · powered by ${provider}` : ''}</p></div>
      <button className="icon-button" aria-label="Reminders and tasks" title="Reminders & tasks" onClick={onOpenItems}><ListTodo size={18}/></button>
      <button className="icon-button" aria-label="Clear AI chat history" title="Clear chat history" disabled={!messages.length} onClick={()=>{if(confirm('Clear your chat history with Common Room AI? Reminders and tasks stay.'))void onClear().catch(e=>setError(e instanceof Error?e.message:'Could not clear.'));}}><Eraser size={18}/></button>
    </header>
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line px-5 text-[10px] text-muted sm:px-7"><Info size={12}/>Only you see this chat. Messages here go to the AI service{provider ? ` (${provider})` : ''} and are not end-to-end encrypted.</div>
    {configured===false&&<p className="warning-notice mx-4 mt-3">The AI isn’t switched on yet. Add <code>GROQ_API_KEY=your-key</code> to <code>backend/.env</code> and restart Commonroom.</p>}
    <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-5" role="log" aria-label="AI chat" aria-live="polite">
      {!messages.length&&<div className="px-5 pb-6 sm:px-7"><AiAvatar/><h3 className="mt-4 text-2xl font-bold tracking-tight">Hi {user.name.split(' ')[0]}, how can I help?</h3><p className="mt-2 max-w-xl text-[13px] leading-6 text-muted">Ask me anything, or have me set reminders and tasks. In any chat, mention <span className="font-semibold text-accent">@ai</span> to ask me there. I only read a chat’s earlier messages when you ask me to.</p>
        <div className="mt-5 flex flex-wrap gap-2">{SUGGESTIONS.map(s=><button key={s} disabled={busy} onClick={()=>void send(s)} className="secondary-button rounded-full px-3 py-1.5 text-xs">{s}</button>)}</div></div>}
      {messages.map(m=>m.role==='user'
        ?<article key={m.id} className="message-row"><Avatar name={user.name} src={user.avatarUrl}/><div className="min-w-0 flex-1"><p className="text-[13px] font-bold">You</p><p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.65]">{m.body}</p></div></article>
        :<article key={m.id} className="message-row"><AiAvatar/><div className="min-w-0 flex-1"><p className="flex items-center gap-2 text-[13px]"><span className="font-bold">{AI_NAME}</span><time className="text-[10px] text-muted" dateTime={m.createdAt}>{new Date(m.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}</time></p><div className="mt-0.5"><AiText text={m.body}/><ItemChips items={m.items}/></div></div></article>)}
      {thinking&&<Thinking/>}<div ref={bottom}/>
    </div>
    <form onSubmit={submit} className="shrink-0 bg-canvas px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      {error&&<p role="alert" className="error-notice mb-2 flex items-center justify-between gap-2">{error}<button type="button" aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></p>}
      <div className="overflow-hidden rounded-xl border border-line bg-panel focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <textarea ref={input} aria-label="Message Common Room AI" placeholder="Ask anything, or “remind me to… at 6 pm”" rows={2} maxLength={2000} value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(draft);}}} className="block max-h-36 min-h-[70px] w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[13px] leading-6"/>
        <div className="flex items-center justify-end px-2 pb-2"><button type="submit" disabled={busy||!draft.trim()} aria-label="Ask Common Room AI" className="primary-button rounded-md px-3 py-2"><Send size={15}/><span className="hidden text-xs sm:inline">Ask</span></button></div>
      </div>
    </form>
  </section>;
}
