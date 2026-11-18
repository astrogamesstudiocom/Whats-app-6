import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { CallOverlay } from './components/CallOverlay';
import { ChatWindow } from './components/ChatWindow';
import { MobileBottomNav, type NavTab } from './components/MobileBottomNav';
import { NewChatModal } from './components/NewChatModal';
import { SettingsModal } from './components/SettingsModal';
import { Sidebar } from './components/Sidebar';
import { auth, registerPushNotifications } from './lib/firebase';
import type { ChatWallpaperId, ThemeMode } from './lib/theme';
import {
  createOrOpenDirectChat,
  fetchConversationMembersOnce,
  initiateCallSession,
  markNotificationRead,
  saveFcmToken,
  setPresence,
  subscribeCallInvites,
  subscribeConversationRefs,
  subscribeDiscoverableUsers,
  subscribeUserNotifications,
  subscribeUserProfile,
  syncVerifiedUserProfile,
} from './services/chatService';
import type {
  CallInvite,
  CallMode,
  CallType,
  ConversationRef,
  UserNotification,
  UserProfile,
} from './types/chat';

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [profileSyncing, setProfileSyncing] = useState(false);

  const [directoryUsers, setDirectoryUsers] = useState<UserProfile[]>([]);
  const [conversations, setConversations] = useState<ConversationRef[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null
  );
  const [callHistory, setCallHistory] = useState<CallInvite[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<NavTab>('chats');
  const [newChatTab, setNewChatTab] = useState<'direct' | 'group' | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(
    null
  );

  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'light';
    const saved =
      localStorage.getItem('mcw_theme_mode') ||
      localStorage.getItem('mcw_theme');
    if (saved === 'dark' || saved === 'pure' || saved === 'light') {
      return saved;
    }
    return 'light';
  });

  const [wallpaper, setWallpaper] = useState<ChatWallpaperId>(() => {
    if (typeof window === 'undefined') return 'aurora';
    const saved = localStorage.getItem('mcw_wallpaper');
    if (
      saved === 'default' ||
      saved === 'aurora' ||
      saved === 'geometric' ||
      saved === 'dusk' ||
      saved === 'midnight' ||
      saved === 'botanical'
    ) {
      return saved;
    }
    return 'aurora';
  });

  // Sync Tailwind dark & pure-white classes on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (themeMode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('pure-white');
    } else if (themeMode === 'pure') {
      root.classList.remove('dark');
      root.classList.add('pure-white');
    } else {
      root.classList.remove('dark');
      root.classList.remove('pure-white');
    }
    localStorage.setItem('mcw_theme_mode', themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem('mcw_wallpaper', wallpaper);
  }, [wallpaper]);

  const cycleThemeMode = () => {
    setThemeMode((prev) =>
      prev === 'light' ? 'dark' : prev === 'dark' ? 'pure' : 'light'
    );
  };

  const bootstrapVerifiedUser = useCallback(async (user: User) => {
    setProfileSyncing(true);
    try {
      const profile = await syncVerifiedUserProfile(user);
      setCurrentUser(profile);

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const pushRes = await registerPushNotifications(user, (payload) => {
          const title = payload.notification?.title || 'My Chatting Web';
          const body = payload.notification?.body || 'New message received';
          setToast({ title, body });
          window.setTimeout(() => setToast(null), 4500);
        });
        if (pushRes.token) {
          await saveFcmToken(user.uid, pushRes.token).catch(() => undefined);
        }
      }
    } finally {
      setProfileSyncing(false);
    }
  }, []);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthReady(true);

      if (user && user.emailVerified) {
        await bootstrapVerifiedUser(user);
      } else {
        setCurrentUser(null);
        setConversations([]);
        setCallHistory([]);
        setNotifications([]);
        setActiveConversationId(null);
        setActiveCallId(null);
      }
    });
    return () => unsub();
  }, [bootstrapVerifiedUser]);

  // Real-time Firestore subscriptions (only when authenticated + verified)
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified || !currentUser?.uid) {
      return;
    }

    const uid = currentUser.uid;
    const unsubProfile = subscribeUserProfile(uid, (p) => {
      if (p) setCurrentUser(p);
    });
    const unsubUsers = subscribeDiscoverableUsers(setDirectoryUsers);
    const unsubConvs = subscribeConversationRefs(uid, setConversations);
    const unsubCalls = subscribeCallInvites(uid, setCallHistory);
    const unsubNotifs = subscribeUserNotifications(uid, setNotifications);

    const handleVisibility = () => {
      void setPresence(uid, document.visibilityState === 'visible');
    };
    const handleUnload = () => {
      void setPresence(uid, false);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      unsubProfile();
      unsubUsers();
      unsubConvs();
      unsubCalls();
      unsubNotifs();
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [firebaseUser, currentUser?.uid]);

  const usersById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const u of directoryUsers) map.set(u.uid, u);
    if (currentUser) map.set(currentUser.uid, currentUser);
    return map;
  }, [directoryUsers, currentUser]);

  const activeConversationRef = useMemo(
    () =>
      conversations.find((c) => c.conversationId === activeConversationId) ||
      null,
    [conversations, activeConversationId]
  );

  const unreadChats = useMemo(
    () => conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [conversations]
  );

  const missedCalls = useMemo(() => {
    if (!currentUser) return 0;
    return callHistory.filter(
      (c) => c.status === 'missed' && c.callerId !== currentUser.uid
    ).length;
  }, [callHistory, currentUser]);

  // Detect incoming ringing call invite for current user
  const incomingInvite = useMemo(() => {
    if (!currentUser || activeCallId) return null;
    const now = Date.now();
    return (
      callHistory.find((inv) => {
        if (inv.status !== 'ringing') return false;
        if (inv.callerId === currentUser.uid) return false;
        if (!inv.createdAt) return true;
        // Ignore stale invites older than 90s
        return now - inv.createdAt.toMillis() < 90000;
      }) || null
    );
  }, [callHistory, currentUser, activeCallId]);

  const handleStartCall = async (params: {
    conversationId: string;
    conversationTitle: string;
    callType: CallType;
    mode: CallMode;
    recipients: Array<{ uid: string; displayName: string; photoURL?: string }>;
  }) => {
    if (!currentUser) return;
    const callId = await initiateCallSession({
      caller: currentUser,
      ...params,
    });
    setActiveCallId(callId);
  };

  const handleStartCallback = async (invite: CallInvite) => {
    if (!currentUser) return;
    const members = await fetchConversationMembersOnce(invite.conversationId);
    const recipients = members
      .filter((m) => m.uid !== currentUser.uid)
      .map((m) => ({
        uid: m.uid,
        displayName: m.displayName,
        photoURL: m.photoURL,
      }));
    if (recipients.length === 0) return;
    await handleStartCall({
      conversationId: invite.conversationId,
      conversationTitle: invite.conversationTitle || invite.callerName,
      callType: invite.callType,
      mode: invite.mode,
      recipients,
    });
  };

  const handleStartDirectCall = async (
    peer: UserProfile,
    callType: 'audio' | 'video'
  ) => {
    if (!currentUser) return;
    const conversationId = await createOrOpenDirectChat(currentUser, peer);
    setActiveConversationId(conversationId);
    await handleStartCall({
      conversationId,
      conversationTitle: peer.displayName,
      callType,
      mode: 'direct',
      recipients: [
        {
          uid: peer.uid,
          displayName: peer.displayName,
          photoURL: peer.photoURL,
        },
      ],
    });
  };

  const handleSignOut = async () => {
    if (currentUser) {
      await setPresence(currentUser.uid, false);
    }
    await signOut(auth);
  };

  if (!authReady || profileSyncing) {
    return (
      <div className="theme-canvas flex min-h-screen items-center justify-center bg-slate-50 text-slate-700 dark:bg-slate-950 dark:text-slate-300">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white px-5 py-3.5 text-sm font-semibold shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
          <span>Loading My Chatting Web...</span>
        </div>
      </div>
    );
  }

  if (!firebaseUser || !firebaseUser.emailVerified || !currentUser) {
    return (
      <AuthScreen
        pendingVerificationUser={
          firebaseUser && !firebaseUser.emailVerified ? firebaseUser : null
        }
        onVerificationConfirmed={async () => {
          if (auth.currentUser?.emailVerified) {
            await bootstrapVerifiedUser(auth.currentUser);
          }
        }}
      />
    );
  }

  return (
    <div className="theme-canvas flex h-screen w-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar: visible always on md+, hidden on mobile when a chat is open */}
      <div
        className={`${
          activeConversationId ? 'hidden md:flex' : 'flex w-full pb-16 md:w-auto md:pb-0'
        } h-full shrink-0`}
      >
        <Sidebar
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          currentUser={currentUser}
          conversations={conversations}
          directoryUsers={directoryUsers}
          activeConversationId={activeConversationId}
          usersById={usersById}
          callHistory={callHistory}
          notifications={notifications}
          themeMode={themeMode}
          onCycleTheme={cycleThemeMode}
          onSelectConversation={(id) => setActiveConversationId(id)}
          onOpenNewChat={(tab) => setNewChatTab(tab)}
          onOpenSettings={() => setShowSettings(true)}
          onSignOut={() => void handleSignOut()}
          onMarkNotificationRead={(id) =>
            void markNotificationRead(currentUser.uid, id)
          }
          onStartCallback={(inv) => void handleStartCallback(inv)}
          onStartDirectCall={(peer, callType) =>
            void handleStartDirectCall(peer, callType)
          }
        />
      </div>

      {/* Main Chat Viewport */}
      <div
        className={`${
          activeConversationId ? 'flex' : 'hidden md:flex'
        } min-w-0 flex-1`}
      >
        <ChatWindow
          conversationRef={activeConversationRef}
          currentUser={currentUser}
          usersById={usersById}
          wallpaper={wallpaper}
          onStartCall={(p) => void handleStartCall(p)}
          onBackMobile={() => setActiveConversationId(null)}
        />
      </div>

      {/* Mobile Bottom Navigation (only when browsing lists on mobile) */}
      {!activeConversationId && (
        <MobileBottomNav
          activeTab={activeTab}
          unreadChats={unreadChats}
          missedCalls={missedCalls}
          onChangeTab={setActiveTab}
        />
      )}

      {/* Dialogs */}
      {newChatTab && (
        <NewChatModal
          initialTab={newChatTab}
          currentUser={currentUser}
          directoryUsers={directoryUsers}
          onClose={() => setNewChatTab(null)}
          onConversationOpened={(id) => setActiveConversationId(id)}
        />
      )}

      {showSettings && (
        <SettingsModal
          currentUser={currentUser}
          themeMode={themeMode}
          wallpaper={wallpaper}
          onChangeThemeMode={setThemeMode}
          onChangeWallpaper={setWallpaper}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* WebRTC Incoming & Active Call Overlay */}
      <CallOverlay
        activeCallId={activeCallId}
        incomingInvite={incomingInvite}
        currentUser={currentUser}
        onCallAccepted={(callId) => setActiveCallId(callId)}
        onCallClosed={() => setActiveCallId(null)}
      />

      {/* Foreground FCM Notification Toast */}
      {toast && (
        <div className="theme-surface fixed top-4 right-4 z-50 max-w-sm rounded-2xl border border-slate-200/80 bg-white/95 px-4 py-3 shadow-xl backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/95">
          <p className="text-xs font-bold text-slate-900 dark:text-white">
            {toast.title}
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            {toast.body}
          </p>
        </div>
      )}
    </div>
  );
}
