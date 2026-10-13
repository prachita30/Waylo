import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { DestinationArt } from '@/components/brand/DestinationArt';
import { AirportChip } from '@/components/brand/Route';
import { api } from '@/lib/api';
import { ME_KEY, type Me, useMe } from '@/lib/auth';
import { cn } from '@/lib/cn';
import type { Destination } from '@/content/destinations';
import { isoDate } from '@/lib/dates';

/** Wishlist toggle. Signed-out visitors are sent to sign in and brought back. */
export function SaveButton({ cityId, name, className }: { cityId: string; name: string; className?: string }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const saved = !!me?.savedDestinations.some((d) => d.cityId === cityId);
  const toggle = useMutation({
    mutationFn: () => (saved ? api.delete(`/users/me/saved-destinations/${cityId}`) : api.put(`/users/me/saved-destinations/${cityId}`)),
    onMutate: () => {
      qc.setQueryData<Me | null>(ME_KEY, (old) =>
        old
          ? {
              ...old,
              savedDestinations: saved
                ? old.savedDestinations.filter((d) => d.cityId !== cityId)
                : [...old.savedDestinations, { cityId, name, state: '', savedAt: new Date().toISOString() }],
            }
          : old,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  });
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${name} from saved destinations` : `Save ${name}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!me) navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
        else toggle.mutate();
      }}
      className={cn('grid size-10 place-items-center rounded-full bg-white/90 text-[#0E1A2B] shadow-card backdrop-blur transition hover:scale-105', className)}
    >
      <Heart className={cn('size-[18px] transition', saved && 'fill-[#F2705B] text-[#F2705B]')} aria-hidden />
    </button>
  );
}

const SHAPES = { tall: 'aspect-[3/4]', square: 'aspect-square', wide: 'aspect-[4/3]' };

/** Pinterest-style editorial card. */
export function DestinationCard({ d, from = 'BOM', priceLabel }: { d: Destination; from?: string; priceLabel?: string }) {
  const href = `/flights?${new URLSearchParams({ from, to: d.airport, date: isoDate(7), adults: '1', cabin: 'economy' })}`;
  return (
    <article className="group relative mb-4 break-inside-avoid overflow-hidden rounded-card bg-surface-2 shadow-card">
      <Link to={href} className="block focus-visible:outline-offset-[-4px]">
        <div className={cn('relative transition duration-500 group-hover:scale-[1.03]', SHAPES[d.shape])}>
          <DestinationArt scene={d.scene} seed={d.cityId} />
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <div className="mb-2 flex flex-wrap gap-1.5">
            {d.tags.map((t) => (
              <span key={t} className="rounded-full bg-white/20 px-2 py-0.5 text-[0.7rem] font-semibold backdrop-blur">
                {t}
              </span>
            ))}
          </div>
          <h3 className="text-xl font-bold tracking-tight">{d.name}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-white/85">{d.blurb}</p>
          <div className="mt-3 flex items-center justify-between">
            <AirportChip code={`${from} → ${d.airport}`} tone="inverse" className="tracking-normal" />
            {priceLabel && <span className="t-price text-sm">{priceLabel}</span>}
          </div>
        </div>
      </Link>
      <SaveButton cityId={d.cityId} name={d.name} className="absolute top-3 right-3" />
    </article>
  );
}
