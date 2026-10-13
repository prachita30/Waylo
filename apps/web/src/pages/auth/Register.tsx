import { zodResolver } from '@hookform/resolvers/zod';
import { type RegisterInput, registerSchema } from '@waylo/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input } from '@/components/ui/Field';
import { Notice } from '@/components/ui/States';
import { safeNext, useMe, useRegister } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { AuthLayout } from './AuthLayout';

export default function Register() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe();
  const signup = useRegister();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, setError, formState } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: '', email: '', password: '', phone: '', acceptTerms: false as unknown as true },
  });

  if (me.data) return <Navigate to={safeNext(params.get('next'))} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await signup.mutateAsync(values);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (e) {
      setFormError(applyServerErrors(e, setError, ['fullName', 'email', 'password', 'phone', 'acceptTerms']));
    }
  });

  return (
    <AuthLayout
      title="Create your account"
      subtitle={
        <>
          Already have one?{' '}
          <Link to={`/login${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <Input label="Full name" autoComplete="name" hint="As it appears on your government ID, for flight bookings." error={formState.errors.fullName?.message} {...register('fullName')} />
        <Input label="Email" type="email" autoComplete="email" inputMode="email" error={formState.errors.email?.message} {...register('email')} />
        <Input
          label="Mobile number (optional)"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+91"
          hint="Used for pickup coordination with your driver."
          error={formState.errors.phone?.message}
          {...register('phone')}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with a letter and a number."
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <Controller
          control={control}
          name="acceptTerms"
          render={({ field, fieldState }) => (
            <div>
              <Checkbox
                checked={!!field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                label={
                  <>
                    I agree to the{' '}
                    <Link to="/legal/terms" className="text-primary underline" target="_blank">
                      Terms of use
                    </Link>{' '}
                    and{' '}
                    <Link to="/legal/privacy" className="text-primary underline" target="_blank">
                      Privacy policy
                    </Link>
                  </>
                }
              />
              {fieldState.error && (
                <p role="alert" className="mt-1 text-sm text-danger">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
        <Button type="submit" block size="lg" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
