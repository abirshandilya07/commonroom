import {useEffect,useRef,useState} from 'react';
import {Download,ShieldCheck,X} from 'lucide-react';
import {readDeviceKey,forgetDeviceKey} from '../lib/deviceIdentity';
import {post} from '../lib/api';
import {sessionRecovery} from '../lib/encryption';
import type {User} from '../lib/types';
export default function PrivacyDialog({user,onClose,onExpired}:{user:User;onClose:()=>void;onExpired:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmForget,setConfirmForget]=useState(false);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  async function backup(){
    setBusy(true);setError('');
    try {
      const device=await readDeviceKey(user.id);
      if(!device)throw new Error('No backup key was found on this browser.');
      const url=URL.createObjectURL(new Blob([`Commonroom recovery key\nAccount: @${user.username}\n\n${device.recoveryKey}\n\nKeep this private. It unlocks your encrypted messages.\n`],{type:'text/plain'}));
      const a=document.createElement('a');a.href=url;a.download=`commonroom-recovery-${user.username}.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e instanceof Error?e.message:'Could not export backup.');}finally{setBusy(false);}
  }
  async function forget(){
    setBusy(true);setError('');
    try {await forgetDeviceKey(user.id);sessionRecovery(user.id,null);await post('/auth/logout');onExpired();}
    catch{setError('Could not finish signing out. Try again. If the key was removed, your backup will be needed next time.');}finally{setBusy(false);}
  }
  return <dialog ref={dialog} onCancel={onClose} className="dialog-panel" aria-labelledby="privacy-title"><div className="flex items-center justify-between"><h2 id="privacy-title" className="text-lg font-bold">Privacy &amp; backup</h2><button aria-label="Close privacy settings" className="icon-button" onClick={onClose}><X size={18}/></button></div><p className="my-4 flex items-center gap-2 text-sm font-semibold text-accent"><ShieldCheck size={18}/>End-to-end encryption is on</p><p className="text-sm leading-6 text-muted">Your keys are saved on this browser, so your chats open automatically after you sign in.</p><div className="my-5 rounded-xl border border-line bg-soft p-4"><h3 className="text-sm font-semibold">Optional recovery backup</h3><p className="my-3 text-xs leading-6 text-muted">Save a private backup before switching browsers or clearing site data. Without a backup or a browser that still has your key, encrypted history cannot be recovered.</p><button disabled={busy} onClick={()=>void backup()} className="secondary-button"><Download size={15}/>Download recovery key</button></div><p className="text-xs leading-6 text-muted">Normal sign-out keeps your key on this device. On a shared computer, save your backup, then forget this browser.</p>{confirmForget?<div className="mt-3 space-y-3"><p className="warning-notice">This removes this account’s local key and signs you out. Make sure your backup is saved first.</p><button disabled={busy} className="secondary-button" onClick={()=>void forget()}>Forget browser and sign out</button><button disabled={busy} className="ml-3 text-xs text-muted" onClick={()=>setConfirmForget(false)}>Cancel</button></div>:<button className="mt-3 text-xs font-semibold text-accent" onClick={()=>setConfirmForget(true)}>Forget this browser…</button>}{error&&<p role="alert" className="error-notice mt-3">{error}</p>}</dialog>;
}
