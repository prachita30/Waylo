import { useSearchParams } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { IncidentForm } from '@/features/incidents/IncidentForm';

export default function OperatorIncidents() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader title="Incidents" description="Report safety issues, accidents, vehicle problems or conduct concerns." />
      <IncidentForm groupId={params.get('trip') ?? undefined} />
    </>
  );
}
