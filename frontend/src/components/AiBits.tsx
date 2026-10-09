import {Fragment} from 'react';
import {Sparkles,AlarmClock,ListTodo,BookOpen} from 'lucide-react';
import type {AiItemSummary,AiMessage} from '../lib/types';
import {AI_NAME} from '../hooks/useAssistant';
export function AiAvatar({small=false}:{small?:boolean}){
  return <span aria-hidden className={`grid shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[var(--brand)] to-[#2f7fd8] text-white ${small?'h-7 w-7':'h-9 w-9'}`}><Sparkles size={small?14:17}/></span>;
}
export function formatDue(value:string|null){
  if(!value)return 'No date';
  const date=new Date(value),today=new Date(),tomorrow=new Date();tomorrow.setDate(today.getDate()+1);
  const time=date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  if(date.toDateString()===today.toDateString())return `Today, ${time}`;
  if(date.toDateString()===tomorrow.toDateString())return `Tomorrow, ${time}`;
  return `${date.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})}, ${time}`;
}
// Light formatting for AI answers: **bold**, `code` and bullet lines. Text is never injected as HTML.
function inline(text:string){
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')&&part.length>4?<strong key={i}>{part.slice(2,-2)}</strong>:part.startsWith('`')&&part.endsWith('`')&&part.length>2?<code key={i} className="rounded bg-soft px-1 text-[12px]">{part.slice(1,-1)}</code>:<Fragment key={i}>{part}</Fragment>);
}
export function AiText({text}:{text:string}){
  return <div className="space-y-1 break-words text-[13px] leading-[1.65] [overflow-wrap:anywhere]">{text.split('\n').map((line,i)=>{
    const bullet=line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if(bullet)return <p key={i} className="flex gap-2 pl-1"><span className="text-muted">•</span><span>{inline(bullet[1])}</span></p>;
    const heading=line.match(/^#{1,4}\s+(.*)$/);
    if(heading)return <p key={i} className="font-semibold">{inline(heading[1])}</p>;
    return line.trim()?<p key={i}>{inline(line)}</p>:<div key={i} className="h-1"/>;
  })}</div>;
}
export function ItemChips({items}:{items:AiItemSummary[]}){
  if(!items.length)return null;
  return <div className="mt-2 flex flex-wrap gap-1.5">{items.map(item=><span key={item.id} className="flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2 py-1 text-[11px]">{item.kind==='reminder'?<AlarmClock size={12} className="text-accent"/>:<ListTodo size={12} className="text-accent"/>}<span className="font-semibold">{item.title}</span>{item.dueAt&&<span className="text-muted">· {formatDue(item.dueAt)}</span>}</span>)}</div>;
}
// An AI answer shown inside a regular chat, visible to everyone in that chat.
export function AiReply({message}:{message:AiMessage}){
  const time=new Date(message.createdAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
  return <article className="message-row" aria-label={`${AI_NAME} reply`}>
    <AiAvatar/>
    <div className="min-w-0 flex-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]"><span className="font-bold">{AI_NAME}</span><span className="rounded bg-accent-soft px-1.5 py-px text-[9px] font-semibold text-accent">AI</span><time className="text-[10px] text-muted" dateTime={message.createdAt}>{time}</time>{message.askedBy&&<span className="text-[10px] text-muted">answering {message.askedBy.name}</span>}</p>
      {message.contextCount>0&&<p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted"><BookOpen size={11}/>Read the last {message.contextCount} messages because {message.askedBy?.name||'someone'} asked</p>}
      <div className="mt-1 rounded-lg border border-line bg-soft px-3 py-2"><AiText text={message.body}/><ItemChips items={message.items}/></div>
    </div>
  </article>;
}
export function Thinking({label=`${AI_NAME} is thinking…`}:{label?:string}){
  return <p role="status" className="mt-3 flex items-center gap-2 px-7 text-[11px] text-muted"><Sparkles size={12} className="animate-pulse text-accent"/>{label}</p>;
}
