import { driverSchema, VEHICLE_CLASSES, vehicleSchema } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Accessibility, FileUp, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { PageHeader } from '@/components/layout/PortalLayout';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Dialog } from '@/components/ui/Dialog';
import { Checkbox, Input, Select } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { DOC_LABEL, type Fleet as FleetData, useFleet } from '@/lib/operator';
import { VEHICLE_LABEL } from '@/lib/rides';

export default function Fleet() {
  const q = useFleet();
  const [dialog, setDialog] = useState<'vehicle' | 'driver' | 'document' | null>(null);
  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data;
  const subjectName = (type: string, id: string) =>
    type === 'vehicle' ? (f.vehicles.find((v) => v.id === id)?.registration ?? 'Vehicle') : type === 'driver' ? (f.drivers.find((d) => d.id === id)?.fullName ?? 'Driver') : 'Company';

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Vehicles, drivers and documents are reviewed by WAYLO before they can carry passengers."
        actions={
          <>
            <Button size="sm" onClick={() => setDialog('vehicle')}>
              <Plus className="size-4" aria-hidden /> Vehicle
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog('driver')}>
              <Plus className="size-4" aria-hidden /> Driver
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDialog('document')}>
              <FileUp className="size-4" aria-hidden /> Document
            </Button>
          </>
        }
      />
      <section className="mb-10">
        <SectionHeader title="Vehicles" />
        <DataTable
          caption="Vehicles"
          rows={f.vehicles}
          rowKey={(v) => v.id}
          empty="Add your first vehicle"
          columns={[
            { key: 'reg', header: 'Registration', cell: (v) => <span className="font-mono font-semibold">{v.registration}</span> },
            { key: 'model', header: 'Vehicle', cell: (v) => `${v.colour} ${v.makeModel}` },
            { key: 'class', header: 'Class', cell: (v) => VEHICLE_LABEL[v.vehicleClass] },
            {
              key: 'cap',
              header: 'Capacity',
              cell: (v) => (
                <span className="inline-flex items-center gap-1">
                  {v.seats} seats · {v.luggageUnits} bag units {v.wheelchairAccessible && <Accessibility className="size-4 text-mint" aria-label="Wheelchair accessible" />}
                </span>
              ),
            },
            { key: 'status', header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
          ]}
        />
      </section>
      <section className="mb-10">
        <SectionHeader title="Drivers" />
        <DataTable
          caption="Drivers"
          rows={f.drivers}
          rowKey={(d) => d.id}
          empty="Add your first driver"
          columns={[
            { key: 'name', header: 'Name', cell: (d) => <span className="font-semibold">{d.fullName}</span> },
            { key: 'phone', header: 'Phone', cell: (d) => d.phone },
            { key: 'lic', header: 'Licence', cell: (d) => `•••• ${d.licenceLast4}` },
            { key: 'app', header: 'App login', cell: (d) => (d.userId ? 'Linked' : 'Not linked'), hideOnMobile: true },
            { key: 'status', header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
          ]}
        />
      </section>
      <section>
        <SectionHeader title="Documents" />
        <DataTable
          caption="Documents"
          rows={f.documents}
          rowKey={(d) => d.id}
          empty="Upload permits, insurance, registration and licences"
          columns={[
            { key: 'type', header: 'Document', cell: (d) => DOC_LABEL[d.docType] ?? d.docType },
            { key: 'for', header: 'For', cell: (d) => subjectName(d.subjectType, d.subjectId) },
            { key: 'exp', header: 'Expires', cell: (d) => (d.expiresOn ? formatDate(`${d.expiresOn}T12:00:00Z`, 'UTC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—') },
            { key: 'status', header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
          ]}
          actions={(d) => (
            <a className="text-sm font-semibold text-primary hover:underline" href={`/api/v1/operator/documents/${d.id}/file`} target="_blank" rel="noreferrer">
              View
            </a>
          )}
        />
      </section>
      {dialog === 'vehicle' && <VehicleDialog onClose={() => setDialog(null)} />}
      {dialog === 'driver' && <DriverDialog onClose={() => setDialog(null)} />}
      {dialog === 'document' && <DocumentDialog fleet={f} onClose={() => setDialog(null)} />}
    </>
  );
}

function useFleetMutation(onClose: () => void) {
  const qc = useQueryClient();
  return {
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['operator-fleet'] });
      onClose();
    },
  };
}

function VehicleDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ vehicleClass: 'sedan' as 'sedan' | 'suv' | 'van', makeModel: '', colour: '', registration: '', seats: 4, luggageUnits: 6, wheelchairAccessible: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post('/operator/vehicles', v),
    ...useFleetMutation(onClose),
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors(), form: e.message }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = vehicleSchema.safeParse(v);
    if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
    save.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a vehicle">
      <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Class"
          value={v.vehicleClass}
          onChange={(e) => {
            const c = e.target.value as 'sedan' | 'suv' | 'van';
            setV((s) => ({ ...s, vehicleClass: c, seats: VEHICLE_CLASSES[c].seats, luggageUnits: VEHICLE_CLASSES[c].luggageUnits }));
          }}
        >
          {(['sedan', 'suv', 'van'] as const).map((c) => (
            <option key={c} value={c}>
              {VEHICLE_LABEL[c]}
            </option>
          ))}
        </Select>
        <Input label="Registration" placeholder="MH 01 AB 1234" value={v.registration} onChange={(e) => setV((s) => ({ ...s, registration: e.target.value }))} error={errors.registration} />
        <Input label="Make and model" value={v.makeModel} onChange={(e) => setV((s) => ({ ...s, makeModel: e.target.value }))} error={errors.makeModel} />
        <Input label="Colour" value={v.colour} onChange={(e) => setV((s) => ({ ...s, colour: e.target.value }))} error={errors.colour} />
        <Input label="Passenger seats" type="number" min={2} max={12} value={v.seats} onChange={(e) => setV((s) => ({ ...s, seats: Number(e.target.value) }))} error={errors.seats} />
        <Input label="Luggage capacity (bag units)" type="number" min={2} max={24} value={v.luggageUnits} onChange={(e) => setV((s) => ({ ...s, luggageUnits: Number(e.target.value) }))} hint="Cabin bag 1, medium 2, large 3." error={errors.luggageUnits} />
        <Checkbox className="sm:col-span-2" checked={v.wheelchairAccessible} onChange={(e) => setV((s) => ({ ...s, wheelchairAccessible: e.target.checked }))} label="Wheelchair accessible (ramp or lift)" />
        {errors.form && <Notice tone="danger" className="sm:col-span-2">{errors.form}</Notice>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit for review
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DriverDialog({ onClose }: { onClose: () => void }) {
  const [v, setV] = useState({ fullName: '', phone: '', licenceLast4: '', userEmail: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.post('/operator/drivers', v),
    ...useFleetMutation(onClose),
    onError: (e) => e instanceof ApiError && setErrors({ ...e.fieldErrors(), form: e.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a driver" description="We store only the last 4 characters of the licence number. Upload the licence as a document for verification.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const p = driverSchema.safeParse(v);
          if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
          save.mutate();
        }}
      >
        <Input label="Full name" value={v.fullName} onChange={(e) => setV((s) => ({ ...s, fullName: e.target.value }))} error={errors.fullName} />
        <Input label="Mobile" type="tel" placeholder="+91" value={v.phone} onChange={(e) => setV((s) => ({ ...s, phone: e.target.value }))} error={errors.phone} />
        <Input label="Licence number (last 4 characters)" maxLength={4} value={v.licenceLast4} onChange={(e) => setV((s) => ({ ...s, licenceLast4: e.target.value }))} error={errors.licenceLast4} />
        <Input label="Driver's WAYLO login email (optional)" type="email" hint="An operator account the driver uses to update trips." value={v.userEmail} onChange={(e) => setV((s) => ({ ...s, userEmail: e.target.value }))} error={errors.userEmail} />
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Submit for review
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DocumentDialog({ fleet, onClose }: { fleet: FleetData; onClose: () => void }) {
  const [subject, setSubject] = useState('operator:');
  const [docType, setDocType] = useState('operator_permit');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const [subjectType, subjectId] = subject.split(':');
      const fd = new FormData();
      fd.append('subjectType', subjectType!);
      fd.append('subjectId', subjectId || ((await api.get<{ membership: { operator: { id: string } } }>('/operator/me')).membership.operator.id));
      fd.append('docType', docType);
      if (expiresOn) fd.append('expiresOn', expiresOn);
      fd.append('file', file!);
      return api.post('/operator/documents', fd);
    },
    ...useFleetMutation(onClose),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Upload a document" description="PDF, PNG or JPEG up to 5 MB. Documents are visible only to your team and WAYLO reviewers.">
      <div className="space-y-4">
        <Select label="For" value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="operator:">Company</option>
          {fleet.vehicles.map((v) => (
            <option key={v.id} value={`vehicle:${v.id}`}>
              Vehicle {v.registration}
            </option>
          ))}
          {fleet.drivers.map((d) => (
            <option key={d.id} value={`driver:${d.id}`}>
              Driver {d.fullName}
            </option>
          ))}
        </Select>
        <Select label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)}>
          {Object.entries(DOC_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Input label="Expiry date (if any)" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        <Input label="File" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-2.5" />
        {save.isError && <Notice tone="danger">{(save.error as Error).message}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file} loading={save.isPending} onClick={() => save.mutate()}>
            Upload
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
