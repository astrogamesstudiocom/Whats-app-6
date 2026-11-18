import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, storage } from './firebase';

export interface MediaUploadResult {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  provider: 'firebase-storage' | 'server-relay';
}

export async function sha256Hex(value: string): Promise<string> {
  const normalized = value.trim().toLowerCase();
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

async function uploadViaFirebaseStorage(
  path: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, blob, { contentType: mimeType });

  return new Promise((resolve, reject) => {
    // Abort quickly if bucket is unprovisioned / hangs on CORS preflight
    const timeout = window.setTimeout(() => {
      task.cancel();
      reject(new Error('storage/timeout'));
    }, 12000);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        }
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
      async () => {
        window.clearTimeout(timeout);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

async function uploadViaServerRelay(
  conversationId: string,
  fileName: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<MediaUploadResult> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required for media upload.');
  const idToken = await user.getIdToken();

  onProgress?.(35);
  const response = await fetch('/api/media/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': mimeType || 'application/octet-stream',
      'x-conversation-id': conversationId,
      'x-file-name': encodeURIComponent(fileName),
    },
    body: blob,
  });

  if (!response.ok) {
    const errPayload = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(errPayload.error || `Server upload failed (${response.status})`);
  }

  onProgress?.(100);
  const result = (await response.json()) as {
    url: string;
    size: number;
    mimeType: string;
    fileName: string;
  };

  return {
    url: result.url,
    fileName,
    mimeType: result.mimeType,
    size: result.size,
    provider: 'server-relay',
  };
}

export async function uploadChatMedia(
  conversationId: string,
  senderId: string,
  file: File | Blob,
  fileName: string,
  onProgress?: (pct: number) => void
): Promise<MediaUploadResult> {
  const cleanName = fileName.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120);
  const mimeType = file.type || 'application/octet-stream';
  const storagePath = `chats/${conversationId}/${senderId}/${Date.now()}_${cleanName}`;

  try {
    const url = await uploadViaFirebaseStorage(storagePath, file, mimeType, onProgress);
    return {
      url,
      fileName: cleanName,
      mimeType,
      size: file.size,
      provider: 'firebase-storage',
    };
  } catch {
    // Fallback to authenticated Express endpoint when Firebase Storage billing/rules are not yet enabled in Console
    return uploadViaServerRelay(conversationId, cleanName, file, mimeType, onProgress);
  }
}

export async function uploadUserAvatar(
  userId: string,
  file: File
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 80);
  const storagePath = `avatars/${userId}/${Date.now()}_${cleanName}`;
  try {
    return await uploadViaFirebaseStorage(storagePath, file, file.type || 'image/jpeg');
  } catch {
    const res = await uploadViaServerRelay(`avatar_${userId}`, cleanName, file, file.type || 'image/jpeg');
    return res.url;
  }
}
