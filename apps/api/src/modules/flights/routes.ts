import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { limiter } from '../../http/rateLimit';
import { params, query } from '../../http/validate';
import { getOffer, searchFlights, WINDOWS } from './service';

const iata = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code.');
const windowEnum = z.enum(Object.keys(WINDOWS) as [keyof typeof WINDOWS, ...(keyof typeof WINDOWS)[]]);

export const searchQuerySchema = z.object({
  from: iata,
  to: iata,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd.'),
  adults: z.coerce.number().int().min(1).max(9).default(1),
  cabin: z.enum(['economy', 'premium_economy', 'business']).default('economy'),
  /** Max fare per adult, in minor units. */
  maxPrice: z.coerce.number().int().positive().optional(),
  /** Comma-separated departure windows, e.g. "morning,evening". */
  windows: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').filter(Boolean) : undefined))
    .pipe(z.array(windowEnum).optional()),
  sort: z.enum(['price', 'departure', 'duration']).default('price'),
  flex: z
    .enum(['1', '0', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  refundableOnly: z
    .enum(['1', '0', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  page: z.coerce.number().int().min(1).max(50).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export function flightsRouter(ctx: AppContext): Router {
  const r = Router();
  const searchLimit = limiter({ windowMs: 60_000, limit: Math.max(30, Math.floor(ctx.config.API_RATE_LIMIT / 5)), name: 'flight-search' });

  r.get('/flights/search', searchLimit, async (req, res) => {
    const q = query(req, searchQuerySchema);
    res.json(await searchFlights(ctx, q));
  });

  r.get('/flights/offers/:offerId', async (req, res) => {
    const { offerId } = params(req, z.object({ offerId: z.string().uuid() }));
    const { adults } = query(req, z.object({ adults: z.coerce.number().int().min(1).max(9).default(1) }));
    res.json({ offer: await getOffer(ctx, offerId, adults) });
  });

  return r;
}
