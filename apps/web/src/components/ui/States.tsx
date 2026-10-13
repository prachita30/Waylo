import { AlertTriangle, Compass, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-surface-2', className)} aria-hidden />;
}

export function SkeletonList({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-28 w-full rounded-card" />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center rounded-card border border-dashed border-line px-6 py-12 text-center', className)}>
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-lavender text-primary">
        {icon ?? <Compass className="size-6" aria-hidden />}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body && <p className="t-body mt-1.5 max-w-md">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : 'Please try again in a moment.';
  return (
    <div role="alert" className={cn('flex flex-col items-center rounded-card bg-danger-soft/60 px-6 py-10 text-center', className)}>
      <AlertTriangle className="mb-3 size-7 text-danger" aria-hidden />
      <h3 className="font-semibold">{title}</h3>
      <p className="t-body mt-1 max-w-md">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'bg-sky text-ink border-primary/15',
    success: 'bg-mint-soft text-ink border-mint/20',
    warning: 'bg-amber-soft text-ink border-amber/25',
    danger: 'bg-danger-soft text-ink border-danger/25',
  }[tone];
  return (
    <div role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'} className={cn('rounded-2xl border px-4 py-3 text-sm', styles, className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn('text-ink-2', title && 'mt-0.5')}>{children}</div>}
    </div>
  );
}
