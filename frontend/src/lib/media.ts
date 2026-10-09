import type { Attachment } from './types';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT = 4000;

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';

export function kindOf(mime: string): AttachmentKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (
    mime.startsWith('text/') ||
    mime === 'application/pdf' ||
    mime === 'application/json' ||
    mime === 'application/octet-stream'
  ) {
    return 'document';
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const objectUrlCache = new Map<string, string>();

export async function attachmentUrl(attachment: Attachment | string): Promise<string> {
  if (typeof attachment === 'string') {
    return `/api/attachments/${attachment}`;
  }

  if (objectUrlCache.has(attachment.id)) {
    return objectUrlCache.get(attachment.id)!;
  }

  const res = await fetch(`/api/attachments/${attachment.id}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Attachment download failed');
  const buffer = await res.arrayBuffer();

  const keyBytes = Uint8Array.from(atob(attachment.key), (c) => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(attachment.iv), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, cryptoKey, buffer);

  const blob = new Blob([decrypted], { type: attachment.mime });
  const url = URL.createObjectURL(blob);
  objectUrlCache.set(attachment.id, url);
  return url;
}

export async function resizeAvatar(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      const size = 256;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else resolve(file);
      }, 'image/webp', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to process image'));
    };
    img.src = url;
  });
}

const MAGIC_NUMBERS: Record<string, (h: Uint8Array) => boolean> = {
  'image/jpeg': (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff,
  'image/png': (h) => h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47,
  'image/gif': (h) => h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38,
  'image/webp': (h) => h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50,
  'video/mp4': (h) => h[4] === 0x66 && h[5] === 0x74 && h[6] === 0x79 && h[7] === 0x70,
  'video/webm': (h) => h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3,
  'audio/webm': (h) => h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3,
  'audio/mpeg': (h) => (h[0] === 0xff && (h[1] & 0xe0) === 0xe0) || (h[0] === 0x49 && h[1] === 0x42 && h[2] === 0x33),
  'audio/ogg': (h) => h[0] === 0x4f && h[1] === 0x67 && h[2] === 0x67 && h[3] === 0x53,
  'audio/wav': (h) => h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 && h[8] === 0x57 && h[9] === 0x41 && h[10] === 0x56 && h[11] === 0x45,
  'application/pdf': (h) => h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46, // '%PDF'
};

const DANGEROUS_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.msi', '.vbs', '.js', '.scr',
  '.pif', '.hta', '.jar', '.com', '.reg', '.wsf', '.cpl', '.ps1'
];

export async function scanFileSafety(file: File): Promise<{ safe: boolean; reason?: string }> {
  const fileName = file.name.toLowerCase();

  // 1. Extension check
  for (const ext of DANGEROUS_EXTENSIONS) {
    if (fileName.endsWith(ext)) {
      return { safe: false, reason: `File extension '${ext}' is blocked for security.` };
    }
  }

  try {
    const buffer = await file.slice(0, 1024).arrayBuffer();
    const header = new Uint8Array(buffer);
    const textHeader = new TextDecoder('utf-8', { fatal: false }).decode(header);

    // 2. Anti-malware test signature
    if (textHeader.includes('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*')) {
      return { safe: false, reason: 'Malicious payload detected (EICAR standard test signature).' };
    }

    // 3. Dangerous script detection (XSS / polyglots)
    if (textHeader.includes('<script') || textHeader.includes('javascript:') || textHeader.includes('onload=')) {
      return { safe: false, reason: 'Active embedded scripts detected in file header.' };
    }

    // 4. Magic bytes check
    const validator = MAGIC_NUMBERS[file.type];
    if (validator && !validator(header)) {
      return { safe: false, reason: 'File content does not match its declared media format.' };
    }
  } catch {}

  return { safe: true };
}

export function encodeBody(text: string, attachment?: any): string {
  if (!attachment) return text;
  return JSON.stringify({ text, attachment });
}

export function decodeBody(raw: string): { text: string; attachment?: any } {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && ('text' in parsed || 'attachment' in parsed)) {
      return { text: parsed.text || '', attachment: parsed.attachment };
    }
  } catch {}
  return { text: raw };
}

export async function encryptFile(file: Blob): Promise<{ ciphertext: Blob; key: string; iv: string }> {
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const fileBytes = await file.arrayBuffer();
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, fileBytes);

  return {
    ciphertext: new Blob([encrypted], { type: 'application/octet-stream' }),
    key: btoa(String.fromCharCode(...rawKey)),
    iv: btoa(String.fromCharCode(...iv))
  };
}