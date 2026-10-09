import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { parse, serialize } from 'cookie';
const scrypt = promisify(scryptCallback);
const cookieName = 'commonroom_session';
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
export const publicUser = (user) => ({id: user.id, name: user.name, username: user.username});
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}
export function sessionToken(headers) {
  return parse(headers.cookie || '')[cookieName];
}
export function findSession(db, headers) {
  const token = sessionToken(headers);
  if (!token) return null;
  return db.prepare(`SELECT u.*, s.token_hash, s.expires_at FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .get(hashToken(token), Date.now()) || null;
}
export function createSession(db, userId, res, secure) {
  const token = randomBytes(32).toString('hex');
  const maxAge = 7 * 24 * 60 * 60;
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(hashToken(token), userId, Date.now() + maxAge * 1000);
  res.setHeader('Set-Cookie', serialize(cookieName, token, {httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge}));
}
export function clearSession(res, secure) {
  res.setHeader('Set-Cookie', serialize(cookieName, '', {httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 0}));
}
