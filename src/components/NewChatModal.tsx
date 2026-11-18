import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  Loader2,
  Mail,
  MessageSquarePlus,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import {
  createGroupChat,
  createOrOpenDirectChat,
  findUserByEmail,
} from '../services/chatService';
import type { UserProfile } from '../types/chat';

interface NewChatModalProps {
  initialTab: 'direct' | 'group';
  currentUser: UserProfile;
  directoryUsers: UserProfile[];
  onClose: () => void;
  onConversationOpened: (conversationId: string) => void;
}

export function NewChatModal({
  initialTab,
  currentUser,
  directoryUsers,
  onClose,
  onConversationOpened,
}: NewChatModalProps) {
  const [tab, setTab] = useState<'direct' | 'group'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [emailLookupLoading, setEmailLookupLoading] = useState(false);
  const [emailLookupError, setEmailLookupError] = useState<string | null>(null);
  const [groupTitle, setGroupTitle] = useState('');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const otherUsers = directoryUsers.filter((u) => u.uid !== currentUser.uid);
  const filteredUsers = otherUsers.filter((u) =>
    u.displayName.toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  const handleOpenDirect = async (peer: UserProfile) => {
    setSubmitting(true);
    try {
      const convId = await createOrOpenDirectChat(currentUser, peer);
      onConversationOpened(convId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailLookup = async () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    setEmailLookupError(null);
    setEmailLookupLoading(true);
    try {
      const peer = await findUserByEmail(trimmed);
      if (!peer) {
        setEmailLookupError(
          'No verified account found for that email address yet.'
        );
      } else if (peer.uid === currentUser.uid) {
        setEmailLookupError('That email belongs to your current account.');
      } else {
        await handleOpenDirect(peer);
      }
    } catch (err) {
      setEmailLookupError(
        err instanceof Error ? err.message : 'Unable to look up email.'
      );
    } finally {
      setEmailLookupLoading(false);
    }
  };

  const toggleGroupMember = (uid: string) => {
    setSelectedUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleCreateGroup = async () => {
    if (!groupTitle.trim() || selectedUids.length === 0) return;
    setSubmitting(true);
    try {
      const members = otherUsers.filter((u) => selectedUids.includes(u.uid));
      const convId = await createGroupChat(currentUser, groupTitle.trim(), members);
      onConversationOpened(convId);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="theme-surface w-full max-w-lg overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200/80 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-md shadow-indigo-600/20">
              {tab === 'direct' ? (
                <MessageSquarePlus className="h-5 w-5" />
              ) : (
                <Users className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {tab === 'direct' ? 'Start a Conversation' : 'Create Community Channel'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {tab === 'direct'
                  ? 'Message or call anyone verified on My Chatting Web'
                  : 'Bring people together for group messaging & calls'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          {/* Animated Tab Switcher */}
          <div className="theme-subtle grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 dark:bg-slate-950">
            <button
              type="button"
              onClick={() => setTab('direct')}
              className={`rounded-xl py-2 text-xs font-semibold transition-all ${
                tab === 'direct'
                  ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-800 dark:text-indigo-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Direct Message
            </button>
            <button
              type="button"
              onClick={() => setTab('group')}
              className={`rounded-xl py-2 text-xs font-semibold transition-all ${
                tab === 'group'
                  ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-800 dark:text-indigo-400'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Group Community
            </button>
          </div>

          {tab === 'direct' && (
            <div className="mt-5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Find by exact email
              </label>
              <div className="mt-2 flex gap-2">
                <div className="relative flex-1">
                  <Mail className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleEmailLookup();
                    }}
                    placeholder="colleague@example.com"
                    className="theme-subtle w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-3.5 pl-10 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-900"
                  />
                </div>
                <button
                  type="button"
                  disabled={emailLookupLoading || !emailInput.trim()}
                  onClick={() => void handleEmailLookup()}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {emailLookupLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    'Find'
                  )}
                </button>
              </div>
              {emailLookupError && (
                <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">
                  {emailLookupError}
                </p>
              )}
            </div>
          )}

          {tab === 'group' && (
            <div className="mt-5">
              <label
                htmlFor="group-title-input"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                Community / Group Name
              </label>
              <div className="relative mt-2">
                <Users className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="group-title-input"
                  type="text"
                  maxLength={100}
                  value={groupTitle}
                  onChange={(e) => setGroupTitle(e.target.value)}
                  placeholder="Design Guild, Weekend Crew..."
                  className="theme-subtle w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-3.5 pl-10 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-900"
                />
              </div>
            </div>
          )}

          <div className="mt-5">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter verified directory..."
                className="theme-subtle w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pr-3.5 pl-9 text-xs text-slate-900 outline-none transition-all focus:border-indigo-500 focus:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-white dark:focus:bg-slate-900"
              />
            </div>

            <div className="chat-scroll mt-3 max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200/80 dark:divide-slate-800/80 dark:border-slate-800">
              {filteredUsers.length === 0 ? (
                <div className="p-6 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  No other verified users are currently listed in the directory.
                  Sign in with a second account in another browser or incognito window to test real-time chat & calls.
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const selected = selectedUids.includes(user.uid);
                  return (
                    <button
                      key={user.uid}
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        tab === 'direct'
                          ? void handleOpenDirect(user)
                          : toggleGroupMember(user.uid)
                      }
                      className={`flex min-h-[56px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                        selected
                          ? 'bg-indigo-50/70 dark:bg-indigo-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                          name={user.displayName}
                          src={user.photoURL}
                          size="sm"
                          online={user.online}
                          ring={user.online}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {user.displayName}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {user.online ? (
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                Online
                              </span>
                            ) : (
                              'Offline'
                            )}
                            {user.statusText ? ` · ${user.statusText}` : ''}
                          </p>
                        </div>
                      </div>

                      {tab === 'group' && (
                        <div
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                            selected
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-slate-300 dark:border-slate-600'
                          }`}
                        >
                          {selected && <Check className="h-3.5 w-3.5" />}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {tab === 'group' && (
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="font-mono text-xs font-medium text-slate-500 tabular-nums dark:text-slate-400">
                {selectedUids.length} member{selectedUids.length === 1 ? '' : 's'} selected
              </span>
              <button
                type="button"
                disabled={submitting || !groupTitle.trim() || selectedUids.length === 0}
                onClick={() => void handleCreateGroup()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Create Community
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
