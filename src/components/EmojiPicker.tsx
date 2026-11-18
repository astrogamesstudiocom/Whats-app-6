import { useState } from 'react';
import { motion } from 'motion/react';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

const EMOJI_CATEGORIES: Array<{
  id: string;
  label: string;
  emojis: string[];
}> = [
  {
    id: 'smileys',
    label: 'Smileys',
    emojis: [
      '😀', '😄', '😁', '😆', '🥹', '😂', '🤣', '😊',
      '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😎',
      '🤩', '🥳', '🤔', '🤨', '😐', '😌', '😴', '🤯',
      '🥺', '😭', '😤', '🔥', '✨', '💯', '🎉', '🙌',
    ],
  },
  {
    id: 'gestures',
    label: 'Gestures',
    emojis: [
      '👍', '👎', '👏', '🙏', '🤝', '✌️', '🤞', '🤟',
      '👌', '🤌', '👋', '💪', '🫶', '❤️', '🧡', '💛',
      '💚', '💙', '💜', '🖤', '🤍', '💥', '⚡', '🌟',
    ],
  },
  {
    id: 'work',
    label: 'Activity',
    emojis: [
      '💬', '📞', '📹', '🎙️', '🎧', '💻', '📱', '📷',
      '📎', '📌', '✅', '🚀', '🎯', '🏆', '☕', '🍕',
      '🌍', '🌙', '☀️', '🌈', '🎵', '🎶', '🔔', '🔒',
    ],
  },
];

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [activeCat, setActiveCat] = useState(EMOJI_CATEGORIES[0].id);
  const current =
    EMOJI_CATEGORIES.find((c) => c.id === activeCat) || EMOJI_CATEGORIES[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.96 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="w-72 rounded-2xl border border-slate-200/90 bg-white/95 p-3 shadow-xl backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/95"
    >
      <div className="mb-2.5 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {EMOJI_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCat(cat.id)}
            className={`rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
              activeCat === cat.id
                ? 'bg-white text-indigo-600 shadow-xs dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-8 gap-1">
        {current.emojis.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelect(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition-transform hover:scale-115 hover:bg-slate-100 active:scale-95 dark:hover:bg-slate-800"
          >
            {emoji}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
