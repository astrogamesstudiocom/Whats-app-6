import type { Timestamp } from 'firebase/firestore';

export const PAYLOAD_LIMITS = {
  DISPLAY_NAME_MAX: 80,
  STATUS_TEXT_MAX: 140,
  CONVERSATION_TITLE_MAX: 100,
  MESSAGE_TEXT_MAX: 4000,
  PREVIEW_TEXT_MAX: 240,
  REPLY_PREVIEW_MAX: 200,
  PHOTO_URL_MAX: 1024,
  MEDIA_URL_MAX: 2048,
} as const;

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
  statusText?: string;
  discoverable: boolean;
  online: boolean;
  lastSeen: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PrivateAccount {
  uid: string;
  email: string;
  emailVerified: boolean;
  fcmTokens?: string[];
  updatedAt: Timestamp | null;
}

export type ConversationType = 'direct' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  title?: string;
  iconURL?: string;
  createdBy: string;
  memberCount: number;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageAt?: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ConversationMember {
  uid: string;
  displayName: string;
  photoURL?: string;
  role: 'admin' | 'member';
  joinedAt: Timestamp | null;
  lastDeliveredAt?: Timestamp | null;
  lastReadAt?: Timestamp | null;
}

export interface ConversationRef {
  conversationId: string;
  type: ConversationType;
  title?: string;
  iconURL?: string;
  peerUid?: string;
  peerPhotoURL?: string;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageAt: Timestamp | null;
  unreadCount?: number;
  updatedAt: Timestamp | null;
}

export type MessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'call';

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  type: MessageType;
  text: string;
  mediaUrl?: string;
  mediaName?: string;
  mediaMime?: string;
  mediaSize?: number;
  audioDuration?: number;
  replyToId?: string;
  replyToPreview?: string;
  deleted?: boolean;
  editedAt?: Timestamp | null;
  createdAt: Timestamp | null;
}

export interface TypingIndicator {
  uid: string;
  displayName: string;
  isTyping: boolean;
  updatedAt: Timestamp | null;
}

export type CallType = 'audio' | 'video';
export type CallMode = 'direct' | 'group';
export type CallStatus = 'ringing' | 'active' | 'ended' | 'rejected' | 'missed';
export type ParticipantStatus = 'ringing' | 'joined' | 'rejected' | 'left' | 'missed';

export interface CallSession {
  id: string;
  conversationId: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  callType: CallType;
  mode: CallMode;
  status: CallStatus;
  durationSeconds?: number;
  startedAt?: Timestamp | null;
  endedAt?: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface CallParticipant {
  uid: string;
  displayName: string;
  photoURL?: string;
  role: 'caller' | 'callee';
  status: ParticipantStatus;
  audioMuted: boolean;
  videoOff: boolean;
  updatedAt: Timestamp | null;
}

export interface WebRtcSignal {
  id: string;
  fromUid: string;
  toUid: string;
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: string;
  candidate?: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  createdAt: Timestamp | null;
}

export interface CallInvite {
  callId: string;
  conversationId: string;
  conversationTitle?: string;
  callerId: string;
  callerName: string;
  callerPhoto?: string;
  callType: CallType;
  mode: CallMode;
  status: CallStatus;
  durationSeconds?: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface UserNotification {
  id: string;
  userId: string;
  type: 'missed_call' | 'message' | 'call';
  title: string;
  body: string;
  conversationId?: string;
  callId?: string;
  read: boolean;
  createdAt: Timestamp | null;
}

export interface InfrastructureHealth {
  ok: boolean;
  projectId: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  turnConfigured: boolean;
  vapidConfigured: boolean;
}
