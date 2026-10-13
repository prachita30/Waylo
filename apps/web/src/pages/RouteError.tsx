import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';

/** Branded fallback for errors thrown while rendering or loading a route. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  // A failed lazy chunk after a deploy is fixed by a reload.
  const chunkFailed = error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-md">
        <Logo className="mb-8 justify-center" />
        <h1 className="t-title">{notFound ? 'We could not find that page' : 'This page hit turbulence'}</h1>
        <p className="t-body mt-3">
          {chunkFailed
            ? 'A newer version of WAYLO is available. Reload to continue.'
            : 'Something unexpected happened. Your bookings are safe. Please try again.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="secondary" asChild>
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
