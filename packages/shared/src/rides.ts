import { z } from 'zod';

/**
 * Luggage is measured in capacity units so mixed bag sizes can be compared with a vehicle's
 * boot space. Values are deliberately conservative.
 */
export const LUGGAGE_UNITS = { cabin: 1, medium: 2, large: 3 } as const;
export type LuggageSize = keyof typeof LUGGAGE_UNITS;
export interface Luggage {
  cabin: number;
  medium: number;
  large: number;
}

export function luggageUnits(l: Luggage): number {
  return l.cabin * LUGGAGE_UNITS.cabin + l.medium * LUGGAGE_UNITS.medium + l.large * LUGGAGE_UNITS.large;
}

export type VehicleClass = 'sedan' | 'suv' | 'van';
export interface VehicleSpec {
  class: VehicleClass;
  label: string;
  seats: number;
  luggageUnits: number;
  wheelchairAccessible: boolean;
}

/** Reference vehicle classes. Operators register actual vehicles against these (Phase 9). */
export const VEHICLE_CLASSES: Record<VehicleClass, VehicleSpec> = {
  sedan: { class: 'sedan', label: 'Sedan', seats: 4, luggageUnits: 6, wheelchairAccessible: false },
  suv: { class: 'suv', label: 'SUV', seats: 6, luggageUnits: 10, wheelchairAccessible: false },
  van: { class: 'van', label: 'Van', seats: 8, luggageUnits: 14, wheelchairAccessible: true },
};
export const LARGEST_VEHICLE = VEHICLE_CLASSES.van;

export const VEHICLE_PREFERENCES = ['any', 'sedan', 'suv', 'van'] as const;
export type VehiclePreference = (typeof VEHICLE_PREFERENCES)[number];

/** Vehicle classes a request is willing to ride in. Accessibility needs restrict to accessible vehicles. */
export function acceptableVehicles(pref: VehiclePreference, wheelchair: boolean): VehicleClass[] {
  const base: VehicleClass[] = pref === 'any' ? ['sedan', 'suv', 'van'] : [pref];
  return wheelchair ? base.filter((c) => VEHICLE_CLASSES[c].wheelchairAccessible) : base;
}

/** True when a single party (seats + bags) can fit in at least one acceptable vehicle. */
export function partyFits(passengers: number, luggage: Luggage, classes: VehicleClass[]): boolean {
  return classes.some((c) => passengers <= VEHICLE_CLASSES[c].seats && luggageUnits(luggage) <= VEHICLE_CLASSES[c].luggageUnits);
}

const count = (max: number) => z.number().int().min(0).max(max);

export const rideRequestSchema = z
  .object({
    airport: z.string().regex(/^[A-Z]{3}$/),
    pickupZoneId: z.string().uuid(),
    /** Optional flight link. When the flight is known, its scheduled arrival is used. */
    flightNumber: z
      .string()
      .trim()
      .toUpperCase()
      .transform((s) => s.replace(/\s+/g, ''))
      .pipe(z.string().regex(/^[A-Z0-9]{2}\d{1,4}$/, 'Use a flight number like 6E5321.'))
      .optional()
      .or(z.literal('').transform(() => undefined)),
    /** Scheduled (or expected) arrival, ISO 8601 with offset. */
    arrivalAt: z.string().datetime({ offset: true }),
    destination: z.object({
      placeId: z.string().min(1).max(128),
      label: z.string().trim().min(2).max(160),
      area: z.string().trim().min(2).max(80),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }),
    passengers: z.number().int().min(1, 'At least one traveller.').max(6, 'Up to 6 travellers per request.'),
    luggage: z.object({ cabin: count(12), medium: count(12), large: count(12) }),
    vehiclePreference: z.enum(VEHICLE_PREFERENCES),
    maxWaitMinutes: z.number().int().min(10).max(60),
    maxDetourMinutes: z.number().int().min(5).max(30),
    wheelchair: z.boolean(),
    notes: z.string().trim().max(280).optional().or(z.literal('').transform(() => undefined)),
    flightBookingId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const classes = acceptableVehicles(v.vehiclePreference, v.wheelchair);
    if (classes.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['vehiclePreference'], message: 'Wheelchair-accessible trips need a van. Choose “Any” or “Van”.' });
    } else if (!partyFits(v.passengers, v.luggage, classes)) {
      ctx.addIssue({ code: 'custom', path: ['luggage'], message: 'This group and luggage will not fit in a shared vehicle. Reduce bags or book a private ride.' });
    }
  });
export type RideRequestInput = z.input<typeof rideRequestSchema>;
