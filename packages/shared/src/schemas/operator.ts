import { z } from 'zod';
import { fullNameSchema, phoneSchema } from './auth';

export const onboardingSchema = z.object({
  name: z.string().trim().min(2, 'Enter your company or fleet name.').max(120),
  phone: phoneSchema,
  airports: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1, 'Choose at least one airport.').max(10),
});

export const vehicleSchema = z.object({
  vehicleClass: z.enum(['sedan', 'suv', 'van']),
  makeModel: z.string().trim().min(2, 'Enter the make and model.').max(60),
  colour: z.string().trim().min(2, 'Enter the colour.').max(30),
  /** Indian registration, e.g. MH 01 AB 1234. Spaces are normalised. */
  registration: z
    .string()
    .trim()
    .toUpperCase()
    .transform((s) => s.replace(/[\s-]+/g, ' '))
    .pipe(z.string().regex(/^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{1,4}$/, 'Use a registration like MH 01 AB 1234.')),
  seats: z.number().int().min(2).max(12),
  luggageUnits: z.number().int().min(2).max(24),
  wheelchairAccessible: z.boolean(),
});
export type VehicleInput = z.input<typeof vehicleSchema>;

export const driverSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  licenceLast4: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{4}$/, 'Enter the last 4 characters of the licence number.'),
  /** Existing WAYLO account (operator role) the driver signs in with, if any. */
  userEmail: z.string().trim().toLowerCase().email().optional().or(z.literal('').transform(() => undefined)),
});
export type DriverInput = z.input<typeof driverSchema>;

export const availabilitySchema = z
  .object({
    driverId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    airport: z.string().regex(/^[A-Z]{3}$/),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), { path: ['endsAt'], message: 'End must be after start.' })
  .refine((v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 14 * 3_600_000, { path: ['endsAt'], message: 'A shift can be at most 14 hours.' });

export const incidentSchema = z.object({
  groupId: z.string().uuid().optional(),
  category: z.enum(['safety', 'accident', 'vehicle', 'passenger_conduct', 'driver_conduct', 'lost_item', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().trim().min(10, 'Describe what happened (at least 10 characters).').max(2000),
});
