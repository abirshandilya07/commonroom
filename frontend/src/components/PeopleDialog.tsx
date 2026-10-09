import {useEffect,useRef,useState} from 'react';
import {Search,X,ArrowUpRight,Users,MessageSquare,Check} from 'lucide-react';
import {api} from '../lib/api';
import type {User} from '../lib/types';
import {MAX_GROUP_MEMBERS} from '../../../shared/limits';
import Avatar from './Avatar';
export default function PeopleDialog({onClose,onSelect,onGroup}:{onClose:()=>void;onSelect:(u:User)=>Promise<void>;onGroup:(title:string,ids:string[])=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [query,setQuery]=useState(''),[people,setPeople]=useState<User[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [page,setPage]=useState(0),[hasMore,setHasMore]=useState(false);
  const [group,setGroup]=useState(false),[title,setTitle]=useState(''),[selected,setSelected]=useState<User[]>([]);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);const timer=setTimeout(()=>{void api<{users:User[];hasMore:boolean}>(`/users?q=${encodeURIComponent(query)}&offset=${page*50}`,{signal:controller.signal}).then(data=>{if(controller.signal.aborted)return;setPeople(current=>page?[...current,...data.users]:data.users);setHasMore(data.hasMore);setError('');}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});},200);return()=>{clearTimeout(timer);controller.abort();};},[query,page]);
  async function select(person:User){if(group){setSelected(current=>current.some(u=>u.id===person.id)?current.filter(u=>u.id!==person.id):[...current,person]);return;}setBusy(true);try{await onSelect(person);onClose();}catch(e){setError(e instanceof Error?e.message:'Please try again.');}finally{setBusy(false);}}
  return <dialog ref={dialog} onCancel={onClose} className="dialog-panel" aria-labelledby="people-title"><div className="flex items-center justify-between"><h2 id="people-title" className="text-lg font-bold">New conversation</h2><button aria-label="Close people search" className="icon-button" onClick={onClose}><X size={18}/></button></div>
    <div className="my-4 flex gap-1 rounded-lg bg-soft p-1"><button aria-pressed={!group} disabled={busy} className={`flex flex-1 items-center justify-center gap-2 rounded-md p-2 text-xs ${!group?'bg-panel shadow-sm':''}`} onClick={()=>setGroup(false)}><MessageSquare size={14}/>Direct message</button><button aria-pressed={group} disabled={busy} className={`flex flex-1 items-center justify-center gap-2 rounded-md p-2 text-xs ${group?'bg-panel shadow-sm':''}`} onClick={()=>setGroup(true)}><Users size={14}/>Group chat</button></div>
    {group&&<label className="field-label">Group name<input aria-label="Group name" className="field" value={title} onChange={e=>setTitle(e.target.value)} maxLength={60} placeholder="e.g. Hackathon team"/></label>}
    <div className="relative my-4"><Search className="absolute left-3 top-3.5 text-muted" size={16}/><input autoFocus aria-label="Search registered users" className="field pl-10" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);setPeople([]);setHasMore(false);}} placeholder="Search name or username"/></div>
    {group&&<div className="mb-3 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{selected.map(u=><button key={u.id} className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[11px] text-accent" onClick={()=>setSelected(current=>current.filter(p=>p.id!==u.id))}>{u.name}<X size={11}/></button>)}<p className="w-full text-[10px] text-muted">Choose 2–{MAX_GROUP_MEMBERS - 1} people · {selected.length + 1}/{MAX_GROUP_MEMBERS} including you. Membership is fixed for this version.</p></div>}
    {error&&<p role="alert" className="error-notice mb-3">{error}</p>}
    <div className="max-h-64 space-y-1 overflow-y-auto">{loading?<p className="py-6 text-center text-xs text-muted">Looking for people…</p>:people.length?people.map(person=>{
      const chosen=selected.some(u=>u.id===person.id);
      return <button disabled={busy||!person.encryptionReady||(group&&!chosen&&selected.length>=MAX_GROUP_MEMBERS - 1)} key={person.id} onClick={()=>void select(person)} className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-soft"><Avatar name={person.name} src={person.avatarUrl}/><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.name}</span><span className="text-xs text-muted">{person.encryptionReady?`@${person.username}`:'Has not opened chats yet'}</span></span>{group?<span className={`grid h-5 w-5 place-items-center rounded border ${chosen?'border-accent bg-accent-soft text-accent':'border-line'}`}>{chosen&&<Check size={14}/>}</span>:<ArrowUpRight size={15}/>}</button>;
    }):<p className="py-6 text-center text-xs text-muted">No people found. Ask a friend to register and open their chats.</p>}</div>
    {hasMore&&<button disabled={loading||busy} className="secondary-button mt-3 w-full" onClick={()=>setPage(n=>n+1)}>{loading?'Loading…':'Load more people'}</button>}
    {group&&<button disabled={busy||selected.length<2||title.trim().length<2} className="primary-button mt-4 w-full" onClick={async()=>{setBusy(true);try{await onGroup(title.trim(),selected.map(u=>u.id));onClose();}catch(e){setError(e instanceof Error?e.message:'Unable to create group.');}finally{setBusy(false);}}}>{busy?'Creating…':'Create encrypted group'}</button>}
  </dialog>;
}
