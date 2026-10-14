import { useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable } from '@/components/ui/DataTable';
import { Input, Select } from '@/components/ui/Field';
import { ErrorState, SkeletonList } from '@/components/ui/States';
import { type AdminUser, ROLE_LABEL, useAdminAction, useAdminList } from '@/lib/admin';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { formatDateTime } from '@/lib/dates';
import { ReasonDialog } from './AdminShell';

export default function Users() {
  const me = useMe();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const list = useAdminList<AdminUser>('/admin/users', { q: q || undefined, role: role || undefined, limit: 100 });
  const [suspending, setSuspending] = useState<AdminUser | null>(null);
  const setStatus = useAdminAction(({ id, status, reason }: { id: string; status: 'active' | 'suspended'; reason?: string }) => api.patch(`/admin/users/${id}`, { status, reason }));

  return (
    <>
      <PageHeader title="Users" description="Search accounts, and suspend or reactivate them. Suspension signs the person out everywhere straight away." />
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(search.trim());
        }}
      >
        <Input label="Name or email" value={search} onChange={(e) => setSearch(e.target.value)} wrapperClassName="min-w-56 flex-1" />
        <Select label="Account type" value={role} onChange={(e) => setRole(e.target.value)} wrapperClassName="w-44">
          <option value="">All</option>
          {Object.entries(ROLE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          caption="Users"
          rows={list.data}
          rowKey={(u) => u.id}
          empty="No accounts match"
          columns={[
            {
              key: 'name',
              header: 'Name',
              cell: (u) => (
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {u.fullName} {u.isDemo && <Badge tone="amber">Demo</Badge>}
                  </span>
                  <span className="t-note">{u.email}</span>
                </span>
              ),
            },
            { key: 'role', header: 'Type', cell: (u) => ROLE_LABEL[u.role] },
            { key: 'status', header: 'Status', cell: (u) => (
              <span className="flex flex-col items-start gap-1">
                <StatusBadge status={u.status} />
                {u.suspendedReason && <span className="t-note">{u.suspendedReason}</span>}
              </span>
            ) },
            { key: 'last', header: 'Last sign-in', cell: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'), hideOnMobile: true },
            { key: 'joined', header: 'Joined', cell: (u) => formatDateTime(u.createdAt), hideOnMobile: true },
          ]}
          actions={(u) =>
            u.id === me.data?.user.id || u.status === 'deleted' ? null : u.status === 'suspended' ? (
              <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ id: u.id, status: 'active' })} aria-label={`Reactivate ${u.fullName}`}>
                Reactivate
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setSuspending(u)} aria-label={`Suspend ${u.fullName}`}>
                Suspend
              </Button>
            )
          }
        />
      )}
      <ReasonDialog
        open={!!suspending}
        onClose={() => setSuspending(null)}
        title={`Suspend ${suspending?.fullName ?? ''}?`}
        description="They are signed out and cannot sign in until reactivated. Their bookings and rides are not cancelled automatically."
        confirmLabel="Suspend account"
        onSubmit={(reason) => setStatus.mutateAsync({ id: suspending!.id, status: 'suspended', reason })}
      />
    </>
  );
}
