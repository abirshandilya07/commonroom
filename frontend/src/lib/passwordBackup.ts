// Password backup of the device recovery secret, so a new browser opens chats with the account password.
// The secret is wrapped in the browser with a key derived from the password (PBKDF2-SHA256);
// the server stores only the wrapped copy. See docs/ENCRYPTION.md for the trade-off.
export type KeyBackup = {version: 1; salt: string; iv: string; ciphertext: string; iterations: number};
const ITERATIONS = 600_000;
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const aad = (userId: string) => new TextEncoder().encode(`commonroom-key-backup:v1:${userId}`);
// Held in memory only, for the sign-in that just happened in this tab.
let pending: string | null = null;
export const rememberPassword = (password: string) => {pending = password || null;};
export const recentPassword = () => pending;
export const forgetPassword = () => {pending = null;};
async function derive(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations}, base, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']);
}
export async function wrapSecret(userId: string, password: string, secret: string): Promise<KeyBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, ITERATIONS);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: aad(userId)}, key, new TextEncoder().encode(secret)));
  return {version: 1, salt: b64(salt), iv: b64(iv), ciphertext: b64(ciphertext), iterations: ITERATIONS};
}
export async function unwrapSecret(userId: string, password: string, backup: KeyBackup): Promise<string> {
  const key = await derive(password, unb64(backup.salt), backup.iterations);
  const plain = await crypto.subtle.decrypt({name: 'AES-GCM', iv: unb64(backup.iv) as BufferSource, additionalData: aad(userId)}, key, unb64(backup.ciphertext) as BufferSource);
  return new TextDecoder().decode(plain);
}
