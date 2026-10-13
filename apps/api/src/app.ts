import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { sessionMiddleware } from './http/auth';
import { CLIENT_HEADER, csrfGuard } from './http/csrf';
import { errorHandler, notFoundHandler } from './http/errors';
import { limiter } from './http/rateLimit';
import { authRouter } from './modules/auth/routes';
import { bookingsRouter } from './modules/bookings/routes';
import { flightsRouter } from './modules/flights/routes';
import { healthRouter, metaRouter } from './modules/meta/routes';
import { paymentsRouter, paymentWebhookRouter } from './modules/payments/routes';
import { reviewRouter } from './modules/admin/review';
import { registerSupply } from './modules/operator/fleet';
import { incidentsRouter, operatorRouter } from './modules/operator/routes';
import { ridesRouter } from './modules/rides/routes';
import { usersRouter } from './modules/users/routes';

/** Paths under /api/v1 that skip the CSRF client-header check (server-to-server, signature-verified). */
export const CSRF_EXEMPT = ['/payments/webhooks/'];

export function createApp(ctx: AppContext) {
  // Matching uses approved operator capacity as supply.
  registerSupply();
  const app = express();
  app.disable('x-powered-by');
  if (ctx.config.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger: ctx.logger,
      autoLogging: ctx.config.NODE_ENV !== 'test',
      customProps: () => ({ svc: 'api' }),
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || ctx.config.webOrigins.includes(origin)),
      credentials: true,
      allowedHeaders: ['Content-Type', CLIENT_HEADER, 'Idempotency-Key'],
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    }),
  );
  // Webhooks need the raw body for signature verification, so they are mounted before JSON parsing.
  app.use('/api/v1/payments/webhooks/:provider', paymentWebhookRouter(ctx));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.use(healthRouter(ctx));

  const v1 = Router();
  v1.use(limiter({ windowMs: 60_000, limit: ctx.config.API_RATE_LIMIT, name: 'api' }));
  v1.use(csrfGuard(ctx.config.webOrigins, CSRF_EXEMPT));
  v1.use(sessionMiddleware(ctx));
  v1.use(metaRouter(ctx));
  v1.use(authRouter(ctx));
  v1.use(usersRouter(ctx));
  v1.use(flightsRouter(ctx));
  v1.use(bookingsRouter(ctx));
  v1.use(paymentsRouter(ctx));
  v1.use(ridesRouter(ctx));
  v1.use(operatorRouter(ctx));
  v1.use(incidentsRouter(ctx));
  v1.use(reviewRouter(ctx));
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
