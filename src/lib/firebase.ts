import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type User } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, onMessage, type MessagePayload } from 'firebase/messaging';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
storage.maxUploadRetryTime = 4000;
storage.maxOperationRetryTime = 4000;
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export interface FcmRegistrationResult {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  token: string | null;
  reason?: string;
}

export async function registerPushNotifications(
  _user: User,
  onForegroundMessage?: (payload: MessagePayload) => void
): Promise<FcmRegistrationResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      supported: false,
      permission: 'unsupported',
      token: null,
      reason: 'Browser does not support Notifications API.',
    };
  }

  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return {
      supported: false,
      permission: Notification.permission,
      token: null,
      reason: 'Firebase Cloud Messaging is not supported in this browser context.',
    };
  }

  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;

  if (permission !== 'granted') {
    return {
      supported: true,
      permission,
      token: null,
      reason: 'Notification permission was not granted.',
    };
  }

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  const messaging = getMessaging(app);

  if (onForegroundMessage) {
    onMessage(messaging, onForegroundMessage);
  }

  if (!vapidKey) {
    return {
      supported: true,
      permission,
      token: null,
      reason: 'VITE_FIREBASE_VAPID_KEY is not configured. Browser notifications remain active when open.',
    };
  }

  try {
    const swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: swRegistration,
    });
    return {
      supported: true,
      permission,
      token: token || null,
    };
  } catch (err) {
    return {
      supported: true,
      permission,
      token: null,
      reason: err instanceof Error ? err.message : 'Failed to obtain FCM registration token.',
    };
  }
}

export { firebaseConfig };
