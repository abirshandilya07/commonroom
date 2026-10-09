import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Send, Check, MessageSquare, Info, X, Search, LockKeyhole, ArrowDown, Paperclip, Mic, Pencil, Trash2, SmilePlus, ImageIcon, Film, FileText, UserPlus, UserMinus, LogOut, Crown, Sparkles, Smile, Flag, Ban, ShieldAlert, Eye, Laugh } from 'lucide-react';
import { api, post } from '../lib/api';
import { AiReply, Thinking } from './AiBits';
import { MENTION, READ_REQUEST, CONTEXT_SIZE } from '../hooks/useAssistant';
// "@meme" or "@meme ProgrammerHumor" on its own asks Memer for a random Reddit meme.
const MEME_COMMAND = /^\s*@(?:meme|memer)(?:\s+(?:r\/)?([A-Za-z0-9_]{2,21}))?\s*$/i;
import Avatar from './Avatar';
import AttachmentView from './Attachment';
import VoiceRecorder from './VoiceRecorder';
import AddMembersDialog from './AddMembersDialog';
import { fingerprint } from '../lib/encryption';
import { formatBytes, kindOf, MAX_ATTACHMENT_BYTES, MAX_TEXT } from '../lib/media';
import { checkOutgoing } from '../lib/fileSafety';
import type { Outgoing } from '../hooks/useChat';
import type { AiMessage, Conversation, Message, Presence, User } from '../lib/types';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const EMOJI_GROUPS: [string, string[]][] = [
  ['Smileys', ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉','😊','😇','🥰','😍','🤩','😘','😋','😛','😜','🤪','🤗','🤭','🤔','🤐','😐','😑','😶','😏','😒','🙄','😬','😌','😔','😪','😴','😷','🤒','🥵','🥶','😵','🤯','🥳','😎','🤓','😕','😟','😮','😲','😳','🥺','😢','😭','😱','😤','😡','🤬','💀','🤡','👻','🤖']],
  ['Gestures', ['👍','👎','👌','✌️','🤞','🤟','🤘','👋','🙌','👏','🙏','🤝','💪','👀','🫡','🫶','✍️','👉','👆','☝️']],
  ['Hearts', ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💕','💖','💯','✨','🔥','⭐','🌟','💥','💫']],
  ['Things', ['🎉','🎊','🎂','🎁','🏆','🥇','📚','📝','📌','📅','⏰','💻','📱','💡','🚀','✅','❌','⚠️','☕','🍕','🍔','🍟','🎮','🎧','🎵','⚽','🏏','🌈','☀️','🌙']],
];
type Props = {user: User; conversation: Conversation; messages: Message[]; connected: boolean; presence: Record<string, Presence>; typing: string; loading: boolean; hasMore: boolean;
  onBack: () => void; onOlder: () => Promise<void>; onSend: (id: string, body: string, nonce: string, outgoing?: Outgoing) => Promise<void>; onTyping: (id: string, value: boolean) => void;
  onEdit: (message: Message, text: string) => Promise<void>; onDelete: (message: Message) => Promise<void>; onReact: (message: Message, emoji: string) => Promise<void>; onProfile: (userId: string) => void;
  onAddMembers: (ids: string[]) => Promise<void>; onRemoveMember: (userId: string) => Promise<void>; reportsVersion: number;
  blocked: string[]; onToggleBlock: (userId: string) => Promise<void>; onLoadAll: () => Promise<void>;
  aiMessages: AiMessage[]; aiThinking: boolean; onAsk: (prompt: string, context?: {name: string; text: string}[]) => Promise<void>};
// Turns plain URLs into safe links; message text is never rendered as HTML.
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="text-accent underline underline-offset-2 hover:opacity-80">{part}</a> : part);
}
const REASONS = [['spam', 'Spam'], ['harassment', 'Harassment or bullying'], ['hate', 'Hate speech'], ['inappropriate', 'Inappropriate content'], ['other', 'Something else']] as const;
type Report = {id: string; messageId: number; reason: string; excerpt: string; reporter: {id: string; name: string}; sender: {id: string; name: string}; messageDeleted: boolean; createdAt: string};
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
  const [viewer, setViewer] = useState<{url: string; name: string; kind?: 'image' | 'video'} | null>(null);
  const [adding, setAdding] = useState(false);
  const [memberError, setMemberError] = useState('');
  const isCreator = group && p.conversation.createdBy === p.user.id;
  // Moderation: block, report, and (for group creators) review reports and remove messages.
  const peerBlocked = !group && p.blocked.includes(p.conversation.peer.id);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [reporting, setReporting] = useState<Message | null>(null);
  const [reportReason, setReportReason] = useState('spam'), [reportNote, setReportNote] = useState(''), [includeText, setIncludeText] = useState(true), [reportNotice, setReportNotice] = useState('');
  const reportDialog = useRef<HTMLDialogElement>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const loadReports = async () => {if (!isCreator) return; try {setReports((await api<{reports: Report[]}>(`/conversations/${p.conversation.id}/reports`)).reports);} catch {/* shown on next open */}};
  useEffect(() => {void loadReports(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCreator, p.conversation.id, p.reportsVersion]);
  useEffect(() => {if (reporting) {setReportReason('spam'); setReportNote(''); setIncludeText(true); setReportNotice(''); reportDialog.current?.showModal();}}, [reporting]);
  async function submitReport() {
    if (!reporting) return;
    try {
      const result = await post<{reviewed: boolean}>(`/messages/${reporting.id}/report`, {reason: reportReason, ...(reportNote.trim() ? {note: reportNote.trim()} : {}), ...(includeText && reporting.body ? {excerpt: reporting.body.slice(0, 2000)} : {})});
      setReportNotice(result.reviewed ? 'Thanks. The group creator will review it.' : 'Thanks, your report was saved. You can also block this person from their profile.');
    } catch (e) {setReportNotice(e instanceof Error ? e.message : 'Could not send the report.');}
  }
  async function resolveReport(report: Report, removeMessage: boolean) {
    try {
      if (removeMessage && !report.messageDeleted) {const target = p.messages.find(m => m.id === report.messageId); if (target) await p.onDelete(target); else throw new Error('Scroll up to load that message, then remove it.');}
      await post(`/conversations/${p.conversation.id}/reports/${report.id}/resolve`, {});
      await loadReports();
    } catch (e) {setMemberError(e instanceof Error ? e.message : 'Could not update the report.');}
  }
  // Preview the chosen photo or video before sending.
  const [preview, setPreview] = useState('');
  useEffect(() => {if (!file || !/^(image|video)\//.test(file.type)) {setPreview(''); return;} const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url);}, [file]);
  const [searchingAll, setSearchingAll] = useState(false);
  async function removeMember(userId: string) {
    const leaving = userId === p.user.id;
    if (!confirm(leaving ? `Leave ${p.conversation.peer.name}? You won't see new messages.` : `Remove ${p.conversation.members.find(m => m.id === userId)?.name} from the group?`)) return;
    setMemberError('');
    try {await p.onRemoveMember(userId); if (leaving) details.current?.close();} catch (e) {setMemberError(e instanceof Error ? e.message : 'Could not update the group.');}
  }
  const retry = useRef<{body: string; id: string; file: File | null} | null>(null);
  const details = useRef<HTMLDialogElement>(null);
  const imageDialog = useRef<HTMLDialogElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const textBox = useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // GIFs share the emoji button. A picked GIF is sent like a photo: encrypted on this device first.
  const [pickerTab, setPickerTab] = useState<'emoji' | 'gif'>('emoji');
  const [gifQuery, setGifQuery] = useState(''), [gifs, setGifs] = useState<{id: string; title: string; preview: string; full: string}[]>([]), [gifError, setGifError] = useState(''), [gifBusy, setGifBusy] = useState(false);
  const gifPicker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!emojiOpen || pickerTab !== 'gif') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setGifError('');
      api<{gifs: typeof gifs}>(`/gifs/search?q=${encodeURIComponent(gifQuery.trim())}`).then(d => {if (!cancelled) setGifs(d.gifs);}).catch(e => {if (!cancelled) {setGifs([]); setGifError(e instanceof Error ? e.message : 'GIF search is unavailable.');}});
    }, 300);
    return () => {cancelled = true; clearTimeout(timer);};
  }, [emojiOpen, pickerTab, gifQuery]);
  async function sendGif(blob: Blob, name: string) {
    setGifBusy(true);
    try {const ok = await deliver(draft.trim(), {file: new File([blob], name, {type: blob.type || 'image/gif'}), name}); if (ok) {setEmojiOpen(false); setDraft('');}}
    finally {setGifBusy(false);}
  }
  async function pickGif(gif: {title: string; full: string}) {
    try {const response = await fetch(gif.full, {credentials: 'same-origin'}); if (!response.ok) throw new Error('That GIF couldn’t be loaded.'); await sendGif(await response.blob(), `${(gif.title || 'GIF').replace(/[^\w -]/g, '').trim().slice(0, 40) || 'GIF'}.gif`);}
    catch (e) {setGifError(e instanceof Error ? e.message : 'That GIF couldn’t be sent.');}
  }
  // Insert at the cursor so people can add emoji mid-sentence.
  function insertEmoji(emoji: string) {
    const el = textBox.current, start = el?.selectionStart ?? draft.length, end = el?.selectionEnd ?? draft.length;
    const next = (draft.slice(0, start) + emoji + draft.slice(end)).slice(0, MAX_TEXT);
    setDraft(next); p.onTyping(p.conversation.id, !!next.trim());
    requestAnimationFrame(() => {if (!el) return; el.focus(); const at = Math.min(start + emoji.length, next.length); el.setSelectionRange(at, at);});
  }
  const bottom = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  // Follow new messages only while the reader is at the bottom; never pull them away from older history.
  const atBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(false);
  const last = p.messages.at(-1);
  const lastId = last?.id;
  const visible = query.trim() ? p.messages.filter((m) => m.body.toLowerCase().includes(query.trim().toLowerCase())) : p.messages;
  // AI answers sit in the timeline by time; they are visible to everyone in this chat.
  type Entry = {kind: 'm'; m: Message} | {kind: 'ai'; a: AiMessage};
  const aiShown = query.trim() ? p.aiMessages.filter(a => a.body.toLowerCase().includes(query.trim().toLowerCase())) : p.aiMessages;
  const timeline: Entry[] = [...visible.map(m => ({kind: 'm' as const, m})), ...aiShown.map(a => ({kind: 'ai' as const, a}))]
    .sort((x, y) => {const tx = x.kind === 'm' ? x.m.createdAt : x.a.createdAt, ty = y.kind === 'm' ? y.m.createdAt : y.a.createdAt; return tx < ty ? -1 : tx > ty ? 1 : x.kind === 'm' ? -1 : 1;});
  const mentioned = MENTION.test(draft);
  const [readOverride, setReadOverride] = useState<boolean | null>(null);
  const readChat = readOverride ?? READ_REQUEST.test(draft);
  const toBottom = (smooth = true) => {bottom.current?.scrollIntoView({behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant'}); atBottom.current = true; setNewBelow(false);};
  useEffect(() => {
    if (query.trim() || !lastId) return;
    if (atBottom.current || last?.senderId === p.user.id) toBottom(); else setNewBelow(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId, query]);
  useEffect(() => {if ((p.aiThinking || p.aiMessages.length) && atBottom.current && !query.trim()) toBottom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.aiThinking, p.aiMessages.length]);
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
  // Memer: the server picks a safe meme; it is sent like a photo, encrypted on this device first.
  const [memeBusy, setMemeBusy] = useState(false);
  const memeCommand = file ? null : draft.match(MEME_COMMAND);
  async function sendMeme(subreddit?: string) {
    if (memeBusy || busy) return;
    setMemeBusy(true); setError('');
    try {
      const meme = await api<{title: string; subreddit: string; image: string}>(`/memes/random${subreddit ? `?sub=${encodeURIComponent(subreddit)}` : ''}`);
      const response = await fetch(meme.image, {credentials: 'same-origin'});
      if (!response.ok) throw new Error('That meme couldn’t be loaded. Try again.');
      const blob = await response.blob(), ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const name = `${meme.title.replace(/[^\w -]/g, '').trim().slice(0, 40) || 'meme'}.${ext}`;
      const ok = await deliver(`😂 Memer · r/${meme.subreddit}\n${meme.title}`, {file: new File([blob], name, {type: blob.type || 'image/jpeg'}), name});
      if (ok && memeCommand) {setDraft(''); p.onTyping(p.conversation.id, false);}
    } catch (e) {setError(e instanceof Error ? `Memer: ${e.message}` : 'Memer couldn’t find a meme.');}
    finally {setMemeBusy(false);}
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if ((!body && !file) || busy || memeBusy) return;
    if (memeCommand) {await sendMeme(memeCommand[1]); return;}
    const ok = await deliver(body, file ? {file, name: file.name} : undefined, {body, file});
    // Keep a file picked while this message was still sending.
    if (ok) {setDraft(''); setEmojiOpen(false); setFile(current => current === file ? null : current); retry.current = null; p.onTyping(p.conversation.id, false);}
    if (ok && MENTION.test(body)) {
      const shareChat = readChat;
      setReadOverride(null);
      // Privacy: earlier messages are shared with the AI only when the asker allows it.
      const context = shareChat ? p.messages.filter(m => !m.deleted && !m.decryptionError && !m.beforeJoin && (m.body || m.attachment)).slice(-CONTEXT_SIZE)
        .map(m => ({name: nameOf(m.senderId) === 'You' ? p.user.name : nameOf(m.senderId), text: [m.attachment ? `[${m.attachment.kind}: ${m.attachment.name}]` : '', m.body].filter(Boolean).join(' ').slice(0, 2000)})) : undefined;
      try {await p.onAsk(body.replace(MENTION, ' ').trim() || body, context);}
      catch (e) {setError(e instanceof Error ? `Common Room AI: ${e.message}` : 'Common Room AI could not answer.');}
    }
  }
  async function choose(selected?: File) {
    if (!selected) return;
    if (selected.size > MAX_ATTACHMENT_BYTES) {setError(`That file is ${formatBytes(selected.size)}. Files can be up to 25 MB.`); return;}
    try {await checkOutgoing(selected, selected.name); setError(''); setFile(selected);}
    catch (e) {setError(e instanceof Error ? e.message : 'That file can’t be shared.');}
  }
  async function saveEdit(message: Message) {
    if (!editing) return;
    const text = editing.text.trim();
    if ((!text && !message.attachment) || text === message.body) {setEditing(null); return;}
    try {await p.onEdit(message, text); setEditing(null);} catch (e) {setError(e instanceof Error ? e.message : 'Unable to edit.');}
  }
  async function remove(message: Message) {
    if (!confirm(message.senderId === p.user.id ? 'Delete this message for everyone?' : 'Remove this message from the group for everyone?')) return;
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
    {findOpen && <div className="flex items-center gap-2 border-b border-line bg-soft px-4 py-2"><Search size={15} className="text-muted"/><input autoFocus aria-label="Search loaded messages" className="min-w-0 flex-1 bg-transparent py-1 text-xs" placeholder="Search messages in this chat…" value={query} onChange={(e) => setQuery(e.target.value)}/><span className="shrink-0 text-[10px] text-muted">{visible.length} found</span>{p.hasMore && <button className="shrink-0 text-[10px] font-semibold text-accent" disabled={searchingAll} onClick={async () => {setSearchingAll(true); try {await p.onLoadAll();} catch (e) {setError(e instanceof Error ? e.message : 'Unable to load history.');} finally {setSearchingAll(false);}}}>{searchingAll ? 'Loading…' : 'Search all history'}</button>}<button aria-label="Close message search" className="icon-button h-7 w-7" onClick={() => {setFindOpen(false); setQuery('');}}><X size={14}/></button></div>}
    {p.messages.some(m=>m.legacy)&&<p className="warning-notice mx-4 mt-2">Earlier messages were sent before encryption was enabled. They remain readable and are not end-to-end encrypted.</p>}
    <div className="relative min-h-0 flex-1"><div ref={log} onScroll={onScroll} className="h-full overflow-y-auto pb-4 pt-5" role="log" aria-label="Messages" aria-live="polite"><div ref={content}>
      {p.hasMore && <div className="mb-5 text-center"><button disabled={loadingOlder} className="secondary-button px-3 py-1.5 text-[11px]" onClick={async () => {setLoadingOlder(true); try {await p.onOlder();} catch (e) {setError(e instanceof Error ? e.message : 'Unable to load history.');} finally {setLoadingOlder(false);}}}>{loadingOlder ? 'Loading…' : 'Load earlier messages'}</button></div>}
      {!p.hasMore && !query.trim() && <div className="px-5 pb-7 pt-3 sm:px-7"><Avatar name={p.conversation.peer.name} src={group ? undefined : p.conversation.peer.avatarUrl} large/><h3 className="mt-4 text-2xl font-bold tracking-tight">{p.conversation.peer.name}</h3><p className="mt-1 text-xs text-muted">{group ? `${p.conversation.members.length} members` : `@${p.conversation.peer.username}`}</p><p className="mt-3 max-w-xl text-[13px] leading-6 text-muted">{group ? `Welcome to ${p.conversation.peer.name}. New messages are encrypted for all ${p.conversation.members.length} members.` : `Your direct conversation with ${p.conversation.peer.name}. New messages are encrypted on your devices.`}</p></div>}
      {p.loading && !p.messages.length && <p className="px-7 py-5 text-xs text-muted">Loading your conversation…</p>}
      {query.trim() && !visible.length && <p className="px-7 py-8 text-sm text-muted">No matches in the loaded messages.{p.hasMore ? ' Use “Search all history” to look further back.' : ''}</p>}
      {timeline.map((entry, index) => {
        const before = timeline[index - 1];
        if (entry.kind === 'ai') return <AiReply key={`ai-${entry.a.id}`} message={entry.a}/>;
        const m = entry.m;
        const own = m.senderId === p.user.id;
        const date = new Date(m.createdAt);
        const prev = before?.kind === 'm' ? before.m : undefined;
        const showDate = !before || date.toDateString() !== new Date(before.kind === 'm' ? before.m.createdAt : before.a.createdAt).toDateString();
        const grouped = !query.trim() && !showDate && prev?.senderId === m.senderId && date.getTime() - new Date(prev.createdAt).getTime() < 300000;
        const member = p.conversation.members.find(x => x.id === m.senderId);
        const author = member || (own ? p.user : {name:'Unknown sender', avatarUrl: null});
        const actionable = !m.deleted && !m.legacy && !m.decryptionError && !m.beforeJoin;
        const isEditing = editing?.id === m.id;
        const hidden = !own && p.blocked.includes(m.senderId) && !revealed.has(m.id) && !m.deleted;
        const canRemove = own || (isCreator && !own);
        return <div key={m.id}>
          {showDate && <div className="relative my-4 flex items-center px-5 sm:px-7"><span className="h-px flex-1 bg-line"/><span className="rounded-full border border-line bg-canvas px-3 py-1 text-[10px] font-semibold">{date.toLocaleDateString(undefined, {weekday: 'long', month: 'long', day: 'numeric'})}</span><span className="h-px flex-1 bg-line"/></div>}
          <article onClick={e => {if (!(e.target as HTMLElement).closest('button,textarea,audio,video,a')) setSelected(selected === m.id ? null : m.id);}} className={`message-row group relative ${grouped ? 'py-1' : ''}`}>
            {grouped ? <span className="w-9 shrink-0 pt-1 text-right text-[9px] text-muted"><time dateTime={m.createdAt}>{date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false})}</time></span> : <button aria-label={`View ${author.name}'s profile`} onClick={() => p.onProfile(m.senderId)} className="h-9 shrink-0"><Avatar name={author.name} src={author.avatarUrl}/></button>}
            <div className="min-w-0 flex-1">
              {!grouped && <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]"><button className="font-bold hover:underline" onClick={() => p.onProfile(m.senderId)}>{author.name}</button>{own && <span className="text-[10px] text-muted">(you)</span>}<time className="text-[10px] text-muted" dateTime={m.createdAt}>{date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'})}</time>{own && !m.deleted && <Check aria-label="Saved on server" className="text-success" size={11}/>}<span className="text-[9px] text-muted">{m.deleted ? '' : m.legacy ? 'Earlier · unencrypted' : m.decryptionError ? 'Verification failed' : 'Encrypted'}</span></p>}
              {m.deleted ? <p className={`text-[13px] italic text-muted ${grouped ? '' : 'mt-0.5'}`}>This message was deleted.</p> : hidden ? <p className="mt-0.5 flex items-center gap-2 text-[12px] italic text-muted"><Ban size={12}/>Message from someone you blocked<button className="not-italic font-semibold text-accent" onClick={() => setRevealed(new Set(revealed).add(m.id))}><Eye size={12} className="mr-1 inline"/>Show</button></p> : isEditing ? <div className="mt-1">
                <textarea autoFocus aria-label="Edit message" maxLength={MAX_TEXT} rows={2} value={editing.text} onChange={e => setEditing({id: m.id, text: e.target.value})} onKeyDown={e => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); void saveEdit(m);} if (e.key === 'Escape') setEditing(null);}} className="block w-full resize-none rounded-lg border border-accent bg-panel px-3 py-2 text-[13px] leading-6"/>
                <p className="mt-1 flex gap-3 text-[10px] text-muted"><span>Enter to save · Esc to cancel</span><button className="font-semibold text-accent" onClick={() => void saveEdit(m)}>Save</button><button onClick={() => setEditing(null)}>Cancel</button></p>
              </div> : <>
                {m.body && <p className={`${m.decryptionError ? "text-red-500" : m.beforeJoin ? "italic text-muted" : ""} whitespace-pre-wrap break-words text-[13px] leading-[1.65] [overflow-wrap:anywhere] ${grouped ? '' : 'mt-0.5'}`}>{linkify(m.body)}{m.editedAt && <span className="ml-1.5 text-[10px] text-muted">(edited)</span>}</p>}
                {m.attachment && <AttachmentView attachment={m.attachment} onOpenImage={(url, name, kind) => setViewer({url, name, kind})}/>}
                {!m.body && m.editedAt && <span className="text-[10px] text-muted">(edited)</span>}
              </>}
              {m.id === lastOwn?.id && !!seenBy.length && <p className="mt-1 text-[10px] text-muted">{group ? `Seen by ${seenBy.length === p.conversation.members.length - 1 ? 'everyone' : seenBy.map(x => x.name.split(' ')[0]).join(', ')}` : 'Seen'}</p>}
              {!!m.reactions?.length && <div className="mt-1.5 flex flex-wrap gap-1">{m.reactions.map(r => {const mine = r.userIds.includes(p.user.id); return <button key={r.emoji} onClick={() => void react(m, r.emoji)} title={r.userIds.map(nameOf).join(', ')} aria-pressed={mine} aria-label={`${r.emoji} ${r.userIds.length}, reacted by ${r.userIds.map(nameOf).join(', ')}`} className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${mine ? 'border-accent bg-accent-soft' : 'border-line bg-soft hover:border-accent'}`}><span>{r.emoji}</span><span className="text-[10px] font-semibold">{r.userIds.length}</span></button>;})}</div>}
            </div>
            {actionable && !isEditing && !hidden && <div className={`flex shrink-0 items-center gap-0.5 self-start rounded-lg border border-transparent p-0.5 transition group-hover:border-line group-hover:bg-panel group-hover:opacity-100 focus-within:opacity-100 ${picker === m.id || selected === m.id ? 'border-line bg-panel opacity-100' : 'opacity-60'}`}>
              {picker === m.id ? QUICK_REACTIONS.map(emoji => <button key={emoji} aria-label={`React ${emoji}`} className="grid h-7 w-7 place-items-center rounded-md text-base hover:bg-soft" onClick={() => void react(m, emoji)}>{emoji}</button>)
                : <button aria-label="Add reaction" title="Add reaction" className="icon-button h-7 w-7" onClick={() => setPicker(m.id)}><SmilePlus size={15}/></button>}
              {picker === m.id ? <button aria-label="Close reactions" className="icon-button h-7 w-7" onClick={() => setPicker(null)}><X size={14}/></button> : <>
                {own && <button aria-label="Edit message" title="Edit" className="icon-button h-7 w-7" onClick={() => setEditing({id: m.id, text: m.body})}><Pencil size={14}/></button>}
                {canRemove && <button aria-label={own ? 'Delete message' : 'Remove message (group creator)'} title={own ? 'Delete' : 'Remove (group creator)'} className="icon-button h-7 w-7 hover:text-red-500" onClick={() => void remove(m)}><Trash2 size={14}/></button>}
                {!own && <button aria-label="Report message" title="Report" className="icon-button h-7 w-7 hover:text-red-500" onClick={() => setReporting(m)}><Flag size={14}/></button>}
              </>}
            </div>}
          </article>
        </div>;
      })}
      {p.typing && <p className="mt-3 flex items-center gap-2 px-7 text-[11px] text-muted"><span className="flex gap-0.5" aria-hidden><span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.3s]"/><span className="h-1 w-1 animate-bounce rounded-full bg-muted [animation-delay:-0.15s]"/><span className="h-1 w-1 animate-bounce rounded-full bg-muted"/></span>{p.typing}</p>}{p.aiThinking && <Thinking/>}<div ref={bottom}/>
    </div></div>{newBelow && <button onClick={() => toBottom()} className="primary-button absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-xs shadow-lg"><ArrowDown size={14}/>New messages</button>}</div>
    <form onSubmit={submit} className="relative shrink-0 bg-canvas px-3 pb-3 pt-2 sm:px-5 sm:pb-4">
      {error && <p role="alert" className="error-notice mb-2 flex items-center justify-between gap-2">{error}<button type="button" aria-label="Dismiss error" onClick={() => setError('')}><X size={14}/></button></p>}
      {peerBlocked && <p className="warning-notice mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5"><Ban size={13}/>You blocked {p.conversation.peer.name}. Neither of you can send messages here.</span><button type="button" className="font-semibold underline" onClick={() => void p.onToggleBlock(p.conversation.peer.id).catch(e => setError(e instanceof Error ? e.message : 'Could not unblock.'))}>Unblock</button></p>}
      {!ready && <p className="warning-notice mb-2">Every member must sign in and complete encryption setup before new messages can be sent.</p>}
      {!p.connected && <p role="status" className="warning-notice mb-2">Reconnecting… Your draft stays here.</p>}
      {emojiOpen && <div role="dialog" aria-label="Emoji picker" onKeyDown={e => {if (e.key === 'Escape') {setEmojiOpen(false); textBox.current?.focus();}}} className="absolute bottom-full left-3 z-20 mb-1 sm:left-5 w-[min(19rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-2 shadow-xl">
                  <div className="flex items-center justify-between px-1 pb-1"><div className="flex gap-1" role="tablist">{(['emoji', 'gif'] as const).map(tab => <button type="button" role="tab" key={tab} aria-selected={pickerTab === tab} onClick={() => setPickerTab(tab)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${pickerTab === tab ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-soft'}`}>{tab === 'emoji' ? 'Emoji' : 'GIF'}</button>)}</div><button type="button" aria-label="Close emoji picker" className="icon-button h-6 w-6" onClick={() => setEmojiOpen(false)}><X size={13}/></button></div>
                  {pickerTab === 'gif' ? <div>
                    <div className="flex gap-1.5"><input aria-label="Search GIFs" autoFocus value={gifQuery} onChange={e => setGifQuery(e.target.value)} placeholder="Search GIFs…" className="h-8 min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 text-xs"/><button type="button" disabled={gifBusy || !ready || peerBlocked} onClick={() => gifPicker.current?.click()} className="secondary-button h-8 px-2 py-0 text-[11px]">Upload GIF</button></div>
                    <input ref={gifPicker} type="file" accept="image/gif" hidden onChange={e => {const f = e.target.files?.[0]; e.target.value = ''; if (f) void sendGif(f, f.name);}}/>
                    {gifError && <p className="mt-2 text-[11px] text-muted">{gifError}</p>}
                    {gifBusy && <p className="mt-2 text-[11px] text-muted">Encrypting and sending…</p>}
                    <div className="mt-2 grid max-h-60 grid-cols-3 gap-1 overflow-y-auto">{gifs.map(g => <button type="button" key={g.id} disabled={gifBusy || !ready || peerBlocked} aria-label={`Send GIF: ${g.title}`} onClick={() => void pickGif(g)} className="overflow-hidden rounded-md bg-soft hover:ring-2 hover:ring-accent"><img src={g.preview} alt={g.title} loading="lazy" className="h-20 w-full object-cover"/></button>)}</div>
                    {!!gifs.length && <p className="mt-1 text-right text-[9px] text-muted">Powered by GIPHY</p>}
                  </div> : <div className="max-h-60 overflow-y-auto">{EMOJI_GROUPS.map(([label, list]) => <div key={label}><p className="px-1 pb-0.5 pt-1.5 text-[10px] text-muted">{label}</p><div className="grid grid-cols-8 gap-0.5">{list.map(emoji => <button type="button" key={emoji} aria-label={`Insert ${emoji}`} onClick={() => insertEmoji(emoji)} className="grid h-8 w-8 place-items-center rounded-md text-lg hover:bg-soft">{emoji}</button>)}</div></div>)}</div>}
                </div>}
      {memeCommand && !recording && <div className="mb-2 flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[11px] font-semibold text-accent"><Laugh size={13}/>{memeBusy ? 'Memer is finding a meme…' : `Memer will send a random meme${memeCommand[1] ? ` from r/${memeCommand[1]}` : ''} to everyone here`}</div>}
      {mentioned && !recording && <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-[11px]"><span className="flex items-center gap-1.5 font-semibold text-accent"><Sparkles size={13}/>Common Room AI will answer in this chat</span><label className="flex items-center gap-1.5 text-ink"><input type="checkbox" checked={readChat} onChange={e => setReadOverride(e.target.checked)}/>Let it read the last {CONTEXT_SIZE} messages</label><span className="text-muted">{readChat ? 'Those messages are sent to the AI service to answer.' : 'It only sees this message.'}</span></div>}
      <div className="overflow-hidden rounded-xl border border-line bg-panel focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        {recording ? <VoiceRecorder onCancel={() => setRecording(false)} onError={setError} onSend={(blob, duration) => {setRecording(false); void deliver('', {file: blob, name: 'Voice note', duration});}}/> : <>
          {file && <div className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-line bg-soft px-3 py-2 text-xs">{kindOf(file.type) === 'video' ? <Film size={15} className="text-accent"/> : kindOf(file.type) === 'audio' ? <Mic size={15} className="text-accent"/> : kindOf(file.type) === 'image' ? <ImageIcon size={15} className="text-accent"/> : <FileText size={15} className="text-accent"/>}{preview && (kindOf(file.type) === 'video' ? <video src={preview} muted className="h-12 w-16 shrink-0 rounded-md bg-black object-cover"/> : <img src={preview} alt="" className="h-12 w-12 shrink-0 rounded-md object-cover"/>)}<span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span><span className="text-muted">{formatBytes(file.size)}</span><button type="button" aria-label="Remove attachment" disabled={busy} onClick={() => setFile(null)}><X size={14}/></button></div>}
          <textarea ref={textBox} aria-label="Message" placeholder={file ? 'Add a caption (optional)' : `Message ${p.conversation.peer.name} · to message AI use @ai`} rows={2} maxLength={MAX_TEXT} disabled={busy} value={draft} onChange={(e) => {setDraft(e.target.value); p.onTyping(p.conversation.id, !!e.target.value.trim());}} onKeyDown={(e) => {if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); void submit(e);}}} className="block max-h-36 min-h-[70px] w-full resize-none bg-transparent px-4 pb-2 pt-3 text-[13px] leading-6"/>
          <div className="flex items-center justify-between gap-2 px-2 pb-2">
            <div className="flex items-center gap-0.5">
              <button type="button" aria-label="Attach a file" title="Attach a photo, video, audio or document (up to 25 MB)" disabled={busy || !ready || !p.connected} className="icon-button h-8 w-8" onClick={() => filePicker.current?.click()}><Paperclip size={17}/></button>
              <button type="button" aria-label="Insert emoji" title="Emoji" aria-expanded={emojiOpen} disabled={busy} className="icon-button h-8 w-8" onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={17}/></button>
              <button type="button" aria-label="Record voice note" title="Record voice note" disabled={busy || !ready || !p.connected} className="icon-button h-8 w-8" onClick={() => {setError(''); setRecording(true);}}><Mic size={17}/></button>
              <button type="button" aria-label="Send a random meme" title="Memer: send a random meme (or type @meme subreddit)" disabled={busy || memeBusy || !ready || peerBlocked || !p.connected} className="icon-button h-8 w-8" onClick={() => void sendMeme()}><Laugh size={17} className={memeBusy ? 'animate-pulse' : ''}/></button>
              <input ref={filePicker} type="file" hidden onChange={e => {void choose(e.target.files?.[0]); e.target.value = '';}}/>
              <span className="ml-1 hidden text-[10px] text-muted sm:inline">{memeBusy ? 'Finding a meme…' : busy && file ? 'Encrypting and uploading…' : draft.length > 0 ? `${draft.length.toLocaleString()} / 2,000` : ''}</span>
            </div>
            <button type="submit" disabled={busy || !ready || peerBlocked || !p.connected || (!draft.trim() && !file)} aria-label={busy ? 'Sending message' : error ? 'Retry message' : 'Send message'} className="primary-button rounded-md px-3 py-2"><Send size={15}/><span className="hidden text-xs sm:inline">Send</span></button>
          </div>
        </>}
      </div>
      <p className="mt-1.5 text-right text-[10px] text-muted"><span className="font-semibold">Enter</span> to send · <span className="font-semibold">Shift + Enter</span> for a new line · <span className="font-semibold text-accent">@ai</span> to ask Common Room AI · <span className="font-semibold text-accent">@meme</span> for a meme</p>
    </form>
    <dialog ref={details} className="dialog-panel max-w-xl" aria-labelledby="details-title"><div className="flex items-center justify-between"><h2 id="details-title" className="text-base font-bold">Conversation details</h2><button aria-label="Close conversation details" className="icon-button" onClick={() => details.current?.close()}><X size={18}/></button></div>
      <h3 className="mt-4 text-xl font-bold">{p.conversation.peer.name}</h3><p className="mt-2 text-xs leading-6 text-muted">{group ? 'The group creator can add or remove people. New members only see messages sent after they join.' : 'A private direct conversation.'} Compare fingerprints with each participant through a separate, trusted channel. Messages and media are signed and encrypted in your browser. This prototype has not been independently audited and does not provide forward secrecy.</p>
      {group && <div className="mt-4 flex flex-wrap gap-2">{isCreator && <button className="secondary-button text-xs" onClick={() => setAdding(true)}><UserPlus size={14}/>Add people</button>}<button className="secondary-button text-xs hover:text-red-500" onClick={() => void removeMember(p.user.id)}><LogOut size={14}/>Leave group</button></div>}
      {memberError && <p role="alert" className="error-notice mt-3">{memberError}</p>}
      {isCreator && <div className="mt-4 rounded-lg border border-line p-3"><p className="flex items-center gap-1.5 text-sm font-semibold"><ShieldAlert size={15} className="text-accent"/>Reports to review · {reports.length}</p>
        {!reports.length ? <p className="mt-1 text-[11px] text-muted">No open reports. As the creator you can remove any message (trash icon) and remove members.</p> : <ul className="mt-2 space-y-2">{reports.map(r => <li key={r.id} className="rounded-md bg-soft p-2.5 text-xs">
          <p><span className="font-semibold">{r.reporter.name}</span> reported <span className="font-semibold">{r.sender.name}</span> for <span className="font-semibold">{r.reason}</span></p>
          {r.excerpt ? <p className="mt-1 border-l-2 border-line pl-2 italic text-muted">“{r.excerpt}”</p> : <p className="mt-1 text-muted">The reporter didn’t share the message text.</p>}
          <div className="mt-2 flex gap-3">{!r.messageDeleted && <button className="font-semibold text-red-500" onClick={() => void resolveReport(r, true)}>Remove message</button>}{r.messageDeleted && <span className="text-muted">Message removed</span>}<button className="font-semibold text-accent" onClick={() => void resolveReport(r, false)}>Dismiss</button>{r.sender.id !== p.user.id && p.conversation.members.some(x => x.id === r.sender.id) && <button className="text-muted hover:text-red-500" onClick={() => void removeMember(r.sender.id)}>Remove {r.sender.name.split(' ')[0]} from group</button>}</div>
        </li>)}</ul>}</div>}
      <div className="mt-4 max-h-80 space-y-3 overflow-y-auto">{p.conversation.members.map(member=><div key={member.id} className="rounded-lg border border-line bg-soft p-3"><div className="flex items-center gap-2"><button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => {details.current?.close(); p.onProfile(member.id);}}><Avatar name={member.name} src={member.avatarUrl} status={member.id === p.user.id ? undefined : p.presence[member.id] ?? 'offline'} small/><p className="truncate text-sm font-semibold hover:underline">{member.name}{member.id===p.user.id?' (you)':''}</p>{group && member.id === p.conversation.createdBy && <span title="Group creator" className="flex items-center gap-1 text-[10px] text-accent"><Crown size={11}/>Creator</span>}</button>{isCreator && member.id !== p.user.id && <button aria-label={`Remove ${member.name}`} title="Remove from group" className="icon-button h-7 w-7 hover:text-red-500" onClick={() => void removeMember(member.id)}><UserMinus size={14}/></button>}</div><p className="mt-2 text-[10px] text-muted">Encryption identity fingerprint · compare the full value</p><code className="mt-1 block break-words text-[10px] leading-5 text-muted">{fingerprints[member.id]||'Encryption setup not completed'}</code></div>)}</div>
      <p className="mt-4 text-xs leading-6 text-muted">A checkmark means saved on the server, not read. The server can see membership, sender IDs, timestamps, message sizes and reactions; message text and media stay encrypted.</p></dialog>
    <dialog ref={reportDialog} onClose={() => setReporting(null)} className="dialog-panel" aria-labelledby="report-title">
      <div className="flex items-center justify-between"><h2 id="report-title" className="flex items-center gap-2 text-base font-bold"><Flag size={16}/>Report message</h2><button aria-label="Close report" className="icon-button" onClick={() => reportDialog.current?.close()}><X size={18}/></button></div>
      {reporting && <>
        <p className="mt-2 text-xs leading-5 text-muted">From {nameOf(reporting.senderId)}. {group ? 'The group creator reviews reports.' : 'Your report is saved, and you can block this person from their profile.'} Messages are encrypted, so the text is only included if you choose.</p>
        <label className="field-label mt-4">Reason<select value={reportReason} onChange={e => setReportReason(e.target.value)} className="field">{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field-label mt-3">Details (optional)<input value={reportNote} maxLength={500} onChange={e => setReportNote(e.target.value)} className="field"/></label>
        {!!reporting.body && <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={includeText} onChange={e => setIncludeText(e.target.checked)}/>Include the message text so it can be reviewed</label>}
        {reportNotice && <p role="status" className="mt-3 text-xs text-success">{reportNotice}</p>}
        <div className="mt-4 flex justify-end gap-2">{!reportNotice ? <><button className="secondary-button" onClick={() => reportDialog.current?.close()}>Cancel</button><button className="primary-button" onClick={() => void submitReport()}>Send report</button></> : <button className="primary-button" onClick={() => reportDialog.current?.close()}>Done</button>}</div>
      </>}
    </dialog>
    {adding && <AddMembersDialog conversation={p.conversation} onClose={() => setAdding(false)} onAdd={p.onAddMembers}/>}
    <dialog ref={imageDialog} onClose={() => setViewer(null)} className="fixed inset-0 m-auto max-h-[92vh] max-w-[92vw] bg-transparent p-0 backdrop:bg-black/80" aria-label="Media viewer">
      {viewer && <div className="relative">{viewer.kind === 'video' ? <video src={viewer.url} controls autoPlay className="max-h-[88vh] w-[min(90vw,1100px)] rounded-lg bg-black object-contain"/> : <img src={viewer.url} alt={viewer.name} className="max-h-[88vh] max-w-[90vw] rounded-lg object-contain"/>}<button aria-label="Close viewer" className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-black/60 text-white" onClick={() => imageDialog.current?.close()}><X size={18}/></button></div>}
    </dialog>
  </section>;
}
