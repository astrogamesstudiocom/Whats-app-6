import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';

interface FirebaseAppletConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig: FirebaseAppletConfig = JSON.parse(
  fs.readFileSync(configPath, 'utf8')
);

const isPlaceholderProject =
  !firebaseConfig.projectId || firebaseConfig.projectId === 'remixed-project-id';

const adminApp = isPlaceholderProject
  ? null
  : getApps().length
    ? getApp()
    : initializeApp({ projectId: firebaseConfig.projectId });

interface AuthedRequest extends Request {
  authUser?: DecodedIdToken;
}

const UPLOAD_ROOT = path.resolve(process.cwd(), '.uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'];
const ALLOWED_EXACT_MIMES = new Set([
  'application/octet-stream',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
]);

function isAllowedMime(mime: string): boolean {
  const clean = mime.split(';')[0].trim().toLowerCase();
  if (ALLOWED_EXACT_MIMES.has(clean)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => clean.startsWith(prefix));
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]/g, '');
}

async function requireVerifiedAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!adminApp) {
    res.status(503).json({ error: 'Firebase project is not provisioned.' });
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Bearer token.' });
    return;
  }

  const idToken = header.slice('Bearer '.length).trim();
  if (!idToken) {
    res.status(401).json({ error: 'Empty Bearer token.' });
    return;
  }

  try {
    const decoded = await getAuth(adminApp).verifyIdToken(idToken);
    if (!decoded.email_verified) {
      res.status(403).json({ error: 'Verified email required.' });
      return;
    }
    req.authUser = decoded;
    next();
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid Firebase ID token.',
    });
  }
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: '2mb' }));

  // Serve Firebase Cloud Messaging Service Worker dynamically with provisioned config
  app.get('/firebase-messaging-sw.js', (_req: Request, res: Response) => {
    const swScript = `
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp(${JSON.stringify({
      apiKey: firebaseConfig.apiKey,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket,
      messagingSenderId: firebaseConfig.messagingSenderId,
      appId: firebaseConfig.appId,
    })});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'My Chatting Web';
  const options = {
    body: (payload.notification && payload.notification.body) || 'New activity in your workspace',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});
`;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(swScript.trim());
  });

  // Public health & infrastructure readiness summary
  app.get('/api/health', (_req: Request, res: Response) => {
    const turnConfigured = Boolean(
      process.env.TURN_SERVER_URLS &&
        process.env.TURN_USERNAME &&
        process.env.TURN_CREDENTIAL
    );
    const vapidConfigured = Boolean(process.env.VITE_FIREBASE_VAPID_KEY);
    res.json({
      ok: true,
      projectId: firebaseConfig.projectId,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
      storageBucket: firebaseConfig.storageBucket,
      turnConfigured,
      vapidConfigured,
    });
  });

  // Authenticated ICE/STUN/TURN server configuration endpoint
  app.get(
    '/api/ice-servers',
    requireVerifiedAuth,
    (_req: AuthedRequest, res: Response) => {
      const iceServers: Array<{
        urls: string | string[];
        username?: string;
        credential?: string;
      }> = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ];

      const turnUrls = process.env.TURN_SERVER_URLS;
      const turnUsername = process.env.TURN_USERNAME;
      const turnCredential = process.env.TURN_CREDENTIAL;

      const turnConfigured = Boolean(turnUrls && turnUsername && turnCredential);
      if (turnConfigured && turnUrls && turnUsername && turnCredential) {
        iceServers.push({
          urls: turnUrls
            .split(',')
            .map((u) => u.trim())
            .filter(Boolean),
          username: turnUsername,
          credential: turnCredential,
        });
      }

      res.json({
        iceServers,
        turnConfigured,
      });
    }
  );

  // Authenticated server-side media relay upload (used when Firebase Storage bucket requires Blaze billing)
  app.post(
    '/api/media/upload',
    requireVerifiedAuth,
    express.raw({ type: '*/*', limit: '35mb' }),
    (req: AuthedRequest, res: Response) => {
      const conversationId = sanitizeId(
        String(req.headers['x-conversation-id'] || '')
      );
      const originalName = String(req.headers['x-file-name'] || 'attachment')
        .replace(/[^a-zA-Z0-9._\- ]/g, '_')
        .slice(0, 120);
      const mimeType = String(
        req.headers['content-type'] || 'application/octet-stream'
      );

      if (!conversationId) {
        res.status(400).json({ error: 'Missing valid x-conversation-id header.' });
        return;
      }

      if (!isAllowedMime(mimeType)) {
        res.status(415).json({ error: `Unsupported media type: ${mimeType}` });
        return;
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Empty upload payload.' });
        return;
      }

      if (body.length > 35 * 1024 * 1024) {
        res.status(413).json({ error: 'File exceeds 35MB server limit.' });
        return;
      }

      const convDir = path.join(UPLOAD_ROOT, conversationId);
      fs.mkdirSync(convDir, { recursive: true });

      const ext = path.extname(originalName).slice(0, 12);
      const safeFileId = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
      const diskPath = path.join(convDir, safeFileId);
      fs.writeFileSync(diskPath, body);

      // Write metadata sidecar for content-type restoration
      fs.writeFileSync(
        `${diskPath}.meta.json`,
        JSON.stringify({
          mimeType,
          originalName,
          uploadedBy: req.authUser?.uid || 'unknown',
          size: body.length,
        })
      );

      res.json({
        url: `/api/media/file/${conversationId}/${safeFileId}`,
        size: body.length,
        mimeType,
        fileName: originalName,
      });
    }
  );

  // Authenticated media fetch
  app.get(
    '/api/media/file/:conversationId/:fileId',
    (req: Request, res: Response) => {
      const conversationId = sanitizeId(String(req.params.conversationId || ''));
      const fileId = path.basename(String(req.params.fileId || ''));
      if (!conversationId || !fileId || fileId.includes('..')) {
        res.status(400).json({ error: 'Invalid media identifier.' });
        return;
      }

      const diskPath = path.join(UPLOAD_ROOT, conversationId, fileId);
      if (!fs.existsSync(diskPath)) {
        res.status(404).json({ error: 'Media file not found.' });
        return;
      }

      const metaPath = `${diskPath}.meta.json`;
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          if (meta.mimeType) {
            res.setHeader('Content-Type', meta.mimeType);
          }
        } catch {
          // ignore malformed meta
        }
      }

      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.sendFile(diskPath);
    }
  );

  // Vite dev middleware or static production build
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`My Chatting Web server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
