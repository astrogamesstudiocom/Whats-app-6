export type ThemeMode = 'light' | 'dark' | 'pure';

export type ChatWallpaperId =
  | 'default'
  | 'aurora'
  | 'geometric'
  | 'dusk'
  | 'midnight'
  | 'botanical';

export interface WallpaperOption {
  id: ChatWallpaperId;
  label: string;
  previewClass: string;
  canvasClass: string;
}

export const CHAT_WALLPAPERS: WallpaperOption[] = [
  {
    id: 'default',
    label: 'Clean Minimal',
    previewClass: 'bg-slate-100 dark:bg-slate-900',
    canvasClass: '',
  },
  {
    id: 'aurora',
    label: 'Aurora Mesh',
    previewClass: 'bg-gradient-to-br from-indigo-100 via-cyan-50 to-white dark:from-indigo-950 dark:via-slate-900 dark:to-cyan-950',
    canvasClass: 'wallpaper-aurora',
  },
  {
    id: 'geometric',
    label: 'Studio Grid',
    previewClass: 'bg-slate-50 wallpaper-geometric dark:bg-slate-950',
    canvasClass: 'wallpaper-geometric',
  },
  {
    id: 'dusk',
    label: 'Warm Dusk',
    previewClass: 'bg-gradient-to-br from-rose-100 via-amber-50 to-white dark:from-rose-950 dark:via-slate-900 dark:to-amber-950',
    canvasClass: 'wallpaper-dusk',
  },
  {
    id: 'midnight',
    label: 'Deep Sapphire',
    previewClass: 'bg-gradient-to-br from-blue-100 via-sky-50 to-slate-50 dark:from-blue-950 dark:via-slate-950 dark:to-cyan-950',
    canvasClass: 'wallpaper-midnight',
  },
  {
    id: 'botanical',
    label: 'Sage Mist',
    previewClass: 'bg-gradient-to-br from-emerald-100 via-teal-50 to-white dark:from-emerald-950 dark:via-slate-900 dark:to-teal-950',
    canvasClass: 'wallpaper-botanical',
  },
];

export function getWallpaperClass(id: ChatWallpaperId): string {
  return CHAT_WALLPAPERS.find((w) => w.id === id)?.canvasClass || '';
}
