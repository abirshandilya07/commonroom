import {useEffect,useState} from 'react';
import {ImageIcon,Film,Mic,AlertTriangle,FileText,Download,ShieldCheck,Maximize2} from 'lucide-react';
import {attachmentUrl,formatBytes,formatDuration} from '../lib/media';
import type {Attachment} from '../lib/types';
// Decrypts an attachment on demand and shows it inline.
export default function AttachmentView({attachment,onOpenImage}:{attachment:Attachment;onOpenImage:(url:string,name:string,kind?:'image'|'video')=>void}) {
  const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  // Documents are fetched only when someone chooses to download them.
  if(attachment.kind==='file')return <div className="mt-1.5 flex w-full max-w-sm items-center gap-3 rounded-lg border border-line bg-soft p-3">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><FileText size={19}/></span>
    <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{attachment.name}</span><span className="flex items-center gap-1 text-[10px] text-muted">{error?<><AlertTriangle size={11}/>{error}</>:<><ShieldCheck size={11}/>{formatBytes(attachment.size)} · encrypted · checked</>}</span></span>
    <button aria-label={`Download ${attachment.name}`} disabled={busy} className="icon-button" onClick={async()=>{setBusy(true);setError('');try{const href=await attachmentUrl(attachment);const link=document.createElement('a');link.href=href;link.download=attachment.name;link.rel='noopener';link.click();}catch(e){setError(e instanceof Error?e.message:'Download failed.');}finally{setBusy(false);}}}><Download size={17} className={busy?'animate-pulse':''}/></button>
  </div>;
  return <InlineMedia attachment={attachment} onOpenImage={onOpenImage} url={url} setUrl={setUrl} error={error} setError={setError}/>;
}
function InlineMedia({attachment,onOpenImage,url,setUrl,error,setError}:{attachment:Attachment;onOpenImage:(url:string,name:string,kind?:'image'|'video')=>void;url:string;setUrl:(u:string)=>void;error:string;setError:(e:string)=>void}) {
  useEffect(()=>{let cancelled=false;attachmentUrl(attachment).then(u=>{if(!cancelled)setUrl(u);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[attachment,setUrl,setError]);
  const Icon=attachment.kind==='image'?ImageIcon:attachment.kind==='video'?Film:Mic;
  if(error)return <p className="mt-1.5 flex items-center gap-2 text-xs text-muted"><AlertTriangle size={14}/>{error}</p>;
  if(!url)return <div className="mt-1.5 flex h-16 w-64 max-w-full items-center gap-2 rounded-lg border border-line bg-soft px-3 text-xs text-muted"><Icon size={16} className="animate-pulse"/>Decrypting {attachment.kind==='audio'?'voice note':attachment.name} · {formatBytes(attachment.size)}</div>;
  if(attachment.kind==='image')return <button className="mt-1.5 block" onClick={()=>onOpenImage(url,attachment.name)} aria-label={`Open image ${attachment.name}`}><img src={url} alt={attachment.name} className="max-h-72 max-w-full rounded-lg border border-line object-contain sm:max-w-sm"/></button>;
  if(attachment.kind==='video')return <div className="group/video relative mt-1.5 w-fit max-w-full"><video src={url} controls preload="metadata" className="max-h-80 max-w-full rounded-lg border border-line bg-black sm:max-w-md"/><button aria-label={`Enlarge video ${attachment.name}`} title="Enlarge" onClick={e=>{const v=e.currentTarget.parentElement?.querySelector('video');v?.pause();onOpenImage(url,attachment.name,'video');}} className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80"><Maximize2 size={15}/></button></div>;
  return <div className="mt-1.5 flex w-full max-w-sm items-center gap-2 rounded-full border border-line bg-soft py-1 pl-3 pr-1"><Mic size={15} className="shrink-0 text-accent"/><audio src={url} controls preload="metadata" className="h-9 min-w-0 flex-1" aria-label="Voice note"/>{attachment.duration?<span className="shrink-0 pr-2 text-[10px] text-muted">{formatDuration(attachment.duration)}</span>:null}</div>;
}
