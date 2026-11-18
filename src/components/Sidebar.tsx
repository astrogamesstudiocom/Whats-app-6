import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell,
  Globe,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  Palette,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  Search,
  Settings,
  Users,
  Video,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { BrandLogo } from './BrandLogo';
import type { NavTab } from './MobileBottomNav';
import { formatDuration } from '../lib/media';
import type { ThemeMode } from '../lib/theme';
import { createOrOpenDirectChat } from '../services/chatService';
import type {
  CallInvite,
  ConversationRef,
  UserNotification,
  UserProfile,
} from '../types/chat';

interface SidebarProps {
  activeTab: NavTab;
  onChangeTab: (tab: NavTab) => void;
  currentUser: UserProfile;
  conversations: ConversationRef[];
  directoryUsers: UserProfile[];
  activeConversationId: string | null;
  usersById: Map<string, UserProfile>;
  callHistory: CallInvite[];
  notifications: UserNotification[];
  themeMode: ThemeMode;
  onCycleTheme: () => void;
  onSelectConversation: (conversationId: string) => void;
  onOpenNewChat: (initialTab: 'direct' | 'group') => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onMarkNotificationRead: (notificationId: string) => void;
  onStartCallback: (invite: CallInvite) => void;
  onStartDirectCall: (peer: UserProfile, callType: 'audio' | 'video') => void;
}

function formatShortTime(ts: { toDate: () => Date } | null | undefined): string {
  if (!ts) return '';
  const d = ts.toDate();
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

const RAIL_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: typeof MessageCircle;
}> = [
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'communities', label: 'Communities', icon: Globe },
];

export function Sidebar({
  activeTab,
  onChangeTab,
  currentUser,
  conversations,
  directoryUsers,
  activeConversationId,
  usersById,
  callHistory,
  notifications,
  themeMode,
  onCycleTheme,
  onSelectConversation,
  onOpenNewChat,
  onOpenSettings,
  onSignOut,
  onMarkNotificationRead,
  onStartCallback,
  onStartDirectCall,
}: SidebarProps) {
  const [search, setSearch] = useState('');
  const [showAlerts, setShowAlerts] = useState(false);
  const [openingPeerUid, setOpeningPeerUid] = useState<string | null>(null);

  const unreadChats = useMemo(
    () => conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [conversations]
  );

  const unreadAlerts = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const missedCalls = useMemo(
    () =>
      callHistory.filter(
        (c) => c.status === 'missed' && c.callerId !== currentUser.uid
      ).length,
    [callHistory, currentUser.uid]
  );

  const friends = useMemo(
    () => directoryUsers.filter((u) => u.uid !== currentUser.uid),
    [directoryUsers, currentUser.uid]
  );

  const onlineFriends = useMemo(
    () => friends.filter((f) => f.online),
    [friends]
  );

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!q) return true;
      const peer = c.peerUid ? usersById.get(c.peerUid) : undefined;
      const name = (peer?.displayName || c.title || '').toLowerCase();
      const preview = (c.lastMessageText || '').toLowerCase();
      return name.includes(q) || preview.includes(q);
    });
  }, [conversations, search, usersById]);

  const groupCommunities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (c.type !== 'group') return false;
      if (!q) return true;
      return (c.title || '').toLowerCase().includes(q);
    });
  }, [conversations, search]);

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.statusText || '').toLowerCase().includes(q)
    );
  }, [friends, search]);

  const handleOpenPeerChat = async (peer: UserProfile) => {
    setOpeningPeerUid(peer.uid);
    try {
      const convId = await createOrOpenDirectChat(currentUser, peer);
      onSelectConversation(convId);
    } finally {
      setOpeningPeerUid(null);
    }
  };

  return (
    <div className="flex h-full w-full shrink-0 md:w-[396px] lg:w-[420px]">
      {/* Desktop Left Navigation Rail (Discord / Telegram style) */}
      <nav
        aria-label="Workspace navigation"
        className="theme-rail hidden w-[72px] shrink-0 flex-col items-center justify-between border-r border-slate-200 bg-slate-100/80 py-4 md:flex dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={onOpenSettings}
            title="Profile & Settings"
            className="transition-transform hover:scale-105 active:scale-95"
          >
            <BrandLogo size="md" />
          </button>

          <div className="h-px w-8 bg-slate-200 dark:bg-slate-800" />

          <div className="flex flex-col items-center gap-2">
            {RAIL_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              const badge =
                item.id === 'chats'
                  ? unreadChats
                  : item.id === 'calls'
                    ? missedCalls
                    : 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setShowAlerts(false);
                    onChangeTab(item.id);
                  }}
                  title={item.label}
                  aria-label={item.label}
                  className="group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors"
                >
                  {isActive && !showAlerts && (
                    <motion.div
                      layoutId="desktopRailIndicator"
                      transition={{
                        type: 'spring',
                        stiffness: 450,
                        damping: 32,
                      }}
                      className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 shadow-md shadow-indigo-600/25"
                    />
                  )}
                  <Icon
                    className={`relative z-10 h-5 w-5 transition-colors ${
                      isActive && !showAlerts
                        ? 'text-white'
                        : 'text-slate-500 group-hover:text-slate-900 dark:text-slate-400 dark:group-hover:text-white'
                    }`}
                  />
                  {badge > 0 && (
                    <span className="absolute -top-1 -right-1 z-20 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 font-mono text-[10px] font-bold text-white ring-2 ring-slate-100 tabular-nums dark:ring-slate-950">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAlerts((v) => !v)}
            title="Notifications"
            aria-label="Notifications"
            className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              showAlerts
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <Bell className="h-4.5 w-4.5" />
            {unreadAlerts > 0 && (
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
            )}
          </button>

          <button
            type="button"
            onClick={onCycleTheme}
            title={`Theme: ${themeMode === 'pure' ? 'Pure White' : themeMode} (click to switch)`}
            aria-label="Switch theme"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Palette className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            title="Settings & Themes"
            aria-label="Settings & Themes"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-200/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <Settings className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={onSignOut}
            title="Sign Out"
            aria-label="Sign Out"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
          >
            <LogOut className="h-4.5 w-4.5" />
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-1"
            title={currentUser.displayName}
          >
            <Avatar
              name={currentUser.displayName}
              src={currentUser.photoURL}
              size="sm"
              online={currentUser.online}
            />
          </button>
        </div>
      </nav>

      {/* Main List Panel */}
      <aside className="theme-surface flex h-full min-w-0 flex-1 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Top Profile / View Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 px-4 py-3.5 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <div className="md:hidden">
              <Avatar
                name={currentUser.displayName}
                src={currentUser.photoURL}
                size="sm"
                online={currentUser.online}
              />
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                {showAlerts
                  ? 'Alerts'
                  : activeTab === 'chats'
                    ? 'Chats'
                    : activeTab === 'calls'
                      ? 'Calls'
                      : activeTab === 'friends'
                        ? 'Friends'
                        : 'Communities'}
              </h1>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {currentUser.displayName}
                {currentUser.statusText ? ` · ${currentUser.statusText}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowAlerts((v) => !v)}
              title="Notifications"
              aria-label="Notifications"
              className="relative flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Bell className="h-4.5 w-4.5" />
              {unreadAlerts > 0 && (
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              title="Settings & Themes"
              aria-label="Settings & Themes"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 md:hidden dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Settings className="h-4.5 w-4.5" />
            </button>

            <button
              type="button"
              onClick={() =>
                onOpenNewChat(activeTab === 'communities' ? 'group' : 'direct')
              }
              title={
                activeTab === 'communities' ? 'Create Community' : 'New Message'
              }
              aria-label={
                activeTab === 'communities' ? 'Create Community' : 'New Message'
              }
              className="flex h-9 items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-3 text-xs font-semibold text-white shadow-sm shadow-indigo-600/20 transition-transform hover:brightness-105 active:scale-95"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">
                {activeTab === 'communities' ? 'Create' : 'New'}
              </span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {!showAlerts && activeTab !== 'calls' && (
          <div className="px-3.5 pt-3 pb-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  activeTab === 'friends'
                    ? 'Search verified friends...'
                    : activeTab === 'communities'
                      ? 'Search communities...'
                      : 'Search messages or contacts...'
                }
                className="theme-subtle w-full rounded-xl border border-slate-200/80 bg-slate-100/80 py-2.5 pr-3.5 pl-10 text-xs text-slate-900 transition-all outline-none focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/15 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:bg-slate-900"
              />
            </div>
          </div>
        )}

        {/* Active View Content */}
        <div className="chat-scroll flex-1 overflow-y-auto px-2.5 pt-1 pb-20 md:pb-4">
          <AnimatePresence mode="wait">
            {showAlerts ? (
              <motion.div
                key="alerts"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
                className="space-y-2 p-1.5"
              >
                <div className="flex items-center justify-between px-1 pb-1">
                  <span className="text-xs font-medium text-slate-500">
                    Recent activity
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAlerts(false)}
                    className="text-xs font-semibold text-indigo-600 dark:text-indigo-400"
                  >
                    Back
                  </button>
                </div>
                {notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <Bell className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
                    <p className="mt-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                      All caught up
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Missed call alerts and priority updates appear here.
                    </p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <button
                      key={notif.id}
                      type="button"
                      onClick={() => {
                        if (!notif.read) onMarkNotificationRead(notif.id);
                        if (notif.conversationId) {
                          onSelectConversation(notif.conversationId);
                          setShowAlerts(false);
                          onChangeTab('chats');
                        }
                      }}
                      className={`w-full rounded-2xl border p-3.5 text-left transition-all hover:shadow-xs ${
                        notif.read
                          ? 'border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-900'
                          : 'border-indigo-200 bg-indigo-50/70 dark:border-indigo-900/50 dark:bg-indigo-950/35'
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white">
                          {notif.title}
                        </span>
                        <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {formatShortTime(notif.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                        {notif.body}
                      </p>
                    </button>
                  ))
                )}
              </motion.div>
            ) : activeTab === 'chats' ? (
              <motion.div
                key="chats"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                {/* Online Now Quick Strip */}
                {onlineFriends.length > 0 && !search && (
                  <div className="mb-2 border-b border-slate-100 px-1.5 pb-3 dark:border-slate-800/80">
                    <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-slate-400">
                      Active now ({onlineFriends.length})
                    </p>
                    <div className="chat-scroll flex gap-3 overflow-x-auto px-1 pb-1">
                      {onlineFriends.slice(0, 12).map((friend) => (
                        <button
                          key={friend.uid}
                          type="button"
                          onClick={() => void handleOpenPeerChat(friend)}
                          className="flex w-14 shrink-0 flex-col items-center gap-1 text-center transition-transform hover:-translate-y-0.5"
                        >
                          <Avatar
                            name={friend.displayName}
                            src={friend.photoURL}
                            size="md"
                            online={friend.online}
                          />
                          <span className="w-full truncate text-[11px] font-medium text-slate-700 dark:text-slate-300">
                            {friend.displayName.split(' ')[0]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {filteredConversations.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <MessageSquarePlus className="h-6 w-6" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {conversations.length === 0
                        ? 'No conversations yet'
                        : 'No matching chats'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {conversations.length === 0
                        ? 'Pick a friend or start a new channel to begin chatting.'
                        : 'Try searching by another name or message.'}
                    </p>
                    {conversations.length === 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenNewChat('direct')}
                        className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm"
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                        Start a Chat
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredConversations.map((conv) => {
                      const isActive = conv.conversationId === activeConversationId;
                      const peer = conv.peerUid
                        ? usersById.get(conv.peerUid)
                        : undefined;
                      const displayName =
                        peer?.displayName || conv.title || 'Conversation';
                      const photo = peer?.photoURL || conv.peerPhotoURL;
                      const unread = conv.unreadCount || 0;

                      return (
                        <button
                          key={conv.conversationId}
                          type="button"
                          onClick={() => onSelectConversation(conv.conversationId)}
                          className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all ${
                            isActive
                              ? 'bg-gradient-to-r from-indigo-600/12 to-blue-600/8 ring-1 ring-indigo-500/25 dark:from-indigo-500/20 dark:to-blue-500/10'
                              : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <Avatar
                            name={displayName}
                            src={photo}
                            size="md"
                            isGroup={conv.type === 'group'}
                            online={
                              conv.type === 'direct'
                                ? Boolean(peer?.online)
                                : undefined
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span
                                className={`truncate text-sm font-semibold ${
                                  isActive
                                    ? 'text-indigo-700 dark:text-indigo-300'
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {displayName}
                              </span>
                              <span
                                className={`shrink-0 font-mono text-[11px] tabular-nums ${
                                  unread > 0
                                    ? 'font-semibold text-indigo-600 dark:text-indigo-400'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {formatShortTime(conv.lastMessageAt)}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <span
                                className={`truncate text-xs ${
                                  unread > 0
                                    ? 'font-medium text-slate-800 dark:text-slate-200'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {conv.lastMessageText || 'Say hello!'}
                              </span>
                              {unread > 0 && (
                                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 px-1.5 font-mono text-[10px] font-bold text-white shadow-xs tabular-nums">
                                  {unread > 99 ? '99+' : unread}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'calls' ? (
              <motion.div
                key="calls"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                {callHistory.length === 0 ? (
                  <div className="px-4 py-14 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Phone className="h-6 w-6" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                      No call history yet
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Voice and video calls across your chats appear here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 p-1">
                    {callHistory.map((invite) => {
                      const isOutgoing = invite.callerId === currentUser.uid;
                      const isMissed =
                        invite.status === 'missed' ||
                        invite.status === 'rejected';
                      const label =
                        invite.conversationTitle || invite.callerName || 'Call';

                      return (
                        <div
                          key={invite.callId}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-3 py-2.5 transition-colors hover:border-slate-200 dark:border-slate-800/80 dark:bg-slate-900 dark:hover:border-slate-700"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div
                              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                                isMissed && !isOutgoing
                                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400'
                                  : isOutgoing
                                    ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400'
                                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400'
                              }`}
                            >
                              {isMissed && !isOutgoing ? (
                                <PhoneMissed className="h-4.5 w-4.5" />
                              ) : isOutgoing ? (
                                <PhoneOutgoing className="h-4.5 w-4.5" />
                              ) : (
                                <PhoneIncoming className="h-4.5 w-4.5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {label}
                              </p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                                <span
                                  className={`capitalize ${
                                    isMissed && !isOutgoing
                                      ? 'font-medium text-rose-600 dark:text-rose-400'
                                      : ''
                                  }`}
                                >
                                  {invite.status}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="capitalize">
                                  {invite.callType}
                                </span>
                                {typeof invite.durationSeconds === 'number' &&
                                  invite.durationSeconds > 0 && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {formatDuration(invite.durationSeconds)}
                                      </span>
                                    </>
                                  )}
                                <span aria-hidden="true">·</span>
                                <span className="font-mono tabular-nums">
                                  {formatShortTime(invite.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => onStartCallback(invite)}
                            title="Call back"
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-indigo-600 transition-colors hover:bg-indigo-600 hover:text-white dark:bg-slate-800 dark:text-indigo-400 dark:hover:bg-indigo-600 dark:hover:text-white"
                          >
                            {invite.callType === 'video' ? (
                              <Video className="h-4 w-4" />
                            ) : (
                              <Phone className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            ) : activeTab === 'friends' ? (
              <motion.div
                key="friends"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                {filteredFriends.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <Users className="mx-auto h-7 w-7 text-slate-300 dark:text-slate-600" />
                    <p className="mt-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                      No verified friends found
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Invite someone by email using the New button above.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredFriends.map((friend) => (
                      <div
                        key={friend.uid}
                        className="flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                      >
                        <button
                          type="button"
                          disabled={openingPeerUid === friend.uid}
                          onClick={() => void handleOpenPeerChat(friend)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <Avatar
                            name={friend.displayName}
                            src={friend.photoURL}
                            size="md"
                            online={friend.online}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {friend.displayName}
                            </p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                              {friend.online ? 'Online now' : 'Offline'}
                              {friend.statusText ? ` · ${friend.statusText}` : ''}
                            </p>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => onStartDirectCall(friend, 'audio')}
                            title="Voice call"
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-400"
                          >
                            <Phone className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onStartDirectCall(friend, 'video')}
                            title="Video call"
                            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-indigo-950/60 dark:hover:text-indigo-400"
                          >
                            <Video className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              /* Communities (Group Channels) */
              <motion.div
                key="communities"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16 }}
              >
                {groupCommunities.length === 0 ? (
                  <div className="px-4 py-12 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400">
                      <Globe className="h-6 w-6" />
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                      No communities yet
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Create a group channel for team messaging and group voice/video calls.
                    </p>
                    <button
                      type="button"
                      onClick={() => onOpenNewChat('group')}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 px-4 py-2 text-xs font-semibold text-white shadow-sm"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create Community
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {groupCommunities.map((grp) => {
                      const isActive = grp.conversationId === activeConversationId;
                      return (
                        <button
                          key={grp.conversationId}
                          type="button"
                          onClick={() => onSelectConversation(grp.conversationId)}
                          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all ${
                            isActive
                              ? 'bg-gradient-to-r from-indigo-600/12 to-cyan-600/10 ring-1 ring-indigo-500/25'
                              : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                          }`}
                        >
                          <Avatar
                            name={grp.title || 'Community'}
                            src={grp.iconURL}
                            size="md"
                            isGroup
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                                {grp.title || 'Community'}
                              </span>
                              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                                {formatShortTime(grp.lastMessageAt)}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                              {grp.lastMessageText || 'Group channel'}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </aside>
    </div>
  );
}
