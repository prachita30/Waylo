import { brand } from '@waylo/shared';
import { cn } from '@/lib/cn';

/** WAYLO mark: a route that zig-zags from origin (ivory) to destination (mint). */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8', className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect width="64" height="64" rx="16" fill="#0E1A2B" />
      <path
        d="M13 22 L23.5 43 L32 28 L40.5 43 L51 22"
        fill="none"
        stroke="#FAF7F2"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="13" cy="22" r="4.5" fill="#FAF7F2" />
      <circle cx="51" cy="22" r="5.5" fill="#13A88A" />
    </svg>
  );
}

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className="size-8 dark:outline dark:outline-1 dark:outline-white/15 dark:rounded-[10px]" />
      {!compact && <span className="text-[1.3rem] font-extrabold tracking-[-0.04em] text-ink">{brand.name}</span>}
      {compact && <span className="sr-only">{brand.name}</span>}
    </span>
  );
}
