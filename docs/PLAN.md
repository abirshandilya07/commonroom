# A practical 24-hour plan

## Product decision

**Commonroom: campus conversations that turn into clear next steps.**

Audience: classmates, project teammates, and campus clubs. Pain point: decisions and assigned tasks disappear inside long chats. Current scope: dependable direct/group messaging, a Slack-inspired UI, smooth light/dark themes, unread notifications, and a browser encryption prototype. Group chats are now included; communities remain deferred. The decisions/action panel remains a possible later differentiator.

This direction is a proposal, not a claim of market novelty. Validate it quickly with two classmates: “What do you repeatedly lose in your group chats?” Use their answer to tune the demo story.

## What the problem statement actually asks for

Mandatory: registration, sign-in/sign-out, maintained sessions, private one-to-one real-time communication between registered users, and correct user/conversation associations. The transport should use WebSockets or WebSocket-based technology. Libraries and external services are allowed. Persistent storage is encouraged and already included.

The extension list is optional, not a checklist. Do not promise or build every item.

| Evaluation | Weight | What we prioritize |
|---|---:|---|
| Core functionality | 20% | Two independent accounts reliably exchange messages |
| Technical implementation | 15% | Server-side authorization, sessions, saved history, clean code |
| Feature depth/usefulness | 15% | One coherent extension with a complete user flow |
| Live demo / working product | 25% | A rehearsed, repeatable scenario and offline/local backup |
| Pitch / presentation | 25% | Clear audience, problem, product behavior, and honest limits |

The first three categories determine shortlisting. The last two apply to shortlisted teams. Make the core strong enough to reach that stage, then protect rehearsal time.

## Schedule from the start of the event

These are elapsed hours, not calendar times. The scaffold can accelerate the first stages, but the team still needs to understand and verify it. Follow any organizer rules on when code may be written.

| Hours | Deliverable | Exit condition |
|---|---|---|
| 0–1 | Agree on audience, feature cut line, roles, and private repo | Everyone runs the project and can explain the product in one sentence |
| 1–3 | Review/authenticate the starter | Register/login/logout/refresh work; invalid logins fail clearly |
| 3–6 | Own and verify the real-time core | Two browser sessions exchange messages; third account cannot access them |
| 6–8 | Reliability checkpoint | Restart preserves messages; reconnect recovers history; retry makes no duplicate |
| 8–12 | Groups and encryption verification | Three accounts decrypt group history; outsider fails; automatic setup works; optional backup restores a new browser |
| 12–15 | Notifications, light/dark and mobile | Unread resets on open; optional sound/desktop paths work; reduced-motion and mobile checked |
| 15–17 | Polish complete flows | Responsive layouts, empty/loading/error states; keyboard and mobile checks |
| 17–19 | Integration freeze; optional deployment | All acceptance checks pass in a fresh install; one stable demo path |
| 19–21 | Pitch and demo video | Six-slide deck and a short recorded walkthrough with readable UI |
| 21–23 | Rehearsal and fixes only | Repeat the live demo twice with two browsers; verify shared links |
| 23–24 | Submission buffer | Repo, README, PPT link, YouTube link, and optional live URL verified |

## Hard feature gates

1. **Hour 6:** if direct chat is unreliable, stop extensions and fix it.
2. **Hour 12:** freeze the implemented direct/group scope; do not expand encryption primitives or add communities. Fix recovery and unread flows before polishing.
3. **Hour 15:** no new major features; finish or cut incomplete ones.
4. **Hour 19:** no architecture rewrites, database swaps, auth-provider changes, or new AI services.
5. **Hour 23:** verify submission links; do not gamble the submission on a last-minute feature.

If working solo, keep the demo short and understand the implemented flows before extending them. If the team has only two people, divide frontend/product and backend/integration, and share the demo work.

## Suggested ownership for four people

| Owner | Owns | Suggested branch |
|---|---|---|
| Frontend | Components, layout, mobile, accessibility | feature/chat-ui |
| Backend | Auth, REST contracts, membership, reliability | feature/chat-reliability |
| Real-time/integration | Socket events, retries, reconnects, tests | feature/realtime |
| Product/demo | Light/dark review, user story, deck, video | feature/themes-demo |

These are suggested roles; no assumption is made about actual team size. You can own backend/integration if that matches your preference. Avoid having everyone modify App.tsx or app.js independently. Agree on API/event payloads first. Merge small working branches every 2–3 hours instead of waiting until the last hour.

## Current milestone: groups, notifications, encryption

Implemented: membership migration, fixed groups of 3–256 people, membership-based authorization for every message/history/typing path, unread cursors, optional sound/desktop alerts, and client-side encryption/signatures with automatic device-key management. Existing history stays visibly unencrypted. Public identity fingerprints can be compared independently. There is no forward secrecy or independent security audit; see ENCRYPTION.md.

Demo a group with three real accounts. Verify all participants can decrypt and an outsider cannot read or send. Show a background-chat unread badge and reset it by opening the conversation. Test recovery on a fresh browser before relying on it in the demo.

Next group milestone: design member invitation/removal/leave, roles and key rotation together using an established reviewed protocol. Current memberships are intentionally fixed. Communities need their own discovery, permissions, moderation and channel model; do not bolt them onto the current group dialog.

## Later possibility: decisions and next steps

Keep the first version explicit and simple:

- A message menu offers “Mark as decision” or “Create task.”
- A task has title, assignee from the conversation, done/open state, creator, timestamp, and source message ID.
- A side panel shows pinned decisions and open tasks, with a link back to the source message.
- All writes require membership; persisted changes are broadcast to current members.
- Demo a realistic campus project discussion and turn its outcome into one assigned task.

Optional later: ask an LLM to propose a summary only after participants choose that action. Keep API calls and keys on the backend, validate output, show source messages, allow edits, and explain that selected chat content is sent to an external service. Never make the core chat depend on AI availability.

## Defer

Custom cryptographic protocol extensions, forward-secret ratchet development during the event, voice/video calls, media scanning, public discovery feeds, complex moderation, microservices, Redis, Kubernetes, and multiple database providers. File uploads require separate storage, authorization, validation, and abuse handling; they are not the fastest path to a dependable demo.

## Your immediate next 45 minutes

- 0–10: install Node 24, extract the repo, run `npm ci` and `npm run dev`.
- 10–20: create three accounts in separate browser sessions; open chats automatically, send direct/group messages.
- 20–30: read `ARCHITECTURE.md`, then trace one message through ChatPanel → useChat → shared/crypto → app.js → chat.js → db.js.
- 30–40: run `npm run check`; ask each teammate to repeat the local setup.
- 40–45: commit the baseline to a private GitHub repo and choose who owns the next feature.
