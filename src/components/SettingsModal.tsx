import { useEffect, useState, type ChangeEvent } from 'react';
import { motion } from 'motion/react';
import {
  Bell,
  Camera,
  Check,
  CheckCircle2,
  Loader2,
  Moon,
  Palette,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  User as UserIcon,
  X,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { auth, registerPushNotifications } from '../lib/firebase';
import { uploadUserAvatar } from '../lib/media';
import {
  CHAT_WALLPAPERS,
  type ChatWallpaperId,
  type ThemeMode,
} from '../lib/theme';
import { saveFcmToken, updateUserProfile } from '../services/chatService';
import type { InfrastructureHealth, UserProfile } from '../types/chat';

interface SettingsModalProps {
  currentUser: UserProfile;
  themeMode: ThemeMode;
  wallpaper: ChatWallpaperId;
  onChangeThemeMode: (mode: ThemeMode) => void;
  onChangeWallpaper: (wallpaper: ChatWallpaperId) => void;
  onClose: () => void;
}

type SettingsTab = 'appearance' | 'profile' | 'system';

const THEME_CARDS: Array<{
  id: ThemeMode;
  title: string;
  desc: string;
  previewBg: string;
  previewCard: string;
  previewBubble: string;
  icon: typeof Sun;
}> = [
  {
    id: 'light',
    title: 'Light',
    desc: 'Crisp daylight surfaces',
    previewBg: 'bg-slate-100 border-slate-200',
    previewCard: 'bg-white',
    previewBubble: 'bg-indigo-600',
    icon: Sun,
  },
  {
    id: 'dark',
    title: 'Dark',
    desc: 'Deep midnight slate',
    previewBg: 'bg-slate-950 border-slate-800',
    previewCard: 'bg-slate-900',
    previewBubble: 'bg-indigo-500',
    icon: Moon,
  },
  {
    id: 'pure',
    title: 'Pure White',
    desc: 'Ultra-clean minimal white',
    previewBg: 'bg-white border-slate-200',
    previewCard: 'bg-slate-50',
    previewBubble: 'bg-blue-600',
    icon: Sparkles,
  },
];

export function SettingsModal({
  currentUser,
  themeMode,
  wallpaper,
  onChangeThemeMode,
  onChangeWallpaper,
  onClose,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTab>('appearance');
  const [displayName, setDisplayName] = useState(currentUser.displayName);
  const [statusText, setStatusText] = useState(currentUser.statusText || '');
  const [discoverable, setDiscoverable] = useState(currentUser.discoverable);
  const [photoURL, setPhotoURL] = useState(currentUser.photoURL || '');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [pushStatus, setPushStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<InfrastructureHealth | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: InfrastructureHealth) => setHealth(data))
      .catch(() => undefined);
  }, []);

  const handleAvatarUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarError(null);
    setUploadingAvatar(true);
    try {
      const url = await uploadUserAvatar(currentUser.uid, file);
      setPhotoURL(url);
      setSavedNotice('Photo uploaded — click Save Changes to update your profile.');
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : 'Failed to upload profile photo.'
      );
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSavedNotice(null);
    try {
      await updateUserProfile(currentUser.uid, {
        displayName,
        statusText,
        discoverable,
        photoURL: photoURL || undefined,
        email: auth.currentUser?.email,
      });
      setSavedNotice('Profile saved');
    } finally {
      setSaving(false);
    }
  };

  const handleEnablePush = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const res = await registerPushNotifications(user);
    if (res.token) {
      await saveFcmToken(user.uid, res.token);
      setPushStatus('Push notifications enabled and FCM token synced.');
    } else if (res.permission === 'granted') {
      setPushStatus(
        res.reason || 'Browser notifications permitted (foreground active).'
      );
    } else {
      setPushStatus(res.reason || 'Notification permission declined.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="theme-surface flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              Settings &amp; Personalization
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Themes, chat wallpapers, profile, and notifications
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-slate-200/80 px-6 py-2.5 dark:border-slate-800">
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-slate-100 p-1 dark:bg-slate-950">
            {[
              { id: 'appearance' as const, label: 'Appearance', icon: Palette },
              { id: 'profile' as const, label: 'Profile', icon: UserIcon },
              { id: 'system' as const, label: 'Notifications & Info', icon: Server },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-all ${
                    active
                      ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-800 dark:text-indigo-400'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="chat-scroll flex-1 overflow-y-auto p-6">
          {tab === 'appearance' && (
            <div className="space-y-6">
              {/* Theme Mode Cards */}
              <section>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  App Theme
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Choose between Light, Dark, or Pure White mode.
                </p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {THEME_CARDS.map((card) => {
                    const Icon = card.icon;
                    const selected = themeMode === card.id;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => onChangeThemeMode(card.id)}
                        className={`group rounded-2xl border p-3 text-left transition-all ${
                          selected
                            ? 'border-indigo-600 ring-2 ring-indigo-600/20'
                            : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                        }`}
                      >
                        <div
                          className={`mb-3 flex h-16 flex-col justify-between rounded-xl border p-2.5 ${card.previewBg}`}
                        >
                          <div className="flex items-center gap-1.5">
                            <div
                              className={`h-2.5 w-10 rounded-full ${card.previewCard}`}
                            />
                          </div>
                          <div className="flex justify-end">
                            <div
                              className={`h-3 w-12 rounded-full ${card.previewBubble}`}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <Icon className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                            <span className="text-xs font-semibold text-slate-900 dark:text-white">
                              {card.title}
                            </span>
                          </div>
                          {selected && (
                            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-white">
                              <Check className="h-2.5 w-2.5" />
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {card.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Custom Chat Wallpapers */}
              <section>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Chat Wallpaper
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Personalize the backdrop behind your conversation bubbles.
                </p>

                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {CHAT_WALLPAPERS.map((wp) => {
                    const selected = wallpaper === wp.id;
                    return (
                      <button
                        key={wp.id}
                        type="button"
                        onClick={() => onChangeWallpaper(wp.id)}
                        className={`overflow-hidden rounded-2xl border text-left transition-all ${
                          selected
                            ? 'border-indigo-600 ring-2 ring-indigo-600/20'
                            : 'border-slate-200 hover:border-slate-300 dark:border-slate-800'
                        }`}
                      >
                        <div
                          className={`relative h-16 w-full ${wp.previewClass}`}
                        >
                          <div className="absolute right-2 bottom-2 h-3 w-10 rounded-full bg-indigo-600/80" />
                          <div className="absolute bottom-6 left-2 h-3 w-9 rounded-full bg-white/80 dark:bg-slate-800/80" />
                          {selected && (
                            <span className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xs">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                        <div className="px-3 py-2">
                          <p className="text-xs font-semibold text-slate-900 dark:text-white">
                            {wp.label}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {tab === 'profile' && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="relative">
                  <Avatar
                    name={displayName || currentUser.displayName}
                    src={photoURL || undefined}
                    size="xl"
                    ring
                  />
                  <label className="absolute right-0 bottom-0 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-indigo-600 text-white shadow-md transition-transform hover:scale-105 dark:border-slate-900">
                    {uploadingAvatar ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                  </label>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-bold text-slate-900 dark:text-white">
                    {currentUser.displayName}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {auth.currentUser?.email} · Verified Account
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-slate-400">
                    {currentUser.uid}
                  </p>
                  {avatarError && (
                    <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
                      {avatarError}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Display Name
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Bio / Status Line
                  </label>
                  <input
                    type="text"
                    maxLength={140}
                    value={statusText}
                    onChange={(e) => setStatusText(e.target.value)}
                    placeholder="Available for calls"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3 dark:border-slate-800">
                <div>
                  <span className="block text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Discoverable in Friends Directory
                  </span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    Allow verified users to find and message you.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={discoverable}
                  onChange={(e) => setDiscoverable(e.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
              </label>

              <div className="flex items-center justify-between pt-1">
                {savedNotice ? (
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {savedNotice}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-md shadow-indigo-600/20 hover:brightness-105 disabled:opacity-50"
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {tab === 'system' && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                      <Bell className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Push Notifications (FCM)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Receive real-time browser alerts for messages and calls.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleEnablePush}
                    className="shrink-0 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    Enable
                  </button>
                </div>
                {pushStatus && (
                  <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                    {pushStatus}
                  </p>
                )}
              </div>

              <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 text-xs dark:divide-slate-800 dark:border-slate-800">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-600 dark:text-slate-400">
                    Firebase Project
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {health?.projectId || 'Connected'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-600 dark:text-slate-400">
                    WebRTC STUN / TURN
                  </span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {health?.turnConfigured
                      ? 'STUN + TURN Active'
                      : 'STUN Active'}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-slate-600 dark:text-slate-400">
                    FCM Web Push VAPID
                  </span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {health?.vapidConfigured ? 'Configured' : 'Optional'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
