import { expect, type Page } from '@playwright/test';

/** Shared fixture password for seeded demo accounts (see apps/api/src/db/demo-accounts.ts). */
export const DEMO_PASSWORD = 'waylo-demo-2026';

export const uniqueEmail = (prefix = 'e2e') => `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function registerPassenger(page: Page, opts: { name?: string; email?: string; password?: string } = {}) {
  const email = opts.email ?? uniqueEmail();
  const password = opts.password ?? 'journey2026';
  await page.goto('/register');
  await page.getByLabel('Full name').fill(opts.name ?? 'Ananya Rao');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).not.toHaveURL(/\/register/);
  return { email, password };
}
