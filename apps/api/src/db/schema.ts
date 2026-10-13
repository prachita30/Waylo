import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  char,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
export const pk = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

// ---------------------------------------------------------------- catalog

export const cities = pgTable('cities', {
  id: varchar('id', { length: 32 }).primaryKey(), // slug, e.g. "mumbai"
  name: text('name').notNull(),
  state: text('state').notNull(),
  country: varchar('country', { length: 2 }).notNull().default('IN'),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  createdAt: createdAt(),
});

export const airports = pgTable(
  'airports',
  {
    code: varchar('code', { length: 3 }).primaryKey(), // IATA
    name: text('name').notNull(),
    cityId: varchar('city_id', { length: 32 })
      .notNull()
      .references(() => cities.id),
    timezone: text('timezone').notNull(), // IANA zone for local display
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('airports_city_idx').on(t.cityId)],
);

// ---------------------------------------------------------------- platform

export const appConfig = pgTable('app_config', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: updatedAt(),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: pk(),
    actorUserId: uuid('actor_user_id'),
    actorRole: varchar('actor_role', { length: 16 }),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').notNull().default({}),
    ip: varchar('ip', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_actor_idx').on(t.actorUserId),
    index('audit_created_idx').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------- identity

export const roleEnum = pgEnum('user_role', ['passenger', 'operator', 'partner', 'admin']);
export const userStatusEnum = pgEnum('user_status', ['active', 'suspended', 'deleted']);

export const users = pgTable(
  'users',
  {
    id: pk(),
    /** Stored lower-cased; uniqueness enforced by users_email_uq. */
    email: varchar('email', { length: 254 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: varchar('full_name', { length: 80 }).notNull(),
    phone: varchar('phone', { length: 16 }),
    role: roleEnum('role').notNull().default('passenger'),
    status: userStatusEnum('status').notNull().default('active'),
    homeAirport: varchar('home_airport', { length: 3 }).references(() => airports.code),
    avatarFile: varchar('avatar_file', { length: 80 }),
    /** Demo accounts are seeded only in demo mode and are labelled in the UI. */
    isDemo: boolean('is_demo').notNull().default(false),
    suspendedReason: text('suspended_reason'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), index('users_role_idx').on(t.role), index('users_status_idx').on(t.status)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** SHA-256 of the opaque cookie token; the raw token is never stored. */
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 255 }),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  notifyEmail: boolean('notify_email').notNull().default(true),
  notifySms: boolean('notify_sms').notNull().default(true),
  notifyPush: boolean('notify_push').notNull().default(true),
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
  updatedAt: updatedAt(),
});

export const savedDestinations = pgTable(
  'saved_destinations',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cityId: varchar('city_id', { length: 32 })
      .notNull()
      .references(() => cities.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cityId] })],
);

// ---------------------------------------------------------------- flights

export const cabinEnum = pgEnum('cabin_class', ['economy', 'premium_economy', 'business']);
export const flightStatusEnum = pgEnum('flight_status', ['scheduled', 'delayed', 'cancelled', 'departed', 'landed']);
export const offerStatusEnum = pgEnum('offer_status', ['draft', 'published', 'paused', 'expired', 'withdrawn']);

export const airlines = pgTable('airlines', {
  code: varchar('code', { length: 3 }).primaryKey(),
  name: text('name').notNull(),
  /** Fictional airlines used by the sandbox adapter. Always labelled in the UI. */
  isSandbox: boolean('is_sandbox').notNull().default(false),
  brandColor: varchar('brand_color', { length: 7 }).notNull().default('#2648E8'),
  createdAt: createdAt(),
});

/** One scheduled operation of a flight (airline + number + departure instant). */
export const flights = pgTable(
  'flights',
  {
    id: pk(),
    airlineCode: varchar('airline_code', { length: 3 })
      .notNull()
      .references(() => airlines.code),
    flightNumber: varchar('flight_number', { length: 8 }).notNull(),
    origin: varchar('origin', { length: 3 })
      .notNull()
      .references(() => airports.code),
    destination: varchar('destination', { length: 3 })
      .notNull()
      .references(() => airports.code),
    departAt: timestamp('depart_at', { withTimezone: true }).notNull(),
    arriveAt: timestamp('arrive_at', { withTimezone: true }).notNull(),
    status: flightStatusEnum('status').notNull().default('scheduled'),
    /** Latest known arrival estimate from a flight-status source. Null when unknown. */
    estimatedArriveAt: timestamp('estimated_arrive_at', { withTimezone: true }),
    statusUpdatedAt: timestamp('status_updated_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('flights_operation_uq').on(t.airlineCode, t.flightNumber, t.departAt),
    index('flights_route_idx').on(t.origin, t.destination, t.departAt),
    check('flights_times_ck', sql`${t.arriveAt} > ${t.departAt}`),
  ],
);

export const flightOffers = pgTable(
  'flight_offers',
  {
    id: pk(),
    flightId: uuid('flight_id')
      .notNull()
      .references(() => flights.id),
    /** 'partner' for offers published in the partner portal, otherwise the adapter provider key. */
    source: varchar('source', { length: 32 }).notNull(),
    externalRef: varchar('external_ref', { length: 128 }).notNull(),
    partnerId: uuid('partner_id'),
    cabin: cabinEnum('cabin').notNull(),
    /** All-inclusive fare per adult, in minor units. */
    fareMinor: integer('fare_minor').notNull(),
    taxesMinor: integer('taxes_minor').notNull().default(0),
    /**
     * The airline's published regular fare for the same flight and cabin. A discount is shown
     * only when this is present; it is never estimated by WAYLO.
     */
    referenceFareMinor: integer('reference_fare_minor'),
    referenceSource: text('reference_source'),
    currency: char('currency', { length: 3 }).notNull().default('INR'),
    baggageCabinKg: integer('baggage_cabin_kg').notNull().default(7),
    baggageCheckedKg: integer('baggage_checked_kg').notNull().default(0),
    refundable: boolean('refundable').notNull().default(false),
    changeFeeMinor: integer('change_fee_minor'),
    cancelFeeMinor: integer('cancel_fee_minor'),
    fareRules: text('fare_rules').notNull().default(''),
    eligibility: jsonb('eligibility').$type<{ maxPassengers?: number; minAdvanceHours?: number; notes?: string }>().notNull().default({}),
    /** Seats the airline reports as sellable at this fare. Null when the source does not say. */
    seatsAvailable: integer('seats_available'),
    /** Partner-set cap on how many seats WAYLO may sell at this fare. */
    inventoryCap: integer('inventory_cap'),
    seatsSold: integer('seats_sold').notNull().default(0),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    status: offerStatusEnum('status').notNull().default('published'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('offers_source_ref_uq').on(t.source, t.externalRef),
    index('offers_flight_idx').on(t.flightId),
    index('offers_status_valid_idx').on(t.status, t.validUntil),
    check('offers_fare_ck', sql`${t.fareMinor} > 0 AND ${t.taxesMinor} >= 0 AND ${t.taxesMinor} <= ${t.fareMinor}`),
    check('offers_sold_ck', sql`${t.seatsSold} >= 0 AND (${t.inventoryCap} IS NULL OR ${t.seatsSold} <= ${t.inventoryCap})`),
  ],
);
