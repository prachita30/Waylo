import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ME, mockApi, renderRoutes } from '@/test/render';
import Home from './Home';
import LegalPage from './info/LegalPage';

afterEach(() => vi.unstubAllGlobals());

const AIRPORTS = {
  items: [
    { code: 'BOM', name: 'CSMIA', city: 'Mumbai', cityId: 'mumbai', state: 'MH', timezone: 'Asia/Kolkata', lat: 0, lng: 0 },
    { code: 'GOI', name: 'Dabolim', city: 'Goa', cityId: 'goa', state: 'GA', timezone: 'Asia/Kolkata', lat: 0, lng: 0 },
  ],
};
const signedOut = { 'GET /users/me': () => ({ status: 401, body: { error: { code: 'unauthorized', message: '' } } }), 'GET /airports': () => ({ body: AIRPORTS }) };

describe('Homepage', () => {
  it('renders the hero, discovery, how-it-works and trust sections', async () => {
    mockApi(signedOut);
    renderRoutes([{ path: '/', element: <Home /> }]);
    expect(screen.getByRole('heading', { level: 1, name: /Your next journey, for less/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Goa' })).toBeInTheDocument();
    expect(screen.getByText('Airline-authorised flight offers')).toBeInTheDocument();
    expect(screen.getByText('Illustrative example')).toBeInTheDocument();
    expect(screen.getByText('Authorised inventory only')).toBeInTheDocument();
  });

  it('validates the flight search and navigates with query parameters', async () => {
    mockApi(signedOut);
    const { router } = renderRoutes([
      { path: '/', element: <Home /> },
      { path: '/flights', element: <p>results</p> },
    ]);
    await screen.findAllByRole('option', { name: 'Goa (GOI)' });
    await userEvent.click(screen.getByRole('button', { name: /Search flight offers/ }));
    expect(screen.getByText('Choose where you are flying to.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('To'), 'GOI');
    await userEvent.click(screen.getByRole('button', { name: /Search flight offers/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/flights'));
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('from')).toBe('BOM');
    expect(params.get('to')).toBe('GOI');
    expect(params.get('adults')).toBe('1');
  });

  it('switches to the shared-ride tab and carries the flight number', async () => {
    mockApi(signedOut);
    const { router } = renderRoutes([
      { path: '/', element: <Home /> },
      { path: '/rides/new', element: <p>ride form</p> },
    ]);
    await userEvent.click(screen.getByRole('tab', { name: /Shared airport ride/ }));
    await userEvent.type(screen.getByLabelText('Flight number (optional)'), '6e 5321');
    await userEvent.click(screen.getByRole('button', { name: /Find people to share with/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/rides/new'));
    expect(new URLSearchParams(router.state.location.search).get('flight')).toBe('6E5321');
  });

  it('sends signed-out visitors to sign in when saving a destination', async () => {
    mockApi(signedOut);
    const { router } = renderRoutes([
      { path: '/', element: <Home /> },
      { path: '/login', element: <p>login</p> },
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save Goa' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Save Goa' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('saves a destination for signed-in users', async () => {
    const { calls } = mockApi({
      'GET /users/me': () => ({ body: ME }),
      'GET /airports': () => ({ body: AIRPORTS }),
      'PUT /users/me/saved-destinations/goa': () => ({ status: 204 }),
    });
    renderRoutes([{ path: '/', element: <Home /> }]);
    await waitFor(() => expect(calls.some((c) => c.path === '/users/me')).toBe(true));
    await userEvent.click(await screen.findByRole('button', { name: 'Save Goa' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.path === '/users/me/saved-destinations/goa')).toBe(true));
  });
});

describe('Legal pages', () => {
  it('marks draft documents as needing legal review', () => {
    renderRoutes([{ path: '/legal/:slug', element: <LegalPage /> }], '/legal/terms');
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of use' })).toBeInTheDocument();
    expect(screen.getByText('Draft for review')).toBeInTheDocument();
  });
});
