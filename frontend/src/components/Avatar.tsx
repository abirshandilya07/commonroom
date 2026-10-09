import { Bot } from 'lucide-react';
import type { Presence } from '../lib/types';

const dot: Record<Presence, string> = { online: 'bg-success', dnd: 'bg-red-500', offline: 'bg-muted' };
const label: Record<Presence, string> = { online: 'Online', dnd: 'Do not disturb', offline: 'Offline' };

export default function Avatar({
  name,
  src,
  status,
  online,
  large = false,
  small = false,
}: {
  name: string;
  src?: string | null;
  status?: Presence;
  online?: boolean;
  large?: boolean;
  small?: boolean;
}) {
  const isBot = name.toLowerCase().includes('campus ai');
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase();

  const palettes = [
    'bg-[#deebe4] text-[#2c6950] dark:bg-[#29483d] dark:text-[#b0e0c7]',
    'bg-[#eadcf3] text-[#764791] dark:bg-[#493452] dark:text-[#dec0ef]',
    'bg-[#dce8f6] text-[#3f6691] dark:bg-[#30435d] dark:text-[#b7d5f9]',
    'bg-[#f3e2d5] text-[#945c35] dark:bg-[#503f33] dark:text-[#edc9aa]',
  ];
  const color = isBot
    ? 'bg-gradient-to-tr from-purple-600 to-indigo-500 text-white'
    : palettes[[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % palettes.length];

  const presence = status ?? (online === undefined ? undefined : online ? 'online' : 'offline');
  const size = large ? 'h-16 w-16 text-xl' : small ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs';

  return (
    <span className={`relative grid shrink-0 place-items-center rounded-lg font-semibold ${src ? '' : color} ${size}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full rounded-lg object-cover" />
      ) : isBot ? (
        <Bot size={large ? 30 : small ? 14 : 18} />
      ) : (
        initials
      )}
      {presence && (
        <span
          aria-label={label[presence]}
          title={label[presence]}
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel ${dot[presence]}`}
        />
      )}
    </span>
  );
}