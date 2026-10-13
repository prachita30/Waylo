import { formatMoney } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Users } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Checkbox } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { RideMatchCard } from '@/components/travel/RideMatchCard';
import { api, ApiError } from '@/lib/api';
import { type MatchOption, type RideRequest, useMatches } from '@/lib/rides';

type Pending = { kind: 'join'; option: MatchOption & { groupId: string } } | { kind: 'start'; option: MatchOption };

export function MatchesPanel({ request }: { request: RideRequest }) {
  const qc = useQueryClient();
  const q = useMatches(request.id, request.status === 'open');
  const [pending, setPending] = useState<Pending | null>(null);
  const [soloOk, setSoloOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const act = useMutation({
    mutationFn: async (p: Pending) =>
      p.kind === 'join'
        ? api.post(`/rides/groups/${p.option.groupId}/join`, { requestId: request.id, acceptedMaxTotalMinor: p.option.you.price.totalMinor })
        : api.post('/rides/groups', { requestId: request.id, soloOk, splitMethod: p.option.splitMethod, acceptedMaxTotalMinor: p.option.you.price.totalMinor }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ride-request', request.id] });
      await qc.invalidateQueries({ queryKey: ['ride-requests'] });
    },
  });

  if (q.isPending) return <SkeletonList count={2} className="mb-6" />;
  if (q.isError) return <ErrorState className="mb-6" title="We could not load matches" error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data;

  return (
    <section className="mb-8" aria-labelledby="matches-heading">
      <SectionHeader
        eyebrow="Matches"
        title="Choose how to get there"
        action={m.compatibleOpenRequests > 0 ? <span className="flex items-center gap-1 text-sm font-semibold text-mint"><Sparkles className="size-4" aria-hidden /> {m.compatibleOpenRequests} more heading your way</span> : undefined}
      />
      <h2 id="matches-heading" className="sr-only">
        Ride matches
      </h2>
      <Notice tone="success" className="mb-4">
        {m.policy.priceGuarantee}
      </Notice>
      <div className="space-y-4">
        {m.groups.map((g, i) => (
          <RideMatchCard
            key={g.groupId}
            option={g}
            highlight={i === 0}
            action={
              <Button variant="mint" onClick={() => { setErr(null); setPending({ kind: 'join', option: g }); }}>
                Join for {formatMoney(g.you.price.totalMinor)}
              </Button>
            }
          />
        ))}
        {m.groups.length === 0 && (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title="No groups to join yet"
            body={m.compatibleOpenRequests > 0 ? 'Start a group and compatible travellers will see it.' : 'Start a group now. Riders who request later will be able to join you.'}
          />
        )}
        {m.newGroup ? (
          <RideMatchCard
            option={m.newGroup}
            action={
              <Button variant="secondary" onClick={() => { setErr(null); setPending({ kind: 'start', option: m.newGroup! }); }}>
                Start a group
              </Button>
            }
          />
        ) : (
          m.newGroupBlockedBy && <Notice tone="warning" title="A new group is not available">{m.newGroupBlockedBy.join(' · ')}</Notice>
        )}
      </div>

      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setPending(null)}
          title={pending.kind === 'join' ? 'Join this group?' : 'Start a group?'}
          description={
            pending.kind === 'join'
              ? `You agree to pay at most ${formatMoney(pending.option.you.price.totalMinor)}. Your price drops if more riders join.`
              : `You agree to pay at most ${formatMoney(pending.option.you.price.totalMinor)}, the price for this vehicle alone. Each rider who joins lowers it.`
          }
          confirmLabel={pending.kind === 'join' ? 'Join group' : 'Start group'}
          onConfirm={async () => {
            setErr(null);
            try {
              await act.mutateAsync(pending);
              setPending(null);
            } catch (e) {
              setErr(e instanceof ApiError ? e.message : 'Something went wrong.');
              await q.refetch();
              throw e;
            }
          }}
        >
          <div className="space-y-3 text-sm">
            {pending.kind === 'start' && (
              <Checkbox
                checked={soloOk}
                onChange={(e) => setSoloOk(e.target.checked)}
                label="If nobody joins, I will ride alone at this price"
                description="Otherwise we release your request at no cost when the group locks."
              />
            )}
            <p className="text-ink-3">{m.policy.beforeLock} {m.policy.afterLock}</p>
            <p className="text-ink-3">{m.policy.waiting}</p>
            {err && <Notice tone="danger">{err}</Notice>}
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}
