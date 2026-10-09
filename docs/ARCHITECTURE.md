# Architecture and contracts

## Runtime and message path

React 19/TypeScript/Vite 7/Tailwind 4 is served at :5173 during development. Vite proxies `/api` and WebSocket `/socket.io` to Express 5 at :3001. The built app is served by Express at :3001. Node 24 provides SQLite and server crypto; browser Web Crypto encrypts/decrypts messages. No cloud service is required.

1. Authenticate with an opaque HttpOnly cookie backed by a hashed session token.
2. Automatically open/create a device identity in EncryptionGate; server returns only public keys and an encrypted vault.
3. ChatPanel creates a UUID; useChat checks/pins member identities and encrypts/signs in the browser.
4. Socket sends an encrypted envelope. Server rechecks the session, membership, context, recipients and signature.
5. SQLite saves ciphertext or recognizes the exact retry by sender/client UUID.
6. Broadcast to every member's authenticated user room, then acknowledge persistence.
7. Each client verifies/decrypts, updates unread state, and optionally alerts. A focused visible active chat advances its last-read cursor to the latest loaded message.

The sender checkmark means saved by the server, not read by another person. Default Socket.IO delivery is at-most-once; this app adds saved history, retry deduplication, and reconnect reload, but no durable offline outbox or exactly-once delivery. Drafts/retries live in memory. Notifications trigger on live events; reconnect updates unread counts but does not replay a toast for every missed message.

## Data model and upgrade

| Table | Purpose / constraint |
|---|---|
| users | Unique normalized username, display name, scrypt password hash |
| sessions | Hashed opaque cookie token, account ID and expiry |
| identities | One immutable public encryption/signing identity and encrypted vault per account |
| conversations | Direct/group kind, title, creator; sorted distinct pair unique for directs |
| conversation_members | Membership and monotonic last_read_id per account/conversation |
| messages | Sender/context/client UUID; ciphertext JSON or legacy plaintext; unique sender/client UUID |

`db.js` migrates the old direct-pair table, makes a consistent on-disk VACUUM backup before rebuilding it, and backfills memberships. It adds the encrypted payload column and sets user_version=3. Existing IDs/history survive; FK integrity is checked. Backups are not encrypted automatically. Parameters are bound in SQL.

## HTTP

JSON errors: `{error: string}`. Authenticated endpoints require a valid cookie. All writes and socket handshakes require an allowed Origin. Tests/CLI clients supply it explicitly.

| Method/path | Request | Response |
|---|---|---|
| GET /api/health | — | {ok} |
| POST /api/auth/register | {name, username, password} | {user}, cookie |
| POST /api/auth/login | {username, password} | {user}, cookie |
| GET /api/auth/me | cookie | {user} |
| POST /api/auth/logout | cookie | {ok}; revokes current session/sockets |
| GET /api/identity | cookie | {identity: null or public keys + encrypted vault} |
| POST /api/identity | public keys + encrypted vault | {ok}; first publication only |
| GET /api/users?q=ab | cookie | {users}; up to 50, with encryptionReady |
| GET /api/conversations | cookie | {conversations}; membership-only, public member keys, unread counts |
| POST /api/conversations | {userId} | {id}; reuse direct pair |
| POST /api/groups | {title, memberIds} | {id}; creator + 2–255 distinct initialized accounts |
| GET /api/conversations/:id/messages?before=123 | optional exclusive ID cursor | {messages, hasMore}; newest 50 ordered oldest first |
| POST /api/conversations/:id/read | {messageId} | {ok}; validates message belongs to the same conversation |

Public key lookup uses authenticated conversation memberships. The private encrypted vault is returned only to its owner. Exact TS data contracts live in `frontend/src/lib/types.ts`; cryptographic contracts in `shared/crypto.d.ts`.

## Socket events

| Direction | Event | Payload |
|---|---|---|
| Client → server | message:send | {conversationId, clientId, encrypted: Envelope} |
| Ack | callback | {ok:true,message} or {ok:false,error} |
| Server → members | message:new | WireMessage with ciphertext (no plaintext for new messages) |
| Server → members | conversation:changed | Reload list/members |
| Server → own account | read:changed | Reload unread state |
| Client → server | typing:set | {conversationId, typing} |
| Server → other members | typing:update | {conversationId, userId, name, typing} |
| Server → authenticated users | presence:update | Online account ID array |

A room is chosen by the server from authenticated user identity. Clients cannot subscribe to arbitrary conversations. Group recipients come from the membership table, not untrusted client-selected socket rooms. Membership is fixed this version.

## UI state

- Single New conversation button/Ctrl+K opens direct/group creation. Sidebar tabs filter existing chats.
- Notification bell + counts + title reflect saved per-account unread cursors. Sound and desktop opt-ins are local per account/browser, false by default. Alerts contain sender/group names only. No service-worker push; multiple tabs may each alert.
- Theme initializes before React to avoid a flash; manual preference persists and syncs across tabs. Color transition is 240 ms and disabled for reduced motion.
- Device recovery secrets live in IndexedDB per account; old sessionStorage secrets migrate on unlock; identity pins live in localStorage; private CryptoKeys/decrypted message text live in React memory. See ENCRYPTION.md for the trust model and limits.

Single server process/persistent disk only. Presence/throttles are not distributed. TLS, production cookies, exact APP_ORIGIN and reviewed proxy settings are deployment requirements. This is not a horizontally scaled or audited secure messenger.
