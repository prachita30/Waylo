import { z } from 'zod';
import { phoneSchema } from './auth';

const iata = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter airport code.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-mm-dd.');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'Use HH:MM.');
const paise = z.number().int().min(0);

export const partnerOnboardingSchema = z.object({
  name: z.string().trim().min(2).max(120),
  kind: z.enum(['airline', 'distributor']),
  phone: phoneSchema,
  airlines: z
    .array(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2}$/, 'Use a 2-character airline designator.'), name: z.string().trim().min(2).max(80) }))
    .min(1, 'Add at least one airline you are authorised to sell.')
    .max(10),
});

/**
 * A partner-published fare. Times are local to each airport. Money is in paise. The reference
 * fare (the airline's regular fare for the same flight) is optional, but if given its source is
 * required, because WAYLO only shows savings against a sourced reference.
 */
export const partnerOfferSchema = z
  .object({
    airlineCode: z.string().regex(/^[A-Z0-9]{2}$/),
    flightDigits: z.string().regex(/^\d{1,4}$/, 'Use the numeric part of the flight number.'),
    origin: iata,
    destination: iata,
    departDate: date,
    departTime: time,
    arriveDate: date,
    arriveTime: time,
    cabin: z.enum(['economy', 'premium_economy', 'business']),
    fareMinor: paise.positive('Enter the fare.'),
    taxesMinor: paise,
    referenceFareMinor: paise.positive().optional(),
    referenceSource: z.string().trim().min(5).max(200).optional(),
    baggageCabinKg: z.number().int().min(0).max(30),
    baggageCheckedKg: z.number().int().min(0).max(60),
    refundable: z.boolean(),
    changeFeeMinor: paise.nullable(),
    cancelFeeMinor: paise.nullable(),
    fareRules: z.string().trim().min(20, 'Describe the fare rules (at least 20 characters).').max(2000),
    maxPassengers: z.number().int().min(1).max(9).optional(),
    minAdvanceHours: z.number().int().min(0).max(720).optional(),
    eligibilityNotes: z.string().trim().max(300).optional(),
    inventoryCap: z.number().int().min(1, 'Set how many seats WAYLO may sell.').max(500),
    validFrom: z.string().datetime({ offset: true }),
    validUntil: z.string().datetime({ offset: true }),
    publish: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.origin === v.destination) ctx.addIssue({ code: 'custom', path: ['destination'], message: 'Destination must differ from origin.' });
    if (v.taxesMinor > v.fareMinor) ctx.addIssue({ code: 'custom', path: ['taxesMinor'], message: 'Taxes cannot exceed the all-inclusive fare.' });
    if (v.referenceFareMinor !== undefined && !v.referenceSource) ctx.addIssue({ code: 'custom', path: ['referenceSource'], message: 'Say where the regular fare comes from.' });
    if (v.referenceFareMinor !== undefined && v.referenceFareMinor <= v.fareMinor) ctx.addIssue({ code: 'custom', path: ['referenceFareMinor'], message: 'The regular fare must be higher than this offer.' });
    if (new Date(v.validUntil) <= new Date(v.validFrom)) ctx.addIssue({ code: 'custom', path: ['validUntil'], message: 'The offer must end after it starts.' });
    if (!v.refundable && v.cancelFeeMinor !== null) ctx.addIssue({ code: 'custom', path: ['cancelFeeMinor'], message: 'Non-refundable fares have no cancellation fee.' });
  });
export type PartnerOfferInput = z.input<typeof partnerOfferSchema>;

export const partnerOfferUpdateSchema = z.object({
  fareMinor: paise.positive().optional(),
  taxesMinor: paise.optional(),
  inventoryCap: z.number().int().min(1).max(500).optional(),
  validUntil: z.string().datetime({ offset: true }).optional(),
  fareRules: z.string().trim().min(20).max(2000).optional(),
});
