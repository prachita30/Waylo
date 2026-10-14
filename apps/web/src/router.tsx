import { createBrowserRouter } from 'react-router';
import { PassengerLayout } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { UserMenu } from '@/components/layout/UserMenu';
import { RouteError } from '@/pages/RouteError';
import OperatorShell, { OperatorOutlet } from '@/pages/operator/OperatorShell';
import AdminShell from '@/pages/admin/AdminShell';
import PartnerShell, { PartnerOutlet } from '@/pages/partner/PartnerShell';

const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
  { path: '/login', lazy: lazyPage(() => import('@/pages/auth/Login')), errorElement: <RouteError /> },
  { path: '/register', lazy: lazyPage(() => import('@/pages/auth/Register')), errorElement: <RouteError /> },
  {
    path: '/operator',
    element: <RequireAuth roles={['operator']} />,
    errorElement: <RouteError />,
    children: [
      {
        element: <OperatorShell />,
        children: [
          {
            element: <OperatorOutlet />,
            children: [
              { index: true, lazy: lazyPage(() => import('@/pages/operator/Trips')) },
              { path: 'trips/:groupId', lazy: lazyPage(() => import('@/pages/operator/TripConsole')) },
              { path: 'fleet', lazy: lazyPage(() => import('@/pages/operator/Fleet')) },
              { path: 'availability', lazy: lazyPage(() => import('@/pages/operator/Availability')) },
              { path: 'earnings', lazy: lazyPage(() => import('@/pages/operator/Earnings')) },
              { path: 'incidents', lazy: lazyPage(() => import('@/pages/operator/Incidents')) },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '/partner',
    element: <RequireAuth roles={['partner']} />,
    errorElement: <RouteError />,
    children: [
      {
        element: <PartnerShell />,
        children: [
          {
            element: <PartnerOutlet />,
            children: [
              { index: true, lazy: lazyPage(() => import('@/pages/partner/Overview')) },
              { path: 'offers', lazy: lazyPage(() => import('@/pages/partner/Offers')) },
              { path: 'offers/new', lazy: lazyPage(() => import('@/pages/partner/NewOffer')) },
              { path: 'routes', lazy: lazyPage(() => import('@/pages/partner/Routes')) },
              { path: 'bookings', lazy: lazyPage(() => import('@/pages/partner/Bookings')) },
              { path: 'activity', lazy: lazyPage(() => import('@/pages/partner/Activity')) },
            ],
          },
        ],
      },
    ],
  },
  {
    path: '/admin',
    element: <RequireAuth roles={['admin']} />,
    errorElement: <RouteError />,
    children: [
      {
        element: <AdminShell />,
        children: [
          { index: true, lazy: lazyPage(() => import('@/pages/admin/Overview')) },
          { path: 'review', lazy: lazyPage(() => import('@/pages/admin/Review')) },
          { path: 'support', lazy: lazyPage(() => import('@/pages/admin/Support')) },
          { path: 'support/:ticketId', lazy: async () => ({ Component: (await import('@/pages/admin/Support')).SupportTicket }) },
          { path: 'incidents', lazy: lazyPage(() => import('@/pages/admin/Incidents')) },
          { path: 'bookings', lazy: lazyPage(() => import('@/pages/admin/Bookings')) },
          { path: 'rides', lazy: lazyPage(() => import('@/pages/admin/Rides')) },
          { path: 'offers', lazy: lazyPage(() => import('@/pages/admin/Offers')) },
          { path: 'finance', lazy: lazyPage(() => import('@/pages/admin/Finance')) },
          { path: 'analytics', lazy: lazyPage(() => import('@/pages/admin/Analytics')) },
          { path: 'users', lazy: lazyPage(() => import('@/pages/admin/Users')) },
          { path: 'settings', lazy: lazyPage(() => import('@/pages/admin/Settings')) },
          { path: 'audit', lazy: lazyPage(() => import('@/pages/admin/Audit')) },
          { path: 'sandbox', lazy: lazyPage(() => import('@/pages/admin/Sandbox')) },
        ],
      },
    ],
  },
  {
    element: <PassengerLayout headerRight={<UserMenu />} />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: lazyPage(() => import('@/pages/Home')) },
      { path: 'legal/:slug', lazy: lazyPage(() => import('@/pages/info/LegalPage')) },
      { path: 'partners', lazy: lazyPage(() => import('@/pages/info/Partners')) },
      { path: 'support', lazy: lazyPage(() => import('@/pages/info/SupportInfo')) },
      { path: 'flights', lazy: lazyPage(() => import('@/pages/flights/FlightResults')) },
      { path: 'flights/offers/:offerId', lazy: lazyPage(() => import('@/pages/flights/OfferDetail')) },
      { path: 'rides', lazy: lazyPage(() => import('@/pages/rides/Rides')) },
      {
        element: <RequireAuth />,
        children: [
          { path: 'account', lazy: lazyPage(() => import('@/pages/account/Account')) },
          { path: 'flights/offers/:offerId/book', lazy: lazyPage(() => import('@/pages/flights/Book')) },
          { path: 'pay/sandbox/:intentId', lazy: lazyPage(() => import('@/pages/pay/SandboxCheckout')) },
          { path: 'trips', lazy: lazyPage(() => import('@/pages/trips/Trips')) },
          { path: 'trips/flights/:bookingId', lazy: lazyPage(() => import('@/pages/trips/FlightBookingDetail')) },
          { path: 'rides/new', lazy: lazyPage(() => import('@/pages/rides/NewRide')) },
          { path: 'trips/rides/:requestId', lazy: lazyPage(() => import('@/pages/trips/RideRequestDetail')) },
          { path: 'report-incident', lazy: lazyPage(() => import('@/pages/info/ReportIncident')) },
          { path: 'notifications', lazy: lazyPage(() => import('@/pages/Notifications')) },
          { path: 'support/tickets', lazy: lazyPage(() => import('@/pages/support/SupportTickets')) },
          { path: 'support/tickets/:ticketId', lazy: lazyPage(() => import('@/pages/support/TicketThread')) },
        ],
      },
      ...(import.meta.env.DEV ? [{ path: 'dev/design', lazy: lazyPage(() => import('@/pages/DesignSystem')) }] : []),
      { path: '*', lazy: lazyPage(() => import('@/pages/NotFound')) },
    ],
  },
]);
