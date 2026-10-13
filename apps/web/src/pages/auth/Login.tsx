import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginInput, loginSchema } from '@waylo/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Notice } from '@/components/ui/States';
import { homeForRole, safeNext, useLogin, useMe } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { useMeta } from '@/lib/meta';
import { AuthLayout } from './AuthLayout';

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const me = useMe();
  const meta = useMeta();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });
  const { register, handleSubmit, setError, setValue, formState } = form;

  if (me.data) return <Navigate to={safeNext(params.get('next'), homeForRole(me.data.user.role))} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { user } = await login.mutateAsync(values);
      navigate(safeNext(params.get('next'), homeForRole(user.role)), { replace: true });
    } catch (e) {
      setFormError(applyServerErrors(e, setError, ['email', 'password']));
    }
  });

  const demo = meta.data?.demoLogin;

  return (
    <AuthLayout
      title="Welcome back"
      subtitle={
        <>
          New to WAYLO?{' '}
          <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : ''}`} className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {formError && <Notice tone="danger">{formError}</Notice>}
        <Input label="Email" type="email" autoComplete="email" inputMode="email" error={formState.errors.email?.message} {...register('email')} />
        <Input label="Password" type="password" autoComplete="current-password" error={formState.errors.password?.message} {...register('password')} />
        <Button type="submit" block size="lg" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>

      {demo && (
        <section className="mt-8 rounded-card border border-dashed border-coral/50 bg-coral-soft/40 p-4" aria-labelledby="demo-accounts">
          <div className="mb-3 flex items-center gap-2">
            <Badge tone="coral">Demo</Badge>
            <h2 id="demo-accounts" className="text-sm font-semibold">
              Try a demo account
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {demo.accounts
              .filter((a, i, all) => all.findIndex((b) => b.role === a.role) === i)
              .map((a) => (
                <Button
                  key={a.email}
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setValue('email', a.email, { shouldValidate: true });
                    setValue('password', demo.password, { shouldValidate: true });
                  }}
                >
                  {a.role[0]!.toUpperCase() + a.role.slice(1)}
                </Button>
              ))}
          </div>
          <p className="mt-3 text-xs text-ink-3">Demo accounts only exist in the sandbox environment and cannot make real bookings.</p>
        </section>
      )}
    </AuthLayout>
  );
}
