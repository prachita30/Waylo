import { zonedTimeToUtc } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, isoDate } from '@/lib/dates';
import { useFleet, useMembership } from '@/lib/operator';

export default function Availability() {
  const qc = useQueryClient();
  const q = useFleet();
  const { data: m } = useMembership();
  const [v, setV] = useState({ driverId: '', vehicleId: '', airport: m?.operator.airports[0] ?? 'BOM', date: isoDate(1), from: '06:00', to: '14:00' });
  const add = useMutation({
    mutationFn: () => {
      const startsAt = zonedTimeToUtc(v.date, v.from, 'Asia/Kolkata');
      let endsAt = zonedTimeToUtc(v.date, v.to, 'Asia/Kolkata');
      if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000); // overnight shift
      return api.post('/operator/availability', { driverId: v.driverId, vehicleId: v.vehicleId, airport: v.airport, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operator-fleet'] }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/operator/availability/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['operator-fleet'] }) });

  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data;
  const approvedDrivers = f.drivers.filter((d) => d.status === 'approved');
  const approvedVehicles = f.vehicles.filter((x) => x.status === 'approved');

  return (
    <>
      <PageHeader title="Shifts" description="Scheduled shifts tell WAYLO which vehicles can take airport trips. Within 48 hours, riders are only matched when a shift covers the pickup." />
      <Card className="mb-8">
        <CardSection>
          <SectionHeader title="Add a shift" />
          <form
            className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Select label="Driver" value={v.driverId} onChange={(e) => setV((s) => ({ ...s, driverId: e.target.value }))} required>
              <option value="">Choose</option>
              {approvedDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
            <Select label="Vehicle" value={v.vehicleId} onChange={(e) => setV((s) => ({ ...s, vehicleId: e.target.value }))} required>
              <option value="">Choose</option>
              {approvedVehicles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.registration}
                </option>
              ))}
            </Select>
            <Select label="Airport" value={v.airport} onChange={(e) => setV((s) => ({ ...s, airport: e.target.value }))}>
              {m?.operator.airports.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </Select>
            <Input label="Date" type="date" min={isoDate(0)} value={v.date} onChange={(e) => setV((s) => ({ ...s, date: e.target.value }))} />
            <Input label="From" type="time" value={v.from} onChange={(e) => setV((s) => ({ ...s, from: e.target.value }))} />
            <Input label="To" type="time" value={v.to} onChange={(e) => setV((s) => ({ ...s, to: e.target.value }))} />
            <div className="sm:col-span-3 lg:col-span-6">
              {add.isError && <Notice tone="danger" className="mb-3">{add.error instanceof ApiError ? add.error.message : 'Could not add shift.'}</Notice>}
              <Button type="submit" loading={add.isPending} disabled={!v.driverId || !v.vehicleId}>
                Add shift
              </Button>
            </div>
          </form>
        </CardSection>
      </Card>
      <SectionHeader title="Upcoming shifts" />
      <DataTable
        caption="Upcoming shifts"
        rows={f.availability}
        rowKey={(s) => s.id}
        empty="No upcoming shifts"
        columns={[
          { key: 'driver', header: 'Driver', cell: (s) => f.drivers.find((d) => d.id === s.driverId)?.fullName ?? '—' },
          { key: 'vehicle', header: 'Vehicle', cell: (s) => f.vehicles.find((x) => x.id === s.vehicleId)?.registration ?? '—' },
          { key: 'airport', header: 'Airport', cell: (s) => s.airportCode },
          { key: 'from', header: 'Starts', cell: (s) => formatDateTime(s.startsAt) },
          { key: 'to', header: 'Ends', cell: (s) => formatDateTime(s.endsAt) },
        ]}
        actions={(s) => (
          <Button variant="ghost" size="sm" aria-label="Remove shift" onClick={() => remove.mutate(s.id)}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        )}
      />
    </>
  );
}
