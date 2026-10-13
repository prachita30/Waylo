import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.describe('flight booking (sandbox)', () => {
  test('search → offer → passengers → sandbox payment → confirmed with PNR', async ({ page }) => {
    await signIn(page, 'passenger@demo.waylo.app');
    await page.goto(`/flights?from=BOM&to=GOI&date=${inDays(5)}&adults=1&cabin=economy`);
    await page.getByRole('link', { name: 'Select' }).first().click();
    await expect(page.getByText('Fare rules from the airline')).toBeVisible();
    await page.getByRole('link', { name: 'Continue to passenger details' }).click();

    await expect(page.getByText(/Price held for/)).toBeVisible();
    await page.getByLabel('First and middle names').fill('Ananya');
    await page.getByLabel('Last name').fill('Rao');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Continue to payment/ }).click();

    await expect(page.getByText('Simulated payment')).toBeVisible();
    await page.getByRole('button', { name: /Simulate successful payment/ }).click();

    await expect(page.getByText('Airline booking reference (PNR)')).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
  });

  test('declined payment can be retried', async ({ page }) => {
    await signIn(page, 'rider2@demo.waylo.app');
    await page.goto(`/flights?from=BOM&to=DEL&date=${inDays(6)}&adults=1&cabin=economy`);
    await page.getByRole('link', { name: 'Select' }).first().click();
    await page.getByRole('link', { name: 'Continue to passenger details' }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Continue to payment/ }).click();
    await page.getByRole('button', { name: /Simulate declined payment/ }).click();
    await expect(page.getByText('Payment declined')).toBeVisible();
    await page.getByRole('button', { name: /Simulate successful payment/ }).click();
    await expect(page.getByText('Airline booking reference (PNR)')).toBeVisible();
  });
});
