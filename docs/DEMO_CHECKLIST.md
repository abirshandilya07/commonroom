# Acceptance and submission checklist

## Before adding features

- [ ] The extracted root contains both package.json and package-lock.json.
- [ ] Light/dark toggle works on authentication, chat, people search, and conversation details.
- [ ] Theme survives refresh/logout; another tab picks up a changed preference.
- [ ] A first visit follows the system color preference.
- [ ] Ctrl+K opens people search; Escape closes dialogs.
- [ ] Theme transition respects reduced motion and has no horizontal mobile overflow.
- [ ] Only one New conversation button exists; its Direct/Group tabs work.
- [ ] Verify automatic setup, same-browser re-login, optional backup, and new-browser recovery; wrong key fails.
- [ ] Create a three-account group; all members read signed encrypted messages and see named typing.
- [ ] An outsider cannot read/send/receive group messages (automated integration test).
- [ ] Incoming messages outside the focused chat show a toast, badge and title count; unread survives refresh and clears on open.
- [ ] Enable sound through the bell, try Test sound, and check incoming sound on the actual demo device.
- [ ] Enable desktop permission and test with the app in the background on the actual demo OS/browser. Alerts contain no message text.
- [ ] State accurately: desktop alerts require the app open; group membership is fixed; communities remain deferred.
- [ ] Conversation details show all fingerprints. Compare them through a separate trusted channel.
- [ ] State the encryption limits: unaudited prototype, no forward secrecy, older history/backups remain plaintext.
- [ ] Verify an old database upgrade on a backup before using real existing data.

- [ ] Fresh `npm ci` succeeds under Node 24.
- [ ] `npm run check` passes.
- [ ] Register Alice in a normal browser and Bob in incognito/a different browser.
- [ ] Empty/invalid inputs display a useful error.
- [ ] Reusing a username is rejected.
- [ ] Logout and login work; refreshing keeps a valid session.
- [ ] Alice finds Bob, opens a conversation, and sends a message.
- [ ] Bob sees it without refreshing and replies.
- [ ] A third user cannot fetch/write the conversation (covered by integration tests).
- [ ] Two accounts opening the same pair do not create duplicate conversations.
- [ ] Typing indicators appear then expire; online status updates on disconnect.
- [ ] Close and reopen one window; its messages remain.
- [ ] Stop/restart the backend; accounts and messages remain.
- [ ] Reconnect reloads the latest page; older history is reachable.
- [ ] Retry a timed-out send unchanged; the server stores only one copy.
- [ ] No message content runs as HTML/JavaScript.
- [ ] At 390px width, open a conversation, send, and navigate back to the list.
- [ ] Keyboard users can operate forms, user search, and the composer.
- [ ] Test `npm run build` then `npm start` separately from dev mode.

## Three-minute demo script

1. **0:00–0:20:** Explain the audience and pain point: campus project conversations lose decisions and next steps.
2. **0:20–0:45:** Show two independent registered users. Explain real authenticated sessions.
3. **0:45–1:25:** Start a conversation, exchange messages, show typing and presence.
4. **1:25–1:50:** Refresh or briefly reconnect and show persisted history.
5. **1:50–2:30:** Show a three-member group, an unread alert, and both themes. Mention encrypted new messages and optional recovery backup; explain the prototype limits.
6. **2:30–3:00:** Explain the architecture, one reliability decision, and next step.

Use prepared test accounts with non-sensitive data. Keep both browser windows visible. Have a local copy running even if you deploy. Record a short backup before the last hour.

## Six-slide pitch outline

1. Audience, problem, one-sentence product promise.
2. Realistic campus scenario and what current chat misses.
3. Product screenshots and complete user flow.
4. Architecture: React/Web Crypto → Express/Socket.IO → SQLite, with sessions, ciphertext and membership checks.
5. Implemented differentiator, demo evidence, and reliability checks.
6. Team contributions, current limits, and next steps.

## Required submission items from the brief

- [ ] Complete source in GitHub; keep the repository private until the hackathon ends. It may be made public at final submission.
- [ ] README with install/configure/run/reproduce instructions, architecture, major features, and environment variables.
- [ ] Working real-time web application. Organizers may run it independently.
- [ ] PPT uploaded to Google Drive with public link access enabled; include its shareable link.
- [ ] Short demo video uploaded to YouTube with public access; include its link.
- [ ] Verify both links in a signed-out/incognito browser.
- [ ] Optional live deployment link, if stable.
- [ ] No recovery keys, API keys, `.env`, passwords, personal data, or database files committed.

The brief warns that failing its repository/upload/link-access requirements can cause disqualification. Treat this checklist as part of the build, not admin work for the last minute.
