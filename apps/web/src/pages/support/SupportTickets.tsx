import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, LifeBuoy, Paperclip, Siren } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { EmptyState, ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/dates';
import { CATEGORY_LABEL, type Ticket, type TicketSummary, useTickets } from '@/lib/support';

const STATUS_BADGE: Record<TicketSummary['status'], string> = { open: 'open_ticket', in_review: 'in_review', awaiting_customer: 'awaiting_customer', resolved: 'resolved', closed: 'closed' };

export default function SupportTickets() {
  const [params] = useSearchParams();
  const q = useTickets();
  const prefill = params.get('booking') || params.get('group');
  return (
    <div className="container-page max-w-3xl py-8 sm:py-12">
      <h1 className="t-title flex items-center gap-2">
        <LifeBuoy className="size-7 text-primary" aria-hidden /> Support
      </h1>
      <p className="t-body mt-2">We usually reply within a few hours. Safety concerns go straight to a person on our team.</p>
      <div className="mt-4 flex items-start gap-3 rounded-card bg-danger-soft p-4 text-sm">
        <Siren className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <p>
          <strong>In an emergency, call 112.</strong>
        </p>
      </div>
      <NewTicket defaultOpen={!!prefill} />
      <section className="mt-10" aria-labelledby="my-tickets">
        <SectionHeader title="Your requests" />
        <h2 id="my-tickets" className="sr-only">
          Your requests
        </h2>
        {q.isPending ? (
          <SkeletonList />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState title="No support requests" body="If something goes wrong with a trip, we are here to help." />
        ) : (
          <ul className="space-y-3">
            {q.data.map((t) => (
              <li key={t.id}>
                <Link to={`/support/tickets/${t.id}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-4 shadow-card hover:border-ink-3/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.subject}</p>
                    <p className="text-xs text-ink-3">
                      {t.reference} · {CATEGORY_LABEL[t.category]} · updated {formatDateTime(t.lastActivityAt)}
                    </p>
                  </div>
                  <StatusBadge status={STATUS_BADGE[t.status]} />
                  <ChevronRight className="size-5 text-ink-3" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewTicket({ defaultOpen }: { defaultOpen: boolean }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(defaultOpen);
  const [category, setCategory] = useState(params.get('group') ? 'ride' : 'booking');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [bookingRef, setBookingRef] = useState(params.get('booking') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('category', category);
      fd.append('subject', subject);
      fd.append('message', message);
      if (bookingRef) fd.append('bookingRef', bookingRef);
      if (params.get('group')) fd.append('groupId', params.get('group')!);
      if (file) fd.append('attachment', file);
      return api.post<{ ticket: Ticket }>('/support/tickets', fd);
    },
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/support/tickets/${r.ticket.id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.fieldErrors())[0] ?? e.message) : 'Could not send your request.'),
  });

  if (!open) {
    return (
      <Button className="mt-6" onClick={() => setOpen(true)}>
        New support request
      </Button>
    );
  }
  return (
    <Card className="mt-6">
      <CardSection>
        <SectionHeader title="New support request" />
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <Select label="What is it about?" value={category} onChange={(e) => setCategory(e.target.value)}>
            {Object.entries(CATEGORY_LABEL).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Input label="Booking reference (optional)" placeholder="WY…" value={bookingRef} onChange={(e) => setBookingRef(e.target.value.toUpperCase())} maxLength={8} />
          <Input wrapperClassName="sm:col-span-2" label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} required />
          <Textarea wrapperClassName="sm:col-span-2" label="How can we help?" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} required />
          <Input wrapperClassName="sm:col-span-2" label="Attachment (optional)" hint="PDF, PNG or JPEG up to 5 MB, e.g. a receipt." type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-2.5" />
          {category === 'safety' && (
            <Notice tone="danger" className="sm:col-span-2" title="Safety concerns are escalated immediately">
              If you are in danger right now, call 112 first.
            </Notice>
          )}
          {error && <Notice tone="danger" className="sm:col-span-2">{error}</Notice>}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" loading={create.isPending}>
              <Paperclip className="size-4" aria-hidden /> Send request
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardSection>
    </Card>
  );
}
