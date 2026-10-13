import { incidentSchema } from '@waylo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Siren } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Select, Textarea } from '@/components/ui/Field';
import { Notice } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';

const CATEGORIES = [
  ['safety', 'Personal safety'],
  ['accident', 'Accident'],
  ['vehicle', 'Vehicle problem'],
  ['passenger_conduct', 'Passenger conduct'],
  ['driver_conduct', 'Driver conduct'],
  ['lost_item', 'Lost item'],
  ['other', 'Something else'],
] as const;

interface Incident {
  id: string;
  category: string;
  severity: string;
  description: string;
  status: string;
  createdAt: string;
}

/** Shared incident report form for riders, drivers and operators. Safety reports are escalated. */
export function IncidentForm({ groupId, defaultCategory = 'safety' }: { groupId?: string; defaultCategory?: string }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState(defaultCategory);
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mine = useQuery({ queryKey: ['incidents-mine'], queryFn: () => api.get<{ items: Incident[] }>('/incidents/mine').then((r) => r.items) });
  const report = useMutation({
    mutationFn: () => api.post('/incidents', { groupId, category, severity, description }),
    onSuccess: async () => {
      setDescription('');
      await qc.invalidateQueries({ queryKey: ['incidents-mine'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not send the report.'),
  });
  return (
    <>
      <div className="mb-6 flex items-start gap-3 rounded-card bg-danger-soft p-4 text-sm">
        <Siren className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <p>
          <strong>In an emergency, call 112 first.</strong> Safety and accident reports are escalated to the WAYLO team immediately.
        </p>
      </div>
      <Card className="mb-8">
        <CardSection>
          <SectionHeader title="Report an incident" />
          <form
            className="grid gap-4 sm:grid-cols-2"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const p = incidentSchema.safeParse({ groupId, category, severity, description });
              if (!p.success) return setError(p.error.issues[0]!.message);
              report.mutate();
            }}
          >
            <Select label="What happened?" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
            <Select label="How serious?" value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </Select>
            <Textarea wrapperClassName="sm:col-span-2" label="Details" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} hint="Include when and where it happened." />
            {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
            {report.isSuccess && <Notice tone="success" className="sm:col-span-2">Thank you. Your report has been sent to the WAYLO team.</Notice>}
            <div className="sm:col-span-2">
              <Button type="submit" variant="danger" loading={report.isPending}>
                Send report
              </Button>
            </div>
          </form>
        </CardSection>
      </Card>
      <SectionHeader title="Your reports" />
      <DataTable
        caption="Your incident reports"
        rows={mine.data ?? []}
        rowKey={(i) => i.id}
        empty="No reports"
        columns={[
          { key: 'date', header: 'Reported', cell: (i) => formatDateTime(i.createdAt) },
          { key: 'cat', header: 'Type', cell: (i) => CATEGORIES.find(([k]) => k === i.category)?.[1] ?? i.category },
          { key: 'sev', header: 'Severity', cell: (i) => <span className="capitalize">{i.severity}</span> },
          { key: 'status', header: 'Status', cell: (i) => <StatusBadge status={i.status === 'investigating' ? 'in_review' : i.status} /> },
        ]}
      />
    </>
  );
}
