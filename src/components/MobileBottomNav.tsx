import { motion } from 'motion/react';
import { Globe, MessageCircle, Phone, Users } from 'lucide-react';

export type NavTab = 'chats' | 'calls' | 'friends' | 'communities';

interface MobileBottomNavProps {
  activeTab: NavTab;
  unreadChats: number;
  missedCalls: number;
  onChangeTab: (tab: NavTab) => void;
}

const TABS: Array<{
  id: NavTab;
  label: string;
  icon: typeof MessageCircle;
}> = [
  { id: 'chats', label: 'Chats', icon: MessageCircle },
  { id: 'calls', label: 'Calls', icon: Phone },
  { id: 'friends', label: 'Friends', icon: Users },
  { id: 'communities', label: 'Communities', icon: Globe },
];

export function MobileBottomNav({
  activeTab,
  unreadChats,
  missedCalls,
  onChangeTab,
}: MobileBottomNavProps) {
  return (
    <nav
      aria-label="Primary mobile navigation"
      className="theme-surface fixed right-0 bottom-0 left-0 z-40 border-t border-slate-200/80 bg-white/90 px-2 py-1 backdrop-blur-xl md:hidden dark:border-slate-800/80 dark:bg-slate-900/90"
    >
      <div className="grid grid-cols-4 items-center gap-1">
        {TABS.map((item) => {
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
              onClick={() => onChangeTab(item.id)}
              className="relative flex min-h-[48px] flex-col items-center justify-center rounded-xl px-1 py-1 transition-colors"
            >
              {isActive && (
                <motion.div
                  layoutId="mobileBottomTabBg"
                  transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                  className="absolute inset-x-2 inset-y-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/60"
                />
              )}

              <div className="relative z-10 flex items-center justify-center">
                <motion.div
                  animate={{ scale: isActive ? 1.08 : 1 }}
                  transition={{ duration: 0.16 }}
                >
                  <Icon
                    className={`h-5 w-5 transition-colors ${
                      isActive
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  />
                </motion.div>
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 font-mono text-[9px] font-bold text-white tabular-nums">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>

              <span
                className={`relative z-10 mt-0.5 text-[10px] font-semibold tracking-tight whitespace-nowrap ${
                  isActive
                    ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
