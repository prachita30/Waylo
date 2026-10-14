import { CarFront, ChartColumn, FlaskConical, IndianRupee, LayoutDashboard, LifeBuoy, Plane, ScrollText, Settings, ShieldAlert, ShieldCheck, Tags, Users } from 'lucide-react';
import { useState } from 'react';
import { PortalLayout, type PortalNavItem } from '@/components/layout/PortalLayout';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Textarea } from '@/components/ui/Field';
import { Notice } from '@/components/ui/States';
import { ApiError } from '@/lib/api';
import { useMeta } from '@/lib/meta';

const NAV: PortalNavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/review', label: 'Review', icon: ShieldCheck },
  { to: '/admin/support', label: 'Support', icon: LifeBuoy },
  { to: '/admin/incidents', label: 'Incidents', icon: ShieldAlert },
  { to: '/admin/bookings', label: 'Bookings', icon: Plane },
  { to: '/admin/rides', label: 'Rides', icon: CarFront },
  { to: '/admin/offers', label: 'Offers', icon: Tags },
  { to: '/admin/finance', label: 'Finance', icon: IndianRupee },
  { to: '/admin/analytics', label: 'Analytics', icon: ChartColumn },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { to: '/admin/sandbox', label: 'Sandbox', icon: FlaskConical },
];

export default function AdminShell() {
  const meta = useMeta();
  // The sandbox tools only make sense while sandbox adapters are in use.
  const nav = meta.data && !meta.data.demo ? NAV.filter((n) => n.to !== '/admin/sandbox') : NAV;
  return <PortalLayout title="Admin" home="/admin" nav={nav} />;
}

/** Collects a written reason before a consequential admin action (suspend, reject, hold). */
export function ReasonDialog({
  open,
  onClose,
  title,
  description,
  label = 'Reason',
  confirmLabel,
  tone = 'danger',
  minLength = 5,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  label?: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  minLength?: number;
  onSubmit: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => {
    setReason('');
    setError(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !busy && close()}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Go back
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              if (reason.trim().length < minLength) return setError(`Write at least ${minLength} characters.`);
              setBusy(true);
              try {
                await onSubmit(reason.trim());
                close();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Textarea label={label} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} error={error ?? undefined} />
      <p className="t-note mt-2">Recorded in the audit log with your name.</p>
      {tone === 'danger' && <Notice tone="info" className="mt-3">This takes effect immediately.</Notice>}
    </Dialog>
  );
}
