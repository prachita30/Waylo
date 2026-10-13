import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { brand } from '@waylo/shared';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { isApiError } from '@/lib/api';
import { router } from '@/router';
import '@/styles/index.css';

document.title = `${brand.name} — ${brand.tagline}`;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // Never retry client errors (auth, validation, not found); retry transient failures twice.
      retry: (count, err) => !(isApiError(err) && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
