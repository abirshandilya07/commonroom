import { useState, type FormEvent } from 'react';
import { MessageSquare, ArrowRight, Check, Zap, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { post } from '../lib/api';
import type { Me } from '../lib/types';
import ThemeToggle from './ThemeToggle';
import {rememberPassword} from '../lib/passwordBackup';
export default function AuthScreen({onAuth}: {onAuth: (user: Me) => void}) {
  const [register, setRegister] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try { const {user} = await post<{user: Me}>(`/auth/${register ? 'register' : 'login'}`, fields); rememberPassword(String(fields.password ?? '')); onAuth(user); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect.'); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-canvas text-ink">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10"><a href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight"><span className="brand-mark">c.</span>commonroom</a><div className="flex items-center gap-4"><span className="hidden text-xs text-muted sm:block">Your campus. Better connected.</span><ThemeToggle/></div></header>
    <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 py-8 sm:px-10 lg:grid-cols-2 lg:gap-24 lg:py-16">
      <section className="min-w-0"><span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[11px] font-semibold text-accent"><Zap size={13}/>A SPACE FOR YOUR PEOPLE</span><h1 className="mt-6 text-[clamp(2.5rem,7vw,3.8rem)] font-bold leading-[1.07] tracking-[-0.045em]">Good conversations.<br/><span className="text-accent">Great possibilities.</span></h1><p className="mt-5 max-w-md text-base leading-7 text-muted">Connect with classmates, find your next collaborator, and keep the ideas moving. All in one common room.</p>
        <div className="mt-8 overflow-hidden rounded-xl border border-line bg-panel shadow-lg shadow-black/5" aria-label="Illustrative conversation preview"><div className="flex items-center gap-2 border-b border-line bg-soft px-4 py-3"><span className="h-2 w-2 rounded-full bg-[#b99acd]"/><span className="text-xs font-semibold">It starts with a hello</span><span className="ml-auto text-[10px] text-muted">PREVIEW</span></div><div className="space-y-4 p-5"><div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#e6d9f0] text-xs font-bold text-[#764791]">M</span><div><p className="text-xs font-semibold">Your next teammate<span className="ml-2 font-normal text-muted">12:04</span></p><p className="mt-1 text-sm text-muted">Big idea. Small team. Want to build something?</p></div></div><div className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#daece4] text-xs font-bold text-[#35725a]">Y</span><div><p className="text-xs font-semibold">You<span className="ml-2 font-normal text-muted">12:05</span></p><p className="mt-1 text-sm">Count me in. Let’s make it happen.</p></div></div></div></div>
        <div className="mt-6 flex flex-wrap gap-5 text-[11px] text-muted"><span className="flex items-center gap-1.5"><Check size={14} className="text-success"/>Real-time messaging</span><span className="flex items-center gap-1.5"><Check size={14} className="text-success"/>Saved conversations</span></div>
      </section>
      <section className="min-w-0 rounded-2xl border border-line bg-panel p-6 shadow-xl shadow-black/5 sm:p-8">
        <div className="mb-7 flex gap-1 rounded-lg bg-soft p-1" aria-label="Account action"><button type="button" aria-pressed={register} disabled={busy} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${register ? 'bg-panel text-ink shadow-sm' : 'text-muted'}`} onClick={() => {setRegister(true); setError('');}}>Create account</button><button type="button" aria-pressed={!register} disabled={busy} className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${!register ? 'bg-panel text-ink shadow-sm' : 'text-muted'}`} onClick={() => {setRegister(false); setError('');}}>Sign in</button></div>
        <h2 className="text-2xl font-bold tracking-tight">{register ? 'Make yourself at home.' : 'Welcome back.'}</h2><p className="mt-2 text-sm text-muted">{register ? 'Your next conversation is one hello away.' : 'Pick up right where you left off.'}</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          {register && <label className="field-label">Your name<input className="field" name="name" autoComplete="name" placeholder="e.g. Abir" required minLength={2} maxLength={40}/></label>}
          <label className="field-label">Username<input className="field" name="username" autoComplete="username" autoCapitalize="none" placeholder="e.g. abir_m" required pattern="[a-zA-Z0-9_]{3,24}" title="3–24 letters, numbers, or underscores" minLength={3} maxLength={24}/></label>
          <div><label htmlFor="auth-password" className="field-label">Password</label><div className="relative"><input id="auth-password" className="field pr-11" type={showPassword ? 'text' : 'password'} name="password" autoComplete={register ? 'new-password' : 'current-password'} placeholder="At least 8 characters" required minLength={8} maxLength={128}/><button type="button" className="absolute right-1.5 top-1/2 mt-1 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-soft hover:text-ink" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} aria-controls="auth-password" title={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(v => !v)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div></div>
          {error && <p role="alert" className="error-notice">{error}</p>}
          <button disabled={busy} className="primary-button w-full py-3">{busy ? 'One moment…' : register ? 'Let’s get you connected' : 'Sign in to Commonroom'}<ArrowRight size={16}/></button>
        </form>
        <p className="mt-6 flex items-start gap-2 border-t border-line pt-5 text-[11px] leading-5 text-muted"><ShieldCheck className="mt-0.5 shrink-0" size={15}/>End-to-end encryption is automatic. Your conversations, just for you and your people.</p>
      </section>
    </div>
    <footer className="mx-auto flex max-w-6xl justify-between gap-4 px-6 py-8 text-[11px] text-muted sm:px-10"><span>Made for the people around you.</span><span className="whitespace-nowrap">FIRST COMMIT · 2026</span></footer>
  </main>;
}
