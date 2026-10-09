import {useEffect,useRef,useState,type FormEvent} from 'react';
import {ChevronLeft,ChevronRight,AlarmClock,ListTodo,Plus,Trash2,X,Pencil,MessageSquare} from 'lucide-react';
import type {Item} from '../lib/types';
type Changes={title?:string;dueAt?:string|null;done?:boolean};
type Open={day:Date}|{item:Item}|null;
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dayKey=(d:Date)=>`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const pad=(n:number)=>String(n).padStart(2,'0');
// "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">.
const toLocalInput=(iso:string)=>{const d=new Date(iso);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
const timeOf=(iso:string)=>new Date(iso).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
const message=(err:unknown,fallback:string)=>err instanceof Error?err.message:fallback;
const KindIcon=({item,size}:{item:Item;size:number})=>item.kind==='reminder'?<AlarmClock size={size} className="shrink-0 text-accent"/>:<ListTodo size={size} className="shrink-0 text-accent"/>;

// Month calendar of reminders and tasks: click a day to see or add items for it, click an item to edit it.
export default function CalendarView({items,onAdd,onUpdate,onToggle,onRemove}:{items:Item[];onAdd:(kind:'reminder'|'task',title:string,dueAt:string|null)=>Promise<void>;onUpdate:(item:Item,changes:Changes)=>Promise<void>;onToggle:(item:Item)=>Promise<void>;onRemove:(item:Item)=>Promise<void>}){
  const [month,setMonth]=useState(()=>{const d=new Date();return new Date(d.getFullYear(),d.getMonth(),1);});
  const [open,setOpen]=useState<Open>(null);
  const today=dayKey(new Date()),now=Date.now();
  const byDay=new Map<string,Item[]>();
  for(const item of items)if(item.dueAt){const key=dayKey(new Date(item.dueAt));byDay.set(key,[...(byDay.get(key)||[]),item]);}
  for(const list of byDay.values())list.sort((a,b)=>Number(a.done)-Number(b.done)||Date.parse(a.dueAt!)-Date.parse(b.dueAt!));
  const start=new Date(month);start.setDate(1-month.getDay());
  const days=Array.from({length:42},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
  const undated=items.filter(i=>!i.dueAt&&!i.done);
  const shift=(by:number)=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()+by,1));
  // Keep an open item dialog in sync with live updates (or close it if the item was deleted).
  const openItem=open&&'item' in open?items.find(i=>i.id===open.item.id):undefined;
  useEffect(()=>{if(open&&'item' in open&&!openItem)setOpen(null);},[open,openItem]);
  return <div>
    <div className="flex items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-lg font-bold">{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h3>
      <button className="secondary-button h-8 px-2.5 py-0 text-xs" onClick={()=>{const d=new Date();setMonth(new Date(d.getFullYear(),d.getMonth(),1));}}>Today</button>
      <button aria-label="Previous month" className="icon-button h-8 w-8" onClick={()=>shift(-1)}><ChevronLeft size={17}/></button>
      <button aria-label="Next month" className="icon-button h-8 w-8" onClick={()=>shift(1)}><ChevronRight size={17}/></button>
    </div>
    <div className="mt-3 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="grid grid-cols-7 border-b border-line bg-soft">{WEEKDAYS.map(d=><div key={d} className="py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">{d}</div>)}</div>
      <div className="grid grid-cols-7">{days.map((day,i)=>{
        const list=byDay.get(dayKey(day))||[],inMonth=day.getMonth()===month.getMonth(),isToday=dayKey(day)===today;
        const label=`${day.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}${list.length?`, ${list.length} item${list.length===1?'':'s'}`:''}. Add a task`;
        return <div key={i} role="button" tabIndex={0} aria-label={label} onClick={()=>setOpen({day})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setOpen({day});}}}
          className={`group relative min-h-[3.75rem] cursor-pointer border-line p-1 text-left transition hover:bg-soft focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-[var(--brand)] sm:min-h-[6.75rem] sm:p-1.5 ${i%7?'border-l':''} ${i>=7?'border-t':''} ${inMonth?'':'bg-soft/60'}`}>
          <div className="flex items-center justify-between">
            <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-[11px] ${isToday?'bg-[var(--brand)] font-bold text-white':inMonth?'font-semibold':'text-muted'}`}>{day.getDate()}</span>
            <Plus size={13} aria-hidden className="hidden text-muted opacity-0 transition group-hover:opacity-100 sm:block"/>
          </div>
          {/* Phones get dots, wider screens get titled chips. */}
          {!!list.length&&<div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">{list.slice(0,4).map(item=><span key={item.id} className={`h-1.5 w-1.5 rounded-full ${item.done?'bg-line':'bg-[var(--brand)]'}`}/>)}</div>}
          <div className="mt-1 hidden space-y-0.5 sm:block">{list.slice(0,3).map(item=>{const late=!item.done&&Date.parse(item.dueAt!)<now;return <button key={item.id} title={`${item.title} · ${timeOf(item.dueAt!)}`} onClick={e=>{e.stopPropagation();setOpen({item});}}
            className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10.5px] leading-tight hover:brightness-95 ${item.done?'text-muted line-through':late?'bg-red-500/10 text-red-500':'bg-accent-soft text-ink'}`}>
            <KindIcon item={item} size={10}/><span className="shrink-0 text-muted">{timeOf(item.dueAt!)}</span><span className="truncate font-medium">{item.title}</span></button>;})}
            {list.length>3&&<span className="block px-1 text-[10px] font-semibold text-accent">+{list.length-3} more</span>}
          </div>
        </div>;})}</div>
    </div>
    <p className="mt-2 text-[11px] text-muted">Click a day to add a task or reminder for it. Click an item to edit or move it.</p>
    {!!undated.length&&<div className="mt-5"><h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">No date · {undated.length}</h3>
      <div className="flex flex-wrap gap-1.5">{undated.map(item=><button key={item.id} onClick={()=>setOpen({item})} className="flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs hover:bg-soft"><KindIcon item={item} size={12}/><span className="truncate">{item.title}</span></button>)}</div></div>}
    {open&&'day' in open&&<DayDialog day={open.day} list={byDay.get(dayKey(open.day))||[]} onClose={()=>setOpen(null)} onAdd={onAdd} onToggle={onToggle} onEdit={item=>setOpen({item})}/>}
    {openItem&&<ItemDialog item={openItem} onClose={()=>setOpen(null)} onUpdate={onUpdate} onRemove={onRemove}/>}
  </div>;
}

function useModal(){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const el=ref.current;el?.showModal();return()=>el?.close();},[]);
  return ref;
}

function DayDialog({day,list,onClose,onAdd,onToggle,onEdit}:{day:Date;list:Item[];onClose:()=>void;onAdd:(kind:'reminder'|'task',title:string,dueAt:string|null)=>Promise<void>;onToggle:(item:Item)=>Promise<void>;onEdit:(item:Item)=>void}){
  const ref=useModal();
  const [kind,setKind]=useState<'reminder'|'task'>('task'),[title,setTitle]=useState(''),[time,setTime]=useState('09:00'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function add(e:FormEvent){
    e.preventDefault();if(!title.trim()||busy)return;
    const [h,m]=(time||'09:00').split(':').map(Number);
    setBusy(true);setError('');
    try{await onAdd(kind,title.trim(),new Date(day.getFullYear(),day.getMonth(),day.getDate(),h,m).toISOString());setTitle('');}
    catch(err){setError(message(err,'Could not add that.'));}finally{setBusy(false);}
  }
  return <dialog ref={ref} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}} className="dialog-panel" aria-labelledby="day-title">
    <div className="flex items-center justify-between gap-2"><h2 id="day-title" className="text-lg font-bold">{day.toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</h2><button aria-label="Close" className="icon-button" onClick={onClose}><X size={18}/></button></div>
    {list.length?<ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto">{list.map(item=><li key={item.id} className="flex items-center gap-2.5 rounded-lg border border-line bg-soft px-3 py-2">
      <input type="checkbox" aria-label={`Mark “${item.title}” ${item.done?'not done':'done'}`} checked={item.done} onChange={()=>void onToggle(item).catch(err=>setError(message(err,'Something went wrong.')))} className="h-4 w-4 accent-[var(--brand)]"/>
      <KindIcon item={item} size={14}/>
      <span className="min-w-0 flex-1"><span className={`block truncate text-[13px] font-semibold ${item.done?'text-muted line-through':''}`}>{item.title}</span><span className="text-[10px] text-muted">{timeOf(item.dueAt!)}</span></span>
      <button aria-label={`Edit “${item.title}”`} title="Edit" className="icon-button h-7 w-7" onClick={()=>onEdit(item)}><Pencil size={13}/></button>
    </li>)}</ul>:<p className="mt-2 text-xs text-muted">Nothing planned for this day yet.</p>}
    <form onSubmit={add} className="mt-4 space-y-2 rounded-xl border border-line bg-soft p-3">
      <div className="flex gap-2">
        <select aria-label="Type" value={kind} onChange={e=>setKind(e.target.value as 'reminder'|'task')} className="h-9 rounded-lg border border-line bg-panel px-2 text-xs"><option value="task">Task</option><option value="reminder">Reminder</option></select>
        <input aria-label="Time" type="time" required value={time} onChange={e=>setTime(e.target.value)} className="h-9 rounded-lg border border-line bg-panel px-2 text-xs"/>
      </div>
      <div className="flex gap-2">
        <input autoFocus aria-label="Title" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder={kind==='task'?'Add a task…':'Remind me to…'} className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 text-xs"/>
        <button disabled={busy||!title.trim()} className="primary-button h-9 px-3 py-0 text-xs"><Plus size={14}/>Add</button>
      </div>
    </form>
    {error&&<p role="alert" className="error-notice mt-3">{error}</p>}
  </dialog>;
}

function ItemDialog({item,onClose,onUpdate,onRemove}:{item:Item;onClose:()=>void;onUpdate:(item:Item,changes:Changes)=>Promise<void>;onRemove:(item:Item)=>Promise<void>}){
  const ref=useModal();
  const [title,setTitle]=useState(item.title),[due,setDue]=useState(item.dueAt?toLocalInput(item.dueAt):''),[done,setDone]=useState(item.done),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function save(e:FormEvent){
    e.preventDefault();if(!title.trim()||busy)return;
    if(item.kind==='reminder'&&!due){setError('A reminder needs a date and time.');return;}
    const dueAt=due?new Date(due).toISOString():null;
    const changes:Changes={};
    if(title.trim()!==item.title)changes.title=title.trim();
    if(dueAt!==(item.dueAt?new Date(item.dueAt).toISOString():null))changes.dueAt=dueAt;
    if(done!==item.done)changes.done=done;
    setBusy(true);setError('');
    try{if(Object.keys(changes).length)await onUpdate(item,changes);onClose();}
    catch(err){setError(message(err,'Could not save that.'));}finally{setBusy(false);}
  }
  async function remove(){setBusy(true);setError('');try{await onRemove(item);onClose();}catch(err){setError(message(err,'Could not delete that.'));setBusy(false);}}
  return <dialog ref={ref} onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}} className="dialog-panel" aria-labelledby="item-title">
    <form onSubmit={save}>
      <div className="flex items-center justify-between gap-2"><h2 id="item-title" className="flex items-center gap-2 text-lg font-bold"><KindIcon item={item} size={17}/>Edit {item.kind}</h2><button type="button" aria-label="Close" className="icon-button" onClick={onClose}><X size={18}/></button></div>
      {item.conversationName&&<p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><MessageSquare size={11}/>Set from {item.conversationName}</p>}
      <label className="mt-4 block text-xs font-semibold">Title<input autoFocus value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} className="field mt-1"/></label>
      <label className="mt-3 block text-xs font-semibold">Date and time<div className="mt-1 flex items-center gap-2"><input type="datetime-local" value={due} onChange={e=>setDue(e.target.value)} className="field min-w-0 flex-1"/>{item.kind==='task'&&due&&<button type="button" className="secondary-button text-xs" onClick={()=>setDue('')}>No date</button>}</div></label>
      <label className="mt-3 flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={done} onChange={e=>setDone(e.target.checked)} className="h-4 w-4 accent-[var(--brand)]"/>Done</label>
      {error&&<p role="alert" className="error-notice mt-3">{error}</p>}
      <div className="mt-5 flex items-center gap-2">
        <button type="button" disabled={busy} className="secondary-button text-xs text-red-500" onClick={()=>void remove()}><Trash2 size={14}/>Delete</button>
        <span className="flex-1"/>
        <button type="button" className="secondary-button text-xs" onClick={onClose}>Cancel</button>
        <button disabled={busy||!title.trim()} className="primary-button text-xs">{busy?'Saving…':'Save'}</button>
      </div>
    </form>
  </dialog>;
}
