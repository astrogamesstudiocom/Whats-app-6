import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import {
  onDocumentCreated,
  onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

const app = initializeApp();
const DATABASE_ID = 'ai-studio-85f04a81-d937-4317-af8b-4e9baa13de1d';
const db = getFirestore(app, DATABASE_ID);
const messaging = getMessaging(app);

/**
 * Dispatches FCM push notifications to all other conversation members when a message arrives.
 */
export const onMessageCreated = onDocumentCreated(
  {
    document: 'conversations/{conversationId}/messages/{messageId}',
    database: DATABASE_ID,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const message = snap.data();
    const { conversationId } = event.params;
    const senderId = message.senderId as string;
    const senderName = (message.senderName as string) || 'New message';

    const membersSnap = await db
      .collection('conversations')
      .doc(conversationId)
      .collection('members')
      .get();

    const recipientUids = membersSnap.docs
      .map((d) => d.id)
      .filter((uid) => uid !== senderId);

    if (recipientUids.length === 0) return;

    const bodyPreview =
      message.type === 'text'
        ? String(message.text || '').slice(0, 140)
        : `Sent ${message.type === 'audio' ? 'a voice message' : `a ${message.type}`}`;

    const tokens: string[] = [];
    const tokenOwners: Array<{ uid: string; token: string }> = [];

    for (const uid of recipientUids) {
      const accountSnap = await db
        .collection('users')
        .doc(uid)
        .collection('private')
        .doc('account')
        .get();
      const fcmTokens = accountSnap.data()?.fcmTokens;
      if (Array.isArray(fcmTokens)) {
        for (const t of fcmTokens) {
          if (typeof t === 'string' && t.length > 0) {
            tokens.push(t);
            tokenOwners.push({ uid, token: t });
          }
        }
      }
    }

    if (tokens.length === 0) return;

    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: {
        title: senderName,
        body: bodyPreview,
      },
      data: {
        type: 'message',
        conversationId,
        messageId: event.params.messageId,
      },
    });

    // Prune invalid/expired FCM tokens
    const invalidByUid = new Map<string, string[]>();
    response.responses.forEach((res, idx) => {
      if (!res.success && res.error) {
        const code = res.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          const owner = tokenOwners[idx];
          const existing = invalidByUid.get(owner.uid) ?? [];
          existing.push(owner.token);
          invalidByUid.set(owner.uid, existing);
        }
      }
    });

    for (const [uid, badTokens] of invalidByUid.entries()) {
      await db
        .collection('users')
        .doc(uid)
        .collection('private')
        .doc('account')
        .update({
          fcmTokens: FieldValue.arrayRemove(...badTokens),
        });
    }
  }
);

/**
 * Dispatches incoming call & missed call FCM alerts when call session state changes.
 */
export const onCallStateChange = onDocumentUpdated(
  {
    document: 'calls/{callId}',
    database: DATABASE_ID,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;

    const { callId } = event.params;
    if (before.status === after.status) return;

    if (after.status === 'missed') {
      const participantsSnap = await db
        .collection('calls')
        .doc(callId)
        .collection('participants')
        .get();

      const missedCallees = participantsSnap.docs.filter(
        (d) => d.data().role === 'callee' && d.data().status !== 'joined'
      );

      for (const calleeDoc of missedCallees) {
        const uid = calleeDoc.id;
        const accountSnap = await db
          .collection('users')
          .doc(uid)
          .collection('private')
          .doc('account')
          .get();
        const fcmTokens = accountSnap.data()?.fcmTokens;
        if (Array.isArray(fcmTokens) && fcmTokens.length > 0) {
          await messaging.sendEachForMulticast({
            tokens: fcmTokens,
            notification: {
              title: 'Missed Call',
              body: `You missed a ${after.callType} call from ${after.callerName}`,
            },
            data: {
              type: 'missed_call',
              callId,
              conversationId: String(after.conversationId || ''),
            },
          });
        }
      }
    }
  }
);

/**
 * Authenticated callable endpoint for dynamic WebRTC ICE/TURN server configuration.
 */
export const getIceServers = onCall(async (request) => {
  if (!request.auth || !request.auth.token.email_verified) {
    throw new HttpsError('unauthenticated', 'Verified authentication required.');
  }

  const iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }> = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrls = process.env.TURN_SERVER_URLS;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  if (turnUrls && turnUsername && turnCredential) {
    iceServers.push({
      urls: turnUrls.split(',').map((u) => u.trim()),
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return { iceServers };
});
