# Commonroom

A Slack-inspired campus real-time chat starter for FIRST COMMIT, IIT Mandi's 24-hour hackathon.

**Status:** runnable foundation, not a finished competition submission. Real authentication, encrypted direct/group messages, notifications, and persistent storage are implemented. Encryption is a prototype, not an audited secure messenger; read `docs/ENCRYPTION.md`. No mock users or fake conversations are inserted into the database.

## Start here (Windows, macOS, or Linux)

1. Install **Node.js 24.x** and npm. `node -v` should start with `v24.`. If you just installed Node on Windows, reopen VS Code and its terminal.
2. Extract the ZIP into a new folder and open that folder in VS Code. The updated ZIP places `package.json`, `package-lock.json`, `frontend/`, and `backend/` directly at its root. Run every command below from that folder. On Windows you can instead double-click `START_WINDOWS.cmd`; it switches to the correct folder, checks Node 24, installs dependencies, and starts the app.
3. Install the exact dependency versions and start both processes:

```bash
npm ci
npm run dev
```

4. Open **http://localhost:5173**. Use this address consistently instead of switching between localhost and 127.0.0.1 (their cookies are separate).
5. Create your account. Open an **incognito window or a different browser**, create a second account, and keep both windows open. Two normal tabs share the same login cookie.
6. Open each account: encryption keys are created and remembered automatically on this browser. Optional **Privacy & backup** is below your name in the sidebar. Download a recovery key there before switching browsers or clearing site data.
7. Use the single **New conversation** compose icon beside Commonroom (or Ctrl+K): pick a person for a direct message, or select **Group chat**, enter a name, and choose 2–255 other people. Everyone must open their chats once first.
8. Use the top-bar bell to enable optional sound/desktop alerts and open unread conversations. Refresh to confirm saved history.

No external API keys, database signup, Docker, or manual database creation are needed. The backend creates `backend/data/commonroom.sqlite` automatically. Keep this folder to preserve users and messages.

Stop both servers with Ctrl+C. Node 24 may print an experimental warning for `node:sqlite`; it is a Node API status warning, not an application failure. Use the documented Node version rather than an older installation.

## Commands

| Command (from repo root) | Purpose |
|---|---|
| `npm ci` | Reproduce the locked installation |
| `npm run dev` | Start frontend :5173 and backend :3001 together |
| `npm run build` | Type-check and build the frontend |
| `npm test` | Run backend integration tests with real WebSocket clients |
| `npm run check` | Build, type-check, and test |
| `npm start` | Start backend and serve an already-built frontend on :3001 |

For the built app: stop `npm run dev`, run `npm run build`, then `npm start`, and visit **http://localhost:3001**. `npm start` does not rebuild the UI. If you made a backend `.env`, update APP_ORIGIN for port 3001.


## Fixing the screenshot's npm ci error

`npm ci` needs a valid `package-lock.json` in the project root. The original ZIP included `commonroom/package-lock.json`. Your screenshot shows the terminal in `~/Commonroom_starter`, so the likely issue is being one folder above the project. In the original extraction:

```bash
cd commonroom
ls package.json package-lock.json
npm ci
npm run dev
```

The updated ZIP removes this extra nested folder. Open the directory that directly contains **both** package files, frontend, and backend. If the files truly are missing, re-extract the full download; do not create a blank lockfile. `npm install` can generate a missing lockfile only when a valid package.json is present, but it is not necessary for this supplied archive.

## Version 2 (FIRST COMMIT build)

- **Images, videos and voice notes.** Attach with the paperclip, or press the mic to record (live level animation, up to 5 minutes). Files are encrypted in the browser with a fresh AES-GCM key before upload; the key travels inside the encrypted message, so the server stores only opaque bytes (`backend/data/uploads/`). Limit 25 MB per file.
- **Reactions, editing and deleting.** Hover a message for the toolbar. Edits are re-encrypted and re-signed by the sender and marked "(edited)". Deleting removes the ciphertext, reactions and attachment for everyone.
- **Profiles and settings.** Click a name or avatar to see a person's name, username, join date and status, and to keep a private note about them (only you can see it). The gear icon opens your own settings: change your display name and profile picture.
- **Status.** Click your name at the bottom left to choose Online, Do not disturb (mutes your alerts and shows a red dot to others) or Appear offline.
- **Sidebar previews and "Seen".** Each browser decrypts the latest message locally for the sidebar. Your newest message shows "Seen" (or "Seen by …" in groups) once others have read it.
- **Reliability.** Unread counts update locally instead of reloading the conversation list for every message; API rate limits are per signed-in session (so a whole campus Wi-Fi isn't throttled together); presence is shared only with people you have a conversation with; typing indicators stop promptly; the chat no longer jumps to the bottom while you read history.

Reactions, profile pictures, display names and private notes are stored readable on the server. Message text, edits and media are end-to-end encrypted. The database migrates automatically to `user_version=4` on first start.

## This update

- No encryption setup or required backup screen for new accounts.
- Same-browser keys survive sign-out; use Privacy & backup to export or forget them.
- Smooth palette reveal without text color interpolation.
- 256-member groups; paginated people search and matching encrypted-packet limits.
- All/Direct/Groups filter strip removed; desktop rail and conversation sidebar remain.

See `docs/UPDATE_NOTES.md` for upgrade steps and `docs/VERIFICATION.md` for checks.

## Light and dark themes

Use the sun/moon button at the bottom of the desktop rail or in the mobile top bar. It is also available before login. The first visit follows the operating system; toggling stores `commonroom-theme` in browser localStorage. Other tabs on the same origin update too. Clear that key to return to system-following behavior. The setting is per browser, not synced to an account.

Theme tokens live in `frontend/src/index.css`, preference logic in `hooks/useTheme.tsx`, and the pre-paint initializer in `public/theme-init.js`. The external initializer works with the backend's Content Security Policy. Manual theme changes reveal the complete new palette over 280 ms using View Transitions, without fading text colors. Reduced-motion preferences and browsers without View Transitions switch immediately. System/cross-tab updates apply immediately. No new packages are needed for themes.

## Updating your existing copy

This update changes **both frontend and backend** and migrates the database. Stop the old app and back up your entire project first, including `backend/data/` and `.env`. Review any local source edits before replacing files.

For an unmodified previous starter, extract this ZIP into a new folder. Copy your old `backend/data/` folder and optional `backend/.env` into the new backend folder while the old app is stopped. Then run `npm ci` and `npm run dev` from the new root. For a modified project, merge all source/config files, including the new `shared/` folder; do not update only the UI.

On the first launch against the previous two-user schema, the app makes a consistent SQLite backup named `commonroom.sqlite.pre-v3-<timestamp>.sqlite`, migrates direct conversations into memberships, and preserves existing messages. The backup contains old plaintext history; keep it private. After upgrading, each account must complete encryption setup. Old messages remain clearly labelled **Earlier · unencrypted**; only new messages are encrypted. There is no automatic rollback; stop the app and restore the backup with the old code if necessary.

Groups now support 3–256 people with fixed membership. Communities remain deferred. “Commonroom” is the app name, not a multi-tenant workspace implementation.

## Stack decisions

| Layer | Choice | Reason |
|---|---|---|
| UI | React 19 + TypeScript + Vite 7 | Familiar component model; fast local development; typed UI data |
| Styling | Tailwind CSS 4 + Lucide icons | Consistent responsive interface with little custom CSS |
| Server | Express 5, Node.js 24, JavaScript ES modules | One language across the project; no Python environment to coordinate |
| Real-time | Socket.IO 4, WebSocket transport | Events, acknowledgements, reconnection, and authenticated user rooms |
| Storage | SQLite via Node's built-in `node:sqlite` | Real persistence without a database service or native addon build |
| Authentication | Opaque HTTP-only cookie sessions + scrypt hashes | Revocable server-side sessions; no auth token stored in localStorage |
| Encryption | Browser Web Crypto; AES-GCM, RSA-OAEP, ECDSA | Client-side message encryption/signatures; per-account recovery vault |
| Validation | Zod | Validate untrusted HTTP and socket inputs on the server |
| Tests | Node test runner + socket.io-client | Verify behavior using real HTTP and WebSocket connections |

Tailwind uses its v4 Vite plugin and `@import "tailwindcss"`; old v3 `tailwindcss init -p` instructions do not apply to this repo.

## Repository map

```text
commonroom/
  frontend/
    src/
      components/       # Authentication, encryption setup, chat, creation dialog
      hooks/useChat.ts   # Socket lifecycle, history, presence, delivery
      hooks/useTheme.tsx # Theme preference and smooth transitions
      hooks/useNotifications.ts # Toasts, optional sound/desktop alerts
      lib/              # HTTP helper and TypeScript data contracts
      App.tsx           # Session restoration and chat workspace
      index.css         # Tailwind import, tokens, shared UI classes
      main.tsx          # React entry point
    public/theme-init.js # Apply theme before first paint
    vite.config.ts      # Tailwind + React; HTTP and WebSocket proxy
  backend/
    src/
      index.js          # Environment configuration, server lifecycle
      app.js            # HTTP routes, socket handlers, authorization
      auth.js           # Password hashes, session cookies, revocation
      chat.js           # Membership checks and idempotent message writes
      db.js             # SQLite schema, migration, backup, connection
    tests/chat.test.js   # Auth, privacy, delivery, retry, persistence tests
    .env.example        # Optional backend settings
  shared/crypto.js      # Shared versioned Web Crypto message/vault protocol
  docs/
    ENCRYPTION.md       # Recovery, protocol, threat model and limits
    PLAN.md             # 24-hour schedule, feature gates, team ownership
    ARCHITECTURE.md      # Data flow, schema, REST and socket contracts
    DEMO_CHECKLIST.md    # Acceptance checks and submission requirements
  .github/workflows/ci.yml
  START_WINDOWS.cmd     # Windows launcher (always uses the right folder)
  START_HERE.txt         # Folder/install troubleshooting
  package.json          # Root workspace commands
  package-lock.json     # Exact dependency versions; commit this
```

## Implemented

- Registration, login, logout, session restoration after refresh.
- Unique usernames; search registered people by name or username.
- One conversation per user pair; only participants can read or write it.
- Messages saved before broadcast, server timestamps, authenticated sender IDs.
- Message acknowledgement and safe manual retry using a client-generated UUID.
- Latest 50 messages, older-history pagination, and latest-page reload after reconnect.
- Typing indicators and multi-tab-aware online/offline status.
- Slack-inspired navigation with a compact sidebar, named message rows, grouped consecutive messages, and a full-width composer.
- Light/dark themes on every screen; system preference on first visit, saved manual choice, and cross-tab synchronization.
- Ctrl+K people search, local conversation filtering, search within loaded messages, and conversation details.
- Responsive Tailwind screens, empty states, connection errors, and send errors.
- Basic HTTP/auth/socket throttling, input limits, same-origin browser checks, and production security headers.

A checkmark means **saved on the server**, not read by the recipient. Presence is visible to authenticated users, and names/usernames are searchable by them. Passwords, hashes, and session tokens are never included in public user responses.

## New in this version

- Persistent unread counts on conversations, notification bell, and browser title; an in-app toast for incoming messages outside the focused chat.
- Optional gentle chime with a Test sound button. Desktop permission is requested only when enabled; notifications show sender/group, never message text. Desktop alerts need the app open and browser support; there is no closed-app push. Mobile browsers may fall back to in-app alerts. Multiple open tabs can each alert.
- Smooth light/dark changes with reduced-motion support.
- Encrypted groups of 3–256 people; named authors, group typing, history, and member fingerprints. Membership is fixed: create a new group for a different member set.
- One compose entry point for finding people and creating groups; Ctrl+K opens the same dialog.
- Client-side encryption for new direct/group messages, automatic browser key storage, optional recovery backup, immutable public identities, signatures, and first-seen fingerprint pinning. Read `docs/ENCRYPTION.md` before using or describing it.

The next milestone should prioritize reliability and an independent security review. Communities, calls, uploads, group membership editing, and AI summaries remain out of scope. A server-side AI feature cannot read new encrypted chat text; explicit client-side selection and consent would be needed.

## Configuration

Defaults work without an `.env` file. To override them, copy `backend/.env.example` to `backend/.env` and edit it. In Windows PowerShell:

```powershell
Copy-Item backend/.env.example backend/.env
```

In Git Bash/macOS/Linux:

```bash
cp backend/.env.example backend/.env
```

| Variable | Meaning |
|---|---|
| `PORT` | Backend port; default 3001. If changed, update Vite's proxy too. |
| `APP_ORIGIN` | Comma-separated browser origins allowed to write/connect, including scheme and port, no trailing slash. Defaults allow localhost/127.0.0.1 on 5173/3001. |
| `DATABASE_PATH` | SQLite file; relative to `backend` when run with root npm scripts. |
| `COOKIE_SECURE` | Set to `true` for an HTTPS deployment; false for local HTTP. |
| `TRUST_PROXY` | Set to `1` only behind one trusted reverse proxy. |

No `.env` is needed in the frontend. Do not put private keys in Vite variables; frontend code is public.

## Scope and deployment limits

This starter targets **one backend process** and a small hackathon demo. SQLite is appropriate for this scope. It is not a horizontally scaled chat system. For deployment, use a Node host with WebSocket support and persistent disk; serve the built UI from the same origin. Set APP_ORIGIN to its exact HTTPS origin and COOKIE_SECURE=true. A static-only frontend host cannot run this backend. Hosting is optional in the brief and no deployment is created here.

- No AI, account/password recovery, identity reset/rotation, or account deletion yet.
- New message text is encrypted before transmission. Metadata (members, group titles, sender, timing, sizes) remains visible to the server. Older history and migration backups remain plaintext.
- The encryption protocol is unaudited and has no forward secrecy. Compromised client code/devices or a stolen recovery key can expose messages. See ENCRYPTION.md.
- Sessions last seven days. Logout revokes only the current session and disconnects sockets for it.
- Typing/presence are ephemeral; messages, accounts, conversations, and sessions persist.
- Reconnection reloads the newest 50 messages as a contiguous page; older messages remain accessible via “Load earlier messages.”
- An unconfirmed send can be safely retried while the same conversation stays open and the draft is unchanged. Drafts and retry state are in memory; there is no durable offline outbox.
- Throttles are basic per-IP HTTP/per-socket controls, not a distributed abuse prevention system.
- Version 3 includes a migration for the previous starter schema. Future schema changes still require explicit migrations.
- Dependency installation needs internet; running the app needs no external service.

## Git: your first checkpoint

This folder is ready for Git; no remote repository has been created. Create a **private** GitHub repository, with no generated README, then run:

```bash
git init -b main
git add .
git commit -m "feat: bootstrap authenticated realtime chat"
git remote add origin YOUR_PRIVATE_REPO_URL
git push -u origin main
```

Replace YOUR_PRIVATE_REPO_URL with the actual URL. Keep the repository private until the hackathon ends, as required by the brief. Do not commit recovery keys, `.env`, `node_modules`, or SQLite data. The supplied `.gitignore` excludes these.

## References

- Official Tailwind Vite setup: https://tailwindcss.com/docs/installation/using-vite
- Socket.IO delivery guarantees: https://socket.io/docs/v4/delivery-guarantees/
- Node 24 SQLite API: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
- Source requirements: supplied FIRST COMMIT problem statement, sections 02, 04, 08, 09.
