import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  Check,
  CheckCheck,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Music,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Reply,
  Send,
  Smile,
  Square,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { EmojiPicker } from './EmojiPicker';
import { ResolvedMessageMedia } from './ResolvedMessageMedia';
import { formatDuration, uploadChatMedia } from '../lib/media';
import { getWallpaperClass, type ChatWallpaperId } from '../lib/theme';
import {
  editMessage,
  markConversationDelivered,
  markConversationRead,
  sendMessage,
  setTypingState,
  softDeleteMessage,
  subscribeConversation,
  subscribeConversationMembers,
  subscribeMessages,
  subscribeTypingIndicators,
} from '../services/chatService';
import type {
  CallMode,
  CallType,
  ChatMessage,
  Conversation,
  ConversationMember,
  ConversationRef,
  MessageType,
  TypingIndicator,
  UserProfile,
} from '../types/chat';

interface ChatWindowProps {
  conversationRef: ConversationRef | null;
  currentUser: UserProfile;
  usersById: Map<string, UserProfile>;
  wallpaper: ChatWallpaperId;
  onStartCall: (params: {
    conversationId: string;
    conversationTitle: string;
    callType: CallType;
    mode: CallMode;
    recipients: Array<{ uid: string; displayName: string; photoURL?: string }>;
  }) => void;
  onBackMobile?: () => void;
}

function formatMessageTime(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLastSeen(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return 'Offline';
  const d = ts.toDate();
  return `Last seen ${d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  })} at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function ChatWindow({
  conversationRef,
  currentUser,
  usersById,
  wallpaper,
  onStartCall,
  onBackMobile,
}: ChatWindowProps) {
  const conversationId = conversationRef?.conversationId || null;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [members, setMembers] = useState<ConversationMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typingList, setTypingList] = useState<TypingIndicator[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [showMembersDrawer, setShowMembersDrawer] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Voice Note Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const sendingVoiceRef = useRef(false);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const emojiContainerRef = useRef<HTMLDivElement | null>(null);
  const attachContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const stopActiveStream = () => {
    if (activeStreamRef.current) {
      for (const track of activeStreamRef.current.getTracks()) {
        track.stop();
      }
      activeStreamRef.current = null;
    }
  };

  // Subscribe to active conversation, members, messages, typing
  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      setMembers([]);
      setMessages([]);
      setTypingList([]);
      return;
    }

    const unsubConv = subscribeConversation(conversationId, setConversation);
    const unsubMembers = subscribeConversationMembers(conversationId, setMembers);
    const unsubMsgs = subscribeMessages(conversationId, (msgs) => {
      setMessages(msgs);
      void markConversationRead(conversationId, currentUser.uid);
    });
    const unsubTyping = subscribeTypingIndicators(conversationId, setTypingList);

    void markConversationDelivered(conversationId, currentUser.uid);
    void markConversationRead(conversationId, currentUser.uid);

    return () => {
      unsubConv();
      unsubMembers();
      unsubMsgs();
      unsubTyping();
    };
  }, [conversationId, currentUser.uid]);

  // Close popovers on outside click / Escape
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        showEmojiPicker &&
        emojiContainerRef.current &&
        !emojiContainerRef.current.contains(target)
      ) {
        setShowEmojiPicker(false);
      }
      if (
        showAttachMenu &&
        attachContainerRef.current &&
        !attachContainerRef.current.contains(target)
      ) {
        setShowAttachMenu(false);
      }
    };
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowEmojiPicker(false);
        setShowAttachMenu(false);
        setLightboxUrl(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showEmojiPicker, showAttachMenu]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, conversationId]);

  // Cleanup recorder & typing on unmount/switch
  useEffect(() => {
    setShowEmojiPicker(false);
    setShowAttachMenu(false);
    setUploadNotice(null);
    return () => {
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          // ignore cleanup stop errors
        }
      }
      stopActiveStream();
    };
  }, [conversationId]);

  const otherMembers = useMemo(
    () => members.filter((m) => m.uid !== currentUser.uid),
    [members, currentUser.uid]
  );

  const peerProfile = useMemo(() => {
    if (conversationRef?.type !== 'direct') return undefined;
    const peerUid = conversationRef.peerUid || otherMembers[0]?.uid;
    return peerUid ? usersById.get(peerUid) : undefined;
  }, [conversationRef, otherMembers, usersById]);

  const headerTitle =
    peerProfile?.displayName ||
    conversation?.title ||
    conversationRef?.title ||
    'Conversation';

  const headerPhoto =
    peerProfile?.photoURL ||
    conversation?.iconURL ||
    conversationRef?.iconURL ||
    conversationRef?.peerPhotoURL;

  const activeTypers = useMemo(() => {
    const cutoff = Date.now() - 12000;
    return typingList.filter((t) => {
      if (t.uid === currentUser.uid || !t.isTyping) return false;
      if (!t.updatedAt) return true;
      return t.updatedAt.toMillis() >= cutoff;
    });
  }, [typingList, currentUser.uid]);

  const memberUids = useMemo(() => {
    const set = new Set(members.map((m) => m.uid));
    set.add(currentUser.uid);
    if (conversationRef?.peerUid) set.add(conversationRef.peerUid);
    return Array.from(set);
  }, [members, currentUser.uid, conversationRef?.peerUid]);

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (!conversationId) return;

    void setTypingState(
      conversationId,
      currentUser.uid,
      currentUser.displayName,
      val.trim().length > 0
    );

    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    if (val.trim().length > 0) {
      typingTimeoutRef.current = window.setTimeout(() => {
        void setTypingState(
          conversationId,
          currentUser.uid,
          currentUser.displayName,
          false
        );
      }, 2800);
    }
  };

  const handleEmojiSelect = (emoji: string) => {
    const next = `${draft}${emoji}`;
    handleDraftChange(next);
    textAreaRef.current?.focus();
  };

  const handleSendText = async () => {
    if (!conversationId || sending) return;
    const trimmed = draft.trim();
    if (!trimmed) return;

    setSending(true);
    setShowEmojiPicker(false);
    try {
      if (editingMsg) {
        await editMessage(conversationId, editingMsg.id, trimmed);
        setEditingMsg(null);
      } else {
        await sendMessage({
          conversationId,
          sender: currentUser,
          memberUids,
          type: 'text',
          text: trimmed,
          replyToId: replyTo?.id,
          replyToPreview: replyTo
            ? `${replyTo.senderName}: ${replyTo.text || replyTo.mediaName || replyTo.type}`
            : undefined,
        });
        setReplyTo(null);
      }
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendText();
    }
  };

  const triggerAttachmentPicker = (kind: 'photo' | 'audio' | 'doc') => {
    setShowAttachMenu(false);
    if (kind === 'photo') photoInputRef.current?.click();
    else if (kind === 'audio') audioInputRef.current?.click();
    else docInputRef.current?.click();
  };

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !conversationId) return;

    setUploadNotice(null);
    setUploadProgress(5);
    try {
      const uploaded = await uploadChatMedia(
        conversationId,
        currentUser.uid,
        file,
        file.name || `upload_${Date.now()}`,
        (pct) => setUploadProgress(pct)
      );

      let msgType: MessageType = 'document';
      if (uploaded.mimeType.startsWith('image/')) msgType = 'image';
      else if (uploaded.mimeType.startsWith('video/')) msgType = 'video';
      else if (uploaded.mimeType.startsWith('audio/')) msgType = 'audio';

      await sendMessage({
        conversationId,
        sender: currentUser,
        memberUids,
        type: msgType,
        text: draft.trim(),
        mediaUrl: uploaded.url,
        mediaName: uploaded.fileName,
        mediaMime: uploaded.mimeType,
        mediaSize: uploaded.size,
      });
      setDraft('');
    } catch (err) {
      setUploadNotice(
        err instanceof Error ? err.message : 'Failed to upload attachment.'
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const startVoiceRecording = async () => {
    if (!conversationId || isRecording) return;
    setUploadNotice(null);
    setShowEmojiPicker(false);
    setShowAttachMenu(false);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      setUploadNotice(
        'Voice recording is not supported in this browser or context.'
      );
      return;
    }

    try {
      stopActiveStream();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      activeStreamRef.current = stream;

      const candidateMimes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const preferredMime =
        typeof MediaRecorder.isTypeSupported === 'function'
          ? candidateMimes.find((m) => MediaRecorder.isTypeSupported(m)) || ''
          : '';

      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          audioChunksRef.current.push(ev.data);
        }
      };
      recorder.onerror = () => {
        stopActiveStream();
        setIsRecording(false);
        setUploadNotice('Voice recorder encountered a microphone error.');
      };
      recorder.onstop = () => {
        stopActiveStream();
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);
      recordStartRef.current = Date.now();
      setRecordSeconds(0);
      setIsRecording(true);
      recordTimerRef.current = window.setInterval(() => {
        setRecordSeconds(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 500);
    } catch (err) {
      stopActiveStream();
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setUploadNotice(
          'Microphone permission was denied. Allow mic access in your browser to send voice messages.'
        );
      } else if (name === 'NotFoundError') {
        setUploadNotice('No microphone device was detected.');
      } else {
        setUploadNotice(
          err instanceof Error
            ? `Unable to access microphone: ${err.message}`
            : 'Microphone permission is required to record voice messages.'
        );
      }
    }
  };

  const cancelVoiceRecording = () => {
    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        stopActiveStream();
      };
      try {
        recorder.stop();
      } catch {
        stopActiveStream();
      }
    } else {
      stopActiveStream();
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    setIsRecording(false);
    setRecordSeconds(0);
  };

  const finishAndSendVoice = async () => {
    if (!conversationId || !mediaRecorderRef.current || sendingVoiceRef.current) {
      return;
    }
    sendingVoiceRef.current = true;
    const recorder = mediaRecorderRef.current;
    const durationSec = Math.max(
      1,
      Math.round((Date.now() - recordStartRef.current) / 1000)
    );

    if (recordTimerRef.current) {
      window.clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    try {
      if (recorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            stopActiveStream();
            resolve();
          };
          const safetyTimer = window.setTimeout(finish, 2000);
          const prevOnStop = recorder.onstop;
          recorder.onstop = (ev) => {
            window.clearTimeout(safetyTimer);
            if (typeof prevOnStop === 'function') {
              prevOnStop.call(recorder, ev);
            }
            finish();
          };
          try {
            if (typeof recorder.requestData === 'function') {
              recorder.requestData();
            }
            recorder.stop();
          } catch {
            window.clearTimeout(safetyTimer);
            finish();
          }
        });
      } else {
        stopActiveStream();
      }

      mediaRecorderRef.current = null;
      setIsRecording(false);
      setRecordSeconds(0);

      const mime = recorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm';
      const blob = new Blob(audioChunksRef.current, { type: mime });
      audioChunksRef.current = [];
      if (blob.size === 0) {
        setUploadNotice(
          'No audio was captured. Record for at least 1 second before sending.'
        );
        return;
      }

      setUploadProgress(15);
      const ext = mime.includes('mp4')
        ? 'm4a'
        : mime.includes('ogg')
          ? 'ogg'
          : 'webm';
      const uploaded = await uploadChatMedia(
        conversationId,
        currentUser.uid,
        blob,
        `voice_${Date.now()}.${ext}`,
        (pct) => setUploadProgress(pct)
      );
      await sendMessage({
        conversationId,
        sender: currentUser,
        memberUids,
        type: 'audio',
        text: '',
        mediaUrl: uploaded.url,
        mediaName: uploaded.fileName,
        mediaMime: uploaded.mimeType,
        mediaSize: uploaded.size,
        audioDuration: durationSec,
      });
    } catch (err) {
      setUploadNotice(
        err instanceof Error ? err.message : 'Failed to upload voice note.'
      );
    } finally {
      sendingVoiceRef.current = false;
      setUploadProgress(null);
    }
  };

  const getMessageReceipt = (msg: ChatMessage): 'sent' | 'delivered' | 'read' => {
    if (!msg.createdAt || otherMembers.length === 0) return 'sent';
    const msgMs = msg.createdAt.toMillis();
    const anyRead = otherMembers.some(
      (m) => m.lastReadAt && m.lastReadAt.toMillis() >= msgMs
    );
    if (anyRead) return 'read';
    const anyDelivered = otherMembers.some(
      (m) => m.lastDeliveredAt && m.lastDeliveredAt.toMillis() >= msgMs
    );
    return anyDelivered ? 'delivered' : 'sent';
  };

  const triggerCall = (callType: CallType) => {
    if (!conversationId || otherMembers.length === 0) return;
    onStartCall({
      conversationId,
      conversationTitle: headerTitle,
      callType,
      mode: conversationRef?.type === 'group' ? 'group' : 'direct',
      recipients: otherMembers.map((m) => ({
        uid: m.uid,
        displayName: m.displayName,
        photoURL: m.photoURL,
      })),
    });
  };

  const wallpaperClass = getWallpaperClass(wallpaper);

  if (!conversationRef || !conversationId) {
    return (
      <main
        className={`theme-canvas relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-slate-50 p-8 text-center dark:bg-slate-950 ${wallpaperClass}`}
      >
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-100/40 dark:to-slate-950/60" />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="theme-surface relative z-10 max-w-md rounded-3xl border border-slate-200/80 bg-white/85 p-8 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/85"
        >
          <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-3xl border border-indigo-200/60 shadow-lg shadow-indigo-600/15 dark:border-indigo-900/50">
            <img
              src="/src/assets/images/empty_channel_emblem_1794977212291.jpg"
              alt="My Chatting Web studio emblem"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
          <h2 className="mt-6 font-display text-xl font-bold text-slate-900 dark:text-white">
            Select a conversation
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Choose a thread from the sidebar or jump into Friends and Communities to start messaging, sharing media, and launching HD WebRTC calls.
          </p>
        </motion.div>
      </main>
    );
  }

  return (
    <main className="theme-canvas relative flex min-w-0 flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      {/* Top Bar */}
      <header className="theme-surface z-20 flex items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6 dark:border-slate-800/80 dark:bg-slate-900/90">
        <div className="flex min-w-0 items-center gap-3">
          {onBackMobile && (
            <button
              type="button"
              onClick={onBackMobile}
              aria-label="Back to conversations"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <Avatar
            name={headerTitle}
            src={headerPhoto}
            size="md"
            isGroup={conversationRef.type === 'group'}
            ring={
              conversationRef.type === 'direct' && Boolean(peerProfile?.online)
            }
            online={
              conversationRef.type === 'direct'
                ? Boolean(peerProfile?.online)
                : undefined
            }
          />
          <div className="min-w-0">
            <h1 className="truncate font-display text-sm font-bold text-slate-900 sm:text-base dark:text-white">
              {headerTitle}
            </h1>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {activeTypers.length > 0 ? (
                <span className="font-medium text-indigo-600 dark:text-indigo-400">
                  {activeTypers.map((t) => t.displayName).join(', ')}{' '}
                  {activeTypers.length === 1 ? 'is' : 'are'} typing...
                </span>
              ) : conversationRef.type === 'group' ? (
                <span>{members.length} members</span>
              ) : peerProfile?.online ? (
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  Online
                </span>
              ) : (
                <span>{formatLastSeen(peerProfile?.lastSeen)}</span>
              )}
              {activeTypers.length === 0 && peerProfile?.statusText
                ? ` · ${peerProfile.statusText}`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={otherMembers.length === 0}
            onClick={() => triggerCall('audio')}
            title="Start Audio Call"
            aria-label="Start Audio Call"
            className="flex h-10 items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 text-xs font-semibold text-slate-700 shadow-xs transition-all hover:border-indigo-200 hover:bg-indigo-50/70 hover:text-indigo-600 active:scale-[0.97] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <Phone className="h-4 w-4" />
            <span className="hidden sm:inline">Voice</span>
          </button>
          <button
            type="button"
            disabled={otherMembers.length === 0}
            onClick={() => triggerCall('video')}
            title="Start Video Call"
            aria-label="Start Video Call"
            className="flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-3.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-40 whitespace-nowrap"
          >
            <Video className="h-4 w-4" />
            <span className="hidden sm:inline">Video</span>
          </button>
          {conversationRef.type === 'group' && (
            <button
              type="button"
              onClick={() => setShowMembersDrawer((v) => !v)}
              title="Channel Members"
              aria-label="Channel Members"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
                showMembersDrawer
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:border-indigo-500/60 dark:bg-indigo-950/60 dark:text-indigo-400'
                  : 'border-slate-200/90 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              <Users className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

      {/* Main Message Timeline + Optional Members Drawer */}
      <div className={`relative flex min-h-0 flex-1 ${wallpaperClass}`}>
        <div className="chat-scroll flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="theme-surface max-w-xs rounded-2xl border border-slate-200/80 bg-white/85 px-5 py-4 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/85">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  No messages yet
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  Say hello, record a voice note, share media, or start a live WebRTC call.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-3">
              {messages.map((msg) => {
                if (msg.type === 'call') {
                  return (
                    <div
                      key={msg.id}
                      className="my-1.5 flex items-center justify-center"
                    >
                      <div className="theme-surface inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/85 px-3.5 py-1.5 text-xs text-slate-600 shadow-xs backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/85 dark:text-slate-300">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                          <Phone className="h-3 w-3" />
                        </span>
                        <span className="font-medium">{msg.text}</span>
                        <span aria-hidden="true" className="opacity-40">
                          ·
                        </span>
                        <span className="font-mono text-[11px] opacity-75 tabular-nums">
                          {formatMessageTime(msg.createdAt)}
                        </span>
                      </div>
                    </div>
                  );
                }

                const isOwn = msg.senderId === currentUser.uid;
                const receipt = isOwn ? getMessageReceipt(msg) : null;
                const senderUser = usersById.get(msg.senderId);

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className={`group flex flex-col ${
                      isOwn ? 'items-end' : 'items-start'
                    }`}
                  >
                    {!isOwn && conversationRef.type === 'group' && (
                      <span className="mb-1 ml-9 px-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                        {msg.senderName}
                      </span>
                    )}

                    <div className="flex max-w-[88%] items-end gap-2 sm:max-w-[72%]">
                      {!isOwn && conversationRef.type === 'group' && (
                        <div className="mb-0.5 hidden sm:block">
                          <Avatar
                            name={senderUser?.displayName || msg.senderName}
                            src={senderUser?.photoURL}
                            size="xs"
                          />
                        </div>
                      )}

                      {isOwn && !msg.deleted && (
                        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => setReplyTo(msg)}
                            title="Reply"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                          >
                            <Reply className="h-3.5 w-3.5" />
                          </button>
                          {msg.type === 'text' && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingMsg(msg);
                                setDraft(msg.text);
                                textAreaRef.current?.focus();
                              }}
                              title="Edit"
                              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void softDeleteMessage(conversationId, msg.id)
                            }
                            title="Delete"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}

                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm ${
                          isOwn
                            ? 'rounded-br-sm bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/15'
                            : 'theme-surface rounded-bl-sm border border-slate-200/80 bg-white/95 text-slate-900 shadow-xs backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-100'
                        }`}
                      >
                        {msg.replyToPreview && !msg.deleted && (
                          <div
                            className={`mb-2 rounded-xl border-l-2 px-3 py-1.5 text-xs ${
                              isOwn
                                ? 'border-indigo-200 bg-white/15 text-indigo-50'
                                : 'border-indigo-500 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {msg.replyToPreview}
                          </div>
                        )}

                        {msg.deleted ? (
                          <span className="italic opacity-75">
                            This message was deleted
                          </span>
                        ) : (
                          <>
                            <ResolvedMessageMedia
                              msg={msg}
                              isOwn={isOwn}
                              onOpenLightbox={(url) => setLightboxUrl(url)}
                            />

                            {msg.text && (
                              <p className="whitespace-pre-wrap break-words leading-relaxed">
                                {msg.text}
                              </p>
                            )}
                          </>
                        )}

                        <div
                          className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                            isOwn
                              ? 'text-indigo-100/90'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {msg.editedAt && !msg.deleted && <span>Edited</span>}
                          <span className="font-mono tabular-nums">
                            {formatMessageTime(msg.createdAt)}
                          </span>
                          {isOwn && receipt && (
                            <span
                              title={
                                receipt === 'read'
                                  ? 'Read'
                                  : receipt === 'delivered'
                                    ? 'Delivered'
                                    : 'Sent'
                              }
                            >
                              {receipt === 'sent' ? (
                                <Check className="h-3 w-3 opacity-80" />
                              ) : receipt === 'delivered' ? (
                                <CheckCheck className="h-3.5 w-3.5 opacity-80" />
                              ) : (
                                <CheckCheck className="h-3.5 w-3.5 text-cyan-200" />
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {!isOwn && !msg.deleted && (
                        <button
                          type="button"
                          onClick={() => setReplyTo(msg)}
                          title="Reply"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-slate-200/70 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        >
                          <Reply className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}

              {/* Animated Typing Bubble */}
              <AnimatePresence>
                {activeTypers.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="flex items-center gap-2 pt-1"
                  >
                    <div className="theme-surface inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-200/80 bg-white/95 px-3.5 py-2.5 shadow-xs dark:border-slate-800 dark:bg-slate-900/95">
                      <div className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500 [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-indigo-500" />
                      </div>
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {activeTypers.map((t) => t.displayName).join(', ')}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={scrollBottomRef} />
            </div>
          )}
        </div>

        {/* Optional Group Members Drawer */}
        <AnimatePresence>
          {showMembersDrawer && conversationRef.type === 'group' && (
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.2 }}
              className="theme-surface w-68 shrink-0 border-l border-slate-200/80 bg-white/95 p-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xs font-bold tracking-wide text-slate-900 uppercase dark:text-white">
                  Members ({members.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowMembersDrawer(false)}
                  aria-label="Close members list"
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="chat-scroll mt-3 space-y-2 overflow-y-auto">
                {members.map((m) => {
                  const liveUser = usersById.get(m.uid);
                  return (
                    <div
                      key={m.uid}
                      className="flex items-center gap-2.5 rounded-xl p-1.5 transition-colors hover:bg-slate-100/70 dark:hover:bg-slate-800/60"
                    >
                      <Avatar
                        name={liveUser?.displayName || m.displayName}
                        src={liveUser?.photoURL || m.photoURL}
                        size="sm"
                        online={Boolean(liveUser?.online)}
                        ring={Boolean(liveUser?.online)}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                          {liveUser?.displayName || m.displayName}
                        </p>
                        <p className="text-[11px] capitalize text-slate-500 dark:text-slate-400">
                          {m.role}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Composer Dock */}
      <div className="theme-surface relative z-20 border-t border-slate-200/80 bg-white/90 px-4 py-3 backdrop-blur-xl sm:px-6 dark:border-slate-800/80 dark:bg-slate-900/90">
        {uploadProgress !== null && (
          <div className="mb-2.5 flex items-center gap-3 rounded-xl bg-indigo-50/70 px-3 py-2 text-xs text-slate-700 dark:bg-indigo-950/40 dark:text-slate-200">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span className="font-medium">Uploading media</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-indigo-600 to-blue-600 transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            <span className="font-mono font-semibold tabular-nums">
              {uploadProgress}%
            </span>
          </div>
        )}

        {uploadNotice && (
          <div className="mb-2.5 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            <span>{uploadNotice}</span>
            <button
              type="button"
              onClick={() => setUploadNotice(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {(replyTo || editingMsg) && (
          <div className="theme-subtle mb-2.5 flex items-center justify-between gap-3 rounded-xl border-l-4 border-indigo-600 bg-slate-100/80 px-3.5 py-2 text-xs dark:bg-slate-800/80">
            <div className="min-w-0">
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {editingMsg
                  ? 'Editing message'
                  : `Replying to ${replyTo?.senderName}`}
              </span>
              <p className="truncate text-slate-600 dark:text-slate-300">
                {editingMsg
                  ? editingMsg.text
                  : replyTo?.text || replyTo?.mediaName || replyTo?.type}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setReplyTo(null);
                setEditingMsg(null);
                if (editingMsg) setDraft('');
              }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Composer Controls */}
        {isRecording ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-rose-50 px-4 py-2.5 dark:border-red-900/50 dark:from-red-950/40 dark:to-rose-950/30">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-600" />
              </span>
              <div className="flex items-center gap-1" aria-hidden="true">
                {[12, 20, 14, 24, 16, 22, 12].map((h, i) => (
                  <span
                    key={i}
                    className="w-1 animate-pulse rounded-full bg-red-500/80"
                    style={{
                      height: `${h}px`,
                      animationDelay: `${i * 110}ms`,
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-xs font-bold text-red-700 tabular-nums dark:text-red-300">
                {formatDuration(recordSeconds)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancelVoiceRecording}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void finishAndSendVoice()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-red-700 active:scale-[0.97]"
              >
                <Square className="h-3 w-3 fill-current" />
                Send Voice
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={handleFileSelected}
            />
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileSelected}
            />
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,*/*"
              className="hidden"
              onChange={handleFileSelected}
            />

            {/* Attachment Popover Button */}
            <div ref={attachContainerRef} className="relative shrink-0">
              <AnimatePresence>
                {showAttachMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.95 }}
                    transition={{ duration: 0.16 }}
                    className="theme-surface absolute bottom-13 left-0 z-30 w-52 overflow-hidden rounded-2xl border border-slate-200/90 bg-white/95 p-1.5 shadow-xl backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/95"
                  >
                    <button
                      type="button"
                      onClick={() => triggerAttachmentPicker('photo')}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-200 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                        <ImageIcon className="h-4 w-4" />
                      </span>
                      <span>Photo or Video</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerAttachmentPicker('audio')}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-200 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                        <Music className="h-4 w-4" />
                      </span>
                      <span>Audio Track</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerAttachmentPicker('doc')}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:text-slate-200 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400">
                        <FileText className="h-4 w-4" />
                      </span>
                      <span>Document / File</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                disabled={uploadProgress !== null}
                onClick={() => {
                  setShowAttachMenu((v) => !v);
                  setShowEmojiPicker(false);
                }}
                title="Share Media or Document"
                aria-label="Open attachment menu"
                className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-all disabled:opacity-40 ${
                  showAttachMenu
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:border-indigo-500/60 dark:bg-indigo-950/60 dark:text-indigo-400'
                    : 'border-slate-200/90 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {showAttachMenu ? (
                  <Plus className="h-5 w-5 rotate-45 transition-transform" />
                ) : (
                  <Paperclip className="h-4.5 w-4.5" />
                )}
              </button>
            </div>

            {/* Emoji Picker Button */}
            <div ref={emojiContainerRef} className="relative shrink-0">
              <AnimatePresence>
                {showEmojiPicker && (
                  <div className="absolute bottom-13 left-0 z-30">
                    <EmojiPicker onSelect={handleEmojiSelect} />
                  </div>
                )}
              </AnimatePresence>
              <button
                type="button"
                onClick={() => {
                  setShowEmojiPicker((v) => !v);
                  setShowAttachMenu(false);
                }}
                title="Insert Emoji"
                aria-label="Open emoji picker"
                className={`flex h-11 w-11 items-center justify-center rounded-xl border transition-all ${
                  showEmojiPicker
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:border-indigo-500/60 dark:bg-indigo-950/60 dark:text-indigo-400'
                    : 'border-slate-200/90 text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Smile className="h-4.5 w-4.5" />
              </button>
            </div>

            {/* Message Input */}
            <textarea
              ref={textAreaRef}
              rows={1}
              value={draft}
              maxLength={4000}
              onChange={(e) => handleDraftChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a message..."
              className="theme-subtle max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-slate-200/90 bg-slate-100/80 px-4 py-3 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-900"
            />

            {/* Send / Voice Record Action */}
            {draft.trim() ? (
              <button
                type="button"
                disabled={sending}
                onClick={() => void handleSendText()}
                aria-label="Send message"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/25 transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4.5 w-4.5 animate-spin" />
                ) : (
                  <Send className="h-4.5 w-4.5" />
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled={uploadProgress !== null}
                onClick={() => void startVoiceRecording()}
                title="Record Voice Message"
                aria-label="Record Voice Message"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200/90 text-slate-700 transition-all hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 active:scale-95 disabled:opacity-40 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Mic className="h-4.5 w-4.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Image Lightbox Modal */}
      <AnimatePresence>
        {lightboxUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md"
            onClick={() => setLightboxUrl(null)}
          >
            <button
              type="button"
              onClick={() => setLightboxUrl(null)}
              aria-label="Close image preview"
              className="absolute top-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
            <img
              src={lightboxUrl}
              alt="Full resolution preview"
              referrerPolicy="no-referrer"
              className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
