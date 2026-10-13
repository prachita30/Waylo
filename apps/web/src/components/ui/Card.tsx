import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface shadow-card', className)} {...rest} />;
}

export function CardSection({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 sm:p-6', className)} {...rest} />;
}

export function SectionHeader({
  title,
  eyebrow,
  action,
  className,
}: {
  title: string;
  eyebrow?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-5 flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="t-meta mb-1.5">{eyebrow}</p>}
        <h2 className="t-section">{title}</h2>
      </div>
      {action}
    </div>
  );
}
