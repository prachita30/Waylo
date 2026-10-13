import { cn } from '@/lib/cn';

const TONES = ['bg-lavender text-primary', 'bg-mint-soft text-mint', 'bg-coral-soft text-coral', 'bg-sky text-ink', 'bg-amber-soft text-amber'];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?';
}

function toneFor(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) | 0;
  return TONES[Math.abs(h) % TONES.length];
}

/** Passenger / driver avatar: photo when available, otherwise deterministic initials. */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const dims = { sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-base', xl: 'size-24 text-2xl' }[size];
  return (
    <span className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-bold ring-2 ring-surface', dims, !src && toneFor(name), className)}>
      {src ? <img src={src} alt="" className="size-full object-cover" loading="lazy" decoding="async" /> : <span aria-hidden>{initials(name)}</span>}
      <span className="sr-only">{name}</span>
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 'sm' }: { people: { name: string; src?: string | null }[]; max?: number; size?: 'sm' | 'md' }) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex -space-x-2">
      {shown.map((p, i) => (
        <Avatar key={i} name={p.name} src={p.src} size={size} />
      ))}
      {rest > 0 && (
        <span className={cn('inline-grid place-items-center rounded-full bg-surface-2 font-bold text-ink-2 ring-2 ring-surface', size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm')}>
          +{rest}
        </span>
      )}
    </div>
  );
}
