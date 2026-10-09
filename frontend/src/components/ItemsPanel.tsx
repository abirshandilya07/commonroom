import {useState,type FormEvent} from 'react';
import {ArrowLeft,AlarmClock,ListTodo,Trash2,Plus,Sparkles,MessageSquare} from 'lucide-react';
import type {Item} from '../lib/types';
import {formatDue} from './AiBits';
type Filter='all'|'reminder'|'task';
// Every reminder and task, whether set by Common Room AI in any chat or added here.
export default function ItemsPanel({items,onBack,onAdd,onToggle,onRemove,onOpenAssistant}:{items:Item[];onBack:()=>void;onAdd:(kind:'reminder'|'task',title:string,dueAt:string|null)=>Promise<void>;onToggle:(item:Item)=>Promise<void>;onRemove:(item:Item)=>Promise<void>;onOpenAssistant:()=>void}){
  const [filter,setFilter]=useState<Filter>('all'),[kind,setKind]=useState<'reminder'|'task'>('task'),[title,setTitle]=useState(''),[due,setDue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const shown=items.filter(i=>filter==='all'||i.kind===filter);
  const now=Date.now();
  const groups:[string,Item[]][]=[
    ['Overdue',shown.filter(i=>!i.done&&i.dueAt&&Date.parse(i.dueAt)<now)],
    ['Upcoming',shown.filter(i=>!i.done&&i.dueAt&&Date.parse(i.dueAt)>=now)],
    ['No date',shown.filter(i=>!i.done&&!i.dueAt)],
    ['Done',shown.filter(i=>i.done)],
  ];
  async function add(e:FormEvent){
    e.preventDefault();if(!title.trim()||busy)return;
    if(kind==='reminder'&&!due){setError('Pick a date and time for the reminder.');return;}
    setBusy(true);setError('');
    try{await onAdd(kind,title.trim(),due?new Date(due).toISOString():null);setTitle('');setDue('');}
    catch(err){setError(err instanceof Error?err.message:'Could not add that.');}finally{setBusy(false);}
  }
  const run=(action:Promise<void>)=>void action.catch(err=>setError(err instanceof Error?err.message:'Something went wrong.'));
  const open=items.filter(i=>!i.done).length;
  return <section className="flex h-full min-w-0 flex-1 flex-col bg-canvas text-ink">
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line px-3 sm:px-6">
      <button aria-label="Back to conversations" className="icon-button md:hidden" onClick={onBack}><ArrowLeft size={19}/></button>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><ListTodo size={18}/></span>
      <div className="min-w-0 flex-1"><h2 className="truncate text-base font-bold">Reminders &amp; tasks</h2><p className="mt-0.5 text-[11px] text-muted">{open?`${open} open`:'All clear'} · set by you or by Common Room AI</p></div>
      <button className="secondary-button text-xs" onClick={onOpenAssistant}><Sparkles size={14}/>Ask AI</button>
    </header>
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-4 text-xs sm:px-6">{([['all','All'],['reminder','Reminders'],['task','Tasks']] as const).map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value)} className={`flex h-full items-center border-b-2 px-2.5 ${filter===value?'border-accent font-semibold':'border-transparent text-muted hover:text-ink'}`}>{label}</button>)}</div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7">
      <form onSubmit={add} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-soft p-3">
        <select aria-label="Type" value={kind} onChange={e=>setKind(e.target.value as 'reminder'|'task')} className="h-9 rounded-lg border border-line bg-panel px-2 text-xs"><option value="task">Task</option><option value="reminder">Reminder</option></select>
        <input aria-label="Title" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder={kind==='task'?'Add a task…':'Remind me to…'} className="h-9 min-w-[10rem] flex-1 rounded-lg border border-line bg-panel px-3 text-xs"/>
        <input aria-label="Due date and time" type="datetime-local" value={due} onChange={e=>setDue(e.target.value)} className="h-9 rounded-lg border border-line bg-panel px-2 text-xs"/>
        <button disabled={busy||!title.trim()} className="primary-button h-9 px-3 py-0 text-xs"><Plus size={14}/>Add</button>
      </form>
      {error&&<p role="alert" className="error-notice mt-3">{error}</p>}
      <p className="mt-3 text-[11px] text-muted">Tip: in any chat, write <span className="font-semibold text-accent">@ai remind me to…</span> or <span className="font-semibold text-accent">@ai add a task…</span></p>
      {!shown.length&&<p className="py-12 text-center text-sm text-muted">Nothing here yet.</p>}
      {groups.map(([label,list])=>list.length?<div key={label} className="mt-6"><h3 className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${label==='Overdue'?'text-red-500':'text-muted'}`}>{label} · {list.length}</h3><ul className="space-y-1.5">{list.map(item=><li key={item.id} className="group flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2.5">
        <input type="checkbox" aria-label={`Mark “${item.title}” ${item.done?'not done':'done'}`} checked={item.done} onChange={()=>run(onToggle(item))} className="h-4 w-4 accent-[var(--brand)]"/>
        {item.kind==='reminder'?<AlarmClock size={15} className="shrink-0 text-accent"/>:<ListTodo size={15} className="shrink-0 text-accent"/>}
        <span className="min-w-0 flex-1"><span className={`block truncate text-[13px] font-semibold ${item.done?'text-muted line-through':''}`}>{item.title}</span><span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted"><span className={!item.done&&item.dueAt&&Date.parse(item.dueAt)<now?'text-red-500':''}>{formatDue(item.dueAt)}</span>{item.conversationName&&<span className="flex items-center gap-1"><MessageSquare size={10}/>from {item.conversationName}</span>}</span></span>
        <button aria-label={`Delete “${item.title}”`} title="Delete" className="icon-button h-7 w-7 hover:text-red-500" onClick={()=>run(onRemove(item))}><Trash2 size={14}/></button>
      </li>)}</ul></div>:null)}
    </div>
  </section>;
}
