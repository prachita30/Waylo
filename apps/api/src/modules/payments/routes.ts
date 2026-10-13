import { and, eq } from 'drizzle-orm';
import express, { Router } from 'express';
import { z } from 'zod';
import { SandboxPaymentAdapter } from '../../adapters/payments/sandbox';
import { WebhookSignatureError } from '../../adapters/payments/types';
import type { AppContext } from '../../context';
import { payments } from '../../db/schema';
import { currentUser, requireAuth } from '../../http/auth';
import { AppError, conflict, notFound } from '../../http/errors';
import { body, params } from '../../http/validate';
import { handleWebhook } from './service';

/** Provider webhooks: raw body (for signature verification), no session, no CSRF header. */
export function paymentWebhookRouter(ctx: AppContext): Router {
  const r = Router();
  r.post('/', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    try {
      const outcome = await handleWebhook(ctx, req.body as Buffer, req.get('waylo-signature'));
      res.json({ received: true, ...outcome });
    } catch (err) {
      if (err instanceof WebhookSignatureError || err instanceof SyntaxError) {
        res.status(400).json({ error: { code: 'invalid_webhook', message: err.message } });
        return;
      }
      throw err;
    }
  });
  return r;
}

export function paymentsRouter(ctx: AppContext): Router {
  const r = Router();
  const intentParam = z.object({ intentId: z.string().regex(/^sbx_pi_[a-f0-9]{32}$/) });

  async function ownSandboxPayment(userId: string, intentId: string) {
    if (!(ctx.adapters.payments instanceof SandboxPaymentAdapter)) throw notFound('Checkout');
    const [p] = await ctx.db
      .select()
      .from(payments)
      .where(and(eq(payments.provider, ctx.adapters.payments.info.provider), eq(payments.providerIntentId, intentId)));
    if (!p || p.userId !== userId) throw notFound('Checkout');
    return p;
  }

  /** Sandbox checkout page data. Only exists while the sandbox provider is configured. */
  r.get('/payments/sandbox/intents/:intentId', requireAuth, async (req, res) => {
    const { intentId } = params(req, intentParam);
    const p = await ownSandboxPayment(currentUser(req).id, intentId);
    res.json({ payment: { id: p.id, purpose: p.purpose, referenceId: p.referenceId, amountMinor: p.amountMinor, currency: p.currency, status: p.status, failureReason: p.failureReason } });
  });

  /**
   * Simulates the customer completing checkout at the provider. The result is applied only via
   * the provider's signed webhook, the same path a live provider uses.
   */
  r.post('/payments/sandbox/intents/:intentId/complete', requireAuth, async (req, res) => {
    const { intentId } = params(req, intentParam);
    const { outcome } = body(req, z.object({ outcome: z.enum(['succeed', 'fail']) }));
    const p = await ownSandboxPayment(currentUser(req).id, intentId);
    if (p.status === 'succeeded') throw conflict('already_paid', 'This payment is already complete.');
    if (p.status === 'cancelled') throw conflict('payment_closed', 'This payment window has closed.');
    try {
      await (ctx.adapters.payments as SandboxPaymentAdapter).complete(intentId, outcome);
    } catch (e) {
      throw new AppError(409, 'sandbox_error', (e as Error).message);
    }
    const [after] = await ctx.db.select().from(payments).where(eq(payments.id, p.id));
    res.json({ payment: { id: after!.id, status: after!.status, failureReason: after!.failureReason, purpose: after!.purpose, referenceId: after!.referenceId } });
  });

  return r;
}
