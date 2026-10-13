import { useSearchParams } from 'react-router';
import { IncidentForm } from '@/features/incidents/IncidentForm';

export default function ReportIncident() {
  const [params] = useSearchParams();
  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="t-title mb-6">Report a safety issue</h1>
      <IncidentForm groupId={params.get('group') ?? undefined} />
    </div>
  );
}
