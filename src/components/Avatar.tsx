import { useState } from 'react';
import { Users } from 'lucide-react';

interface AvatarProps {
  name: string;
  src?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  isGroup?: boolean;
  ring?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-9 w-9 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const GRADIENT_TONES = [
  'bg-gradient-to-br from-indigo-500 to-blue-600 text-white',
  'bg-gradient-to-br from-cyan-500 to-blue-600 text-white',
  'bg-gradient-to-br from-violet-500 to-indigo-600 text-white',
  'bg-gradient-to-br from-emerald-500 to-teal-600 text-white',
  'bg-gradient-to-br from-rose-500 to-orange-500 text-white',
];

export function Avatar({
  name,
  src,
  size = 'md',
  online,
  isGroup = false,
  ring = false,
}: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const hash = name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const tone = GRADIENT_TONES[hash % GRADIENT_TONES.length];

  return (
    <div className="relative inline-flex shrink-0">
      {src && !imgError ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className={`${SIZE_CLASSES[size]} rounded-full object-cover shadow-xs ${
            ring
              ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900'
              : 'border border-black/5 dark:border-white/10'
          }`}
        />
      ) : (
        <div
          className={`${SIZE_CLASSES[size]} ${tone} flex items-center justify-center rounded-full font-display font-semibold shadow-xs ${
            ring
              ? 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900'
              : ''
          }`}
          aria-label={name}
        >
          {isGroup ? <Users className="h-[45%] w-[45%]" /> : getInitials(name)}
        </div>
      )}

      {online !== undefined && (
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute right-0 bottom-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-900 ${
            online ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
          }`}
        />
      )}
    </div>
  );
}
