import { useEffect, useState } from 'react';
import { ImageIcon, Film, Mic, FileText, Download, AlertTriangle } from 'lucide-react';
import { attachmentUrl, formatBytes, formatDuration } from '../lib/media';
import type { Attachment } from '../lib/types';

export default function AttachmentView({
  attachment,
  onOpenImage
}: {
  attachment: Attachment;
  onOpenImage: (url: string, name: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    attachmentUrl(attachment)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  if (error) {
    return (
      <p className="mt-1.5 flex items-center gap-2 text-xs text-muted">
        <AlertTriangle size={14} />
        {error}
      </p>
    );
  }

  if (!url) {
    const Icon =
      attachment.kind === 'image'
        ? ImageIcon
        : attachment.kind === 'video'
        ? Film
        : attachment.kind === 'audio'
        ? Mic
        : FileText;

    return (
      <div className="mt-1.5 flex h-16 w-64 max-w-full items-center gap-2 rounded-lg border border-line bg-soft px-3 text-xs text-muted">
        <Icon size={16} className="animate-pulse" />
        Decrypting {attachment.kind === 'audio' ? 'voice note' : attachment.name} · {formatBytes(attachment.size)}
      </div>
    );
  }

  if (attachment.kind === 'image') {
    return (
      <button
        className="mt-1.5 block"
        onClick={() => onOpenImage(url, attachment.name)}
        aria-label={`Open image ${attachment.name}`}
      >
        <img
          src={url}
          alt={attachment.name}
          className="max-h-72 max-w-full rounded-lg border border-line object-contain sm:max-w-sm"
        />
      </button>
    );
  }

  if (attachment.kind === 'video') {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        className="mt-1.5 max-h-80 max-w-full rounded-lg border border-line bg-black sm:max-w-md"
      />
    );
  }

  if (attachment.kind === 'audio') {
    return (
      <div className="mt-1.5 flex w-full max-w-sm items-center gap-2 rounded-full border border-line bg-soft py-1 pl-3 pr-1">
        <Mic size={15} className="shrink-0 text-accent" />
        <audio src={url} controls preload="metadata" className="h-9 min-w-0 flex-1" aria-label="Voice note" />
        {attachment.duration ? (
          <span className="shrink-0 pr-2 text-[10px] text-muted">{formatDuration(attachment.duration)}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex max-w-sm items-center gap-3 rounded-lg border border-line bg-soft p-3 text-xs">
      <FileText size={24} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-ink">{attachment.name}</p>
        <p className="text-[11px] text-muted">{formatBytes(attachment.size)}</p>
      </div>
      <a
        href={url}
        download={attachment.name}
        className="secondary-button flex h-8 w-8 items-center justify-center p-0"
        title={`Download ${attachment.name}`}
      >
        <Download size={14} />
      </a>
    </div>
  );
}