# Encryption and recovery

This is a **versioned, unaudited hackathon E2EE prototype**, not a replacement for a reviewed secure messenger. It implements client-side encryption of new direct and group message text. It does not provide forward secrecy or post-compromise recovery. Do not pitch it as Signal-equivalent or production-ready security.

## First use and recovery

1. New accounts create keys automatically after authentication. No enable-encryption prompt, forced download, or saved-key checkbox.
2. The device recovery secret is persisted in IndexedDB, scoped by origin and account ID. The server still receives only public keys and the encrypted vault. This browser is remembered across reloads, new tabs, restarts and ordinary sign-outs, subject to browser storage retention.
3. Privacy & backup in the sidebar offers an optional recovery-key download. Save it privately, outside the repository, before moving browsers or clearing site data. Incognito storage normally disappears when the private session ends.
4. An existing account on a browser without its key needs recovery once. Incorrect keys do not replace the server identity. Old versions' sessionStorage keys migrate automatically when still present; otherwise use the old saved recovery key.
5. Compare participants' complete fingerprints independently before sensitive conversations. First-contact keys come from the server.

The recovery secret unlocks the account's encrypted private-key vault. Anyone with that secret and a copy of the vault/history can decrypt that identity's messages. Losing every remembered browser and the backup means losing access to encrypted history. There is no reset, rotation, administrator bypass, or password-based key recovery.

**Device storage tradeoff:** the recovery secret is readable by JavaScript from this origin in IndexedDB; it is not hardware protected or encrypted with the login password. Same-origin malicious code, compromised devices/extensions, or someone with access to the browser profile can expose it. IndexedDB improves key persistence, not protection from XSS. Private CryptoKeys in memory are non-extractable but remain usable by code in the same origin. The account password is not reused as an encryption key.

Ordinary sign-out revokes the current server session but intentionally retains this account's browser key. Privacy & backup → Forget this browser removes that account's key and signs out. Close other open Commonroom tabs first; this is not remote device revocation or secure deletion of browser backups/memory. Other devices are unaffected. Existing fingerprint pins remain.

Setup saves a pending local identity before publishing it, so network failure/reload can retry without generating a replacement identity. Initialization is deduplicated in React StrictMode and serialized across tabs using Web Locks where available. Storage failures are surfaced rather than silently sending plaintext.

## Protocol v1

The shared implementation is `shared/crypto.js`; device storage is in `frontend/src/lib/deviceIdentity.ts`, and fingerprint pinning is in `frontend/src/lib/encryption.ts`.

| Material | Algorithm / handling |
|---|---|
| Account encryption identity | Browser-generated RSA-OAEP, 2048-bit, SHA-256 |
| Account signing identity | Browser-generated ECDSA P-256, SHA-256 |
| Recovery secret | 32 random bytes, base64 encoded |
| Private-key vault | Exported private JWK bundle, encrypted with AES-256-GCM under the recovery secret; fresh 96-bit IV |
| Vault binding | Authenticated data includes purpose/version, account ID, and canonical public identity |
| Message text | Fresh AES-256-GCM key per message, random 96-bit IV |
| Key distribution | Message key wrapped independently with RSA-OAEP for each member, including sender |
| Message binding | AES additional data binds version, conversation, sender, client UUID, sorted recipient IDs |
| Message signature | ECDSA covers the canonical envelope, including encrypted text, IV, context, and all wrapped keys |
| Fingerprint | SHA-256 of canonical public encryption and signing keys; full value shown in details |

Clients verify envelope context and the sender's signature before decryption. The backend validates session membership, public-key format, exact recipient coverage, sender context, and signature; it rejects new plaintext sends. It saves ciphertext plus wrapped keys and stores `[Encrypted message]` in the legacy body column. Retries reuse the exact signed envelope for the same sender/client UUID. Server timestamps and message IDs are ordering metadata, not signed content.

The backend stores only public identity keys and encrypted private-key vaults. Public identities cannot be changed through the API. Clients pin first-seen identity fingerprints per viewer/member in localStorage and block changed identities. Clearing site storage or using a new browser removes these pins: compare fingerprints again. Pins are a change detector, not proof that the first key was genuine.

## Threat model and limits

- A passive network observer or database-only reader cannot read new message bodies without recipient private keys/recovery secrets. HTTPS remains required outside localhost to protect login credentials, session cookies, public-key delivery, and application code; Web Crypto also requires a secure context.
- The server sees accounts, public keys, encrypted vaults, group names/membership, sender/recipient IDs, message timing/sizes, unread cursors, presence, and typing. Notification titles also reveal sender/group names on the device.
- A malicious server can substitute a key on first contact unless users compare fingerprints independently. Existing pins detect later changes in an uncompromised client. A server that replaces the served JavaScript, an XSS bug, malicious extension, or compromised device can access plaintext and recovery secrets. This browser app does not solve that problem.
- Long-lived RSA identities provide **no forward secrecy**. Later compromise of an identity's private key can expose captured past messages encrypted to it. Fresh per-message AES keys do not change that. No Double Ratchet or audited group protocol is implemented.
- A participant can copy, screenshot, or disclose messages. Signatures are not a legal/non-repudiation guarantee. The server can withhold, reorder, replay records, or erase history; the protocol does not provide a complete tamper-evident transcript. The UI deduplicates normal server IDs.
- Group membership is fixed at creation, 3–256 people. There is no removal, revocation, invite link, administrator role, or membership-key rotation. Create a new group to change participants.
- There are no encrypted attachments, push message content, client key backup to third parties, or secure deletion guarantees. Browsers may retain memory, downloads, and restored session state.
- Existing pre-v3 messages remain plaintext and visibly labelled. Migration backups preserve that plaintext too. Enabling encryption cannot retroactively erase it.

## Password unlock on a new browser

After each sign-in, the browser wraps this account's recovery secret with a key derived from the account password (PBKDF2-SHA256, 600,000 iterations, random salt, AES-256-GCM bound to the account ID) and stores only that wrapped copy on the server. Signing in on a new browser unwraps it with the password just typed, so chats open with no recovery key. If the prompt appears later (for example after a reload), the account password or the recovery key both work. The recovery key remains the backup if the password is forgotten.

Trade-off: the server receives the password at every sign-in, so a malicious or compromised server could capture it and unwrap the key backup, then read past encrypted messages. A database-only leak still needs the password (slowed by PBKDF2). Weak passwords weaken this protection. This is a convenience choice for the hackathon build, not equivalent to a device-only key.

## Common Room AI

The AI cannot read encrypted chats on its own. A mention sends only that message's text to the backend, which forwards it to the AI service (Groq by default). Earlier messages are included only when the asker requests it (for example "summarize the chat"); the browser decrypts up to the last 30 messages and sends them with the question. AI answers, private AI chats, reminders and tasks are stored as plaintext on the server and are visible to the server operator and to the AI service. AI answers in a chat are visible to its current members, including people who joined later.

## Group capacity

`shared/limits.js` sets 256 total members and a 256 KiB incoming packet limit shared by HTTP and Socket.IO. API validation and the composer use the same membership cap. Every encrypted message still wraps its key once per recipient; CPU, payload size, storage, and fan-out grow with group size. This is a capacity boundary, not a benchmark for 256 concurrent users. Larger deployments need load testing and a reviewed group protocol.

## Before a public security-sensitive launch

Have an independent expert review protocol, key lifecycle, client trust and recovery. Prefer an established, audited protocol/library with forward secrecy, verified identities, device management, and a reviewed group membership model. Add a real upgrade/rotation strategy, secure client distribution, operational review, and cross-browser tests. Do not add a homemade ratchet to this version.

References for the primitives and the distinction from forward-secret messaging:
- https://www.w3.org/TR/webcrypto-2/
- https://signal.org/docs/specifications/doubleratchet/
