import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDateTime } from '@/lib/dates';
import { CATEGORY_LABEL, type Ticket, useTicket } from '@/lib/support';

export default function TicketThread() {
  const { ticketId } = useParams();
  const qc = useQueryClient();
  const q = useTicket(ticketId);
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const reply = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('message', message);
      if (file) fd.append('attachment', file);
      return api.post<{ ticket: Ticket }>(`/support/tickets/${ticketId}/messages`, fd);
    },
    onSuccess: (r) => {
      qc.setQueryData(['ticket', ticketId], r.ticket);
      setMessage('');
      setFile(null);
      setFileKey((k) => k + 1);
    },
  });
  const close = useMutation({
    mutationFn: () => api.post<{ ticket: Ticket }>(`/support/tickets/${ticketId}/close`),
    onSuccess: (r) => qc.setQueryData(['ticket', ticketId], r.ticket),
  });

  if (q.isPending) return <div className="container-page max-w-3xl py-10"><SkeletonList count={3} /></div>;
  if (q.isError) return <div className="container-page max-w-3xl py-10"><ErrorState title="Support request not found" error={q.error} /></div>;
  const t = q.data;

  return (
    <div className="container-page max-w-3xl py-6 sm:py-10">
      <Link to="/support/tickets" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Support
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="t-meta">
            {t.reference} · {CATEGORY_LABEL[t.category]}
            {t.relatedBookingRef ? ` · ${t.relatedBookingRef}` : ''}
          </p>
          <h1 className="t-title mt-1">{t.subject}</h1>
        </div>
        <div className="flex gap-2">
          {t.priority === 'urgent' && <Badge tone="coral">Urgent</Badge>}
          <StatusBadge status={t.status === 'open' ? 'open_ticket' : t.status} />
        </div>
      </div>

      <ol className="space-y-4" aria-label="Conversation">
        {t.messages.map((m) => (
          <li key={m.id} className={cn('flex gap-3', m.authorRole === 'customer' && 'flex-row-reverse')}>
            <Avatar name={m.author === 'You' ? 'Y' : 'WAYLO Support'} size="sm" decorative />
            <div className={cn('max-w-[85%] rounded-2xl p-4 text-sm', m.authorRole === 'customer' ? 'bg-primary-soft' : 'border border-line bg-surface')}>
              <p className="text-xs font-semibold text-ink-3">
                {m.author} · {formatDateTime(m.createdAt)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
              {m.attachment && (
                <a href={m.attachment.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
                  <FileText className="size-3.5" aria-hidden /> {m.attachment.name ?? 'Attachment'}
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {t.status === 'closed' ? (
        <Notice tone="info" className="mt-6">
          This request is closed. <Link to="/support/tickets" className="font-semibold text-primary">Open a new one</Link> if you need more help.
        </Notice>
      ) : (
        <Card className="mt-6">
          <CardSection>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (message.trim()) reply.mutate();
              }}
            >
              <Textarea label="Reply" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} />
              <Input key={fileKey} label="Attachment (optional)" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="py-2.5" />
              {reply.isError && <Notice tone="danger">{reply.error instanceof ApiError ? reply.error.message : 'Could not send.'}</Notice>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={reply.isPending} disabled={!message.trim()}>
                  Send reply
                </Button>
                <Button variant="ghost" onClick={() => close.mutate()} loading={close.isPending}>
                  Close request
                </Button>
              </div>
            </form>
          </CardSection>
        </Card>
      )}
    </div>
  );
}
