import { z } from 'zod';
import { emailSchema, phoneSchema } from './auth';

const namePart = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label} as on the ID.`)
    .max(60, `${label[0]!.toUpperCase()}${label.slice(1)} is too long.`)
    .regex(/^[\p{L}\p{M}' .-]+$/u, 'Use letters, spaces, apostrophes or hyphens only.');

export const passengerSchema = z.object({
  firstName: namePart('first name'),
  lastName: namePart('last name'),
});
export type PassengerInput = z.infer<typeof passengerSchema>;

export const createBookingSchema = z.object({
  priceLockId: z.string().uuid(),
  passengers: z.array(passengerSchema).min(1).max(9),
  contact: z.object({
    email: emailSchema,
    phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  }),
  /** The total the customer agreed to. Must equal the price lock; it is a consent check, never used as the charge amount. */
  acceptedTotalMinor: z.number().int().positive(),
  acceptFareRules: z.literal(true, { error: 'Please accept the fare rules to continue.' }),
});
export type CreateBookingInput = z.input<typeof createBookingSchema>;

export const validateOfferSchema = z.object({
  adults: z.number().int().min(1).max(9),
});
