import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/layout/RequireAuth';
import { ME, META, mockApi, renderRoutes } from '@/test/render';
import Account from '../account/Account';
import Login from './Login';
import Register from './Register';

afterEach(() => vi.unstubAllGlobals());

const unauth = {
  'GET /users/me': () => ({ status: 401, body: { error: { code: 'unauthorized', message: 'Please sign in' } } }),
  'GET /meta': () => ({ body: META }),
};

describe('Login page', () => {
  it('validates before calling the API', async () => {
    const { calls } = mockApi(unauth);
    renderRoutes([{ path: '/login', element: <Login /> }], '/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('shows the server error for bad credentials', async () => {
    mockApi({
      ...unauth,
      'POST /auth/login': () => ({ status: 401, body: { error: { code: 'invalid_credentials', message: 'Email or password is incorrect.' } } }),
    });
    renderRoutes([{ path: '/login', element: <Login /> }], '/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrongpass1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();
  });

  it('signs in and follows a safe ?next= redirect', async () => {
    let signedIn = false;
    mockApi({
      'GET /meta': () => ({ body: META }),
      'GET /users/me': () => (signedIn ? { body: ME } : { status: 401, body: { error: { code: 'unauthorized', message: '' } } }),
      'POST /auth/login': () => {
        signedIn = true;
        return { body: { user: ME.user } };
      },
    });
    const { router } = renderRoutes(
      [
        { path: '/login', element: <Login /> },
        { path: '/trips', element: <p>Trips page</p> },
      ],
      '/login?next=%2Ftrips',
    );
    await userEvent.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'journey2026');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
  });

  it('offers demo account quick-fill when the API advertises demo mode', async () => {
    mockApi(unauth);
    renderRoutes([{ path: '/login', element: <Login /> }], '/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Passenger' }));
    expect(screen.getByLabelText('Email')).toHaveValue('passenger@demo.waylo.app');
  });
});

describe('Register page', () => {
  it('requires accepting the terms and shows server errors', async () => {
    mockApi({
      ...unauth,
      'POST /auth/register': () => ({ status: 409, body: { error: { code: 'email_taken', message: 'An account with this email already exists.' } } }),
    });
    renderRoutes([{ path: '/register', element: <Register /> }], '/register');
    await userEvent.type(await screen.findByLabelText('Full name'), 'Ananya Rao');
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'journey2026');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('You need to accept the terms to continue.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('An account with this email already exists.')).toBeInTheDocument();
  });
});

describe('RequireAuth', () => {
  it('redirects signed-out visitors to login with the return path', async () => {
    mockApi(unauth);
    const { router } = renderRoutes(
      [
        { path: '/login', element: <p>Login page</p> },
        { element: <RequireAuth />, children: [{ path: '/account', element: <p>secret</p> }] },
      ],
      '/account',
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toBe('?next=%2Faccount');
  });

  it('blocks the wrong role', async () => {
    mockApi({ 'GET /users/me': () => ({ body: ME }) });
    renderRoutes([{ element: <RequireAuth roles={['admin']} />, children: [{ path: '/admin', element: <p>admin area</p> }] }], '/admin');
    expect(await screen.findByText('This area is not available for your account')).toBeInTheDocument();
    expect(screen.queryByText('admin area')).not.toBeInTheDocument();
  });
});

describe('Account page', () => {
  it('saves profile changes and preference toggles', async () => {
    const { calls } = mockApi({
      'GET /users/me': () => ({ body: ME }),
      'GET /airports': () => ({
        body: { items: [{ code: 'BOM', name: 'CSMIA', city: 'Mumbai', cityId: 'mumbai', state: 'MH', timezone: 'Asia/Kolkata', lat: 0, lng: 0 }] },
      }),
      'PATCH /users/me': (b) => ({ body: { user: { ...ME.user, ...(b as object) } } }),
      'PUT /users/me/preferences': (b) => ({ body: { preferences: b } }),
    });
    renderRoutes([{ path: '/account', element: <Account /> }], '/account');
    const phone = await screen.findByLabelText('Mobile number');
    await userEvent.type(phone, '+919812345678');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ phone: '+919812345678' });

    await userEvent.click(screen.getByRole('switch', { name: 'SMS' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ notifySms: false }));
  });

  it('keeps the delete dialog open and shows the error when the password is wrong', async () => {
    mockApi({
      'GET /users/me': () => ({ body: ME }),
      'GET /airports': () => ({ body: { items: [] } }),
      'DELETE /users/me': () => ({ status: 400, body: { error: { code: 'invalid_password', message: 'Your password is incorrect.' } } }),
    });
    renderRoutes([{ path: '/account', element: <Account /> }], '/account');
    await userEvent.click(await screen.findByRole('button', { name: /Delete my account/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(screen.getAllByLabelText('Password').at(-1)!, 'nope');
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(await screen.findByText('Your password is incorrect.')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
  });
});
