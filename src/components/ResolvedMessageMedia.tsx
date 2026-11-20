import { useEffect, useState } from 'react';
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  RefreshCw,
  Video,
} from 'lucide-react';
import { formatDuration, formatFileSize, useResolvedMediaUrl } from '../lib/media';
import type { ChatMessage } from '../types/chat';

interface ResolvedMessageMediaProps {
  msg: ChatMessage;
  isOwn: boolean;
  onOpenLightbox: (url: string) => void;
}

export function ResolvedMessageMedia({
  msg,
  isOwn,
  onOpenLightbox,
}: ResolvedMessageMediaProps) {
  const [retryNonce, setRetryNonce] = useState(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const { resolvedUrl, loading, error } = useResolvedMediaUrl(
    msg.mediaUrl,
    retryNonce
  );

  useEffect(() => {
    setMediaFailed(false);
  }, [resolvedUrl, retryNonce]);

  const handleRetry = () => {
    setMediaFailed(false);
    setRetryNonce((n) => n + 1);
  };

  if (!msg.mediaUrl) return null;

  const fallbackClass = `mb-1.5 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs ${
    isOwn
      ? 'bg-white/15 text-indigo-50'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  }`;

  if (loading) {
    if (msg.type === 'image') {
      return (
        <div
          className={`mb-1.5 flex h-44 w-56 animate-pulse flex-col items-center justify-center gap-2 rounded-xl text-xs ${
            isOwn
              ? 'bg-white/15 text-indigo-100'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading photo...</span>
        </div>
      );
    }
    return (
      <div className={fallbackClass}>
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>
            {msg.type === 'audio'
              ? 'Loading voice message...'
              : msg.type === 'video'
                ? 'Loading video...'
                : 'Loading attachment...'}
          </span>
        </div>
      </div>
    );
  }

  if (error || mediaFailed || !resolvedUrl) {
    const label =
      msg.type === 'image'
        ? `Photo unavailable (${msg.mediaName || 'image'})`
        : msg.type === 'audio'
          ? `Voice message unavailable${
              typeof msg.audioDuration === 'number'
                ? ` (${formatDuration(msg.audioDuration)})`
                : ''
            }`
          : msg.type === 'video'
            ? `Video unavailable (${msg.mediaName || 'video'})`
            : `File unavailable (${msg.mediaName || 'attachment'})`;

    const Icon =
      msg.type === 'image'
        ? ImageIcon
        : msg.type === 'audio'
          ? Mic
          : msg.type === 'video'
            ? Video
            : FileText;

    return (
      <div className={fallbackClass}>
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
            isOwn
              ? 'bg-white/20 text-white hover:bg-white/30'
              : 'bg-white text-slate-700 shadow-xs hover:bg-slate-50 dark:bg-slate-700 dark:text-slate-100'
          }`}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (msg.type === 'image') {
    return (
      <button
        type="button"
        onClick={() => onOpenLightbox(resolvedUrl)}
        className="mb-1.5 block overflow-hidden rounded-xl"
      >
        <img
          src={resolvedUrl}
          alt={msg.mediaName || 'Shared image'}
          referrerPolicy="no-referrer"
          onError={() => setMediaFailed(true)}
          className="max-h-72 w-auto rounded-xl object-cover transition-transform duration-200 hover:scale-[1.02]"
        />
      </button>
    );
  }

  if (msg.type === 'video') {
    return (
      <video
        key={resolvedUrl}
        src={resolvedUrl}
        controls
        playsInline
        onError={() => setMediaFailed(true)}
        className="mb-1.5 max-h-72 w-full rounded-xl bg-black"
      />
    );
  }

  if (msg.type === 'audio') {
    return (
      <div className="flex items-center gap-2.5 py-0.5">
        <audio
          key={resolvedUrl}
          src={resolvedUrl}
          controls
          preload="metadata"
          onError={() => setMediaFailed(true)}
          className="h-9 max-w-[230px] sm:max-w-[260px]"
        />
        {typeof msg.audioDuration === 'number' && (
          <span className="rounded-md bg-black/10 px-1.5 py-0.5 font-mono text-[11px] opacity-90 tabular-nums dark:bg-white/10">
            {formatDuration(msg.audioDuration)}
          </span>
        )}
      </div>
    );
  }

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noreferrer"
      download={msg.mediaName}
      className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs font-medium transition-colors ${
        isOwn
          ? 'bg-white/15 text-white hover:bg-white/25'
          : 'bg-slate-100 text-slate-800 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
          isOwn
            ? 'bg-white/20 text-white'
            : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400'
        }`}
      >
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {msg.mediaName || 'Attachment'}
        </p>
        <p className="font-mono text-[10px] opacity-75 tabular-nums">
          {formatFileSize(msg.mediaSize)}
        </p>
      </div>
      <Download className="h-4 w-4 shrink-0 opacity-80" />
    </a>
  );
}
