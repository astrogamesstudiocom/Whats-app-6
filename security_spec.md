# Security Specification — My Chatting Web

## 1. Data Invariants
1. **Verified Identity Gate**: Every write and private read requires `request.auth != null` AND `request.auth.token.email_verified == true`.
2. **PII Isolation**: Email addresses and FCM push tokens reside strictly under `/users/{userId}/private/account` and are readable/writable only by `userId == request.auth.uid`. Public `/users/{userId}` documents contain zero PII.
3. **Subcollection Membership**: Conversation access (`/conversations/{conversationId}/messages`, `/typing`) is gated by membership in `/conversations/{conversationId}/members/{request.auth.uid}`. Unbounded member arrays are forbidden.
4. **Atomic Inbox & Call Sync**: Creating or updating another user's `/conversationRefs/{conversationId}` or `/callInvites/{callId}` requires atomic proof via `exists()`/`existsAfter()` that the target user is a member/participant of that conversation/call and the actor is an authenticated member/participant.
5. **Immutable Authorship & Timestamps**: `createdAt`, `senderId`, `callerId`, and `createdBy` cannot be spoofed on create (`== request.auth.uid`, `== request.time`) or altered on update.
6. **Terminal State Locking**: Once a call reaches a terminal status (`ended`, `rejected`, `missed`), `calls/{callId}` cannot revert to `ringing` or `active`.
7. **Signal Isolation**: WebRTC signaling packets (`/calls/{callId}/signals/{signalId}`) can only be created by a call participant with `fromUid == request.auth.uid` and read only by `fromUid == request.auth.uid` or `toUid == request.auth.uid`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unverified Write**: Authenticated user with `email_verified: false` tries to create a message in `/conversations/c1/messages/m1` -> `PERMISSION_DENIED`.
2. **Sender Spoofing**: Verified User A sends a message claiming `senderId: "userB"` -> `PERMISSION_DENIED`.
3. **Ghost Field Shadow Update**: Verified User A updates `/users/userA` with `{ displayName: "Alice", isAdmin: true }` -> `PERMISSION_DENIED`.
4. **PII Cross-Read**: Verified User A attempts `get` on `/users/userB/private/account` -> `PERMISSION_DENIED`.
5. **Non-Member Message Read**: Verified User C (not in `/conversations/c1/members`) attempts `get`/`list` on `/conversations/c1/messages` -> `PERMISSION_DENIED`.
6. **Non-Member Message Inject**: Verified User C tries to `create` a message in `/conversations/c1/messages/m99` -> `PERMISSION_DENIED`.
7. **Backdated Timestamp Poisoning**: Verified User A creates a message with `createdAt` set to a client-chosen past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
8. **ID Poisoning**: Verified User A tries to create a conversation with ID `"../../../etc/passwd"` or a 500-char string -> `PERMISSION_DENIED`.
9. **Terminal Call Resurrection**: Participant tries to update `/calls/call1` from `status: "ended"` back to `status: "active"` -> `PERMISSION_DENIED`.
10. **WebRTC Signal Impersonation**: User A writes a signal packet in `/calls/call1/signals/s1` with `fromUid: "userB"` -> `PERMISSION_DENIED`.
11. **Oversized Payload (DoW)**: User A sends a message with `text` length 10,000 (> 4,000 limit) or `sdp` > 32,768 -> `PERMISSION_DENIED`.
12. **Blanket User List Scraping**: User A tries to list `/users` without filtering `discoverable == true`, or attempts to list `/emailDirectory` -> `PERMISSION_DENIED`.
