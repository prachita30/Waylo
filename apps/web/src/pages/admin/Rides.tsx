import { formatMoney } from '@waylo/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { DataTable } from '@/components/ui/DataTable';
import { Segmented } from '@/components/ui/Field';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { type AdminGroup, type AdminRideRequest, useAdminList } from '@/lib/admin';
import { formatDateTime } from '@/lib/dates';

export default function AdminRides() {
  const [tab, setTab] = useState<'groups' | 'requests'>('groups');
  return (
    <>
      <PageHeader title="Shared rides" description="Ride groups from the last two days onward, and recent ride requests." />
      <Segmented
        label="Show"
        className="mb-6 max-w-sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'groups', label: 'Groups' },
          { value: 'requests', label: 'Requests' },
        ]}
      />
      {tab === 'groups' ? <Groups /> : <Requests />}
    </>
  );
}

function Groups() {
  const list = useAdminList<AdminGroup>('/admin/rides/groups', { limit: 100 }, { refetchInterval: 30_000 });
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <DataTable
      caption="Ride groups"
      rows={list.data}
      rowKey={(g) => g.id}
      empty="No ride groups"
      columns={[
        { key: 'pickup', header: 'Pickup', cell: (g) => `${g.airportCode} · ${formatDateTime(g.plannedPickupAt)}` },
        { key: 'vehicle', header: 'Vehicle', cell: (g) => `${g.vehicleClass}, ${g.seatsTaken}/${g.seatCapacity} seats` },
        { key: 'parties', header: 'Parties', cell: (g) => g.parties },
        { key: 'distance', header: 'Route', cell: (g) => `${(g.routeDistanceMeters / 1000).toFixed(1)} km`, hideOnMobile: true },
        { key: 'fare', header: 'Vehicle fare', cell: (g) => formatMoney(g.vehicleFareMinor) },
        { key: 'subsidy', header: 'Platform subsidy', cell: (g) => (g.platformSubsidyMinor ? formatMoney(g.platformSubsidyMinor) : '—'), hideOnMobile: true },
        { key: 'status', header: 'Status', cell: (g) => <StatusBadge status={g.status} /> },
      ]}
    />
  );
}

function Requests() {
  const list = useAdminList<AdminRideRequest>('/admin/rides/requests', { limit: 100 });
  if (list.isPending) return <SkeletonList />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;
  return (
    <DataTable
      caption="Ride requests"
      rows={list.data}
      rowKey={(r) => r.id}
      empty="No ride requests"
      columns={[
        { key: 'arrival', header: 'Arrives', cell: (r) => `${r.airportCode} · ${formatDateTime(r.expectedArrivalAt)}` },
        { key: 'flight', header: 'Flight', cell: (r) => r.flightNumber ?? '—' },
        { key: 'to', header: 'To', cell: (r) => r.destinationArea },
        { key: 'pax', header: 'Travellers', cell: (r) => r.passengers },
        { key: 'created', header: 'Requested', cell: (r) => formatDateTime(r.createdAt), hideOnMobile: true },
        { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      ]}
    />
  );
}
