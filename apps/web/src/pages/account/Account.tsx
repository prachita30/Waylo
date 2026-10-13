import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, updateProfileSchema, type Preferences, type UpdateProfileInput } from '@waylo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, Heart, LogOut, ShieldCheck, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import type { z } from 'zod';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardSection, SectionHeader } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Input, Select, Toggle } from '@/components/ui/Field';
import { ErrorState, Notice, SkeletonList } from '@/components/ui/States';
import { api } from '@/lib/api';
import { ME_KEY, type Me, type User, useLogout, useMe, useUpdateMe } from '@/lib/auth';
import { applyServerErrors } from '@/lib/forms';
import { useAirports } from '@/lib/meta';

export default function Account() {
  const { data, isPending, error, refetch } = useMe();
  if (isPending) return <div className="container-page py-10"><SkeletonList /></div>;
  if (error || !data) return <div className="container-page py-10"><ErrorState error={error} onRetry={() => refetch()} /></div>;
  return (
    <div className="container-page max-w-3xl space-y-6 py-8 sm:py-12">
      <ProfileHeader user={data.user} />
      <ProfileForm user={data.user} />
      <PreferencesCard preferences={data.preferences} />
      <SavedDestinationsCard me={data} />
      <SecurityCard />
      <DangerZone />
    </div>
  );
}

function ProfileHeader({ user }: { user: User }) {
  const update = useUpdateMe();
  const logout = useLogout();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('avatar', file);
      return api.post<{ user: User }>('/users/me/avatar', fd);
    },
    onSuccess: (r) => update({ user: r.user }),
    onError: (e) => setErr((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<{ user: User }>('/users/me/avatar'),
    onSuccess: (r) => update({ user: r.user }),
  });

  return (
    <Card>
      <CardSection className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <div className="relative">
          <Avatar name={user.fullName} src={user.avatarUrl} size="xl" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute -right-1 -bottom-1 grid size-9 place-items-center rounded-full bg-primary text-primary-ink shadow-card"
            aria-label="Change profile photo"
            disabled={upload.isPending}
          >
            <Camera className="size-4" aria-hidden />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              setErr(null);
              if (f && f.size > 2 * 1024 * 1024) setErr('Profile photos must be 2 MB or smaller.');
              else if (f) upload.mutate(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="t-title truncate">{user.fullName}</h1>
          <p className="truncate text-ink-2">{user.email}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Badge tone="primary">{user.role[0]!.toUpperCase() + user.role.slice(1)}</Badge>
            {user.isDemo && <Badge tone="coral">Demo account</Badge>}
            {user.avatarUrl && (
              <button type="button" className="text-xs font-semibold text-ink-3 hover:text-danger" onClick={() => remove.mutate()}>
                Remove photo
              </button>
            )}
          </div>
          {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={() => logout.mutate(undefined, { onSettled: () => navigate('/') })}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </Button>
      </CardSection>
    </Card>
  );
}

function ProfileForm({ user }: { user: User }) {
  const update = useUpdateMe();
  const airports = useAirports();
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const { register, handleSubmit, setError, formState, reset } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { fullName: user.fullName, phone: user.phone ?? '', homeAirport: user.homeAirport ?? '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    setStatus(null);
    try {
      const r = await api.patch<{ user: User }>('/users/me', values);
      update({ user: r.user });
      reset({ fullName: r.user.fullName, phone: r.user.phone ?? '', homeAirport: r.user.homeAirport ?? '' });
      setStatus({ tone: 'success', text: 'Profile saved.' });
    } catch (e) {
      const msg = applyServerErrors(e, setError, ['fullName', 'phone', 'homeAirport']);
      if (msg) setStatus({ tone: 'danger', text: msg });
    }
  });
  return (
    <Card>
      <CardSection>
        <SectionHeader title="Personal details" eyebrow="Profile" />
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name" autoComplete="name" wrapperClassName="sm:col-span-2" error={formState.errors.fullName?.message} {...register('fullName')} />
          <Input label="Mobile number" type="tel" autoComplete="tel" placeholder="+91" error={formState.errors.phone?.message} {...register('phone')} />
          <Select label="Home airport" error={formState.errors.homeAirport?.message} {...register('homeAirport')}>
            <option value="">Not set</option>
            {airports.data?.map((a) => (
              <option key={a.code} value={a.code}>
                {a.city} ({a.code})
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
              Save changes
            </Button>
            {status && <Notice tone={status.tone} className="py-2">{status.text}</Notice>}
          </div>
        </form>
      </CardSection>
    </Card>
  );
}

function PreferencesCard({ preferences }: { preferences: Preferences }) {
  const update = useUpdateMe();
  const save = useMutation({
    mutationFn: (p: Preferences) => api.put<{ preferences: Preferences }>('/users/me/preferences', p),
    onMutate: (p) => update({ preferences: p }),
    onSuccess: (r) => update({ preferences: r.preferences }),
    onError: () => update({ preferences }),
  });
  const set = (k: keyof Preferences) => (v: boolean) => save.mutate({ ...preferences, [k]: v });
  return (
    <Card>
      <CardSection>
        <SectionHeader title="Notifications" eyebrow="Preferences" />
        <div className="divide-y divide-line">
          <Toggle label="Email" description="Booking confirmations, receipts and trip changes." checked={preferences.notifyEmail} onChange={set('notifyEmail')} />
          <Toggle label="SMS" description="Driver assignment and pickup updates on the day of travel." checked={preferences.notifySms} onChange={set('notifySms')} />
          <Toggle label="Push" description="Live ride-matching and flight status alerts." checked={preferences.notifyPush} onChange={set('notifyPush')} />
          <Toggle label="Offers and inspiration" description="Occasional emails about new routes and fare offers." checked={preferences.marketingOptIn} onChange={set('marketingOptIn')} />
        </div>
        {save.isError && <Notice tone="danger" className="mt-3">We could not save that change. Please try again.</Notice>}
      </CardSection>
    </Card>
  );
}

function SavedDestinationsCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const airports = useAirports();
  const [pick, setPick] = useState('');
  const cities = useMemo(() => {
    const seen = new Map<string, string>();
    airports.data?.forEach((a) => seen.set(a.cityId, a.city));
    return [...seen].filter(([id]) => !me.savedDestinations.some((s) => s.cityId === id));
  }, [airports.data, me.savedDestinations]);
  const refresh = () => qc.invalidateQueries({ queryKey: ME_KEY });
  const add = useMutation({ mutationFn: (id: string) => api.put(`/users/me/saved-destinations/${id}`), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/users/me/saved-destinations/${id}`), onSuccess: refresh });
  return (
    <Card>
      <CardSection>
        <SectionHeader title="Saved destinations" eyebrow="Wishlist" />
        {me.savedDestinations.length === 0 ? (
          <p className="t-body">Save places you want to go and we will surface offers for them first.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {me.savedDestinations.map((d) => (
              <li key={d.cityId} className="inline-flex items-center gap-1.5 rounded-full bg-lavender py-1.5 pr-1.5 pl-3 text-sm font-semibold">
                <Heart className="size-3.5 fill-coral text-coral" aria-hidden />
                {d.name}
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-full hover:bg-surface"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => remove.mutate(d.cityId)}
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (pick) add.mutate(pick, { onSuccess: () => setPick('') });
          }}
        >
          <Select label="Add a destination" value={pick} onChange={(e) => setPick(e.target.value)} wrapperClassName="flex-1">
            <option value="">Choose a city</option>
            {cities.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary" disabled={!pick} loading={add.isPending} className="h-12">
            Save
          </Button>
        </form>
      </CardSection>
    </Card>
  );
}

type PasswordForm = z.input<typeof changePasswordSchema>;

function SecurityCard() {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState, reset } = useForm<PasswordForm>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const onSubmit = handleSubmit(async (values) => {
    setDone(false);
    setFormError(null);
    try {
      await api.post('/users/me/password', values);
      reset();
      setDone(true);
    } catch (e) {
      setFormError(applyServerErrors(e, setError, ['currentPassword', 'newPassword']));
    }
  });
  return (
    <Card>
      <CardSection>
        <SectionHeader title="Password" eyebrow="Security" />
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input label="Current password" type="password" autoComplete="current-password" error={formState.errors.currentPassword?.message} {...register('currentPassword')} />
          <Input label="New password" type="password" autoComplete="new-password" error={formState.errors.newPassword?.message} {...register('newPassword')} />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="secondary" loading={formState.isSubmitting}>
              <ShieldCheck className="size-4" aria-hidden /> Update password
            </Button>
            {done && <Notice tone="success" className="py-2">Password updated. Other devices were signed out.</Notice>}
            {formError && <Notice tone="danger" className="py-2">{formError}</Notice>}
          </div>
        </form>
      </CardSection>
    </Card>
  );
}

function DangerZone() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card className="border-danger/30">
      <CardSection>
        <SectionHeader title="Delete account" eyebrow="Danger zone" />
        <p className="t-body">
          We erase your profile, contact details, photo and preferences straight away. Records of past bookings and payments are kept without your contact details where law or
          accounting requires it. Active trips must be completed or cancelled first.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => setOpen(true)}>
          <Trash2 className="size-4" aria-hidden /> Delete my account
        </Button>
      </CardSection>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setPassword('');
            setConfirm('');
            setErr(null);
          }
        }}
        title="Delete your WAYLO account?"
        description="This cannot be undone."
        confirmLabel="Delete account"
        tone="danger"
        onConfirm={async () => {
          setErr(null);
          try {
            await api.delete('/users/me', { body: { password, confirm } });
          } catch (e) {
            setErr((e as Error).message);
            throw e;
          }
          qc.clear();
          qc.setQueryData(ME_KEY, null);
          navigate('/', { replace: true });
        }}
      >
        <div className="space-y-4">
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Input label="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="characters" />
          {err && <Notice tone="danger">{err}</Notice>}
        </div>
      </ConfirmDialog>
    </Card>
  );
}
