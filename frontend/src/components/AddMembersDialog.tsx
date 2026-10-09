import {useEffect,useRef,useState} from 'react';
import {Search,X,Check,UserPlus} from 'lucide-react';
import {api} from '../lib/api';
import type {Conversation,User} from '../lib/types';
import {MAX_GROUP_MEMBERS} from '../../../shared/limits';
import Avatar from './Avatar';
export default function AddMembersDialog({conversation,onClose,onAdd}:{conversation:Conversation;onClose:()=>void;onAdd:(ids:string[])=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState(''),[people,setPeople]=useState<User[]>([]),[selected,setSelected]=useState<User[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const existing=new Set(conversation.members.map(m=>m.id));
  const room=MAX_GROUP_MEMBERS-conversation.members.length;
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  useEffect(()=>{const controller=new AbortController();const timer=setTimeout(()=>{void api<{users:User[]}>(`/users?q=${encodeURIComponent(query)}`,{signal:controller.signal}).then(d=>setPeople(d.users)).catch(e=>{if(!controller.signal.aborted)setError(e.message);});},200);return()=>{clearTimeout(timer);controller.abort();};},[query]);
  const toggle=(u:User)=>setSelected(c=>c.some(x=>x.id===u.id)?c.filter(x=>x.id!==u.id):[...c,u]);
  return <dialog ref={dialog} onCancel={onClose} className="dialog-panel" aria-labelledby="add-title">
    <div className="flex items-center justify-between"><h2 id="add-title" className="text-lg font-bold">Add people to {conversation.peer.name}</h2><button aria-label="Close" className="icon-button" onClick={onClose}><X size={18}/></button></div>
    <p className="mt-1 text-xs text-muted">New members see messages sent after they join. Earlier messages stay unreadable to them.</p>
    <div className="relative my-4"><Search className="absolute left-3 top-3.5 text-muted" size={16}/><input autoFocus aria-label="Search people to add" className="field pl-10" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name or username"/></div>
    {!!selected.length&&<div className="mb-3 flex flex-wrap gap-1.5">{selected.map(u=><button key={u.id} className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] text-accent" onClick={()=>toggle(u)}>{u.name}<X size={11}/></button>)}</div>}
    {error&&<p role="alert" className="error-notice mb-3">{error}</p>}
    <div className="max-h-64 space-y-1 overflow-y-auto">{people.filter(p=>!existing.has(p.id)).map(person=>{const chosen=selected.some(u=>u.id===person.id);return <button key={person.id} disabled={busy||!person.encryptionReady||(!chosen&&selected.length>=room)} onClick={()=>toggle(person)} className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-soft"><Avatar name={person.name} src={person.avatarUrl}/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.name}</span><span className="text-xs text-muted">{person.encryptionReady?`@${person.username}`:'Has not opened chats yet'}</span></span><span className={`grid h-5 w-5 place-items-center rounded border ${chosen?'border-accent bg-accent-soft text-accent':'border-line'}`}>{chosen&&<Check size={14}/>}</span></button>;})}</div>
    <button disabled={busy||!selected.length} className="primary-button mt-4 w-full" onClick={async()=>{setBusy(true);setError('');try{await onAdd(selected.map(u=>u.id));onClose();}catch(e){setError(e instanceof Error?e.message:'Could not add people.');}finally{setBusy(false);}}}><UserPlus size={15}/>{busy?'Adding…':`Add ${selected.length||''} ${selected.length===1?'person':'people'}`}</button>
  </dialog>;
}
