import {useEffect,useRef,useState} from 'react';
import {X,CalendarDays,NotebookPen,MessageSquare,Ban} from 'lucide-react';
import {api,put} from '../lib/api';
import type {Presence,Profile} from '../lib/types';
import Avatar from './Avatar';
const statusText:Record<string,string>={online:'Online',dnd:'Do not disturb',offline:'Offline',invisible:'Offline'};
export const joinedDate=(iso:string)=>new Date(iso).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'});
// Another member's profile: name, username, join date, presence and a note only you can see.
export default function ProfileDialog({userId,presence,onClose,onMessage,blocked=false,onToggleBlock}:{userId:string;presence?:Presence;onClose:()=>void;onMessage?:()=>void;blocked?:boolean;onToggleBlock?:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [profile,setProfile]=useState<Profile|null>(null),[note,setNote]=useState(''),[saved,setSaved]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  useEffect(()=>{let cancelled=false;api<{profile:Profile}>(`/users/${userId}`).then(d=>{if(!cancelled){setProfile(d.profile);setNote(d.profile.note);setSaved(d.profile.note);}}).catch(e=>!cancelled&&setError(e.message));return()=>{cancelled=true;};},[userId]);
  async function save(){setBusy(true);setError('');try{const {note:stored}=await put<{note:string}>(`/notes/${userId}`,{body:note});setSaved(stored);setNote(stored);}catch(e){setError(e instanceof Error?e.message:'Could not save the note.');}finally{setBusy(false);}}
  const shown=presence??'offline';
  return <dialog ref={dialog} onCancel={onClose} className="dialog-panel" aria-labelledby="profile-title">
    <div className="flex items-center justify-between"><h2 id="profile-title" className="text-base font-bold">Profile</h2><button aria-label="Close profile" className="icon-button" onClick={onClose}><X size={18}/></button></div>
    {!profile?<p className="py-8 text-center text-xs text-muted">{error||'Loading profile…'}</p>:<>
      <div className="mt-4 flex items-center gap-4"><Avatar name={profile.name} src={profile.avatarUrl} status={shown} large/><div className="min-w-0"><p className="truncate text-xl font-bold">{profile.name}</p><p className="text-sm text-muted">@{profile.username}</p><p className="mt-1 text-xs text-muted">{statusText[shown]}</p></div></div>
      <p className="mt-4 flex items-center gap-2 text-xs text-muted"><CalendarDays size={14}/>Joined {joinedDate(profile.joinedAt)}</p>
      {onMessage&&<button className="secondary-button mt-4 w-full" onClick={onMessage}><MessageSquare size={15}/>Send a message</button>}
      <label className="field-label mt-5 flex items-center gap-1.5"><NotebookPen size={14}/>Private note</label>
      <p className="mt-1 text-[11px] text-muted">Only you can see this note.</p>
      <textarea aria-label="Private note" maxLength={1000} rows={3} value={note} onChange={e=>setNote(e.target.value)} placeholder={`Something to remember about ${profile.name}`} className="field resize-none text-[13px]"/>
      {error&&<p role="alert" className="error-notice mt-2">{error}</p>}
      {onToggleBlock&&<button className={`mt-4 flex items-center gap-1.5 text-xs font-semibold ${blocked?'text-accent':'text-red-500'}`} onClick={()=>{if(blocked||confirm(`Block ${profile.name}? They won’t be able to message you directly, and their group messages will be hidden for you.`))void onToggleBlock().catch(e=>setError(e instanceof Error?e.message:'Could not update.'));}}><Ban size={13}/>{blocked?`Unblock ${profile.name}`:`Block ${profile.name}`}</button>}
      <div className="mt-3 flex items-center justify-end gap-3"><span className="text-[11px] text-muted">{note===saved?(saved?'Saved':''):'Unsaved changes'}</span><button disabled={busy||note===saved} className="primary-button" onClick={()=>void save()}>{busy?'Saving…':'Save note'}</button></div>
    </>}
  </dialog>;
}
