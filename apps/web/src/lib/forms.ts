import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Copies server-side validation errors onto form fields and returns a message for
 * anything that is not tied to a field (shown as a form-level notice).
 */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, fields: readonly string[]): string | null {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.';
  const fieldErrors = err.fieldErrors();
  let matched = false;
  for (const [path, message] of Object.entries(fieldErrors)) {
    if (fields.includes(path)) {
      setError(path as Path<T>, { type: 'server', message });
      matched = true;
    }
  }
  return matched && err.code === 'validation_error' ? null : err.message;
}
