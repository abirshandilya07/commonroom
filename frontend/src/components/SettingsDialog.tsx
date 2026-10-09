import {useEffect,useRef,useState} from 'react';
import {X,CalendarDays,ImagePlus,Trash2} from 'lucide-react';
import {api,put,upload} from '../lib/api';
import {resizeAvatar} from '../lib/media';
import type {Me} from '../lib/types';
import Avatar from './Avatar';
import {joinedDate} from './ProfileDialog';
// Your own profile: picture, display name, username and join date.
export default function SettingsDialog({user,onClose,onUpdated}:{user:Me;onClose:()=>void;onUpdated:(user:Me)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),picker=useRef<HTMLInputElement>(null);
  const [name,setName]=useState(user.name),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  async function run(action:()=>Promise<{user:Me}>,done:string){setBusy(true);setError('');setNotice('');try{const result=await action();onUpdated({...user,...result.user,status:user.status});setNotice(done);}catch(e){setError(e instanceof Error?e.message:'Something went wrong.');}finally{setBusy(false);}}
  async function choose(file?:File){if(!file)return;if(!file.type.startsWith('image/')){setError('Choose an image file.');return;}await run(async()=>upload<{user:Me}>('/me/avatar',await resizeAvatar(file),'image/jpeg','PUT'),'Profile picture updated.');}
  const trimmed=name.trim();
  return <dialog ref={dialog} onCancel={onClose} className="dialog-panel" aria-labelledby="settings-title">
    <div className="flex items-center justify-between"><h2 id="settings-title" className="text-base font-bold">Profile settings</h2><button aria-label="Close settings" className="icon-button" onClick={onClose}><X size={18}/></button></div>
    <div className="mt-4 flex items-center gap-4"><Avatar name={user.name} src={user.avatarUrl} large/><div className="flex flex-col items-start gap-2">
      <button disabled={busy} className="secondary-button text-xs" onClick={()=>picker.current?.click()}><ImagePlus size={14}/>{user.avatarUrl?'Change picture':'Add a picture'}</button>
      {user.avatarUrl&&<button disabled={busy} className="flex items-center gap-1.5 text-xs text-muted hover:text-ink" onClick={()=>void run(()=>api<{user:Me}>('/me/avatar',{method:'DELETE'}),'Profile picture removed.')}><Trash2 size={13}/>Remove picture</button>}
      <input ref={picker} type="file" accept="image/*" hidden onChange={e=>{void choose(e.target.files?.[0]);e.target.value='';}}/>
    </div></div>
    <form className="mt-5" onSubmit={e=>{e.preventDefault();if(trimmed.length>=2&&trimmed!==user.name)void run(()=>put<{user:Me}>('/me',{name:trimmed},'PATCH'),'Name updated.');}}>
      <label className="field-label">Display name<input aria-label="Display name" className="field" value={name} maxLength={40} onChange={e=>setName(e.target.value)}/></label>
      <div className="mt-3 flex justify-end"><button disabled={busy||trimmed.length<2||trimmed===user.name} className="primary-button">Save name</button></div>
    </form>
    <dl className="mt-4 space-y-2 rounded-xl border border-line bg-soft p-4 text-xs"><div className="flex justify-between"><dt className="text-muted">Username</dt><dd className="font-semibold">@{user.username}</dd></div><div className="flex justify-between"><dt className="flex items-center gap-1.5 text-muted"><CalendarDays size={13}/>Joined</dt><dd className="font-semibold">{joinedDate(user.joinedAt)}</dd></div></dl>
    {error&&<p role="alert" className="error-notice mt-3">{error}</p>}
    {notice&&<p role="status" className="mt-3 text-xs text-success">{notice}</p>}
  </dialog>;
}
