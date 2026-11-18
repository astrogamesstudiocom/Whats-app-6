interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function BrandLogo({ size = 'md' }: BrandLogoProps) {
  const dims =
    size === 'sm'
      ? 'h-8 w-8 rounded-xl'
      : size === 'lg'
        ? 'h-12 w-12 rounded-2xl'
        : 'h-10 w-10 rounded-xl';

  return (
    <div
      className={`${dims} relative flex shrink-0 items-center justify-center bg-gradient-to-br from-indigo-600 via-blue-600 to-cyan-500 shadow-md shadow-indigo-500/25`}
    >
      <svg
        viewBox="0 0 32 32"
        fill="none"
        className="h-[60%] w-[60%] text-white"
        aria-hidden="true"
      >
        <path
          d="M7 10.5C7 8.567 8.567 7 10.5 7H21.5C23.433 7 25 8.567 25 10.5V17.5C25 19.433 23.433 21 21.5 21H14.5L9.5 25V21H10.5C8.567 21 7 19.433 7 17.5V10.5Z"
          fill="currentColor"
          fillOpacity="0.95"
        />
        <circle cx="12.5" cy="14" r="1.4" fill="#4F46E5" />
        <circle cx="16" cy="14" r="1.4" fill="#2563EB" />
        <circle cx="19.5" cy="14" r="1.4" fill="#06B6D4" />
      </svg>
    </div>
  );
}
