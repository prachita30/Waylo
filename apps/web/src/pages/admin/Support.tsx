import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/PortalLayout';
import { Badge, StatusBadge, type Tone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { Checkbox, Segmented, Select, Textarea } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { useAdminList } from '@/lib/admin';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, relativeTime } from '@/lib/dates';
import { CATEGORY_LABEL, type TicketStatus, type TicketSummary, useTicket } from '@/lib/support';

const PRIORITY_TONE: Record<string, Tone> = { urgent: 'danger', high: 'amber', normal: 'neutral' };
const TICKET_STATUS: Record<TicketStatus, string> = { open: 'open_ticket', in_review: 'in_review', awaiting_customer: 'awaiting_customer', resolved: 'resolved', closed: 'closed' };
/** Agent-facing wording; the shared badge says "Awaiting your reply", which is the customer's view. */
const AGENT_LABEL: Partial<Record<TicketStatus, string>> = { awaiting_customer: 'Awaiting customer' };

function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return AGENT_LABEL[status] ? <Badge tone="lavender">{AGENT_LABEL[status]}</Badge> : <StatusBadge status={TICKET_STATUS[status]} />;
}

type QueueTicket = TicketSummary & { customer: string; email: string };

export default function SupportQueue() {
  const [view, setView] = useState<'active' | 'done'>('active');
  const list = useAdminList<QueueTicket>('/admin/support/tickets', { status: view === 'active' ? 'open,in_review,awaiting_customer' : 'resolved,closed' }, { refetchInterval: 30_000 });
  return (
    <>
      <PageHeader title="Support" description="Urgent and high-priority requests come first, then the longest-waiting." />
      <Segmented
        label="Show"
        className="mb-6 max-w-sm"
        value={view}
        onChange={setView}
        options={[
          { value: 'active', label: 'Active' },
          { value: 'done', label: 'Resolved & closed' },
        ]}
      />
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          caption="Support requests"
          rows={list.data}
          rowKey={(t) => t.id}
          empty="The queue is empty"
          columns={[
            {
              key: 'subject',
              header: 'Request',
              cell: (t) => (
                <Link to={`/admin/support/${t.id}`} className="flex flex-col hover:underline">
                  <span className="font-semibold">{t.subject}</span>
                  <span className="t-note">
                    {t.reference} · {CATEGORY_LABEL[t.category]}
                  </span>
                </Link>
              ),
            },
            { key: 'customer', header: 'Customer', cell: (t) => t.customer, hideOnMobile: true },
            { key: 'priority', header: 'Priority', cell: (t) => <Badge tone={PRIORITY_TONE[t.priority] ?? 'neutral'}>{t.priority}</Badge> },
            { key: 'status', header: 'Status', cell: (t) => <TicketStatusBadge status={t.status} /> },
            { key: 'activity', header: 'Last activity', cell: (t) => relativeTime(t.lastActivityAt) },
          ]}
        />
      )}
    </>
  );
}

export function SupportTicket() {
  const { ticketId } = useParams();
  const q = useTicket(ticketId);
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ticket', ticketId] });
    qc.invalidateQueries({ queryKey: ['admin'] });
  };
  const reply = useMutation({
    mutationFn: () => api.post(`/admin/support/tickets/${ticketId}/messages`, { message, internal, status: status || undefined }),
    onSuccess: () => {
      setMessage('');
      setStatus('');
      setError(null);
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not send.'),
  });
  const update = useMutation({ mutationFn: (patch: { status?: string; priority?: string }) => api.patch(`/admin/support/tickets/${ticketId}`, patch), onSuccess: refresh });

  if (q.isPending) return <SkeletonList />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/admin/support" className="t-note mb-2 inline-block hover:underline">
        ← Support queue
      </Link>
      <PageHeader
        title={t.subject}
        description={
          <>
            {t.reference} · {CATEGORY_LABEL[t.category]}
            {t.relatedBookingRef && ` · Booking ${t.relatedBookingRef}`} · opened {formatDateTime(t.createdAt)}
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <TicketStatusBadge status={t.status} />
        <Select label="Priority" value={t.priority} onChange={(e) => update.mutate({ priority: e.target.value })} wrapperClassName="w-36">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
        {t.status !== 'closed' && (
          <Button size="sm" variant="secondary" onClick={() => update.mutate({ status: 'resolved' })} disabled={t.status === 'resolved'}>
            Mark resolved
          </Button>
        )}
      </div>
      {t.category === 'safety' && (
        <Notice tone="danger" title="Safety request" className="mb-6">
          This request is linked to a safety incident. Follow the incident procedure as well as replying here.
        </Notice>
      )}
      <ol aria-label="Conversation" className="mb-6 space-y-3">
        {t.messages.map((m) => (
          <li key={m.id}>
            <Card className={m.internal ? 'border-amber/50 bg-amber/10' : m.authorRole === 'agent' ? 'bg-lavender/40' : undefined}>
              <CardSection>
                <p className="t-note mb-1 flex items-center gap-1.5">
                  {m.internal && <Lock className="size-3.5" aria-label="Internal note" />}
                  <span className="font-semibold text-ink">{m.author}</span> · {formatDateTime(m.createdAt)}
                  {m.internal && ' · internal note, not visible to the customer'}
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
                {m.attachment && (
                  <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
                    <Paperclip className="size-4" aria-hidden /> {m.attachment.name}
                  </a>
                )}
              </CardSection>
            </Card>
          </li>
        ))}
      </ol>
      {t.status === 'closed' ? (
        <Notice tone="info">This request is closed.</Notice>
      ) : (
        <Card>
          <CardSection>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!message.trim()) return setError('Write a message first.');
                reply.mutate();
              }}
            >
              <Textarea label={internal ? 'Internal note' : 'Reply to customer'} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} error={error ?? undefined} />
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Checkbox label="Internal note (only agents can see it)" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                <Select label="Then set status" value={status} onChange={(e) => setStatus(e.target.value)} wrapperClassName="w-52">
                  <option value="">{internal ? 'Keep current' : 'Awaiting customer'}</option>
                  <option value="in_review">In review</option>
                  <option value="awaiting_customer">Awaiting customer</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </Select>
              </div>
              <Button type="submit" loading={reply.isPending}>
                {internal ? 'Add note' : 'Send reply'}
              </Button>
            </form>
          </CardSection>
        </Card>
      )}
    </div>
  );
}
