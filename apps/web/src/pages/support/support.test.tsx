import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationBell } from '@/components/layout/NotificationBell';
import type { Ticket } from '@/lib/support';
import { ME, mockApi, renderRoutes } from '@/test/render';
import Notifications from '../Notifications';
import SupportTickets from './SupportTickets';
import TicketThread from './TicketThread';

afterEach(() => vi.unstubAllGlobals());

const NOTES = {
  unread: 1,
  items: [
    { id: 'n1', kind: 'flight_booking.confirmed', title: 'Your flight is confirmed', body: 'The airline issued your ticket.', link: '/trips/flights/b1', readAt: null, createdAt: new Date().toISOString() },
    { id: 'n2', kind: 'refund.processed', title: 'Refund sent', body: '₹500 refunded.', link: null, readAt: '2026-10-13T10:00:00Z', createdAt: '2026-10-13T09:00:00Z' },
  ],
};

describe('Notifications', () => {
  it('shows the unread count and opens a notification', async () => {
    const { calls } = mockApi({ 'GET /users/me': () => ({ body: ME }), 'GET /notifications': () => ({ body: NOTES }), 'POST /notifications/read': () => ({ status: 204 }) });
    const { router } = renderRoutes([
      { path: '/', element: <NotificationBell /> },
      { path: '/trips/flights/:id', element: <p>booking</p> },
    ]);
    const bell = await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await userEvent.click(bell);
    await userEvent.click(await screen.findByRole('menuitem', { name: /Your flight is confirmed/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips/flights/b1'));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ ids: ['n1'] });
  });

  it('lists all notifications and marks them read', async () => {
    const { calls } = mockApi({ 'GET /users/me': () => ({ body: ME }), 'GET /notifications': () => ({ body: NOTES }), 'POST /notifications/read': () => ({ status: 204 }) });
    renderRoutes([{ path: '/', element: <Notifications /> }]);
    expect(await screen.findByText('Refund sent')).toBeInTheDocument();
    expect(screen.getByText('(unread)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ ids: 'all' }));
  });
});

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 't1',
  reference: 'SRABC234',
  category: 'booking',
  subject: 'Name spelling on ticket',
  status: 'awaiting_customer',
  priority: 'normal',
  relatedBookingRef: 'WYABC234',
  relatedGroupId: null,
  lastActivityAt: '2026-10-13T10:00:00Z',
  createdAt: '2026-10-13T09:00:00Z',
  incidentId: null,
  messages: [
    { id: 'm1', author: 'You', authorRole: 'customer', body: 'My surname is misspelled.', internal: false, attachment: { name: 'id.png', type: 'image/png', url: '/api/v1/support/attachments/m1' }, createdAt: '2026-10-13T09:00:00Z' },
    { id: 'm2', author: 'WAYLO Support', authorRole: 'agent', body: 'We have asked the airline to correct it.', internal: false, attachment: null, createdAt: '2026-10-13T10:00:00Z' },
  ],
  ...over,
});

describe('Support', () => {
  it('opens a new request prefilled from a booking and sends it as multipart', async () => {
    const { calls } = mockApi({
      'GET /support/tickets': () => ({ body: { items: [] } }),
      'POST /support/tickets': () => ({ status: 201, body: { ticket: ticket() } }),
    });
    const { router } = renderRoutes(
      [
        { path: '/support/tickets', element: <SupportTickets /> },
        { path: '/support/tickets/:id', element: <p>thread</p> },
      ],
      '/support/tickets?booking=WYABC234',
    );
    expect(await screen.findByLabelText('Booking reference (optional)')).toHaveValue('WYABC234');
    await userEvent.type(screen.getByLabelText(/Subject/), 'Name spelling on ticket');
    await userEvent.type(screen.getByLabelText(/How can we help/), 'My surname is misspelled on the ticket.');
    await userEvent.click(screen.getByRole('button', { name: /Send request/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/support/tickets/t1'));
    const sent = calls.find((c) => c.method === 'POST')!.body as FormData;
    expect(sent.get('bookingRef')).toBe('WYABC234');
    expect(sent.get('category')).toBe('booking');
  });

  it('warns about emergencies for safety requests', async () => {
    mockApi({ 'GET /support/tickets': () => ({ body: { items: [] } }) });
    renderRoutes([{ path: '/', element: <SupportTickets /> }]);
    await userEvent.click(await screen.findByRole('button', { name: 'New support request' }));
    await userEvent.selectOptions(screen.getByLabelText('What is it about?'), 'safety');
    expect(screen.getByText('Safety concerns are escalated immediately')).toBeInTheDocument();
  });

  it('shows the conversation with attachments and sends a reply', async () => {
    const { calls } = mockApi({
      'GET /support/tickets/t1': () => ({ body: { ticket: ticket() } }),
      'POST /support/tickets/t1/messages': () => ({ status: 201, body: { ticket: ticket({ status: 'open' }) } }),
    });
    renderRoutes([{ path: '/support/tickets/:ticketId', element: <TicketThread /> }], '/support/tickets/t1');
    const convo = await screen.findByRole('list', { name: 'Conversation' });
    expect(within(convo).getByText('We have asked the airline to correct it.')).toBeInTheDocument();
    expect(within(convo).getByRole('link', { name: /id.png/ })).toHaveAttribute('href', '/api/v1/support/attachments/m1');
    await userEvent.type(screen.getByLabelText('Reply'), 'Thank you!');
    await userEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect((calls.find((c) => c.method === 'POST')!.body as FormData).get('message')).toBe('Thank you!'));
  });

  it('offers a new request when the ticket is closed', async () => {
    mockApi({ 'GET /support/tickets/t1': () => ({ body: { ticket: ticket({ status: 'closed' }) } }) });
    renderRoutes([{ path: '/support/tickets/:ticketId', element: <TicketThread /> }], '/support/tickets/t1');
    expect(await screen.findByText(/This request is closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Reply')).not.toBeInTheDocument();
  });
});
