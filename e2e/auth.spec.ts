import { expect, test } from '@playwright/test';
import { registerPassenger, signIn, uniqueEmail } from './helpers';

test.describe('registration and login', () => {
  test('shows validation errors for an empty form', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter your full name.')).toBeVisible();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('You need to accept the terms to continue.')).toBeVisible();
  });

  test('registers, edits profile, signs out and signs back in', async ({ page }) => {
    const email = uniqueEmail('reg');
    await registerPassenger(page, { name: 'Ananya Rao', email });

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Ananya Rao' })).toBeVisible();
    await page.getByLabel('Mobile number').fill('+919812345678');
    await page.getByLabel('Home airport').selectOption('BOM');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();

    await page.reload();
    await expect(page.getByLabel('Mobile number')).toHaveValue('+919812345678');

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('journey2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL('/account');
  });

  test('rejects wrong credentials with a generic message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('passenger@demo.waylo.app');
    await page.getByLabel('Password').fill('not-the-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  });

  test('demo account quick-fill signs in as the demo passenger', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Passenger' }).click();
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.goto('/account');
    await expect(page.getByText('Demo account').first()).toBeVisible();
  });

  test('deletes an account after password confirmation', async ({ page }) => {
    const { email, password } = await registerPassenger(page);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Password').fill(password);
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await dialog.getByRole('button', { name: 'Delete account' }).click();
    await expect(page).toHaveURL('/');
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Email or password is incorrect.')).toBeVisible();
  });

  test('account menu works on mobile @mobile', async ({ page }) => {
    await signIn(page, 'passenger@demo.waylo.app');
    await page.goto('/account');
    await expect(page.getByRole('navigation', { name: 'Main' }).last()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
