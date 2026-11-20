import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, storage } from './firebase';

export interface MediaUploadResult {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  provider: 'firebase-storage' | 'server-relay';
}

// Cache whether Firebase Storage bucket is unavailable (e.g. 404 unprovisioned)
// so subsequent photo/voice uploads route immediately to the Express relay without waiting.
let firebaseStorageUnavailable = false;

const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'audio/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

export function resolveMimeType(fileName: string, declaredType?: string): string {
  const cleanDeclared = (declaredType || '').trim();
  if (cleanDeclared && cleanDeclared !== 'application/octet-stream') {
    return cleanDeclared.slice(0, 120);
  }
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (ext && EXTENSION_MIME_MAP[ext]) {
    return EXTENSION_MIME_MAP[ext];
  }
  return 'application/octet-stream';
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

async function optimizeImageIfNeeded(
  blob: Blob,
  fileName: string,
  mimeType: string,
  maxDimension = 1920,
  sizeThresholdBytes = 1.2 * 1024 * 1024
): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const compressibleTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'];
  if (!compressibleTypes.includes(mimeType.toLowerCase()) || blob.size <= sizeThresholdBytes) {
    return { blob, fileName, mimeType };
  }

  try {
    const objectUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob, fileName, mimeType };

    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outMime = mimeType === 'image/png' ? 'image/webp' : 'image/jpeg';
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outMime, 0.85)
    );
    if (!compressed || compressed.size >= blob.size) {
      return { blob, fileName, mimeType };
    }

    const baseName = fileName.replace(/\.[^.]+$/, '');
    const ext = outMime === 'image/webp' ? 'webp' : 'jpg';
    return {
      blob: compressed,
      fileName: `${baseName}.${ext}`,
      mimeType: outMime,
    };
  } catch {
    return { blob, fileName, mimeType };
  }
}

async function uploadViaFirebaseStorage(
  path: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  if (firebaseStorageUnavailable) {
    throw new Error('storage/unavailable');
  }

  const storageRef = ref(storage, path);
  const task = uploadBytesResumable(storageRef, blob, { contentType: mimeType });

  return new Promise((resolve, reject) => {
    // Abort quickly if bucket is unprovisioned / returns 404 or hangs on CORS preflight
    const timeout = window.setTimeout(() => {
      firebaseStorageUnavailable = true;
      task.cancel();
      reject(new Error('storage/timeout'));
    }, 4000);

    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        }
      },
      (error) => {
        window.clearTimeout(timeout);
        firebaseStorageUnavailable = true;
        reject(error);
      },
      async () => {
        window.clearTimeout(timeout);
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          resolve(url);
        } catch (err) {
          firebaseStorageUnavailable = true;
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

  onProgress?.(10);

  return new Promise<MediaUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media/upload', true);
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
    xhr.setRequestHeader('Content-Type', mimeType || 'application/octet-stream');
    xhr.setRequestHeader('x-conversation-id', conversationId);
    xhr.setRequestHeader('x-file-name', encodeURIComponent(fileName));

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0 && onProgress) {
        const pct = Math.min(95, Math.max(15, Math.round((ev.loaded / ev.total) * 95)));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText) as {
            url: string;
            size: number;
            mimeType: string;
            fileName: string;
          };
          onProgress?.(100);
          resolve({
            url: result.url,
            fileName: result.fileName || fileName,
            mimeType: result.mimeType || mimeType,
            size: result.size || blob.size,
            provider: 'server-relay',
          });
        } catch {
          reject(new Error('Invalid response from media upload server.'));
        }
      } else {
        let message = `Upload failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText) as { error?: string };
          if (parsed?.error) message = parsed.error;
        } catch {
          if (xhr.status === 413) {
            message = 'File is too large for upload (max 30MB).';
          }
        }
        reject(new Error(message));
      }
    };

    xhr.onerror = () => {
      reject(new Error('Network error while uploading media file.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Upload timed out. Please try again.'));
    };

    xhr.timeout = 60000;
    xhr.send(blob);
  });
}

export async function uploadChatMedia(
  conversationId: string,
  senderId: string,
  file: File | Blob,
  fileName: string,
  onProgress?: (pct: number) => void
): Promise<MediaUploadResult> {
  const initialCleanName = fileName.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120);
  const initialMime = resolveMimeType(initialCleanName, file.type);

  const prepared = await optimizeImageIfNeeded(
    file,
    initialCleanName,
    initialMime
  );
  const storagePath = `chats/${conversationId}/${senderId}/${Date.now()}_${prepared.fileName}`;

  try {
    const url = await uploadViaFirebaseStorage(
      storagePath,
      prepared.blob,
      prepared.mimeType,
      onProgress
    );
    return {
      url,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      size: prepared.blob.size,
      provider: 'firebase-storage',
    };
  } catch {
    // Fallback to authenticated Express endpoint when Firebase Storage billing/rules are not yet enabled in Console
    return uploadViaServerRelay(
      conversationId,
      prepared.fileName,
      prepared.blob,
      prepared.mimeType,
      onProgress
    );
  }
}

export async function uploadUserAvatar(
  userId: string,
  file: File
): Promise<string> {
  const cleanName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 80);
  const initialMime = resolveMimeType(cleanName, file.type || 'image/jpeg');
  const prepared = await optimizeImageIfNeeded(
    file,
    cleanName,
    initialMime,
    512,
    350 * 1024
  );
  const storagePath = `avatars/${userId}/${Date.now()}_${prepared.fileName}`;

  try {
    return await uploadViaFirebaseStorage(
      storagePath,
      prepared.blob,
      prepared.mimeType
    );
  } catch {
    const res = await uploadViaServerRelay(
      `avatar_${userId}`,
      prepared.fileName,
      prepared.blob,
      prepared.mimeType
    );
    return res.url;
  }
}
