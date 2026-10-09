# Review update: automatic encryption and UI polish

## What changed

- New accounts enter chats automatically. Encryption stays mandatory for new messages; no setup prompt or compulsory backup download.
- Device-local IndexedDB remembers the recovery secret per account. Ordinary logout preserves it. Privacy & backup offers optional export and explicit Forget browser and sign out.
- Existing account keys are reused, never silently reset. Previous sessionStorage keys migrate when available. On a new browser, restore once with the saved recovery key.
- Manual theme switching uses a 280 ms palette reveal with no text opacity/color cross-fade. Reduced motion and unsupported browsers switch immediately. Rapid switches cancel the preceding transition.
- Raised the actual starter limit from 12 to 256 total group members. Shared limits cover selection, group creation, message recipient validation and 256 KiB incoming packets. User search pages in batches of 50; selected participants stay selected between searches/pages.
- Removed the All / Direct / Groups strip. The desktop navigation rail and grouped conversation sidebar remain. Mobile shows all conversations by default.

## Upgrade without losing accounts or history

1. Stop both old servers and back up the project/database. Keep any saved recovery keys.
2. Extract the updated ZIP into a new folder and use Node.js 24.x.
3. Copy your existing backend/data directory into the new backend/data (or keep your existing DATABASE_PATH). Preserve your backend/.env separately. Never copy node_modules or old frontend/dist.
4. Run npm ci, then npm run dev. Use exactly the same browser and origin, including hostname and port, as before. localhost and 127.0.0.1 have different storage.
5. If the old tab still contains its sessionStorage key, reload that tab on the updated app. It migrates automatically. Otherwise enter your existing recovery key once. New accounts require no setup interaction.
6. Optional: Privacy & backup below your sidebar name exports a recovery key. Save it before moving devices or clearing site data.

No schema change is needed relative to the attached encrypted starter. Its existing migrations still support older plaintext databases; old plaintext history remains labelled and unchanged. Group membership remains fixed; existing groups are not automatically enlarged and no add/remove-member flow is introduced.

E2EE remains the same unaudited prototype without forward secrecy. Browser storage is not a secure hardware key store. See ENCRYPTION.md for the precise storage/recovery behavior and security limits.
