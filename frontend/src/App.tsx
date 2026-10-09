import {useCallback,useEffect,useRef,useState} from 'react';
import {MessageSquare,Search,LogOut,X,Users,SquarePen,Bell,Volume2,VolumeX,ShieldCheck,ChevronDown,Settings,Circle,MinusCircle,EyeOff,Sparkles} from 'lucide-react';
import {api,ApiError,post,put} from './lib/api';
import type {Conversation,Me,Status,User} from './lib/types';
import {useChat} from './hooks/useChat';
import {useNotifications} from './hooks/useNotifications';
import {sessionRecovery,type UnlockedIdentity} from './lib/encryption';
import AuthScreen from './components/AuthScreen';
import Avatar from './components/Avatar';
import ChatPanel from './components/ChatPanel';
import PeopleDialog from './components/PeopleDialog';
import ThemeToggle from './components/ThemeToggle';
import PrivacyDialog from './components/PrivacyDialog';
import EncryptionGate from './components/EncryptionGate';
import ProfileDialog from './components/ProfileDialog';
import SettingsDialog from './components/SettingsDialog';

const STATUS_OPTIONS:{value:Status;label:string;hint:string;icon:typeof Circle;color:string}[]=[
  {value:'online',label:'Online',hint:'Show when you are active',icon:Circle,color:'text-success'},
  {value:'dnd',label:'Do not disturb',hint:'Mute alerts and sounds',icon:MinusCircle,color:'text-red-500'},
  {value:'invisible',label:'Appear offline',hint:'Others see you as offline',icon:EyeOff,color:'text-muted'},
];

const BOT_USER_ID = '00000000-0000-4000-8000-000000000001';

function Workspace({user,identity,onExpired,onUser}:{user:Me;identity:UnlockedIdentity;onExpired:()=>void;onUser:(user:Me)=>void}) {
  const notices=useNotifications(user.id,user.status==='dnd');
  const reloadMe=useCallback(()=>{void api<{user:Me}>('/auth/me').then(d=>onUser(d.user)).catch(()=>{});},[onUser]);
  const chat=useChat(user,identity,onExpired,notices.notify,reloadMe);
  const [privacyOpen,setPrivacyOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false),[profileId,setProfileId]=useState<string|null>(null);
  const statusMenu=useRef<HTMLDialogElement>(null);
  const myStatus=STATUS_OPTIONS.find(o=>o.value===user.status)||STATUS_OPTIONS[0];

  async function changeStatus(status:Status){statusMenu.current?.close();const previous=user.status;onUser({...user,status});try{await put('/me/status',{status});}catch(e){onUser({...user,status:previous});chat.setError(e instanceof Error?e.message:'Could not change your status.');}}
  async function messageProfile(userId:string){setProfileId(null);const existing=chat.conversations.find(c=>c.kind==='direct'&&c.peer.id===userId);if(existing){chat.setActiveId(existing.id);return;}try{await chat.startChat({id:userId,name:'',username:''});}catch(e){chat.setError(e instanceof Error?e.message:'Could not open that chat.');}}
  
  async function openAiChat() {
    const existing = chat.conversations.find(c => c.kind === 'direct' && c.peer.id === BOT_USER_ID);
    if (existing) {
      chat.setActiveId(existing.id);
      return;
    }
    try {
      await chat.startChat({ id: BOT_USER_ID, name: 'Campus AI Companion', username: 'campus_ai' });
    } catch (e) {
      chat.setError(e instanceof Error ? e.message : 'Could not launch Campus AI.');
    }
  }

  const [createOpen,setCreateOpen]=useState(false),[filter,setFilter]=useState('');
  const [section,setSection]=useState<'all'|'direct'|'group'>('all');
  const notificationDialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null);
  const active=chat.conversations.find(c=>c.id===chat.activeId);
  const unread=chat.conversations.reduce((n,c)=>n+c.unreadCount,0);
  const visible=chat.conversations.filter(c=>(section==='all'||c.kind===section)&&`${c.peer.name} ${c.peer.username}`.toLowerCase().includes(filter.toLowerCase()));
  
  useEffect(()=>{document.title=unread?`(${unread}) Commonroom`:'Commonroom · Campus, connected.';return()=>{document.title='Commonroom · Campus, connected.';};},[unread]);
  useEffect(()=>{if(notices.target){chat.setActiveId(notices.target);notices.setTarget(null);}},[notices.target,chat.setActiveId,notices.setTarget]);
  useEffect(()=>{const shortcut=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCreateOpen(true);}};window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);},[]);
  
  async function signOut(){try{await post('/auth/logout');sessionRecovery(user.id,null);onExpired();}catch(e){if(e instanceof ApiError&&e.status===401)onExpired();else chat.setError(e instanceof Error?e.message:'Unable to sign out.');}}
  const open=(id:string)=>{chat.setActiveId(id);notices.setToast(null);notificationDialog.current?.close();};
  const filterSection=(value:'all'|'direct'|'group')=>{setSection(value);setFilter('');chat.setActiveId(null);};
  
  function row(c:Conversation){
    const isBot = c.peer.id === BOT_USER_ID;
    return <button key={c.id} onClick={()=>open(c.id)} aria-current={c.id===chat.activeId?'true':undefined} className="sidebar-row py-2.5" aria-label={`${c.peer.name}${c.unreadCount?`, ${c.unreadCount} unread`:''}`}>
      {c.kind==='group'?<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><Users size={16}/></span>:<Avatar name={c.peer.name} src={c.peer.avatarUrl} status={chat.online[c.peer.id]??'offline'} small/>}
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-1.5 truncate text-[13px] ${c.unreadCount?'font-bold':'font-semibold'}`}>
          <span className="truncate">{c.peer.name}</span>
          {isBot && <span className="rounded bg-accent/20 px-1 py-0.2 text-[8px] font-bold text-accent uppercase">AI</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{c.lastMessage||'Start the conversation'}</span>
      </span>
      {!!c.unreadCount&&<span aria-label={`${c.unreadCount} unread messages`} className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold text-canvas">{c.unreadCount>99?'99+':c.unreadCount}</span>}
    </button>;
  }

  return <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
    <header className="flex h-12 shrink-0 items-center gap-3 bg-[var(--topbar)] px-3 text-white sm:px-5">
      <button onClick={()=>filterSection('all')} className="flex items-center gap-2 text-sm font-semibold md:w-[260px]" aria-label="Commonroom home"><span className="grid h-6 w-6 place-items-center rounded-md bg-white/15 text-xs">c.</span><span className="hidden sm:inline">commonroom</span></button>
      <span className="mx-auto flex min-w-0 flex-1 items-center justify-center gap-2 text-[11px] text-white/60"><ShieldCheck size={14}/><span className="truncate">Room for your people. Privacy for your words.</span></span>
      <div role="status" className="hidden items-center gap-1.5 text-[11px] text-white/65 lg:flex"><span className={`h-1.5 w-1.5 rounded-full ${chat.connected?'bg-emerald-400':'bg-amber-400'}`}/>{chat.connected?'Connected':'Reconnecting'}</div>
      <button onClick={()=>notificationDialog.current?.showModal()} aria-label={`Notifications${unread?`, ${unread} unread`:''}`} className="relative grid h-8 w-8 shrink-0 place-items-center rounded-md hover:bg-white/10"><Bell size={17}/>{!!unread&&<span className="absolute -right-1 -top-0.5 min-w-4 rounded-full bg-[#a87acc] px-1 text-[9px] font-bold">{unread>99?'99+':unread}</span>}</button><div className="md:hidden"><ThemeToggle rail/></div>
    </header>
    {chat.error&&<div role="alert" className="error-notice flex items-center justify-between rounded-none">{chat.error}<button onClick={()=>chat.setError('')} aria-label="Dismiss error"><X size={16}/></button></div>}
    <div className="flex min-h-0 flex-1">
      <nav aria-label="App navigation" className="hidden w-[68px] shrink-0 flex-col items-center gap-5 bg-[var(--rail)] py-5 md:flex"><button title="All conversations" aria-label="All conversations" onClick={()=>filterSection('all')} className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-[#a377bd] text-xl font-bold text-white">c.</button>
        <button onClick={()=>filterSection('direct')} aria-label="Direct messages" className="flex flex-col items-center gap-1.5 text-[10px] text-white/80"><span className={`rail-button ${section==='direct'?'bg-white/20':''}`}><MessageSquare size={21}/></span>DMs</button>
        <button onClick={()=>filterSection('group')} aria-label="Group chats" className="flex flex-col items-center gap-1.5 text-[10px] text-white/80"><span className={`rail-button ${section==='group'?'bg-white/20':''}`}><Users size={21}/></span>Groups</button>
        <div className="mt-auto flex flex-col items-center gap-3"><ThemeToggle rail/><button title="Profile settings" aria-label="Profile settings" onClick={()=>setSettingsOpen(true)}><Avatar name={user.name} src={user.avatarUrl} status={!chat.connected||user.status==='invisible'?'offline':user.status}/></button></div>
      </nav>
      <aside className={`w-full shrink-0 flex-col border-r border-line bg-[var(--sidebar)] md:flex md:w-[260px] lg:w-[282px] ${chat.activeId?'hidden':'flex'}`}>
        <div className="flex h-[72px] items-center justify-between border-b border-line px-5"><div><h1 className="text-lg font-bold tracking-tight">Commonroom</h1><p className="mt-0.5 text-[11px] text-muted">Your campus, connected</p></div><button onClick={()=>setCreateOpen(true)} className="icon-button" aria-label="New conversation" title="New conversation (Ctrl+K)"><SquarePen size={19}/></button></div>
        
        {/* Quick Launch AI Button */}
        <div className="px-3 pt-3">
          <button onClick={() => void openAiChat()} className="flex w-full items-center gap-2.5 rounded-lg border border-accent/20 bg-accent-soft/50 p-2.5 text-left text-xs font-semibold text-accent transition hover:bg-accent-soft">
            <Sparkles size={16} className="shrink-0 text-accent"/>
            <span className="flex-1 truncate">Chat with Campus AI</span>
          </button>
        </div>

        <div className="p-3"><div className="relative"><Search size={14} className="absolute left-3 top-[11px] text-muted"/><input ref={search} aria-label="Search conversations" value={filter} onChange={e=>setFilter(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-canvas/60 pl-9 pr-3 text-xs" placeholder="Filter your conversations"/></div></div>
        
        <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
          {(['direct','group'] as const).map(kind=>{
            const entries=visible.filter(c=>c.kind===kind);
            return entries.length?<div key={kind} className="mb-4"><p className="flex items-center gap-1 px-2.5 pb-2 pt-3 text-[11px] font-semibold text-muted"><ChevronDown size={12}/>{kind==='direct'?'Direct messages':'Group chats'}</p><div className="space-y-1">{entries.map(row)}</div></div>:null;
          })}
          {!visible.length&&<div className="px-4 py-7"><p className="text-xs leading-6 text-muted">{filter?'No conversations match that search.':'Use the compose button above to start a direct message or create a group.'}</p>{filter&&<button className="mt-3 text-xs text-accent" onClick={()=>setFilter('')}>Clear search</button>}</div>}
        </nav>
        
        <div className="border-t border-line p-4"><div className="flex items-center gap-2.5"><button aria-label={`Your status: ${myStatus.label}. Change status`} title="Change status" onClick={()=>statusMenu.current?.showModal()} className="rounded-lg"><Avatar name={user.name} src={user.avatarUrl} status={user.status==='invisible'?'offline':user.status}/></button><div className="min-w-0 flex-1"><button onClick={()=>statusMenu.current?.showModal()} className="block max-w-full text-left"><span className="block truncate text-xs font-semibold">{user.name}</span><span className={`flex items-center gap-1 text-[11px] ${myStatus.color}`}><myStatus.icon size={9} fill="currentColor"/>{myStatus.label}</span></button><button onClick={()=>setPrivacyOpen(true)} aria-label="Privacy and backup" className="mt-0.5 flex items-center gap-1 text-[11px] text-muted hover:text-accent"><ShieldCheck size={11}/>Privacy &amp; backup</button></div><button className="icon-button" aria-label="Profile settings" title="Profile settings" onClick={()=>setSettingsOpen(true)}><Settings size={17}/></button><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={()=>void signOut()}><LogOut size={17}/></button></div></div>
      </aside>
      
      {active?<ChatPanel key={active.id} user={user} conversation={active} messages={chat.messages} connected={chat.connected} presence={chat.online} typing={chat.typing} loading={chat.loading} hasMore={chat.hasMore} onBack={()=>chat.setActiveId(null)} onOlder={chat.older} onSend={chat.send} onTyping={chat.emitTyping} onEdit={chat.edit} onDelete={chat.remove} onReact={chat.react} onProfile={id=>id===user.id?setSettingsOpen(true):setProfileId(id)}/>:<section className="hidden min-w-0 flex-1 flex-col md:flex"><header className="flex h-[72px] items-center border-b border-line px-7"><h2 className="text-base font-semibold">Your conversations</h2></header><div className="flex flex-1 items-center justify-center p-8"><div className="max-w-md"><span className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent"><MessageSquare size={27}/></span><h2 className="text-4xl font-bold leading-tight tracking-tight">Good conversations.<br/>A little more private.</h2><p className="mt-5 text-sm leading-7 text-muted">Choose a chat from the sidebar or click <strong className="text-accent">Chat with Campus AI</strong> to talk to your academic assistant.</p><div className="mt-8 flex items-start gap-3 rounded-xl border border-line bg-soft p-4"><ShieldCheck className="mt-1 shrink-0 text-accent" size={20}/><p className="text-xs leading-6 text-muted">New direct and group messages are encrypted on your device. Keys are managed automatically on this browser. Optional recovery backup is available from your profile.</p></div></div></div></section>}
    </div>
    
    {notices.toast&&<div role="status" aria-label="New message notification" className="fixed bottom-5 right-4 z-30 flex w-[calc(100%-2rem)] max-w-sm items-start gap-3 rounded-xl border border-line bg-panel p-4 shadow-xl"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><MessageSquare size={17}/></span><button className="min-w-0 flex-1 text-left" onClick={()=>open(notices.toast!.conversationId)}><span className="block truncate text-sm font-bold">{notices.toast.title}</span><span className="mt-1 block text-xs text-muted">New message · Click to open</span></button><button aria-label="Dismiss notification" className="text-muted" onClick={()=>notices.setToast(null)}><X size={16}/></button></div>}
    <dialog ref={notificationDialog} className="dialog-panel" aria-labelledby="notifications-title"><div className="flex items-center justify-between"><h2 id="notifications-title" className="text-lg font-bold">Notifications</h2><button aria-label="Close notifications" className="icon-button" onClick={()=>notificationDialog.current?.close()}><X size={18}/></button></div><p className="mt-2 text-xs leading-5 text-muted">Alerts show who sent a message, never its content. Desktop alerts work while Commonroom is open.</p>
      <div className="my-5 space-y-3 rounded-xl border border-line bg-soft p-4"><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={notices.settings.sound} onChange={notices.toggleSound}/>{notices.settings.sound?<Volume2 size={15}/>:<VolumeX size={15}/>}Notification sound</label><button className="text-xs font-semibold text-accent" onClick={()=>void notices.play()}>Test sound</button><label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={notices.settings.desktop} onChange={()=>void notices.toggleDesktop()}/><Bell size={15}/>Desktop notifications</label>{notices.error&&<p role="alert" className="error-notice">{notices.error}</p>}</div>
      <h3 className="mb-2 text-xs font-semibold text-muted">Unread conversations · {unread} messages</h3><div className="max-h-60 space-y-1 overflow-y-auto">{chat.conversations.filter(c=>c.unreadCount>0).map(c=><button key={c.id} onClick={()=>open(c.id)} className="flex w-full items-center justify-between rounded-lg p-3 text-left text-sm hover:bg-soft"><span className="truncate">{c.peer.name}</span><span className="ml-3 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">{c.unreadCount}</span></button>)}{!unread&&<p className="py-5 text-center text-xs text-muted">You’re all caught up.</p>}</div></dialog>
    <dialog ref={statusMenu} className="dialog-panel max-w-xs" aria-labelledby="status-title"><div className="flex items-center justify-between"><h2 id="status-title" className="text-base font-bold">Set your status</h2><button aria-label="Close status menu" className="icon-button" onClick={()=>statusMenu.current?.close()}><X size={18}/></button></div>
      <div className="mt-3 space-y-1">{STATUS_OPTIONS.map(o=><button key={o.value} aria-pressed={user.status===o.value} onClick={()=>void changeStatus(o.value)} className={`flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-soft ${user.status===o.value?'bg-soft':''}`}><o.icon size={14} fill="currentColor" className={o.color}/><span className="flex-1"><span className="block text-sm font-semibold">{o.label}</span><span className="block text-[11px] text-muted">{o.hint}</span></span>{user.status===o.value&&<span className="text-xs text-accent">Current</span>}</button>)}</div>
      <button className="secondary-button mt-4 w-full" onClick={()=>{statusMenu.current?.close();setSettingsOpen(true);}}><Settings size={15}/>Profile settings</button></dialog>
    {settingsOpen&&<SettingsDialog user={user} onClose={()=>setSettingsOpen(false)} onUpdated={u=>{onUser(u);void chat.refreshConversations().catch(()=>{});}}/>}
    {profileId&&<ProfileDialog userId={profileId} presence={chat.online[profileId]} onClose={()=>setProfileId(null)} onMessage={chat.activeId&&chat.conversations.find(c=>c.id===chat.activeId)?.kind==='direct'&&chat.conversations.find(c=>c.id===chat.activeId)?.peer.id===profileId?undefined:()=>void messageProfile(profileId)}/>}
    {privacyOpen&&<PrivacyDialog user={user} onClose={()=>setPrivacyOpen(false)} onExpired={onExpired}/>}
    {createOpen&&<PeopleDialog onClose={()=>setCreateOpen(false)} onSelect={chat.startChat} onGroup={chat.createGroup}/>}
  </main>;
}

export default function App(){
  const [user,setUser]=useState<Me|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const expired=useCallback(()=>setUser(current=>{if(current)sessionRecovery(current.id,null);return null;}),[]);
  const load=useCallback(async()=>{setLoading(true);setError('');try{setUser((await api<{user:Me}>('/auth/me')).user);}catch(e){if(!(e instanceof ApiError&&e.status===401))setError('Could not reach Commonroom. Make sure the backend is running.');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  if(loading||error)return <div className="grid min-h-dvh place-items-center bg-canvas p-6 text-center text-ink"><div><span className="brand-mark mx-auto mb-5"><MessageSquare size={20}/></span><p className="max-w-md text-xl font-semibold">{error||'Opening Commonroom…'}</p>{error&&<button className="primary-button mx-auto mt-6" onClick={()=>void load()}>Try again</button>}</div></div>;
  return user?<EncryptionGate key={user.id} user={user} onExpired={expired}>{identity=><Workspace user={user} identity={identity} onExpired={expired} onUser={setUser}/>}</EncryptionGate>:<AuthScreen onAuth={setUser}/>;
}