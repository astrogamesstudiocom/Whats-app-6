import { useEffect, useState } from 'react';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage';
import { auth, db, storage } from './firebase';

export interface MediaUploadResult {
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  provider: 'firebase-storage' | 'firestore-media' | 'server-relay';
}

const FIRESTORE_MEDIA_PREFIX = 'mcw-media://';
// 375 KB binary ~= 500,000 base64 chars, comfortably under 550,000 rule max & 1 MiB doc limit
const RAW_CHUNK_BYTES = 375 * 1024;
const MAX_FIRESTORE_BINARY_BYTES = 7.5 * 1024 * 1024; // 20 chunks max
const MAX_AVATAR_BINARY_BYTES = 480 * 1024; // ~640,000 base64 chars <= 680,000 rule max

// Cache whether Firebase Storage bucket is unavailable (e.g. 404 unprovisioned)
// so subsequent photo/voice uploads route immediately without waiting.
let firebaseStorageUnavailable = false;

// Cache resolved object URLs for mcw-media:// URIs across components
const resolvedMediaCache = new Map<string, string>();
const inFlightResolutions = new Map<string, Promise<string>>();

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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const sliceSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += sliceSize) {
    const chunk = bytes.subarray(i, Math.min(i + sliceSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const len = binary.length;
  const buffer = new ArrayBuffer(len);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function makeMediaId(prefix: string): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}_${Date.now()}_${rand}`;
}

async function optimizeImageIfNeeded(
  blob: Blob,
  fileName: string,
  mimeType: string,
  maxDimension = 1600,
  sizeThresholdBytes = 300 * 1024,
  quality = 0.82
): Promise<{ blob: Blob; fileName: string; mimeType: string }> {
  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  const compressibleTypes = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/bmp',
    'image/heic',
    'image/heif',
  ];
  if (!compressibleTypes.includes(cleanMime) || blob.size <= sizeThresholdBytes) {
    return { blob, fileName, mimeType };
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });

    const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob, fileName, mimeType };

    ctx.drawImage(img, 0, 0, targetW, targetH);

    const outMime = cleanMime === 'image/png' ? 'image/webp' : 'image/jpeg';
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, outMime, quality)
    );
    if (!compressed || compressed.size >= blob.size) {
      return { blob, fileName, mimeType };
    }

    const baseName = fileName.replace(/\.[^.]+$/, '') || 'photo';
    const ext = outMime === 'image/webp' ? 'webp' : 'jpg';
    return {
      blob: compressed,
      fileName: `${baseName}.${ext}`,
      mimeType: outMime,
    };
  } catch {
    return { blob, fileName, mimeType };
  } finally {
    URL.revokeObjectURL(objectUrl);
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

async function uploadViaFirestoreMedia(
  conversationId: string,
  senderId: string,
  fileName: string,
  blob: Blob,
  mimeType: string,
  onProgress?: (pct: number) => void
): Promise<MediaUploadResult> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('Cannot upload an empty media file.');
  }
  if (bytes.length > MAX_FIRESTORE_BINARY_BYTES) {
    throw new Error('File exceeds persistent Firestore media threshold.');
  }

  const chunkCount = Math.ceil(bytes.length / RAW_CHUNK_BYTES);
  const mediaId = makeMediaId('med');
  const safeName = (fileName || 'attachment').slice(0, 255);
  const safeMime = (mimeType || 'application/octet-stream').slice(0, 120);

  onProgress?.(18);

  const blobDocRef = doc(db, 'conversations', conversationId, 'mediaBlobs', mediaId);
  await setDoc(blobDocRef, {
    id: mediaId,
    conversationId,
    uploaderUid: senderId,
    fileName: safeName,
    mimeType: safeMime,
    size: bytes.length,
    chunkCount,
    createdAt: serverTimestamp(),
  });

  // Upload chunks in small batches of 3 to stay comfortably below 10 MiB Firestore batch limit
  const BATCH_CHUNK_SIZE = 3;
  for (let startIdx = 0; startIdx < chunkCount; startIdx += BATCH_CHUNK_SIZE) {
    const batch = writeBatch(db);
    const endIdx = Math.min(startIdx + BATCH_CHUNK_SIZE, chunkCount);

    for (let idx = startIdx; idx < endIdx; idx++) {
      const sliceStart = idx * RAW_CHUNK_BYTES;
      const sliceEnd = Math.min(sliceStart + RAW_CHUNK_BYTES, bytes.length);
      const b64 = uint8ArrayToBase64(bytes.subarray(sliceStart, sliceEnd));
      const chunkRef = doc(
        db,
        'conversations',
        conversationId,
        'mediaBlobs',
        mediaId,
        'chunks',
        `chunk_${idx}`
      );
      batch.set(chunkRef, {
        index: idx,
        uploaderUid: senderId,
        data: b64,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
    const pct = Math.min(95, Math.round(20 + (endIdx / chunkCount) * 75));
    onProgress?.(pct);
  }

  // Pre-seed local object URL cache so sender sees instant playback/preview without extra reads
  const internalUrl = `${FIRESTORE_MEDIA_PREFIX}conv/${conversationId}/${mediaId}`;
  const previewBlob = new Blob([bytes], { type: safeMime });
  resolvedMediaCache.set(internalUrl, URL.createObjectURL(previewBlob));
  onProgress?.(100);

  return {
    url: internalUrl,
    fileName: safeName,
    mimeType: safeMime,
    size: bytes.length,
    provider: 'firestore-media',
  };
}

async function uploadAvatarViaFirestore(
  userId: string,
  blob: Blob,
  mimeType: string
): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('Cannot upload an empty profile photo.');
  }
  if (bytes.length > MAX_AVATAR_BINARY_BYTES) {
    throw new Error('Profile photo is too large even after optimization. Please choose a smaller image.');
  }

  const cleanMime = mimeType.split(';')[0].trim().toLowerCase();
  const safeMime = cleanMime.startsWith('image/') ? cleanMime : 'image/jpeg';
  const mediaId = makeMediaId('avt');
  const b64 = uint8ArrayToBase64(bytes);

  await setDoc(doc(db, 'avatarMedia', mediaId), {
    id: mediaId,
    uploaderUid: userId,
    mimeType: safeMime,
    size: bytes.length,
    data: b64,
    createdAt: serverTimestamp(),
  });

  const internalUrl = `${FIRESTORE_MEDIA_PREFIX}avatar/${mediaId}`;
  resolvedMediaCache.set(
    internalUrl,
    URL.createObjectURL(new Blob([bytes], { type: safeMime }))
  );
  return internalUrl;
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

export async function resolveMediaUrl(rawUrl: string): Promise<string> {
  if (!rawUrl) return '';
  if (!rawUrl.startsWith(FIRESTORE_MEDIA_PREFIX)) {
    return rawUrl;
  }

  const cached = resolvedMediaCache.get(rawUrl);
  if (cached) return cached;

  const existingPromise = inFlightResolutions.get(rawUrl);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    const suffix = rawUrl.slice(FIRESTORE_MEDIA_PREFIX.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts[0] === 'conv' && parts.length === 3) {
      const [, conversationId, mediaId] = parts;
      const metaSnap = await getDoc(
        doc(db, 'conversations', conversationId, 'mediaBlobs', mediaId)
      );
      if (!metaSnap.exists()) {
        throw new Error('Media metadata not found.');
      }
      const meta = metaSnap.data() as {
        mimeType?: string;
        chunkCount?: number;
      };
      const chunkCount = Math.max(1, Number(meta.chunkCount || 1));
      const chunkIndices = Array.from({ length: chunkCount }, (_, i) => i);

      const chunkSnaps = await Promise.all(
        chunkIndices.map((idx) =>
          getDoc(
            doc(
              db,
              'conversations',
              conversationId,
              'mediaBlobs',
              mediaId,
              'chunks',
              `chunk_${idx}`
            )
          )
        )
      );

      const binaryParts: Uint8Array<ArrayBuffer>[] = chunkSnaps.map((snap) => {
        if (!snap.exists()) {
          throw new Error('Media chunk is missing.');
        }
        const chunkData = snap.data()?.data as string | undefined;
        if (!chunkData) {
          throw new Error('Media chunk data is empty.');
        }
        return base64ToUint8Array(chunkData);
      });

      const assembledBlob = new Blob(binaryParts, {
        type: meta.mimeType || 'application/octet-stream',
      });
      const objectUrl = URL.createObjectURL(assembledBlob);
      resolvedMediaCache.set(rawUrl, objectUrl);
      return objectUrl;
    }

    if (parts[0] === 'avatar' && parts.length === 2) {
      const [, mediaId] = parts;
      const snap = await getDoc(doc(db, 'avatarMedia', mediaId));
      if (!snap.exists()) {
        throw new Error('Avatar image not found.');
      }
      const data = snap.data() as { mimeType?: string; data?: string };
      if (!data.data) {
        throw new Error('Avatar payload empty.');
      }
      const bytes = base64ToUint8Array(data.data);
      const blob = new Blob([bytes], { type: data.mimeType || 'image/jpeg' });
      const objectUrl = URL.createObjectURL(blob);
      resolvedMediaCache.set(rawUrl, objectUrl);
      return objectUrl;
    }

    throw new Error('Unsupported media URI.');
  })();

  inFlightResolutions.set(rawUrl, promise);
  try {
    return await promise;
  } finally {
    inFlightResolutions.delete(rawUrl);
  }
}

export function useResolvedMediaUrl(
  rawUrl?: string,
  retryNonce = 0
): {
  resolvedUrl: string | null;
  loading: boolean;
  error: string | null;
} {
  const isInternal = Boolean(rawUrl && rawUrl.startsWith(FIRESTORE_MEDIA_PREFIX));
  const syncCached = rawUrl
    ? isInternal
      ? resolvedMediaCache.get(rawUrl) || null
      : rawUrl
    : null;

  const [state, setState] = useState<{
    source: string | undefined;
    resolvedUrl: string | null;
    loading: boolean;
    error: string | null;
  }>({
    source: rawUrl,
    resolvedUrl: syncCached,
    loading: Boolean(rawUrl && isInternal && !syncCached),
    error: null,
  });

  useEffect(() => {
    if (!rawUrl) {
      setState({
        source: rawUrl,
        resolvedUrl: null,
        loading: false,
        error: null,
      });
      return;
    }

    if (!rawUrl.startsWith(FIRESTORE_MEDIA_PREFIX)) {
      setState({
        source: rawUrl,
        resolvedUrl: rawUrl,
        loading: false,
        error: null,
      });
      return;
    }

    if (retryNonce > 0) {
      resolvedMediaCache.delete(rawUrl);
      inFlightResolutions.delete(rawUrl);
    }

    const immediate = resolvedMediaCache.get(rawUrl);
    if (immediate) {
      setState({
        source: rawUrl,
        resolvedUrl: immediate,
        loading: false,
        error: null,
      });
      return;
    }

    let cancelled = false;
    setState({
      source: rawUrl,
      resolvedUrl: null,
      loading: true,
      error: null,
    });

    resolveMediaUrl(rawUrl)
      .then((url) => {
        if (!cancelled) {
          setState({
            source: rawUrl,
            resolvedUrl: url,
            loading: false,
            error: null,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            source: rawUrl,
            resolvedUrl: null,
            loading: false,
            error: err instanceof Error ? err.message : 'Unable to load media.',
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rawUrl, retryNonce]);

  if (!rawUrl) {
    return { resolvedUrl: null, loading: false, error: null };
  }
  if (!isInternal) {
    return { resolvedUrl: rawUrl, loading: false, error: null };
  }
  if (state.source !== rawUrl) {
    const cached = resolvedMediaCache.get(rawUrl) || null;
    return {
      resolvedUrl: cached,
      loading: !cached,
      error: null,
    };
  }
  return {
    resolvedUrl: state.resolvedUrl,
    loading: state.loading,
    error: state.error,
  };
}

export async function uploadChatMedia(
  conversationId: string,
  senderId: string,
  file: File | Blob,
  fileName: string,
  onProgress?: (pct: number) => void
): Promise<MediaUploadResult> {
  const initialCleanName =
    fileName.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 120) || 'attachment';
  const initialMime = resolveMimeType(initialCleanName, file.type);

  const prepared = await optimizeImageIfNeeded(
    file,
    initialCleanName,
    initialMime,
    1600,
    300 * 1024,
    0.82
  );

  // Guard empty blobs early
  if (prepared.blob.size === 0) {
    throw new Error('Selected media file is empty.');
  }

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
    // Primary persistent fallback across dev & shared previews: chunked Firestore media (up to 7.5 MB)
    if (prepared.blob.size <= MAX_FIRESTORE_BINARY_BYTES) {
      return uploadViaFirestoreMedia(
        conversationId,
        senderId,
        prepared.fileName,
        prepared.blob,
        prepared.mimeType,
        onProgress
      );
    }
    // Large videos/documents (> 7.5 MB) fall back to Express relay
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
  const cleanName =
    file.name.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 80) || 'avatar.jpg';
  const initialMime = resolveMimeType(cleanName, file.type || 'image/jpeg');
  let prepared = await optimizeImageIfNeeded(
    file,
    cleanName,
    initialMime,
    512,
    240 * 1024,
    0.82
  );
  if (prepared.blob.size > MAX_AVATAR_BINARY_BYTES) {
    prepared = await optimizeImageIfNeeded(
      prepared.blob,
      prepared.fileName,
      prepared.mimeType,
      320,
      120 * 1024,
      0.72
    );
  }
  const storagePath = `avatars/${userId}/${Date.now()}_${prepared.fileName}`;

  try {
    return await uploadViaFirebaseStorage(
      storagePath,
      prepared.blob,
      prepared.mimeType
    );
  } catch {
    if (prepared.blob.size <= MAX_AVATAR_BINARY_BYTES) {
      return uploadAvatarViaFirestore(userId, prepared.blob, prepared.mimeType);
    }
    const res = await uploadViaServerRelay(
      `avatar_${userId}`,
      prepared.fileName,
      prepared.blob,
      prepared.mimeType
    );
    return res.url;
  }
}
