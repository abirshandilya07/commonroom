import {api, ApiError, post} from './api';
import {createIdentity, unlockIdentity, sessionRecovery, type IdentityRecord, type UnlockedIdentity} from './encryption';

type DeviceKey = {recoveryKey: string; pendingRecord?: IdentityRecord};
// Device-local only: the recovery secret is never sent to the API.
async function storage<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('commonroom-device-keys', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('keys');
    opening.onerror = () => reject(new Error('Allow browser storage to open encrypted chats.'));
    opening.onblocked = () => reject(new Error('Close other Commonroom tabs and try again.'));
    opening.onsuccess = () => {
      const db = opening.result;
      const transaction = db.transaction('keys', mode);
      const request = operation(transaction.objectStore('keys'));
      transaction.oncomplete = () => {db.close(); resolve(request.result);};
      transaction.onabort = transaction.onerror = () => {db.close(); reject(new Error('Could not save encryption keys on this browser. Check available storage.'));};
    };
  });
}
export const readDeviceKey = (userId: string) => storage<DeviceKey | undefined>('readonly', store => store.get(userId));
const saveDeviceKey = (userId: string, key: DeviceKey) => storage('readwrite', store => store.put(key, userId));
export const forgetDeviceKey = (userId: string) => storage('readwrite', store => store.delete(userId));
export async function recoverDevice(userId: string, record: IdentityRecord, recoveryKey: string) {
  const identity = await unlockIdentity(userId, record, recoveryKey);
  await saveDeviceKey(userId, {recoveryKey: recoveryKey.trim()});
  sessionRecovery(userId, null);
  return identity;
}
export type OpenIdentity = {identity: UnlockedIdentity; record?: never} | {identity?: never; record: IdentityRecord};
async function initialize(userId: string): Promise<OpenIdentity> {
  if (!crypto.subtle) throw new Error('Encrypted messaging needs HTTPS or localhost.');
  let {identity: record} = await api<{identity: IdentityRecord | null}>('/identity');
  let device = await readDeviceKey(userId);
  if (!record) {
    // Persist BEFORE publishing. A failed request/reload can retry the same keys.
    if (!device?.pendingRecord) {
      const setup = await createIdentity(userId);
      device = {recoveryKey: setup.recoveryKey, pendingRecord: setup.record};
      await saveDeviceKey(userId, device);
    }
    try {await post('/identity', device.pendingRecord); record = device.pendingRecord!;}
    catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      record = (await api<{identity: IdentityRecord}>('/identity')).identity;
    }
  }
  // Migrate an unlocked tab from the previous release without another prompt.
  for (const secret of [device?.recoveryKey, sessionRecovery(userId)]) {
    if (!secret) continue;
    let identity: UnlockedIdentity;
    try {identity = await unlockIdentity(userId, record, secret);} catch {continue;}
    await saveDeviceKey(userId, {recoveryKey: secret});
    sessionRecovery(userId, null);
    return {identity};
  }
  // Existing identities are never replaced when this device lacks its key.
  return {record};
}
const opening = new Map<string, Promise<OpenIdentity>>();
export function openDeviceIdentity(userId: string): Promise<OpenIdentity> {
  const existing = opening.get(userId);
  if (existing) return existing;
  // StrictMode deduplication and cross-tab serialization where supported.
  const task: Promise<OpenIdentity> = (async () => navigator.locks
    ? await navigator.locks.request(`commonroom-identity:${userId}`, () => initialize(userId))
    : await initialize(userId))();
  opening.set(userId, task);
  void task.finally(() => opening.delete(userId)).catch(() => {});
  return task;
}
