import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Select } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { useAirports } from '@/lib/meta';
import { usePartnerRoutes } from '@/lib/partner';

export default function Routes() {
  const qc = useQueryClient();
  const airports = useAirports();
  const q = usePartnerRoutes();
  const [origin, setOrigin] = useState('BOM');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['partner-routes'] });
  const add = useMutation({
    mutationFn: () => api.post('/partner/routes', { origin, destination }),
    onSuccess: () => {
      setError(null);
      setDestination('');
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not add the route.'),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/partner/routes/${id}`), onSuccess: refresh });

  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const label = (code: string) => {
    const a = airports.data?.find((x) => x.code === code);
    return a ? `${a.city} (${code})` : code;
  };

  return (
    <>
      <PageHeader title="Routes" description="Your network. Offers can only be created on active routes; deactivating a route keeps existing offers and bookings." />
      <Card className="mb-8">
        <CardSection>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!destination || origin === destination) return setError('Choose two different airports.');
              add.mutate();
            }}
          >
            <Select label="From" value={origin} onChange={(e) => setOrigin(e.target.value)} wrapperClassName="min-w-40 flex-1">
              {airports.data?.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.city} ({a.code})
                </option>
              ))}
            </Select>
            <Select label="To" value={destination} onChange={(e) => setDestination(e.target.value)} wrapperClassName="min-w-40 flex-1">
              <option value="">Choose</option>
              {airports.data
                ?.filter((a) => a.code !== origin)
                .map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.city} ({a.code})
                  </option>
                ))}
            </Select>
            <Button type="submit" loading={add.isPending}>
              Add route
            </Button>
          </form>
          {error && (
            <Notice tone="danger" className="mt-4">
              {error}
            </Notice>
          )}
        </CardSection>
      </Card>
      <DataTable
        caption="Routes"
        rows={q.data}
        rowKey={(r) => r.id}
        empty="Add the routes you sell"
        columns={[
          { key: 'from', header: 'From', cell: (r) => label(r.origin) },
          { key: 'to', header: 'To', cell: (r) => label(r.destination) },
          { key: 'state', header: 'State', cell: (r) => <Badge tone={r.active ? 'mint' : 'neutral'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
        ]}
        actions={(r) =>
          r.active ? (
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(r.id)} aria-label={`Deactivate ${r.origin} to ${r.destination}`}>
              Deactivate
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Reactivate ${r.origin} to ${r.destination}`}
              onClick={() => api.post('/partner/routes', { origin: r.origin, destination: r.destination }).then(refresh)}
            >
              Reactivate
            </Button>
          )
        }
      />
    </>
  );
}
