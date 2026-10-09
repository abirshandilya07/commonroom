import {useEffect,useState,type ReactNode} from 'react';
import {LockKeyhole,LogOut} from 'lucide-react';
import {ApiError,post} from '../lib/api';
import {sessionRecovery,type IdentityRecord,type UnlockedIdentity} from '../lib/encryption';
import {openDeviceIdentity,recoverDevice,recoverWithPassword} from '../lib/deviceIdentity';
import type {User} from '../lib/types';
export default function EncryptionGate({user,onExpired,children}:{user:User;onExpired:()=>void;children:(identity:UnlockedIdentity)=>ReactNode}) {
  const [identity,setIdentity]=useState<UnlockedIdentity|null>(null);
  const [record,setRecord]=useState<IdentityRecord|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recovery,setRecovery]=useState(''),[useKey,setUseKey]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let cancelled=false;setLoading(true);setError('');
    void openDeviceIdentity(user.id).then(result=>{
      if(cancelled)return;
      if(result.identity)setIdentity(result.identity);else setRecord(result.record);
    }).catch(e=>{if(!cancelled){if(e instanceof ApiError&&e.status===401)onExpired();else setError(e.message);}}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[user.id,onExpired,attempt]);
  async function unlock() {
    if(!record)return;setBusy(true);setError('');
    try {setIdentity(useKey?await recoverDevice(user.id,record,recovery.trim()):await recoverWithPassword(user.id,record,recovery));setRecovery('');}
    catch(e){setError(useKey?'Could not unlock chats. Check your recovery key and allow browser storage, then try again.':e instanceof Error?e.message:'Could not unlock chats.');}finally{setBusy(false);}
  }
  if(identity)return children(identity);
  if(loading)return <main className="grid min-h-dvh place-items-center bg-canvas text-ink"><p role="status" className="text-sm text-muted">Opening your chats…</p></main>;
  return <main className="grid min-h-dvh place-items-center bg-canvas p-5 text-ink"><section className="w-full max-w-lg rounded-2xl border border-line bg-panel p-7"><span className="mb-5 grid h-12 w-12 place-items-center rounded-xl bg-accent-soft text-accent"><LockKeyhole/></span><h1 className="text-2xl font-bold">{record?'Open your chats on this browser':'Could not open your chats'}</h1>
    {record&&<><p className="mt-2 text-sm leading-6 text-muted">{useKey?'Enter your recovery key once to remember this browser.':'Enter your account password once to open your encrypted chats on this browser.'}</p><form className="mt-6 space-y-4" onSubmit={e=>{e.preventDefault();void unlock();}}><label className="field-label">{useKey?'Recovery key':'Account password'}<input required autoComplete={useKey?'off':'current-password'} type="password" aria-label={useKey?'Recovery key':'Account password'} className="field" value={recovery} onChange={e=>setRecovery(e.target.value)}/></label><button disabled={busy} className="primary-button w-full">{busy?'Unlocking…':'Open chats'}</button></form><button className="mt-3 text-xs font-semibold text-accent" onClick={()=>{setUseKey(!useKey);setRecovery('');setError('');}}>{useKey?'Use my password instead':'Use a recovery key instead'}</button></>}
    {error&&<p role="alert" className="error-notice mt-4">{error}</p>}
    {!record&&<button className="secondary-button mt-3" onClick={()=>setAttempt(n=>n+1)}>Try again</button>}
    <button className="mt-6 flex items-center gap-2 text-xs text-muted" onClick={async()=>{try{await post('/auth/logout');sessionRecovery(user.id,null);onExpired();}catch{setError('Unable to sign out. Try again.');}}}><LogOut size={14}/>Sign out</button></section></main>;
}
