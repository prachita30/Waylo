import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StatusBadge, statusLabel } from './Badge';
import { Button } from './Button';
import { ConfirmDialog } from './Dialog';
import { Input, Segmented } from './Field';

describe('UI primitives', () => {
  it('disables a loading button and marks it busy', () => {
    render(<Button loading>Pay</Button>);
    const btn = screen.getByRole('button', { name: /pay/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('associates labels and errors with inputs', () => {
    render(<Input label="Email" error="Enter a valid email" />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid email');
  });

  it('renders known and unknown statuses', () => {
    render(<StatusBadge status="ticketing_failed" />);
    expect(screen.getByText('Ticketing failed')).toBeInTheDocument();
    expect(statusLabel('some_new_state')).toBe('Some new state');
  });

  it('segmented control behaves as a radio group', async () => {
    function Harness() {
      const [v, setV] = useState<'a' | 'b'>('a');
      return <Segmented label="Cabin" value={v} onChange={setV} options={[{ value: 'a', label: 'Economy' }, { value: 'b', label: 'Business' }]} />;
    }
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Business'));
    expect(screen.getByLabelText('Business')).toBeChecked();
  });

  it('confirm dialog awaits the action before closing', async () => {
    const onConfirm = vi.fn(() => Promise.resolve());
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Cancel ride?" confirmLabel="Cancel ride" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel ride' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
