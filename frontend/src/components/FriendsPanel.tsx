import {useEffect,useState} from 'react';
import {ArrowLeft,Check,Clock,MessageSquare,Search,ShieldCheck,UserMinus,UserPlus,Users,X} from 'lucide-react';
import {api} from '../lib/api';
import type {Presence,User} from '../lib/types';
import type {FriendsState} from '../hooks/useFriends';
import Avatar from './Avatar';
const statusLabel:Record<Presence,string>={online:'Online',dnd:'Do not disturb',offline:'Offline'};
const statusColor:Record<Presence,string>={online:'text-success',dnd:'text-red-500',offline:'text-muted'};
const order:Record<Presence,number>={online:0,dnd:1,offline:2};
// The home screen: add friends, answer requests, and see which friends are around.
export default function FriendsPanel({friends,presence,blocked,onMessage,onProfile,onBack}:{friends:FriendsState;presence:Record<string,Presence>;blocked:string[];onMessage:(userId:string)=>Promise<void>;onProfile:(userId:string)=>void;onBack?:()=>void}){
  const [query,setQuery]=useState(''),[results,setResults]=useState<User[]>([]),[searching,setSearching]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null);
  useEffect(()=>{if(!query.trim()){setResults([]);return;}const controller=new AbortController();setSearching(true);const timer=setTimeout(()=>{void api<{users:User[]}>(`/users?q=${encodeURIComponent(query.trim())}`,{signal:controller.signal}).then(d=>{if(!controller.signal.aborted)setResults(d.users.slice(0,8));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setSearching(false);});},200);return()=>{clearTimeout(timer);controller.abort();};},[query]);
  const act=(id:string,action:()=>Promise<void>)=>{setBusy(id);setError('');void action().catch(e=>setError(e instanceof Error?e.message:'Something went wrong.')).finally(()=>setBusy(null));};
  const status=(id:string):Presence=>presence[id]??'offline';
  const list=[...friends.friends].sort((a,b)=>order[status(a.id)]-order[status(b.id)]||a.name.localeCompare(b.name));
  const around=list.filter(f=>status(f.id)!=='offline'),away=list.filter(f=>status(f.id)==='offline');
  const person=(u:User,sub:React.ReactNode,p?:Presence)=><button onClick={()=>onProfile(u.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`View ${u.name}'s profile`}><Avatar name={u.name} src={u.avatarUrl} status={p}/><span className="min-w-0"><span className="block truncate text-sm font-semibold">{u.name}</span><span className="block truncate text-[11px] text-muted">{sub}</span></span></button>;
  const friendRow=(f:User)=>{const p=status(f.id);return <li key={f.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-soft">
    {person(f,<><span className={statusColor[p]}>{statusLabel[p]}</span> · @{f.username}</>,p)}
    <button disabled={busy===f.id} className="icon-button" aria-label={`Message ${f.name}`} title="Message" onClick={()=>act(f.id,()=>onMessage(f.id))}><MessageSquare size={16}/></button>
    <button disabled={busy===f.id} className="icon-button" aria-label={`Remove ${f.name} from friends`} title="Remove friend" onClick={()=>{if(confirm(`Remove ${f.name} from your friends?`))act(f.id,()=>friends.remove(f.id));}}><UserMinus size={16}/></button>
  </li>;};
  const searchAction=(u:User)=>{const r=friends.relation(u.id);
    if(blocked.includes(u.id))return <span className="text-[11px] text-muted">Blocked</span>;
    if(r==='friends')return <span className="flex items-center gap-1 text-[11px] text-accent"><Check size={13}/>Friends</span>;
    if(r==='outgoing')return <span className="flex items-center gap-1 text-[11px] text-muted"><Clock size={13}/>Requested</span>;
    if(r==='incoming')return <button disabled={busy===u.id} className="primary-button !px-3 !py-1.5 text-xs" onClick={()=>act(u.id,()=>friends.accept(u.id))}><Check size={14}/>Accept</button>;
    return <button disabled={busy===u.id} className="secondary-button !px-3 !py-1.5 text-xs" onClick={()=>act(u.id,()=>friends.send(u.id))}><UserPlus size={14}/>Add friend</button>;};
  const heading=(text:string,count:number)=><h3 className="mb-1 mt-6 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{text} — {count}</h3>;
  return <section className="flex h-full min-w-0 flex-1 flex-col bg-canvas text-ink">
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line px-3 sm:px-7">
      {onBack&&<button aria-label="Back to conversations" className="icon-button md:hidden" onClick={onBack}><ArrowLeft size={19}/></button>}
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Users size={18}/></span>
      <div className="min-w-0 flex-1"><h2 className="truncate text-base font-bold">Friends</h2><p className="mt-0.5 text-[11px] text-muted">{list.length?`${around.length} of ${list.length} online`:'Add people to see when they are around'}</p></div>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-7"><div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-line bg-soft p-4">
        <label htmlFor="friend-search" className="flex items-center gap-2 text-sm font-semibold"><UserPlus size={16} className="text-accent"/>Add a friend</label>
        <div className="relative mt-3"><Search size={15} className="absolute left-3 top-3 text-muted"/><input id="friend-search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name or username" className="field !mt-0 pl-9"/>{query&&<button aria-label="Clear search" className="absolute right-2 top-2 icon-button !h-7 !w-7" onClick={()=>setQuery('')}><X size={14}/></button>}</div>
        {query.trim()&&<ul className="mt-2 space-y-1">{searching&&!results.length?<li className="py-3 text-center text-xs text-muted">Looking for people…</li>:results.length?results.map(u=><li key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-panel">{person(u,`@${u.username}`)}{searchAction(u)}</li>):<li className="py-3 text-center text-xs text-muted">No one matches that search.</li>}</ul>}
      </div>
      {error&&<p role="alert" className="error-notice mt-3">{error}</p>}
      {!!friends.incoming.length&&<>{heading('Friend requests',friends.incoming.length)}<ul className="space-y-1">{friends.incoming.map(u=><li key={u.id} className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft/40 px-2 py-2">
        {person(u,`@${u.username} wants to be friends`)}
        <button disabled={busy===u.id} className="primary-button !px-3 !py-1.5 text-xs" onClick={()=>act(u.id,()=>friends.accept(u.id))}><Check size={14}/>Accept</button>
        <button disabled={busy===u.id} className="secondary-button !px-3 !py-1.5 text-xs" onClick={()=>act(u.id,()=>friends.decline(u.id))}>Decline</button>
      </li>)}</ul></>}
      {list.length?<>{heading('Online',around.length)}{around.length?<ul className="space-y-0.5">{around.map(friendRow)}</ul>:<p className="px-2 py-2 text-xs text-muted">None of your friends are online right now.</p>}
        {!!away.length&&<>{heading('Offline',away.length)}<ul className="space-y-0.5">{away.map(friendRow)}</ul></>}</>
      :<div className="mt-8 text-center"><span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent"><Users size={26}/></span><h3 className="text-xl font-bold">No friends yet</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">Search above to send someone a friend request. Once they accept, you’ll see when they’re online here.</p></div>}
      {!!friends.outgoing.length&&<>{heading('Sent requests',friends.outgoing.length)}<ul className="space-y-0.5">{friends.outgoing.map(u=><li key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-soft">{person(u,`@${u.username} · waiting for a reply`)}<button disabled={busy===u.id} className="secondary-button !px-3 !py-1.5 text-xs" onClick={()=>act(u.id,()=>friends.decline(u.id))}>Cancel</button></li>)}</ul></>}
      <div className="mt-10 flex items-start gap-3 rounded-xl border border-line bg-soft p-4"><ShieldCheck className="mt-0.5 shrink-0 text-accent" size={18}/><p className="text-xs leading-6 text-muted">Messages with friends are encrypted on your device. Only your friends and people you chat with can see when you’re online, and “Appear offline” hides you from everyone.</p></div>
    </div></div>
  </section>;
}
