import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Building2, CarFront, LayoutDashboard, LifeBuoy, Plane, Settings as Cog, Tags } from 'lucide-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PortalLayout } from '@/components/layout/PortalLayout';
import type { AdminOffer, AdminUser, Overview } from '@/lib/admin';
import type { Ticket } from '@/lib/support';
import { META, ME, mockApi, renderRoutes } from '@/test/render';
import AdminOffers from './Offers';
import AdminOverview from './Overview';
import Settings from './Settings';
import { SupportTicket } from './Support';
import Users from './Users';

afterEach(() => vi.unstubAllGlobals());

const ADMIN_ME = { ...ME, user: { ...ME.user, id: 'admin1', email: 'admin@demo.waylo.app', fullName: 'Demo Administrator', role: 'admin' } };
const features = { flightBooking: true, rideRequests: true, partnerOnboarding: true, operatorOnboarding: true };

const overview = (over: Partial<Overview> = {}): Overview => ({
  generatedAt: new Date().toISOString(),
  usersByRole: { passenger: 12, operator: 2, partner: 1, admin: 1 },
  last24h: { bookingsByStatus: { confirmed: 3, ticketing_failed: 1 }, rideGroupsByStatus: {}, ticketingFailed: 1, failedDeliveries: 0 },
  attention: { pendingReviews: { operators: 1, drivers: 0, vehicles: 2, documents: 3, partners: 1 }, openTickets: 4, urgentTickets: 1, openIncidents: 0, criticalIncidents: 0, failedRefunds: 0 },
  features,
  ...over,
});

describe('admin overview', () => {
  it('shows what needs attention from the live counts', async () => {
    mockApi({ 'GET /admin/overview': () => ({ body: overview() }) });
    renderRoutes([{ path: '/', element: <AdminOverview /> }]);
    const review = await screen.findByText('Awaiting review');
    expect(review.closest('a')).toHaveAttribute('href', '/admin/review');
    expect(within(review.closest('a')!).getByText('7')).toBeInTheDocument();
    expect(screen.getByText('1 urgent')).toBeInTheDocument();
    expect(screen.getByText('1 ticketing failures')).toBeInTheDocument();
    expect(screen.getByText('No ride groups in the last 24 hours')).toBeInTheDocument();
    expect(screen.queryByText('Features switched off')).not.toBeInTheDocument();
  });

  it('warns when a feature is switched off', async () => {
    mockApi({ 'GET /admin/overview': () => ({ body: overview({ features: { ...features, flightBooking: false } }) }) });
    renderRoutes([{ path: '/', element: <AdminOverview /> }]);
    expect(await screen.findByText('Features switched off')).toBeInTheDocument();
    expect(screen.getByText(/Flight booking\./)).toBeInTheDocument();
  });
});

const user = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u2',
  email: 'ravi@example.com',
  fullName: 'Ravi Kumar',
  phone: null,
  role: 'passenger',
  status: 'active',
  isDemo: false,
  suspendedReason: null,
  lastLoginAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('admin users', () => {
  it('requires a reason to suspend and never offers self-suspension', async () => {
    const { calls } = mockApi({
      'GET /users/me': () => ({ body: ADMIN_ME }),
      'GET /admin/users': () => ({ body: { items: [user(), user({ id: 'admin1', email: 'admin@demo.waylo.app', fullName: 'Demo Administrator', role: 'admin' })] } }),
      'PATCH /admin/users/u2': () => ({ body: { user: { id: 'u2', status: 'suspended' } } }),
    });
    renderRoutes([{ path: '/', element: <Users /> }]);
    await userEvent.click((await screen.findAllByRole('button', { name: 'Suspend Ravi Kumar' }))[0]!);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Suspend Demo Administrator' })).not.toBeInTheDocument());
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    expect(within(dialog).getByText('Write at least 5 characters.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Repeated payment fraud reports');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend account' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'suspended', reason: 'Repeated payment fraud reports' }));
  });
});

const offer = (over: Partial<AdminOffer> = {}): AdminOffer => ({
  id: 'o1',
  status: 'published',
  source: 'sandbox-airline',
  partner: null,
  flightNumber: 'S1412',
  origin: 'BOM',
  destination: 'GOI',
  departAt: '2026-10-20T03:45:00Z',
  fareMinor: 350_000,
  referenceFareMinor: null,
  referenceSource: null,
  seatsSold: 0,
  inventoryCap: null,
  validUntil: '2026-10-19T00:00:00Z',
  adminHold: false,
  adminHoldReason: null,
  ...over,
});

describe('admin offers', () => {
  it('puts a fare on hold with a reason and releases a held one', async () => {
    const { calls } = mockApi({
      'GET /admin/offers': () => ({ body: { items: [offer(), offer({ id: 'o2', flightNumber: 'S2210', status: 'paused', adminHold: true, adminHoldReason: 'Mis-filed fare' })] } }),
      'POST /admin/offers/o1/hold': () => ({ body: { offer: offer({ adminHold: true }) } }),
      'POST /admin/offers/o2/release': () => ({ body: { offer: offer({ id: 'o2' }) } }),
    });
    renderRoutes([{ path: '/', element: <AdminOffers /> }]);
    expect((await screen.findAllByText('Mis-filed fare')).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole('button', { name: 'Release S2210' })[0]!);
    await waitFor(() => expect(calls.some((c) => c.path === '/admin/offers/o2/release')).toBe(true));

    await userEvent.click(screen.getAllByRole('button', { name: 'Hold S1412' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Reference fare source unverified');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Put on hold' }));
    await waitFor(() => expect(calls.find((c) => c.path === '/admin/offers/o1/hold')?.body).toEqual({ reason: 'Reference fare source unverified' }));
  });
});

describe('admin settings', () => {
  const config = { features, rides: { exitBufferMinutes: 30, lockLeadMinutes: 45, maxParties: 4, defaultSplitMethod: 'equal_per_seat', lateCancelPercent: 25, fullChargeWithinMinutes: 30, pickupGraceMinutes: 15 }, adapters: [{ kind: 'airline', provider: 'sandbox-airline', mode: 'sandbox' }], mode: 'demo' };

  it('confirms before switching a feature off', async () => {
    const { calls } = mockApi({ 'GET /admin/config': () => ({ body: config }), 'PUT /admin/config/features': () => ({ body: { features: { ...features, flightBooking: false } } }) });
    renderRoutes([{ path: '/', element: <Settings /> }]);
    await userEvent.click(await screen.findByRole('switch', { name: /Flight booking/ }));
    const dialog = await screen.findByRole('dialog');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ flightBooking: false }));
    expect(screen.getByText('Sandbox')).toBeInTheDocument();
  });

  it('validates ride rules before saving', async () => {
    const { calls } = mockApi({ 'GET /admin/config': () => ({ body: config }), 'PUT /admin/config/rides': () => ({ body: { rides: config.rides } }) });
    renderRoutes([{ path: '/', element: <Settings /> }]);
    const parties = await screen.findByLabelText('Max parties per vehicle');
    await userEvent.clear(parties);
    await userEvent.type(parties, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save ride rules' }));
    expect(await screen.findByText('Whole number from 2 to 6.')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    await userEvent.clear(parties);
    await userEvent.type(parties, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save ride rules' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ maxParties: 3, pickupGraceMinutes: 15, defaultSplitMethod: 'equal_per_seat' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });
});

describe('admin support thread', () => {
  const ticket: Ticket = {
    id: 't1',
    reference: 'SRABC234',
    category: 'payment_refund',
    subject: 'Refund not received',
    status: 'open',
    priority: 'high',
    relatedBookingRef: 'WYABC234',
    relatedGroupId: null,
    lastActivityAt: '2026-10-13T10:00:00Z',
    createdAt: '2026-10-13T09:00:00Z',
    incidentId: null,
    messages: [
      { id: 'm1', author: 'Ananya Rao', authorRole: 'customer', body: 'It has been 10 days.', internal: false, attachment: null, createdAt: '2026-10-13T09:00:00Z' },
      { id: 'm2', author: 'Demo Administrator', authorRole: 'agent', body: 'Checked provider: refund is processing.', internal: true, attachment: null, createdAt: '2026-10-13T09:30:00Z' },
    ],
  };
  it('marks internal notes and sends a note without notifying the customer', async () => {
    const { calls } = mockApi({
      'GET /support/tickets/t1': () => ({ body: { ticket } }),
      'POST /admin/support/tickets/t1/messages': () => ({ status: 201, body: { ticket } }),
    });
    renderRoutes([{ path: '/admin/support/:ticketId', element: <SupportTicket /> }], '/admin/support/t1');
    const convo = await screen.findByRole('list', { name: 'Conversation' });
    expect(within(convo).getByText(/internal note, not visible to the customer/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Internal note (only agents can see it)'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Internal note' }), 'Escalated to finance.');
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ message: 'Escalated to finance.', internal: true }));
  });
});

describe('portal layout on phones', () => {
  it('puts sections beyond the fourth behind a More sheet', async () => {
    mockApi({ 'GET /meta': () => ({ body: META }), 'GET /users/me': () => ({ body: ADMIN_ME }), 'GET /notifications': () => ({ body: { unread: 0, items: [] } }) });
    const nav = [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/admin/review', label: 'Review', icon: Building2 },
      { to: '/admin/support', label: 'Support', icon: LifeBuoy },
      { to: '/admin/bookings', label: 'Bookings', icon: Plane },
      { to: '/admin/rides', label: 'Rides', icon: CarFront },
      { to: '/admin/offers', label: 'Offers', icon: Tags },
      { to: '/admin/settings', label: 'Settings', icon: Cog },
    ];
    renderRoutes([{ path: '/admin', element: <PortalLayout title="Admin" home="/admin" nav={nav} />, children: [{ index: true, element: <p>home</p> }] }], '/admin');
    const bottom = screen.getAllByRole('navigation', { name: 'Admin navigation' })[1]!;
    expect(within(bottom).queryByRole('link', { name: 'Rides' })).not.toBeInTheDocument();
    await userEvent.click(within(bottom).getByRole('button', { name: 'More' }));
    const sheet = await screen.findByRole('dialog', { name: 'Admin sections' });
    expect(within(sheet).getAllByRole('link').map((l) => l.textContent?.trim())).toEqual(['Rides', 'Offers', 'Settings']);
  });
});
