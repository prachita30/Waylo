import { Minus, Plus } from 'lucide-react';
import { useId, type ReactNode } from 'react';

/** Accessible numeric stepper (spinbutton) for small counts like travellers or bags. */
export function Stepper({
  label,
  hint,
  value,
  min = 0,
  max = 9,
  onChange,
  icon,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  icon?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-3">
        {icon && <span className="grid size-9 place-items-center rounded-xl bg-surface-2 text-ink-2">{icon}</span>}
        <div>
          <p id={`${id}-label`} className="text-sm font-semibold">
            {label}
          </p>
          {hint && <p className="text-xs text-ink-3">{hint}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full border border-line text-ink-2 hover:text-ink disabled:opacity-40"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <span
          role="spinbutton"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') onChange(Math.min(max, value + 1));
            if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') onChange(Math.max(min, value - 1));
          }}
          className="w-6 text-center font-semibold tabular-nums"
        >
          {value}
        </span>
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full border border-line text-ink-2 hover:text-ink disabled:opacity-40"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
