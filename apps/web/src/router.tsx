import { createBrowserRouter } from 'react-router';
import { PassengerLayout } from '@/components/layout/AppShell';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { UserMenu } from '@/components/layout/UserMenu';
import { RouteError } from '@/pages/RouteError';

const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
  { path: '/login', lazy: lazyPage(() => import('@/pages/auth/Login')), errorElement: <RouteError /> },
  { path: '/register', lazy: lazyPage(() => import('@/pages/auth/Register')), errorElement: <RouteError /> },
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
        ],
      },
      ...(import.meta.env.DEV ? [{ path: 'dev/design', lazy: lazyPage(() => import('@/pages/DesignSystem')) }] : []),
      { path: '*', lazy: lazyPage(() => import('@/pages/NotFound')) },
    ],
  },
]);
