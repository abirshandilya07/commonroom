// File safety runs in the sender's browser before encryption (the server only ever sees ciphertext)
// and again in the receiver's browser after decryption, before anything is shown or saved.
const BLOCKED_EXTENSIONS = new Set(['exe','msi','bat','cmd','com','scr','pif','ps1','psm1','vbs','vbe','js','jse','mjs','wsf','wsh','hta','jar','apk','app','dmg','pkg','sh','bash','zsh','run','bin','dll','sys','lnk','reg','iso','img','html','htm','xhtml','svg','xml','php','py','rb','pl','cpl','msc','gadget','inf','scf','url','desktop','appimage','deb','rpm']);
// Documents and archives people actually share on campus.
const DOCUMENT_TYPES: Record<string, string> = {pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',odt:'application/vnd.oasis.opendocument.text',ods:'application/vnd.oasis.opendocument.spreadsheet',odp:'application/vnd.oasis.opendocument.presentation',rtf:'application/rtf',zip:'application/zip',json:'application/json'};
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((b, i) => bytes[offset + i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
export const extensionOf = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
// Strip path tricks and control characters from a shared file name.
export const safeName = (name: string) => name.replace(/[\\/:*?"<>|\u0000-\u001f‮]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';

function contentProblem(bytes: Uint8Array, mime: string, ext: string): string | null {
  if (startsWith(bytes, [0x4d, 0x5a])) return 'This file is a Windows program.';
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'This file is a Linux program.';
  if ([[0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xcf, 0xfa, 0xed, 0xfe], [0xca, 0xfe, 0xba, 0xbe]].some(s => startsWith(bytes, s))) return 'This file is a macOS program.';
  if (startsWith(bytes, [0x23, 0x21])) return 'This file is a script.';
  const head = ascii(bytes, 0, 512).toLowerCase();
  if (/<script|<html|<!doctype html|<svg/.test(head) && !mime.startsWith('text/plain') && ext !== 'md') return 'This file contains web page code.';
  // The bytes must match the type the file claims to be.
  const expect: Record<string, () => boolean> = {
    'image/png': () => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]),
    'image/jpeg': () => startsWith(bytes, [0xff, 0xd8, 0xff]),
    'image/gif': () => ascii(bytes, 0, 4) === 'GIF8',
    'image/webp': () => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP',
    'application/pdf': () => ascii(bytes, 0, 5) === '%PDF-',
    'application/zip': () => startsWith(bytes, [0x50, 0x4b]),
  };
  const officeZip = ['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp'].includes(ext);
  const check = officeZip ? expect['application/zip'] : expect[mime];
  if (check && !check()) return `This file doesn't look like a real ${ext ? `.${ext}` : mime} file.`;
  return null;
}

export type SafeFile = {mime: string; kind: 'image' | 'video' | 'audio' | 'file'; name: string};
export async function checkOutgoing(file: File | Blob, name: string): Promise<SafeFile> {
  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.has(ext)) throw new Error(`.${ext} files can't be shared because they can run code on someone's device.`);
  let mime = file.type;
  if (mime === 'image/svg+xml') throw new Error('SVG images can contain code, so they can’t be shared. Export it as PNG instead.');
  const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file';
  if (kind === 'file') {
    if (!DOCUMENT_TYPES[ext]) throw new Error('Share images, videos, audio, or documents such as PDF, Word, Excel, PowerPoint, text, CSV or ZIP.');
    mime = DOCUMENT_TYPES[ext];
  }
  const problem = contentProblem(new Uint8Array(await file.slice(0, 4096).arrayBuffer()), mime, ext);
  if (problem) throw new Error(`${problem} It was not sent.`);
  return {mime, kind, name: safeName(name)};
}
// The receiver re-checks after decrypting, in case a modified client sent something unsafe.
export function checkIncoming(bytes: ArrayBuffer, mime: string, name: string): string | null {
  const ext = extensionOf(name);
  if (BLOCKED_EXTENSIONS.has(ext) || mime === 'image/svg+xml' || mime.includes('html')) return 'This file was blocked because it could run code.';
  return contentProblem(new Uint8Array(bytes.slice(0, 4096)), mime, ext);
}
