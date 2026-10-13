import type { Role } from '@waylo/shared';
import { ShieldAlert } from 'lucide-react';
import { Link, Navigate, Outlet, useLocation } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { homeForRole, useMe } from '@/lib/auth';
import { PageFallback } from './AppShell';

/**
 * Client-side route gate for a smoother UX. The API enforces every permission independently;
 * this only decides what to render.
 */
export function RequireAuth({ roles }: { roles?: Role[] }) {
  const { data, isPending, error, refetch } = useMe();
  const location = useLocation();
  if (isPending) return <PageFallback />;
  if (error) return <div className="container-page py-10"><ErrorState error={error} onRetry={() => refetch()} /></div>;
  if (!data) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !roles.includes(data.user.role)) {
    return (
      <div className="container-page py-16">
        <EmptyState
          icon={<ShieldAlert className="size-6" aria-hidden />}
          title="This area is not available for your account"
          body="You are signed in, but this section needs a different account type."
          action={
            <Button asChild>
              <Link to={homeForRole(data.user.role)}>Go to my home</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return <Outlet />;
}
