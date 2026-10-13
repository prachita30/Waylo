import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './States';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide on small screens (the row becomes a stacked card). */
  hideOnMobile?: boolean;
}

/**
 * Accessible data table. On narrow screens each row is rendered as a labelled card so dense
 * admin data stays readable without horizontal scrolling.
 */
export function DataTable<T>({ rows, columns, rowKey, caption, empty, actions }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; caption: string; empty?: string; actions?: (row: T) => ReactNode }) {
  if (rows.length === 0) return <EmptyState title={empty ?? 'Nothing here yet'} />;
  return (
    <>
      <div className="hidden overflow-x-auto rounded-card border border-line bg-surface shadow-card md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-surface-2/60 text-xs font-semibold tracking-wide text-ink-3 uppercase">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-4 py-3', c.className)}>
                  {c.header}
                </th>
              ))}
              {actions && (
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-surface-2/40">
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-4 py-3 align-middle', c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
                {actions && <td className="px-4 py-3 text-right">{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-card border border-line bg-surface p-4 shadow-card">
            <dl className="space-y-1.5 text-sm">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((c) => (
                  <div key={c.key} className="flex justify-between gap-3">
                    <dt className="text-ink-3">{c.header}</dt>
                    <dd className="text-right font-medium">{c.cell(r)}</dd>
                  </div>
                ))}
            </dl>
            {actions && <div className="mt-3 flex justify-end gap-2">{actions(r)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function MetricCard({ label, value, hint, icon, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'mint' | 'coral' | 'primary' }) {
  const accent = { default: 'bg-surface-2 text-ink-2', mint: 'bg-mint-soft text-mint', coral: 'bg-coral-soft text-coral', primary: 'bg-primary-soft text-primary' }[tone];
  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-2">{label}</p>
        {icon && <span className={cn('grid size-9 place-items-center rounded-xl', accent)}>{icon}</span>}
      </div>
      <p className="t-price mt-3 text-2xl">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}
