import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { sha256Hex } from '../lib/media';
import {
  PAYLOAD_LIMITS,
  type CallInvite,
  type CallMode,
  type CallParticipant,
  type CallSession,
  type CallType,
  type ChatMessage,
  type Conversation,
  type ConversationMember,
  type ConversationRef,
  type MessageType,
  type TypingIndicator,
  type UserNotification,
  type UserProfile,
} from '../types/chat';

function makeId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  return `${prefix}_${Date.now()}_${rand}`;
}

function trimTo(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export async function syncVerifiedUserProfile(user: User): Promise<UserProfile> {
  const uid = user.uid;
  const userRef = doc(db, 'users', uid);
  const privateRef = doc(db, 'users', uid, 'private', 'account');
  const displayName = trimTo(
    user.displayName || user.email?.split('@')[0] || 'User',
    PAYLOAD_LIMITS.DISPLAY_NAME_MAX
  );
  const photoURL = user.photoURL
    ? user.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX)
    : undefined;

  let existingSnap;
  try {
    existingSnap = await getDoc(userRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
  }

  const batch = writeBatch(db);

  if (!existingSnap.exists()) {
    const profileData: Record<string, unknown> = {
      uid,
      displayName,
      statusText: 'Available on My Chatting Web',
      discoverable: true,
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (photoURL) {
      profileData.photoURL = photoURL;
    }
    batch.set(userRef, profileData);
  } else {
    const updates: Record<string, unknown> = {
      online: true,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (photoURL && !existingSnap.data()?.photoURL) {
      updates.photoURL = photoURL;
    }
    batch.update(userRef, updates);
  }

  if (user.email) {
    const privateSnap = await getDoc(privateRef).catch(() => null);
    const privatePayload: Record<string, unknown> = {
      uid,
      email: user.email.slice(0, 254),
      emailVerified: Boolean(user.emailVerified),
      updatedAt: serverTimestamp(),
    };
    if (privateSnap && privateSnap.exists()) {
      batch.update(privateRef, {
        email: privatePayload.email,
        emailVerified: privatePayload.emailVerified,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(privateRef, privatePayload);
    }

    const emailHash = await sha256Hex(user.email);
    const dirRef = doc(db, 'emailDirectory', emailHash);
    const dirSnap = await getDoc(dirRef).catch(() => null);
    if (dirSnap && dirSnap.exists()) {
      batch.update(dirRef, {
        displayName,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(dirRef, {
        uid,
        displayName,
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }

  const updatedSnap = await getDoc(userRef);
  return updatedSnap.data() as UserProfile;
}

export async function setPresence(uid: string, online: boolean): Promise<void> {
  const userRef = doc(db, 'users', uid);
  try {
    await updateDoc(userRef, {
      online,
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Presence updates on unload can abort silently
  }
}

export async function updateUserProfile(
  uid: string,
  updates: {
    displayName: string;
    statusText: string;
    discoverable: boolean;
    photoURL?: string;
    email?: string | null;
  }
): Promise<void> {
  const userRef = doc(db, 'users', uid);
  const cleanName = trimTo(updates.displayName || 'User', PAYLOAD_LIMITS.DISPLAY_NAME_MAX);
  const cleanStatus = trimTo(updates.statusText, PAYLOAD_LIMITS.STATUS_TEXT_MAX);

  const payload: Record<string, unknown> = {
    displayName: cleanName,
    statusText: cleanStatus,
    discoverable: updates.discoverable,
    online: true,
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (updates.photoURL) {
    payload.photoURL = updates.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  }

  try {
    await updateDoc(userRef, payload);
    if (updates.email) {
      const emailHash = await sha256Hex(updates.email);
      await updateDoc(doc(db, 'emailDirectory', emailHash), {
        displayName: cleanName,
        updatedAt: serverTimestamp(),
      }).catch(() => undefined);
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export async function saveFcmToken(uid: string, token: string): Promise<void> {
  const privateRef = doc(db, 'users', uid, 'private', 'account');
  try {
    const snap = await getDoc(privateRef);
    if (!snap.exists()) return;
    const existing: string[] = Array.isArray(snap.data()?.fcmTokens)
      ? snap.data().fcmTokens
      : [];
    if (existing.includes(token)) return;
    const nextTokens = [token, ...existing].slice(0, 10);
    await updateDoc(privateRef, {
      fcmTokens: nextTokens,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/private/account`);
  }
}

export async function findUserByEmail(email: string): Promise<UserProfile | null> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes('@')) return null;
  const emailHash = await sha256Hex(trimmed);
  try {
    const dirSnap = await getDoc(doc(db, 'emailDirectory', emailHash));
    if (!dirSnap.exists()) return null;
    const targetUid = dirSnap.data()?.uid as string;
    if (!targetUid) return null;
    const profileSnap = await getDoc(doc(db, 'users', targetUid));
    return profileSnap.exists() ? (profileSnap.data() as UserProfile) : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `emailDirectory/${emailHash}`);
  }
}

export function subscribeDiscoverableUsers(
  onUpdate: (users: UserProfile[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'users'),
    where('discoverable', '==', true),
    limit(50)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as UserProfile);
      list.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
      onUpdate(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'users')
  );
}

export function subscribeUserProfile(
  uid: string,
  onUpdate: (profile: UserProfile | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onUpdate(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
  );
}

export function subscribeConversationRefs(
  uid: string,
  onUpdate: (refs: ConversationRef[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'users', uid, 'conversationRefs'),
    orderBy('lastMessageAt', 'desc'),
    limit(100)
  );
  return onSnapshot(
    q,
    (snap) => {
      onUpdate(snap.docs.map((d) => d.data() as ConversationRef));
    },
    (err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `users/${uid}/conversationRefs`
      )
  );
}

export async function createOrOpenDirectChat(
  me: UserProfile,
  peer: UserProfile
): Promise<string> {
  const sorted = [me.uid, peer.uid].sort();
  const convId = `dm_${sorted[0]}_${sorted[1]}`;
  const myRefDoc = doc(db, 'users', me.uid, 'conversationRefs', convId);

  try {
    const existingRef = await getDoc(myRefDoc);
    if (existingRef.exists()) {
      return convId;
    }
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.GET,
      `users/${me.uid}/conversationRefs/${convId}`
    );
  }

  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', convId), {
    id: convId,
    type: 'direct',
    createdBy: me.uid,
    memberCount: 2,
    lastMessageText: '',
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const meMember: Record<string, unknown> = {
    uid: me.uid,
    displayName: trimTo(me.displayName, PAYLOAD_LIMITS.DISPLAY_NAME_MAX),
    role: 'admin',
    joinedAt: serverTimestamp(),
  };
  if (me.photoURL) meMember.photoURL = me.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  batch.set(doc(db, 'conversations', convId, 'members', me.uid), meMember);

  const peerMember: Record<string, unknown> = {
    uid: peer.uid,
    displayName: trimTo(peer.displayName, PAYLOAD_LIMITS.DISPLAY_NAME_MAX),
    role: 'member',
    joinedAt: serverTimestamp(),
  };
  if (peer.photoURL) {
    peerMember.photoURL = peer.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  }
  batch.set(doc(db, 'conversations', convId, 'members', peer.uid), peerMember);

  const myConvRef: Record<string, unknown> = {
    conversationId: convId,
    type: 'direct',
    title: trimTo(peer.displayName, PAYLOAD_LIMITS.CONVERSATION_TITLE_MAX),
    peerUid: peer.uid,
    lastMessageText: '',
    lastMessageAt: serverTimestamp(),
    unreadCount: 0,
    updatedAt: serverTimestamp(),
  };
  if (peer.photoURL) {
    myConvRef.peerPhotoURL = peer.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  }
  batch.set(myRefDoc, myConvRef);

  const peerConvRef: Record<string, unknown> = {
    conversationId: convId,
    type: 'direct',
    title: trimTo(me.displayName, PAYLOAD_LIMITS.CONVERSATION_TITLE_MAX),
    peerUid: me.uid,
    lastMessageText: '',
    lastMessageAt: serverTimestamp(),
    unreadCount: 0,
    updatedAt: serverTimestamp(),
  };
  if (me.photoURL) {
    peerConvRef.peerPhotoURL = me.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  }
  batch.set(doc(db, 'users', peer.uid, 'conversationRefs', convId), peerConvRef);

  try {
    await batch.commit();
    return convId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}`);
  }
}

export async function createGroupChat(
  me: UserProfile,
  title: string,
  selectedPeers: UserProfile[]
): Promise<string> {
  const convId = makeId('grp');
  const cleanTitle = trimTo(title || 'Group Channel', PAYLOAD_LIMITS.CONVERSATION_TITLE_MAX);
  const uniquePeers = selectedPeers.filter((p) => p.uid !== me.uid);
  const allMembers = [me, ...uniquePeers];

  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', convId), {
    id: convId,
    type: 'group',
    title: cleanTitle,
    createdBy: me.uid,
    memberCount: allMembers.length,
    lastMessageText: `${me.displayName} created the group`,
    lastMessageSenderId: me.uid,
    lastMessageAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const member of allMembers) {
    const memberPayload: Record<string, unknown> = {
      uid: member.uid,
      displayName: trimTo(member.displayName, PAYLOAD_LIMITS.DISPLAY_NAME_MAX),
      role: member.uid === me.uid ? 'admin' : 'member',
      joinedAt: serverTimestamp(),
    };
    if (member.photoURL) {
      memberPayload.photoURL = member.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
    }
    batch.set(doc(db, 'conversations', convId, 'members', member.uid), memberPayload);

    batch.set(doc(db, 'users', member.uid, 'conversationRefs', convId), {
      conversationId: convId,
      type: 'group',
      title: cleanTitle,
      lastMessageText: `${me.displayName} created the group`.slice(
        0,
        PAYLOAD_LIMITS.PREVIEW_TEXT_MAX
      ),
      lastMessageSenderId: me.uid,
      lastMessageAt: serverTimestamp(),
      unreadCount: member.uid === me.uid ? 0 : 1,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return convId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}`);
  }
}

export function subscribeConversation(
  conversationId: string,
  onUpdate: (conv: Conversation | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'conversations', conversationId),
    (snap) => onUpdate(snap.exists() ? (snap.data() as Conversation) : null),
    (err) =>
      handleFirestoreError(
        err,
        OperationType.GET,
        `conversations/${conversationId}`
      )
  );
}

export function subscribeConversationMembers(
  conversationId: string,
  onUpdate: (members: ConversationMember[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'conversations', conversationId, 'members'),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as ConversationMember)),
    (err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `conversations/${conversationId}/members`
      )
  );
}

export function subscribeMessages(
  conversationId: string,
  onUpdate: (messages: ChatMessage[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'conversations', conversationId, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200)
  );
  return onSnapshot(
    q,
    (snap) => onUpdate(snap.docs.map((d) => d.data() as ChatMessage)),
    (err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `conversations/${conversationId}/messages`
      )
  );
}

export function subscribeTypingIndicators(
  conversationId: string,
  onUpdate: (typing: TypingIndicator[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'conversations', conversationId, 'typing'),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as TypingIndicator)),
    (err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `conversations/${conversationId}/typing`
      )
  );
}

export async function sendMessage(params: {
  conversationId: string;
  sender: UserProfile;
  memberUids: string[];
  type: MessageType;
  text: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaMime?: string;
  mediaSize?: number;
  audioDuration?: number;
  replyToId?: string;
  replyToPreview?: string;
}): Promise<string> {
  const msgId = makeId('msg');
  const cleanText = trimTo(params.text, PAYLOAD_LIMITS.MESSAGE_TEXT_MAX);
  const senderName = trimTo(
    params.sender.displayName || 'User',
    PAYLOAD_LIMITS.DISPLAY_NAME_MAX
  );

  const previewText =
    params.type === 'text'
      ? cleanText
      : params.type === 'audio'
        ? 'Voice message'
        : params.type === 'image'
          ? 'Shared an image'
          : params.type === 'video'
            ? 'Shared a video'
            : params.type === 'document'
              ? `File: ${params.mediaName || 'Document'}`
              : cleanText;

  const cleanPreview = trimTo(previewText, PAYLOAD_LIMITS.PREVIEW_TEXT_MAX);

  const messagePayload: Record<string, unknown> = {
    id: msgId,
    conversationId: params.conversationId,
    senderId: params.sender.uid,
    senderName,
    type: params.type,
    text: cleanText,
    createdAt: serverTimestamp(),
  };

  if (params.mediaUrl) {
    messagePayload.mediaUrl = params.mediaUrl.slice(0, PAYLOAD_LIMITS.MEDIA_URL_MAX);
  }
  if (params.mediaName) {
    messagePayload.mediaName = params.mediaName.slice(0, 255);
  }
  if (params.mediaMime) {
    messagePayload.mediaMime = params.mediaMime.slice(0, 120);
  }
  if (typeof params.mediaSize === 'number') {
    messagePayload.mediaSize = params.mediaSize;
  }
  if (typeof params.audioDuration === 'number') {
    messagePayload.audioDuration = Math.min(3600, Math.max(0, Math.round(params.audioDuration)));
  }
  if (params.replyToId) {
    messagePayload.replyToId = params.replyToId;
  }
  if (params.replyToPreview) {
    messagePayload.replyToPreview = trimTo(
      params.replyToPreview,
      PAYLOAD_LIMITS.REPLY_PREVIEW_MAX
    );
  }

  const batch = writeBatch(db);
  batch.set(
    doc(db, 'conversations', params.conversationId, 'messages', msgId),
    messagePayload
  );

  batch.update(doc(db, 'conversations', params.conversationId), {
    lastMessageText: cleanPreview,
    lastMessageSenderId: params.sender.uid,
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const uid of params.memberUids) {
    const refDoc = doc(db, 'users', uid, 'conversationRefs', params.conversationId);
    batch.update(refDoc, {
      lastMessageText: cleanPreview,
      lastMessageSenderId: params.sender.uid,
      lastMessageAt: serverTimestamp(),
      unreadCount: uid === params.sender.uid ? 0 : increment(1),
      updatedAt: serverTimestamp(),
    });
  }

  // Clear typing indicator on send
  batch.set(doc(db, 'conversations', params.conversationId, 'typing', params.sender.uid), {
    uid: params.sender.uid,
    displayName: senderName,
    isTyping: false,
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return msgId;
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.CREATE,
      `conversations/${params.conversationId}/messages/${msgId}`
    );
  }
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  newText: string
): Promise<void> {
  const cleanText = trimTo(newText, PAYLOAD_LIMITS.MESSAGE_TEXT_MAX);
  try {
    await updateDoc(
      doc(db, 'conversations', conversationId, 'messages', messageId),
      {
        text: cleanText,
        editedAt: serverTimestamp(),
      }
    );
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `conversations/${conversationId}/messages/${messageId}`
    );
  }
}

export async function softDeleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  try {
    await updateDoc(
      doc(db, 'conversations', conversationId, 'messages', messageId),
      {
        text: 'This message was deleted',
        deleted: true,
        editedAt: serverTimestamp(),
      }
    );
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `conversations/${conversationId}/messages/${messageId}`
    );
  }
}

export async function markConversationDelivered(
  conversationId: string,
  uid: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'conversations', conversationId, 'members', uid), {
      lastDeliveredAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal background receipt sync
  }
}

export async function markConversationRead(
  conversationId: string,
  uid: string
): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'conversations', conversationId, 'members', uid), {
    lastDeliveredAt: serverTimestamp(),
    lastReadAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', uid, 'conversationRefs', conversationId), {
    unreadCount: 0,
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch {
    // Non-fatal if conversation ref is momentarily unavailable
  }
}

export async function setTypingState(
  conversationId: string,
  uid: string,
  displayName: string,
  isTyping: boolean
): Promise<void> {
  try {
    await setDoc(doc(db, 'conversations', conversationId, 'typing', uid), {
      uid,
      displayName: trimTo(displayName, PAYLOAD_LIMITS.DISPLAY_NAME_MAX),
      isTyping,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Ephemeral typing indicator failure should not disrupt UX
  }
}

// ==========================================
// WebRTC Call Sessions & Call History
// ==========================================

export async function initiateCallSession(params: {
  caller: UserProfile;
  conversationId: string;
  conversationTitle: string;
  callType: CallType;
  mode: CallMode;
  recipients: Array<{ uid: string; displayName: string; photoURL?: string }>;
}): Promise<string> {
  const callId = makeId('call');
  const callerName = trimTo(
    params.caller.displayName,
    PAYLOAD_LIMITS.DISPLAY_NAME_MAX
  );
  const convTitle = trimTo(
    params.conversationTitle,
    PAYLOAD_LIMITS.CONVERSATION_TITLE_MAX
  );

  const batch = writeBatch(db);

  const callData: Record<string, unknown> = {
    id: callId,
    conversationId: params.conversationId,
    callerId: params.caller.uid,
    callerName,
    callType: params.callType,
    mode: params.mode,
    status: 'ringing',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (params.caller.photoURL) {
    callData.callerPhoto = params.caller.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  }
  batch.set(doc(db, 'calls', callId), callData);

  const callerParticipant: Record<string, unknown> = {
    uid: params.caller.uid,
    displayName: callerName,
    role: 'caller',
    status: 'joined',
    audioMuted: false,
    videoOff: params.callType === 'audio',
    updatedAt: serverTimestamp(),
  };
  if (params.caller.photoURL) {
    callerParticipant.photoURL = params.caller.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
  }
  batch.set(
    doc(db, 'calls', callId, 'participants', params.caller.uid),
    callerParticipant
  );

  for (const r of params.recipients) {
    const recPayload: Record<string, unknown> = {
      uid: r.uid,
      displayName: trimTo(r.displayName, PAYLOAD_LIMITS.DISPLAY_NAME_MAX),
      role: 'callee',
      status: 'ringing',
      audioMuted: false,
      videoOff: params.callType === 'audio',
      updatedAt: serverTimestamp(),
    };
    if (r.photoURL) {
      recPayload.photoURL = r.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
    }
    batch.set(doc(db, 'calls', callId, 'participants', r.uid), recPayload);
  }

  const allUids = [params.caller.uid, ...params.recipients.map((r) => r.uid)];
  for (const uid of allUids) {
    const inviteData: Record<string, unknown> = {
      callId,
      conversationId: params.conversationId,
      conversationTitle: convTitle,
      callerId: params.caller.uid,
      callerName,
      callType: params.callType,
      mode: params.mode,
      status: 'ringing',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (params.caller.photoURL) {
      inviteData.callerPhoto = params.caller.photoURL.slice(0, PAYLOAD_LIMITS.PHOTO_URL_MAX);
    }
    batch.set(doc(db, 'users', uid, 'callInvites', callId), inviteData);
  }

  try {
    await batch.commit();
    return callId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `calls/${callId}`);
  }
}

export async function acceptCallSession(
  callId: string,
  uid: string,
  callType: CallType,
  participantUids: string[]
): Promise<void> {
  const callSnap = await getDoc(doc(db, 'calls', callId));
  if (!callSnap.exists()) return;
  const callData = callSnap.data() as CallSession;
  if (['ended', 'rejected', 'missed'].includes(callData.status)) return;

  const partsSnap = await getDocs(collection(db, 'calls', callId, 'participants'));
  const allUids =
    partsSnap.docs.length > 0
      ? partsSnap.docs.map((d) => d.id)
      : participantUids;

  const batch = writeBatch(db);

  if (callData.status === 'ringing') {
    batch.update(doc(db, 'calls', callId), {
      status: 'active',
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    for (const pUid of allUids) {
      batch.update(doc(db, 'users', pUid, 'callInvites', callId), {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
    }
  } else {
    batch.update(doc(db, 'users', uid, 'callInvites', callId), {
      status: 'active',
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'calls', callId, 'participants', uid), {
    status: 'joined',
    audioMuted: false,
    videoOff: callType === 'audio',
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `calls/${callId}`);
  }
}

export async function declineCallSession(
  callId: string,
  uid: string,
  mode: CallMode,
  participantUids: string[]
): Promise<void> {
  const callSnap = await getDoc(doc(db, 'calls', callId));
  if (!callSnap.exists()) return;
  const callData = callSnap.data() as CallSession;
  if (['ended', 'rejected', 'missed'].includes(callData.status)) return;

  const batch = writeBatch(db);
  batch.update(doc(db, 'calls', callId, 'participants', uid), {
    status: 'rejected',
    updatedAt: serverTimestamp(),
  });

  if (mode === 'direct') {
    batch.update(doc(db, 'calls', callId), {
      status: 'rejected',
      endedAt: serverTimestamp(),
      durationSeconds: 0,
      updatedAt: serverTimestamp(),
    });
    for (const pUid of participantUids) {
      batch.update(doc(db, 'users', pUid, 'callInvites', callId), {
        status: 'rejected',
        durationSeconds: 0,
        updatedAt: serverTimestamp(),
      });
    }
  } else {
    batch.update(doc(db, 'users', uid, 'callInvites', callId), {
      status: 'rejected',
      durationSeconds: 0,
      updatedAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `calls/${callId}`);
  }
}

export async function updateCallMediaState(
  callId: string,
  uid: string,
  audioMuted: boolean,
  videoOff: boolean
): Promise<void> {
  try {
    await updateDoc(doc(db, 'calls', callId, 'participants', uid), {
      audioMuted,
      videoOff,
      updatedAt: serverTimestamp(),
    });
  } catch {
    // Non-fatal mute state sync
  }
}

export async function endCallSession(params: {
  callId: string;
  actor: UserProfile;
  conversationId: string;
  callType: CallType;
  mode: CallMode;
  wasAnswered: boolean;
  durationSeconds: number;
  participantUids: string[];
}): Promise<void> {
  const callRef = doc(db, 'calls', params.callId);
  const callSnap = await getDoc(callRef).catch(() => null);
  if (!callSnap || !callSnap.exists()) return;
  const callData = callSnap.data() as CallSession;
  if (['ended', 'rejected', 'missed'].includes(callData.status)) return;

  const finalStatus = params.wasAnswered ? 'ended' : 'missed';
  const safeDuration = params.wasAnswered
    ? Math.max(0, Math.min(86400, Math.round(params.durationSeconds)))
    : 0;

  const batch = writeBatch(db);

  batch.update(callRef, {
    status: finalStatus,
    endedAt: serverTimestamp(),
    durationSeconds: safeDuration,
    updatedAt: serverTimestamp(),
  });

  batch.update(doc(db, 'calls', params.callId, 'participants', params.actor.uid), {
    status: 'left',
    updatedAt: serverTimestamp(),
  });

  for (const uid of params.participantUids) {
    batch.update(doc(db, 'users', uid, 'callInvites', params.callId), {
      status: finalStatus,
      durationSeconds: safeDuration,
      updatedAt: serverTimestamp(),
    });
  }

  // If missed, notify callees in-app
  if (finalStatus === 'missed') {
    for (const uid of params.participantUids) {
      if (uid === params.actor.uid) continue;
      const notifId = makeId('notif');
      batch.set(doc(db, 'users', uid, 'notifications', notifId), {
        id: notifId,
        userId: uid,
        type: 'missed_call',
        title: 'Missed Call',
        body: `Missed ${params.callType} call from ${params.actor.displayName}`.slice(
          0,
          300
        ),
        conversationId: params.conversationId,
        callId: params.callId,
        read: false,
        createdAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `calls/${params.callId}`);
  }

  // Record call summary entry in conversation timeline
  const summaryText =
    finalStatus === 'missed'
      ? `Missed ${params.callType} call`
      : `${params.callType === 'video' ? 'Video' : 'Voice'} call · ${Math.floor(safeDuration / 60)}m ${safeDuration % 60}s`;

  await sendMessage({
    conversationId: params.conversationId,
    sender: params.actor,
    memberUids: params.participantUids,
    type: 'call',
    text: summaryText,
  }).catch(() => undefined);
}

export function subscribeCallSession(
  callId: string,
  onUpdate: (session: CallSession | null) => void
): Unsubscribe {
  return onSnapshot(
    doc(db, 'calls', callId),
    (snap) => onUpdate(snap.exists() ? (snap.data() as CallSession) : null),
    (err) => handleFirestoreError(err, OperationType.GET, `calls/${callId}`)
  );
}

export function subscribeCallParticipants(
  callId: string,
  onUpdate: (participants: CallParticipant[]) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'calls', callId, 'participants'),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as CallParticipant)),
    (err) =>
      handleFirestoreError(
        err,
        OperationType.LIST,
        `calls/${callId}/participants`
      )
  );
}

export function subscribeCallInvites(
  uid: string,
  onUpdate: (invites: CallInvite[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'users', uid, 'callInvites'),
    orderBy('createdAt', 'desc'),
    limit(50)
  );
  return onSnapshot(
    q,
    (snap) => onUpdate(snap.docs.map((d) => d.data() as CallInvite)),
    (err) =>
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/callInvites`)
  );
}

export function subscribeUserNotifications(
  uid: string,
  onUpdate: (notifications: UserNotification[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'users', uid, 'notifications'),
    orderBy('createdAt', 'desc'),
    limit(40)
  );
  return onSnapshot(
    q,
    (snap) => onUpdate(snap.docs.map((d) => d.data() as UserNotification)),
    (err) =>
      handleFirestoreError(err, OperationType.LIST, `users/${uid}/notifications`)
  );
}

export async function markNotificationRead(
  uid: string,
  notificationId: string
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid, 'notifications', notificationId), {
      read: true,
    });
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `users/${uid}/notifications/${notificationId}`
    );
  }
}

export async function fetchConversationMembersOnce(
  conversationId: string
): Promise<ConversationMember[]> {
  try {
    const snap = await getDocs(
      collection(db, 'conversations', conversationId, 'members')
    );
    return snap.docs.map((d) => d.data() as ConversationMember);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.LIST,
      `conversations/${conversationId}/members`
    );
  }
}
