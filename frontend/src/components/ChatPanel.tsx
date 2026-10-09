import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Send, Check, MessageSquare, Info, X, Search, LockKeyhole, ArrowDown, Paperclip, Mic, Pencil, Trash2, SmilePlus, ImageIcon, Film } from 'lucide-react';
import Avatar from './Avatar';
import AttachmentView from './Attachment';
import VoiceRecorder from './VoiceRecorder';
import { fingerprint } from '../lib/encryption';
import { formatBytes, kindOf, MAX_ATTACHMENT_BYTES, MAX_TEXT } from '../lib/media';
import type { Outgoing } from '../hooks/useChat';
import type { Conversation, Message, Presence, User } from '../lib/types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
type Props = {user: User; conversation: Conversation; messages: Message[]; connected: boolean; presence: Record<string, Presence>; typing: string; loading: boolean; hasMore: boolean;
  onBack: () => void; onOlder: () => Promise<void>; onSend: (id: string, body: string, nonce: string, outgoing?: Outgoing) => Promise<void>; onTyping: (id: string, value: boolean) => void;
  onEdit: (message: Message, text: string) => Promise<void>; onDelete: (message: Message) => Promise<void>; onReact: (message: Message, emoji: string) => Promise<void>; onProfile: (userId: string) => void};
export default function ChatPanel(p: Props) {
  const [draft, setDraft] = useState('');
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const group = p.conversation.kind === 'group';
  const ready = p.conversation.members.every(m => !!m.identity);
  const peerPresence: Presence = p.presence[p.conversation.peer.id] ?? 'offline';
  useEffect(() => {let cancelled=false;void Promise.all(p.conversation.members.filter(m=>m.identity).map(async m=>[m.id,await fingerprint(m.identity!)] as const)).then(rows=>{if(!cancelled)setFingerprints(Object.fromEntries(rows));});return()=>{cancelled=true;};}, [p.conversation.members]);
  const [busy, setBusy] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [editing, setEditing] = useState<{id: number; text: string} | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  // Touch screens have no hover: tapping a message shows its toolbar.
  const [selected, setSelected] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{url: string; name: string} | null>(null);
  const retry = useRef<{body: string; id: string; file: File | null} | null>(null);
  const details = useRef<HTMLDialogElement>(null);
  const imageDialog = useRef<HTMLDialogElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  // Follow new messages only while the reader is at the bottom; never pull them away from older history.
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const last = p.messages.at(-1);
  const lastId = last?.id;
  const visible = query.trim() ? p.messages.filter((m) => m.body.toLowerCase().includes(query.trim().toLowerCase())) : p.messages;
  const toBottom = (smooth = true) => {bottom.current?.scrollIntoView({behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant'}); atBottom.current = true; setNewBelow(false);};
  useEffect(() => {
    if (query.trim() || !lastId) return;
    if (atBottom.current || last?.senderId === p.user.id) toBottom(); else setNewBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, query]);
  useEffect(() => {if (p.typing && atBottom.current && !query.trim()) toBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.typing]);
  useEffect(() => {if (viewer) imageDialog.current?.showModal();}, [viewer]);
  // Images and players grow after they decrypt; keep the reader pinned to the bottom when they were there.
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = content.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {if (atBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight;});
    observer.observe(el); return () => observer.disconnect();
  }, []);
  const onScroll = () => {const el = log.current; if (!el) return; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (atBottom.current) setNewBelow(false);};

  async function deliver(body: string, outgoing?: Outgoing, retryKey?: {body: string; file: File | null}) {
    const id = retryKey && retry.current?.body === retryKey.body && retry.current.file === retryKey.file ? retry.current.id : crypto.randomUUID();
    if (retryKey) retry.current = {...retryKey, id};
    setBusy(true); setError('');
    try { await p.onSend(p.conversation.id, body, id, outgoing); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to send.'); return false; }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !file) || busy) return;
    const ok = await deliver(body, file ? {file, name: file.name} : undefined, {body, file});
    // Keep a file picked while this message was still sending.
    if (ok) {setDraft(''); setFile(current => current === file ? null : current); retry.current = null; p.onTyping(p.conversation.id, false);}
  }
  function choose(selected?: File) {
    if (!selected) return;
    if (!kindOf(selected.type)) {setError('Choose an image, video or audio file.'); return;}
    if (selected.size > MAX_ATTACHMENT_BYTES) {setError(`That file is ${formatBytes(selected.size)}. Files can be up to 25 MB.`); return;}
    setError(''); setFile(selected);
  }
  async function saveEdit(message: Message) {
    if (!editing) return;
    const text = editing.text.trim();
    if ((!text && !message.attachment) || text === message.body) {setEditing(null); return;}
    try {await p.onEdit(message, text); setEditing(null);} catch (e) {setError(e instanceof Error ? e.message : 'Unable to edit.');}
  }
  async function remove(message: Message) {
    if (!confirm('Delete this message for everyone?')) return;
    try {await p.onDelete(message);} catch (e) {setError(e instanceof Error ? e.message : 'Unable to delete.');}
  }
  async function react(message: Message, emoji: string) {
    setPicker(null);
    try {await p.onReact(message, emoji);} catch (e) {setError(e instanceof Error ? e.message : 'Unable to react.');}
  }
  // "Seen" sits under your newest message once others have read up to it.
  const lastOwn = [...p.messages].reverse().find(m => m.senderId === p.user.id && !m.deleted);
  const seenBy = lastOwn ? p.conversation.members.filter(m => m.id !== p.user.id && (m.lastReadId || 0) >= lastOwn.id) : [];
  const nameOf = (id: string) => id === p.user.id ? 'You' : p.conversation.members.find(m => m.id === id)?.name || 'Someone';

  return <section className="flex h-full min-w-0 flex-1 flex-col bg-canvas text-ink">
    <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-line px-3 sm:px-6">
      <button aria-label="Back to conversations" className="icon-button md:hidden" onClick={p.onBack}><ArrowLeft size={19}/></button>
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={group ? 'Conversation details' : `View ${p.conversation.peer.name}'s profile`} onClick={() => group ? details.current?.showModal() : p.onProfile(p.conversation.peer.id)}>
        <Avatar name={p.conversation.peer.name} src={group ? undefined : p.conversation.peer.avatarUrl} status={group ? undefined : peerPresence}/>
        <div className="min-w-0 flex-1"><h2 className="truncate text-base font-bold">{p.conversation.peer.name}</h2><p className="mt-0.5 text-[11px] text-muted">{group ? `${p.conversation.members.length} members` : peerPresence === 'online' ? 'Active now' : peerPresence === 'dnd' ? 'Do not disturb' : 'Offline'}<span className="mx-1.5">·</span>{group ? 'Group chat' : 'Direct message'}</p></div>
      </button>
      <button aria-label="Find in loaded messages" title="Find in loaded messages" aria-expanded={findOpen} className="icon-button" onClick={() => {setFindOpen(!findOpen); setQuery('');}}><Search size={18}/></button>
      <button aria-label="Conversation details" title="Conversation details" className="icon-button" onClick={() => details.current?.showModal()}><Info size={18}/></button>
    </header>
    <div className="flex h-10 shrink-0 items-center gap-4 border-b border-line px-5 text-xs sm:px-7"><span className="flex h-full items-center gap-1.5 border-b-2 border-accent font-semibold"><MessageSquare size={13}/>Messages</span><span className="ml-auto flex items-center gap-1 text-[10px] text-muted"><LockKeyhole size={11}/>{ready ? 'Messages and media encrypted' : 'Encryption setup needed'}</span></div>
    {findOpen && <div className="flex items-center gap-2 border-b border-line bg-soft px-4 py-2"><Search size={15} className="text-muted"/><input autoFocus aria-label="Search loaded messages" className="min-w-0 flex-1 bg-transparent py-1 text-xs" placeholder="Search loaded messages…" value={query} onChange={(e) => setQuery(e.target.value)}/><span className="shrink-0 text-[10px] text-muted">{visible.length} found</span><button aria-label="Close message search" className="icon-button h-7 w-7" onClick={() => {setFindOpen(false); setQuery('');}}><X size={14}/></button></div>}
    {p.messages.some(m=>m.legacy)&&<p className="warning-notice mx-4 mt-2">Earlier messages were sent before encryption was enabled. They remain readable and are not end-to-end encrypted.</p>}
    <div className="relative min-h-0 flex-1"><div ref={log} onScroll={onScroll} className="h-full overflow-y-auto pb-4 pt-5" role="log" aria-label="Messages" aria-live="polite"><div ref={content}>
      {p.hasMore && <div className="mb-5 text-center"><button disabled={loadingOlder} className="secondary-button px-3 py-1.5 text-[11px]" onClick={async () => {setLoadingOlder(true); try {await p.onOlder();} catch (e) {setError(e instanceof Error ? e.message : 'Unable to load history.');} finally {setLoadingOlder(false);}}}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button></div>}
      {!p.hasMore && !query.trim() && <div className="px-5 pb-7 pt-3 sm:px-7"><Avatar name={p.conversation.peer.name} src={group ? undefined : p.conversation.peer.avatarUrl} large/><h3 className="mt-4 text-2xl font-bold tracking-tight">{p.conversation.peer.name}</h3><p className="mt-1 text-xs text-muted">{group ? `${p.conversation.members.length} members` : `@${p.conversation.peer.username}`}</p><p className="mt-3 max-w-xl text-[13px] leading-6 text-muted">{group ? `Welcome to ${p.conversation.peer.name}. New messages are encrypted for all ${p.conversation.members.length} members.` : `Your direct conversation with ${p.conversation.peer.name}. New messages are encrypted on your devices.`}</p></div>}
      {p.loading && !p.messages.length && <p className="px-7 py-5 text-xs text-muted">Loading your conversation…</p>}
      {query.trim() && !visible.length && <p className="px-7 py-8 text-sm text-muted">No matches in the loaded messages. You can load earlier messages to search further back.</p>}
      {visible.map((m, index) => {
        const own = m.senderId === p.user.id;
        const date = new Date(m.createdAt);
        const prev = visible[index - 1];
        const showDate = !prev || date.toDateString() !== new Date(prev.createdAt).toDateString();
        const grouped = !query.trim() && !showDate && prev?.senderId === m.senderId && date.getTime() - new Date(prev.createdAt).getTime() < 300000;
        const member = p.conversation.members.find(x => x.id === m.senderId);
        const author = member || (own ? p.user : {name:'Unknown sender', avatarUrl: null});
        const actionable = !m.deleted && !m.legacy && !m.decryptionError;
        const isEditing = editing?.id === m.id;
        return <div key={m.id}>
          {showDate && <div className="relative my-4 flex items-center px-5 sm:px-7"><span className="h-px flex-1 bg-line"/><span className="rounded-full border border-line bg-canvas px-3 py-1 text-[10px] font-semibold">{date.toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})}</span><span className="h-px flex-1 bg-line"/></div>}
          <article onClick={e => {if (!(e.target as HTMLElement).closest('button,textarea,audio,video,a')) setSelected(selected === m.id ? null : m.id);}} className={`message-row group relative ${grouped ? 'py-1' : ''}`}>
            {grouped ? <span className="w-9 shrink-0 pt-1 text-right text-[9px] text-muted"><time dateTime={m.createdAt}>{date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false})}</time></span> : <button aria-label={`View ${author.name}'s profile`} onClick={() => p.onProfile(m.senderId)} className="h-9 shrink-0"><Avatar name={author.name} src={author.avatarUrl}/></button>}
            <div className="min-w-0 flex-1">
              {!grouped && <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]"><button className="font-bold hover:underline" onClick={() => p.onProfile(m.senderId)}>{author.name}</button>{own && <span className="text-[10px] text-muted">(you)</span>}<time className="text-[10px] text-muted" dateTime={m.createdAt}>{date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'})}</time>{own && !m.deleted && <Check aria-label="Saved on server" className="text-success" size={11}/>}<span className="text-[9px] text-muted">{m.deleted ? '' : m.legacy ? 'Earlier · unencrypted' : m.decryptionError ? 'Verification failed' : 'Encrypted'}</span></p>}
              {m.deleted ? <p className={`text-[13px] italic text-muted ${grouped ? '' : 'mt-0.5'}`}>This message was deleted.</p> : isEditing ? <div className="mt-1">
                <textarea autoFocus aria-label="Edit message" maxLength={MAX_TEXT} rows={2} value={editing.text} onChange={e => setEditing({id: m.id, text: e.target.value})} onKeyDown={e => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); void saveEdit(m);} if (e.key === 'Escape') setEditing(null);}} className="block w-full resize-none rounded-lg border border-accent bg-panel px-3 py-2 text-[13px] leading-6"/>
                <p className="mt-1 flex gap-3 text-[10px] text-muted"><span>Enter to save · Esc to cancel</span><button className="font-semibold text-accent" onClick={() => void saveEdit(m)}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></p>
              </div> : <>
                {m.body && <p className={`${m.decryptionError ? "text-red-500" : ""} whitespace-pre-wrap break-words text-[13px] leading-[1.65] [overflow-wrap:anywhere] ${grouped ? '' : 'mt-0.5'}`}>{m.body}{m.editedAt && <span className="ml-1.5 text-[10px] text-muted">(edited)</span>}</p>}
                {m.attachment && <AttachmentView attachment={m.attachment} onOpenImage={(url, name) => setViewer({url, name})}/>}
                {!m.body && m.editedAt && <span className="text-[10px] text-muted">(edited)</span>}
              </>}
              {m.id === lastOwn?.id && !!seenBy.length && <p className="mt-1 text-[10px] text-muted">{group ? `Seen by ${seenBy.length === p.conversation.members.length - 1 ? 'everyone' : seenBy.map(x => x.name.split(' ')[0]).join(', ')}` : 'Seen'}</p>}
              {!!m.reactions?.length && <div className="mt-1.5 flex flex-wrap gap-1">{m.reactions.map(r => {const mine = r.userIds.includes(p.user.id); return <button key={r.emoji} onClick={() => void react(m, r.emoji)} title={r.userIds.map(nameOf).join(', ')} aria-pressed={mine} aria-label={`${r.emoji} ${r.userIds.length}, reacted by ${r.userIds.map(nameOf).join(', ')}`} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${mine ? 'border-accent bg-accent-soft' : 'border-line bg-soft hover:border-accent'}`}><span>{r.emoji}</span><span className="text-[10px] font-semibold">{r.userIds.length}</span></button>;})}</div>}
            </div>
            {actionable && !isEditing && <div className={`absolute -top-3 right-4 z-10 items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5 shadow-sm sm:right-7 ${picker === m.id || selected === m.id ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}>
              {picker === m.id ? QUICK_REACTIONS.map(emoji => <button key={emoji} aria-label={`React ${emoji}`} className="grid h-7 w-7 place-items-center rounded-md text-base hover:bg-soft" onClick={() => void react(m, emoji)}>{emoji}</button>)
                : <button aria-label="Add reaction" title="Add reaction" className="icon-button h-7 w-7" onClick={() => setPicker(m.id)}><SmilePlus size={15}/></button>}
              {picker === m.id ? <button aria-label="Close reactions" className="icon-button h-7 w-7" onClick={() => setPicker(null)}><X size={14}/></button> : own && <>
                <button aria-label="Edit message" title="Edit" className="icon-button h-7 w-7" onClick={() => setEditing({id: m.id, text: m.body})}><Pencil size={14}/></button>
                <button aria-label="Delete message" title="Delete" className="icon-button h-7 w-7 hover:text-red-500" onClick={() => void remove(m)}><Trash2 size={14}/></button>
              </>}
            </div>}
          </article>
        </div>;
      })}
      {p.typing && <p className="mt-3 flex items-center gap-2 px-7 text-[11px] text-muted"><span className="flex gap-0.5" aria-hidden><span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]"/><span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]"/><span className="h-1 w-1 animate-bounce rounded-full bg-muted"/></span>{p.typing}</p>}<div ref={bottom}/>
    </div></div>{newBelow && <button onClick={() => toBottom()} className="primary-button absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs shadow-lg"><ArrowDown size={14}/>New messages</button>}</div>
    <form onSubmit={submit} className="shrink-0 bg-canvas px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      {error && <p role="alert" className="error-notice mb-2 flex items-center justify-between gap-2">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></p>}
      {!ready && <p className="warning-notice mb-2">Every member must sign in and complete encryption setup before new messages can be sent.</p>}
      {!p.connected && <p role="status" className="warning-notice mb-2">Reconnecting… Your draft stays here.</p>}
      <div className="overflow-hidden rounded-xl border border-line bg-panel focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        {recording ? <VoiceRecorder onCancel={() => setRecording(false)} onError={setError} onSend={(blob, duration) => {setRecording(false); void deliver('', {file: blob, name: 'Voice note', duration});}}/> : <>
          {file && <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2 text-xs">{kindOf(file.type) === 'video' ? <Film size={15} className="text-accent"/> : kindOf(file.type) === 'audio' ? <Mic size={15} className="text-accent"/> : <ImageIcon size={15} className="text-accent"/>}<span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span><span className="text-muted">{formatBytes(file.size)}</span><button type="button" aria-label="Remove attachment" disabled={busy} onClick={() => setFile(null)}><X size={14}/></button></div>}
          <textarea aria-label="Message" placeholder={file ? 'Add a caption (optional)' : `Message ${p.conversation.peer.name}`} rows={2} maxLength={MAX_TEXT} disabled={busy} value={draft} onChange={(e) => {setDraft(e.target.value); p.onTyping(p.conversation.id, !!e.target.value.trim());}} onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); void submit(e);}}} className="block max-h-36 min-h-[70px] w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[13px] leading-6"/>
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <button type="button" aria-label="Attach image, video or audio" title="Attach image, video or audio (up to 25 MB)" disabled={busy || !ready || !p.connected} className="icon-button h-8 w-8" onClick={() => filePicker.current?.click()}><Paperclip size={17}/></button>
              <button type="button" aria-label="Record voice note" title="Record voice note" disabled={busy || !ready || !p.connected} className="icon-button h-8 w-8" onClick={() => {setError(''); setRecording(true);}}><Mic size={17}/></button>
              <input ref={filePicker} type="file" accept="image/*,video/*,audio/*" hidden onChange={e => {choose(e.target.files?.[0]); e.target.value = '';}}/>
              <span className="ml-1 hidden text-[10px] text-muted sm:inline">{busy && file ? 'Encrypting and uploading…' : draft.length > 0 ? `${draft.length.toLocaleString()} / 2,000` : ''}</span>
            </div>
            <button type="submit" disabled={busy || !ready || !p.connected || (!draft.trim() && !file)} aria-label={busy ? 'Sending message' : error ? 'Retry message' : 'Send message'} className="primary-button rounded-md px-3 py-2"><Send size={15}/><span className="hidden text-xs sm:inline">Send</span></button>
          </div>
        </>}
      </div>
      <p className="mt-1.5 text-right text-[10px] text-muted"><span className="font-semibold">Enter</span> to send · <span className="font-semibold">Shift + Enter</span> for a new line</p>
    </form>
    <dialog ref={details} className="dialog-panel max-w-xl" aria-labelledby="details-title"><div className="flex items-center justify-between"><h2 id="details-title" className="text-base font-bold">Conversation details</h2><button aria-label="Close conversation details" className="icon-button" onClick={() => details.current?.close()}><X size={18}/></button></div>
      <h3 className="mt-4 text-xl font-bold">{p.conversation.peer.name}</h3><p className="mt-2 text-xs leading-6 text-muted">{group ? 'Group membership is fixed in this version. Create a new group for a different set of people.' : 'A private direct conversation.'} Compare fingerprints with each participant through a separate, trusted channel. Messages and media are signed and encrypted in your browser. This prototype has not been independently audited and does not provide forward secrecy.</p>
      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">{p.conversation.members.map(member=><div key={member.id} className="rounded-lg border border-line bg-soft p-3"><button className="flex items-center gap-2 text-left" onClick={() => {details.current?.close(); p.onProfile(member.id);}}><Avatar name={member.name} src={member.avatarUrl} status={member.id === p.user.id ? undefined : p.presence[member.id] ?? 'offline'} small/><p className="text-sm font-semibold hover:underline">{member.name}{member.id===p.user.id?' (you)':''}</p></button><p className="mt-2 text-[10px] text-muted">Encryption identity fingerprint · compare the full value</p><code className="mt-1 block break-words text-[10px] leading-5 text-muted">{fingerprints[member.id]||'Encryption setup not completed'}</code></div>)}</div>
      <p className="mt-4 text-xs leading-6 text-muted">A checkmark means saved on the server, not read. The server can see membership, sender IDs, timestamps, message sizes and reactions; message text and media stay encrypted.</p></dialog>
    <dialog ref={imageDialog} onClose={() => setViewer(null)} className="fixed inset-0 m-auto max-h-[92vh] max-w-[92vw] bg-transparent p-0 backdrop:bg-black/80" aria-label="Image preview">
      {viewer && <div className="relative"><img src={viewer.url} alt={viewer.name} className="max-h-[88vh] max-w-[90vw] rounded-lg object-contain"/><button aria-label="Close image" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white" onClick={() => imageDialog.current?.close()}><X size={18}/></button></div>}
    </dialog>
  </section>;
}
