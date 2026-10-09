import {useEffect,useState} from 'react';
import {ImageIcon,Film,Mic,AlertTriangle} from 'lucide-react';
import {attachmentUrl,formatBytes,formatDuration} from '../lib/media';
import type {Attachment} from '../lib/types';
// Decrypts an attachment on demand and shows it inline.
export default function AttachmentView({attachment,onOpenImage}:{attachment:Attachment;onOpenImage:(url:string,name:string)=>void}) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{let cancelled=false;attachmentUrl(attachment).then(u=>{if(!cancelled)setUrl(u);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[attachment]);
  const Icon=attachment.kind==='image'?ImageIcon:attachment.kind==='video'?Film:Mic;
  if(error)return <p className="mt-1.5 flex items-center gap-2 text-xs text-muted"><AlertTriangle size={14}/>{error}</p>;
  if(!url)return <div className="mt-1.5 flex h-16 w-64 max-w-full items-center gap-2 rounded-lg border border-line bg-soft px-3 text-xs text-muted"><Icon size={16} className="animate-pulse"/>Decrypting {attachment.kind==='audio'?'voice note':attachment.name} · {formatBytes(attachment.size)}</div>;
  if(attachment.kind==='image')return <button className="mt-1.5 block" onClick={()=>onOpenImage(url,attachment.name)} aria-label={`Open image ${attachment.name}`}><img src={url} alt={attachment.name} className="max-h-72 max-w-full rounded-lg border border-line object-contain sm:max-w-sm"/></button>;
  if(attachment.kind==='video')return <video src={url} controls preload="metadata" className="mt-1.5 max-h-80 max-w-full rounded-lg border border-line bg-black sm:max-w-md"/>;
  return <div className="mt-1.5 flex w-full max-w-sm items-center gap-2 rounded-full border border-line bg-soft py-1 pl-3 pr-1"><Mic size={15} className="shrink-0 text-accent"/><audio src={url} controls preload="metadata" className="h-9 min-w-0 flex-1" aria-label="Voice note"/>{attachment.duration?<span className="shrink-0 pr-2 text-[10px] text-muted">{formatDuration(attachment.duration)}</span>:null}</div>;
}
