/**
 * Security Rule Adversarial Verification Suite ("Dirty Dozen" Specification)
 * Intended for execution with @firebase/rules-unit-testing against the Firestore Emulator.
 */

export interface DirtyDozenCase {
  id: string;
  collection: string;
  actor: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
  rationale: string;
}

export const DIRTY_DOZEN_TESTS: DirtyDozenCase[] = [
  {
    id: 'DD-01-unverified-write',
    collection: 'conversations/conv_1/messages/msg_1',
    actor: 'unverified_user_a',
    operation: 'create',
    payload: { id: 'msg_1', conversationId: 'conv_1', senderId: 'user_a', senderName: 'A', type: 'text', text: 'hi' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Reject writes when request.auth.token.email_verified != true',
  },
  {
    id: 'DD-02-sender-spoofing',
    collection: 'conversations/conv_1/messages/msg_2',
    actor: 'verified_user_a',
    operation: 'create',
    payload: { id: 'msg_2', conversationId: 'conv_1', senderId: 'user_b', senderName: 'B', type: 'text', text: 'spoof' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'senderId must equal request.auth.uid',
  },
  {
    id: 'DD-03-shadow-ghost-field',
    collection: 'users/user_a',
    actor: 'verified_user_a',
    operation: 'update',
    payload: { displayName: 'Alice', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Reject unknown ghost keys via keys().hasOnly() and affectedKeys().hasOnly()',
  },
  {
    id: 'DD-04-pii-cross-read',
    collection: 'users/user_b/private/account',
    actor: 'verified_user_a',
    operation: 'get',
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Private account PII isolated strictly to owning UID',
  },
  {
    id: 'DD-05-non-member-read',
    collection: 'conversations/conv_1/messages',
    actor: 'verified_outsider_c',
    operation: 'list',
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Messages require membership in parent conversation',
  },
  {
    id: 'DD-06-non-member-write',
    collection: 'conversations/conv_1/messages/msg_3',
    actor: 'verified_outsider_c',
    operation: 'create',
    payload: { id: 'msg_3', conversationId: 'conv_1', senderId: 'user_c', senderName: 'C', type: 'text', text: 'intrude' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Outsiders cannot inject messages into conversations',
  },
  {
    id: 'DD-07-timestamp-forgery',
    collection: 'conversations/conv_1/messages/msg_4',
    actor: 'verified_user_a',
    operation: 'create',
    payload: { id: 'msg_4', conversationId: 'conv_1', senderId: 'user_a', senderName: 'A', type: 'text', text: 'backdated', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'createdAt must strictly match request.time',
  },
  {
    id: 'DD-08-id-poisoning',
    collection: 'conversations/invalid..id..slash/members/user_a',
    actor: 'verified_user_a',
    operation: 'create',
    payload: { uid: 'user_a', displayName: 'A', role: 'admin' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Path variables must pass isValidId() regex guard',
  },
  {
    id: 'DD-09-terminal-call-resurrection',
    collection: 'calls/call_ended_1',
    actor: 'verified_user_a',
    operation: 'update',
    payload: { status: 'active' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Terminal call states (ended/rejected/missed) are immutable',
  },
  {
    id: 'DD-10-webrtc-signal-impersonation',
    collection: 'calls/call_1/signals/sig_1',
    actor: 'verified_user_a',
    operation: 'create',
    payload: { id: 'sig_1', fromUid: 'user_b', toUid: 'user_a', type: 'offer', sdp: 'v=0...' },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Signaling packet fromUid must match request.auth.uid',
  },
  {
    id: 'DD-11-oversized-payload',
    collection: 'conversations/conv_1/messages/msg_5',
    actor: 'verified_user_a',
    operation: 'create',
    payload: { id: 'msg_5', conversationId: 'conv_1', senderId: 'user_a', senderName: 'A', type: 'text', text: 'x'.repeat(10000) },
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'Reject strings exceeding blueprint maxLength bounds',
  },
  {
    id: 'DD-12-email-directory-list',
    collection: 'emailDirectory',
    actor: 'verified_user_a',
    operation: 'list',
    expectedResult: 'PERMISSION_DENIED',
    rationale: 'emailDirectory permits exact-hash get lookups only, never list scraping',
  },
];
