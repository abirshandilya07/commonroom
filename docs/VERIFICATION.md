# Review update verification

Verified with Node.js 24.19.0 on Linux.

## Automated build and backend tests

- npm ci completed with the existing package-lock.json (208 packages).
- npm run check passed TypeScript checking, the Vite production build, and all 14 reported Node tests (11 behavior subtests plus their parent, migration, and capacity tests).
- Existing tests cover authentication, sessions, origin checks, anonymous socket rejection, identity immutability, private-key field rejection, DM uniqueness, encrypted delivery and retries, group recipients, outsider denial, plaintext rejection, signatures/tampering, unread cursors, typing, history pagination, recovery, logout/restart and legacy migrations.
- The new capacity test creates a group with 256 total members, rejects 257, validates directory pagination and invalid offsets, sends a 2,000-character Unicode encrypted message over a real WebSocket with a payload exceeding the previous 64 KiB limit, and decrypts it as sender and last member. It also rejects excess encrypted recipients and verifies no plaintext body is stored.
- The capacity fixture reuses a recipient public key for speed; the existing three-person group test uses independent key pairs. These are functional boundary tests, not a concurrent-user load benchmark.

## Chromium checks against the production build

Separate browser processes were used for independent accounts/devices.

- Three new accounts entered chats without setup, forced backup or confirmation.
- Reload and logout/login reused the same public identity, without a recovery prompt.
- A second account received and decrypted a direct message; a third received and decrypted a group message.
- The sidebar has no All/Direct/Groups strip.
- Light/dark switching, repeated rapid toggles and reduced motion worked. A mid-transition screenshot showed a solid palette reveal without ghosted text. Final light/dark and mobile screens were captured; dark, intermediate transition and mobile privacy screens were visually inspected.
- Optional recovery download restored the same identity and readable group history in a fresh browser. An incorrect recovery key was rejected first.
- At 390px width, chat back navigation and Privacy & backup worked; the privacy dialog fit the screen. Forget browser and sign out removed the local account key.
- No page runtime errors were recorded.

Current screenshots use the review- prefix in docs/screenshots. Older screenshots are preserved from the starter and may show the former UI. The browser harness used external Playwright/Chromium tooling; the shipped npm test suite needs no browser. Manual reproduction steps are in DEMO_CHECKLIST.md and UPDATE_NOTES.md.

Not verified: Windows launcher on Windows, Safari/Firefox, native OS notifications/audio, physical mobile keyboards, public deployment, long-term browser storage retention, 256 simultaneous connected clients, or an independent cryptographic audit. E2EE remains an unaudited prototype without forward secrecy; see ENCRYPTION.md.
