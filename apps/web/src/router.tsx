import { createBrowserRouter } from 'react-router';
import { PassengerLayout } from '@/components/layout/AppShell';
import { RouteError } from '@/pages/RouteError';

const lazyPage = (load: () => Promise<{ default: React.ComponentType }>) => async () => ({ Component: (await load()).default });

export const router = createBrowserRouter([
  {
    element: <PassengerLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: lazyPage(() => import('@/pages/Home')) },
      ...(import.meta.env.DEV ? [{ path: 'dev/design', lazy: lazyPage(() => import('@/pages/DesignSystem')) }] : []),
      { path: '*', lazy: lazyPage(() => import('@/pages/NotFound')) },
    ],
  },
]);
