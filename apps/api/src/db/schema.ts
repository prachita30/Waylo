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

// ---------------------------------------------------------------- flight bookings & payments

export const bookingStatusEnum = pgEnum('flight_booking_status', [
  'pending_payment',
  'payment_failed',
  'ticketing',
  'confirmed',
  'ticketing_failed',
  'cancelled',
  'expired',
]);

/** A short-lived, server-held confirmation of price and availability. Clients reference it by id only. */
export const priceLocks = pgTable(
  'price_locks',
  {
    id: pk(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => flightOffers.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    adults: integer('adults').notNull(),
    farePerAdultMinor: integer('fare_per_adult_minor').notNull(),
    taxesPerAdultMinor: integer('taxes_per_adult_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('price_locks_user_idx').on(t.userId), check('price_locks_total_ck', sql`${t.totalMinor} = ${t.farePerAdultMinor} * ${t.adults}`)],
);

export const flightBookings = pgTable(
  'flight_bookings',
  {
    id: pk(),
    reference: varchar('reference', { length: 8 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => flightOffers.id),
    priceLockId: uuid('price_lock_id')
      .notNull()
      .references(() => priceLocks.id),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    status: bookingStatusEnum('status').notNull().default('pending_payment'),
    adults: integer('adults').notNull(),
    totalMinor: integer('total_minor').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    contactEmail: varchar('contact_email', { length: 254 }).notNull(),
    contactPhone: varchar('contact_phone', { length: 16 }),
    /** Itinerary, fare rules and baggage exactly as sold, for the customer's record. */
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    airlineOrderRef: varchar('airline_order_ref', { length: 64 }),
    pnr: varchar('pnr', { length: 12 }),
    ticketedAt: timestamp('ticketed_at', { withTimezone: true }),
    ticketingAttempts: integer('ticketing_attempts').notNull().default(0),
    nextTicketingCheckAt: timestamp('next_ticketing_check_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    /** Seats held against the offer's partner inventory cap; released on expiry or failure. */
    seatsHeld: boolean('seats_held').notNull().default(true),
    paymentDueAt: timestamp('payment_due_at', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: varchar('cancelled_by', { length: 16 }),
    refundDueMinor: integer('refund_due_minor'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bookings_reference_uq').on(t.reference),
    uniqueIndex('bookings_lock_uq').on(t.priceLockId),
    uniqueIndex('bookings_idempotency_uq').on(t.userId, t.idempotencyKey),
    index('bookings_user_idx').on(t.userId, t.createdAt),
    index('bookings_status_idx').on(t.status),
  ],
);

export const bookingPassengers = pgTable(
  'booking_passengers',
  {
    id: pk(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => flightBookings.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    firstName: varchar('first_name', { length: 60 }).notNull(),
    lastName: varchar('last_name', { length: 60 }).notNull(),
    ticketNumber: varchar('ticket_number', { length: 20 }),
  },
  (t) => [uniqueIndex('passengers_position_uq').on(t.bookingId, t.position)],
);

export const paymentStatusEnum = pgEnum('payment_status', ['requires_payment', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded']);

export const payments = pgTable(
  'payments',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    purpose: varchar('purpose', { length: 24 }).notNull(), // 'flight_booking' | 'ride'
    referenceId: uuid('reference_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    refundedMinor: integer('refunded_minor').notNull().default(0),
    currency: char('currency', { length: 3 }).notNull(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerIntentId: varchar('provider_intent_id', { length: 128 }).notNull(),
    status: paymentStatusEnum('status').notNull().default('requires_payment'),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_provider_intent_uq').on(t.provider, t.providerIntentId),
    index('payments_reference_idx').on(t.purpose, t.referenceId),
    check('payments_amount_ck', sql`${t.amountMinor} > 0 AND ${t.refundedMinor} >= 0 AND ${t.refundedMinor} <= ${t.amountMinor}`),
  ],
);

/** Every provider webhook event, stored once. The unique event id makes processing idempotent. */
export const paymentEvents = pgTable(
  'payment_events',
  {
    id: pk(),
    provider: varchar('provider', { length: 32 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 128 }).notNull(),
    type: varchar('type', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('payment_events_uq').on(t.provider, t.providerEventId)],
);

// ---------------------------------------------------------------- shared rides: requests

/** Designated pickup points at an airport terminal (where riders meet their driver). */
export const pickupZones = pgTable(
  'pickup_zones',
  {
    id: pk(),
    airportCode: varchar('airport_code', { length: 3 })
      .notNull()
      .references(() => airports.code),
    terminal: varchar('terminal', { length: 8 }).notNull(),
    name: text('name').notNull(),
    instructions: text('instructions').notNull(),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('pickup_zones_airport_idx').on(t.airportCode), uniqueIndex('pickup_zones_name_uq').on(t.airportCode, t.name)],
);

export const rideRequestStatusEnum = pgEnum('ride_request_status', ['open', 'matched', 'cancelled', 'expired', 'no_match', 'completed']);
export const vehiclePreferenceEnum = pgEnum('vehicle_preference', ['any', 'sedan', 'suv', 'van']);

export const rideRequests = pgTable(
  'ride_requests',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    airportCode: varchar('airport_code', { length: 3 })
      .notNull()
      .references(() => airports.code),
    pickupZoneId: uuid('pickup_zone_id')
      .notNull()
      .references(() => pickupZones.id),
    flightNumber: varchar('flight_number', { length: 8 }),
    flightId: uuid('flight_id').references(() => flights.id),
    flightBookingId: uuid('flight_booking_id').references(() => flightBookings.id),
    /** Scheduled (or customer-stated) arrival. Flight status updates move expected_arrival_at (Phase 8). */
    scheduledArrivalAt: timestamp('scheduled_arrival_at', { withTimezone: true }).notNull(),
    expectedArrivalAt: timestamp('expected_arrival_at', { withTimezone: true }).notNull(),
    destinationPlaceId: varchar('destination_place_id', { length: 128 }).notNull(),
    destinationLabel: varchar('destination_label', { length: 160 }).notNull(),
    destinationArea: varchar('destination_area', { length: 80 }).notNull(),
    destinationLat: doublePrecision('destination_lat').notNull(),
    destinationLng: doublePrecision('destination_lng').notNull(),
    directDistanceMeters: integer('direct_distance_meters').notNull(),
    directDurationSeconds: integer('direct_duration_seconds').notNull(),
    passengers: integer('passengers').notNull(),
    luggageCabin: integer('luggage_cabin').notNull().default(0),
    luggageMedium: integer('luggage_medium').notNull().default(0),
    luggageLarge: integer('luggage_large').notNull().default(0),
    vehiclePreference: vehiclePreferenceEnum('vehicle_preference').notNull().default('any'),
    maxWaitMinutes: integer('max_wait_minutes').notNull(),
    maxDetourMinutes: integer('max_detour_minutes').notNull(),
    wheelchair: boolean('wheelchair').notNull().default(false),
    notes: varchar('notes', { length: 280 }),
    status: rideRequestStatusEnum('status').notNull().default('open'),
    closedReason: varchar('closed_reason', { length: 40 }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ride_requests_pool_idx').on(t.airportCode, t.status, t.expectedArrivalAt),
    index('ride_requests_user_idx').on(t.userId, t.createdAt),
    // One active request per traveller per arrival.
    uniqueIndex('ride_requests_active_uq').on(t.userId, t.airportCode, t.scheduledArrivalAt).where(sql`${t.status} in ('open', 'matched')`),
    check('ride_requests_pax_ck', sql`${t.passengers} between 1 and 6`),
    check('ride_requests_limits_ck', sql`${t.maxWaitMinutes} between 10 and 60 and ${t.maxDetourMinutes} between 5 and 30`),
    check('ride_requests_luggage_ck', sql`${t.luggageCabin} >= 0 and ${t.luggageMedium} >= 0 and ${t.luggageLarge} >= 0`),
  ],
);

// ---------------------------------------------------------------- shared rides: groups

export const vehicleClassEnum = pgEnum('vehicle_class', ['sedan', 'suv', 'van']);
export const splitMethodEnum = pgEnum('split_method', ['equal_per_seat', 'distance_weighted']);
export const rideGroupStatusEnum = pgEnum('ride_group_status', ['forming', 'locked', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed', 'cancelled']);
export const participantStatusEnum = pgEnum('ride_participant_status', ['joined', 'payment_due', 'confirmed', 'left', 'removed', 'no_show', 'completed']);
/** Rider-reported progress after landing. WAYLO does not infer baggage or exit times. */
export const readinessEnum = pgEnum('rider_readiness', ['not_landed', 'landed', 'at_baggage', 'ready', 'at_pickup']);

export const rideGroups = pgTable(
  'ride_groups',
  {
    id: pk(),
    airportCode: varchar('airport_code', { length: 3 })
      .notNull()
      .references(() => airports.code),
    pickupZoneId: uuid('pickup_zone_id')
      .notNull()
      .references(() => pickupZones.id),
    status: rideGroupStatusEnum('status').notNull().default('forming'),
    vehicleClass: vehicleClassEnum('vehicle_class').notNull(),
    seatCapacity: integer('seat_capacity').notNull(),
    luggageCapacity: integer('luggage_capacity').notNull(),
    seatsTaken: integer('seats_taken').notNull().default(0),
    luggageTaken: integer('luggage_taken').notNull().default(0),
    parties: integer('parties').notNull().default(0),
    splitMethod: splitMethodEnum('split_method').notNull().default('equal_per_seat'),
    plannedPickupAt: timestamp('planned_pickup_at', { withTimezone: true }).notNull(),
    lockAt: timestamp('lock_at', { withTimezone: true }).notNull(),
    /** Planned drop-off order with leg estimates. */
    route: jsonb('route').$type<{ order: string[]; legs: { to: string; distanceMeters: number; durationSeconds: number }[] }>().notNull(),
    routeDistanceMeters: integer('route_distance_meters').notNull(),
    routeDurationSeconds: integer('route_duration_seconds').notNull(),
    /** Vehicle fare breakdown (base, distance, time, stops, airport access, tolls, total). */
    fare: jsonb('fare').$type<Record<string, number>>().notNull(),
    vehicleFareMinor: integer('vehicle_fare_minor').notNull(),
    /** Amount WAYLO absorbs so no rider pays more than they agreed after someone leaves. */
    platformSubsidyMinor: integer('platform_subsidy_minor').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ride_groups_pool_idx').on(t.airportCode, t.pickupZoneId, t.status, t.plannedPickupAt),
    index('ride_groups_lock_idx').on(t.status, t.lockAt),
    check('ride_groups_capacity_ck', sql`${t.seatsTaken} <= ${t.seatCapacity} and ${t.luggageTaken} <= ${t.luggageCapacity} and ${t.seatsTaken} >= 0`),
  ],
);

export const rideParticipants = pgTable(
  'ride_participants',
  {
    id: pk(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => rideGroups.id),
    requestId: uuid('request_id')
      .notNull()
      .references(() => rideRequests.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: participantStatusEnum('status').notNull().default('joined'),
    seats: integer('seats').notNull(),
    luggageUnits: integer('luggage_units').notNull(),
    /** Ride alone at the agreed price if nobody else joins (only meaningful for the first member). */
    soloOk: boolean('solo_ok').notNull().default(false),
    dropoffOrder: integer('dropoff_order').notNull(),
    waitMinutes: integer('wait_minutes').notNull().default(0),
    detourMinutes: integer('detour_minutes').notNull().default(0),
    estimatedDropoffAt: timestamp('estimated_dropoff_at', { withTimezone: true }).notNull(),
    /** Highest total this rider agreed to; their price can only go down from here. */
    maxTotalMinor: integer('max_total_minor').notNull(),
    fareShareMinor: integer('fare_share_minor').notNull(),
    platformFeeMinor: integer('platform_fee_minor').notNull(),
    taxMinor: integer('tax_minor').notNull(),
    currentTotalMinor: integer('current_total_minor').notNull(),
    finalTotalMinor: integer('final_total_minor'),
    soloTotalMinor: integer('solo_total_minor').notNull(),
    cancellationFeeMinor: integer('cancellation_fee_minor'),
    readiness: readinessEnum('readiness').notNull().default('not_landed'),
    readinessUpdatedAt: timestamp('readiness_updated_at', { withTimezone: true }),
    removedReason: varchar('removed_reason', { length: 32 }),
    /** Set when the group locks; the seat is released if unpaid by then. */
    paymentDueAt: timestamp('payment_due_at', { withTimezone: true }),
    boardedAt: timestamp('boarded_at', { withTimezone: true }),
    droppedOffAt: timestamp('dropped_off_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp('left_at', { withTimezone: true }),
  },
  (t) => [
    index('participants_group_idx').on(t.groupId),
    index('participants_user_idx').on(t.userId),
    uniqueIndex('participants_active_request_uq').on(t.requestId).where(sql`${t.status} in ('joined', 'payment_due', 'confirmed')`),
    check('participants_price_ck', sql`${t.currentTotalMinor} <= ${t.maxTotalMinor}`),
  ],
);

// ---------------------------------------------------------------- fleet operators

export const reviewStatusEnum = pgEnum('review_status', ['pending', 'approved', 'rejected', 'suspended']);
export const operatorRoleEnum = pgEnum('operator_member_role', ['owner', 'dispatcher', 'driver']);

export const operators = pgTable(
  'operators',
  {
    id: pk(),
    name: varchar('name', { length: 120 }).notNull(),
    phone: varchar('phone', { length: 16 }).notNull(),
    /** Airports this operator serves (IATA codes). */
    airports: jsonb('airports').$type<string[]>().notNull().default([]),
    status: reviewStatusEnum('status').notNull().default('pending'),
    statusReason: text('status_reason'),
    /** Platform commission on the vehicle fare, basis points. */
    commissionBps: integer('commission_bps').notNull().default(1500),
    isDemo: boolean('is_demo').notNull().default(false),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('operators_status_idx').on(t.status)],
);

export const operatorMembers = pgTable(
  'operator_members',
  {
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: operatorRoleEnum('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.operatorId, t.userId] }), uniqueIndex('operator_members_user_uq').on(t.userId)],
);

export const drivers = pgTable(
  'drivers',
  {
    id: pk(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    /** Login used for trip updates, when the driver uses the app. */
    userId: uuid('user_id').references(() => users.id),
    fullName: varchar('full_name', { length: 80 }).notNull(),
    phone: varchar('phone', { length: 16 }).notNull(),
    /** Only the last four characters are stored; the licence document is reviewed separately. */
    licenceLast4: varchar('licence_last4', { length: 4 }).notNull(),
    status: reviewStatusEnum('status').notNull().default('pending'),
    statusReason: text('status_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('drivers_operator_idx').on(t.operatorId), uniqueIndex('drivers_user_uq').on(t.userId)],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: pk(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    vehicleClass: vehicleClassEnum('vehicle_class').notNull(),
    makeModel: varchar('make_model', { length: 60 }).notNull(),
    colour: varchar('colour', { length: 30 }).notNull(),
    registration: varchar('registration', { length: 16 }).notNull(),
    seats: integer('seats').notNull(),
    luggageUnits: integer('luggage_units').notNull(),
    wheelchairAccessible: boolean('wheelchair_accessible').notNull().default(false),
    status: reviewStatusEnum('status').notNull().default('pending'),
    statusReason: text('status_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('vehicles_operator_idx').on(t.operatorId), uniqueIndex('vehicles_registration_uq').on(t.registration)],
);

export const documentTypeEnum = pgEnum('document_type', [
  'operator_permit',
  'insurance',
  'vehicle_registration',
  'fitness_certificate',
  'driving_licence',
  'police_verification',
]);

export const operatorDocuments = pgTable(
  'operator_documents',
  {
    id: pk(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    /** operator | driver | vehicle */
    subjectType: varchar('subject_type', { length: 16 }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    docType: documentTypeEnum('doc_type').notNull(),
    fileName: varchar('file_name', { length: 80 }).notNull(),
    contentType: varchar('content_type', { length: 40 }).notNull(),
    expiresOn: varchar('expires_on', { length: 10 }),
    status: reviewStatusEnum('status').notNull().default('pending'),
    reviewNotes: text('review_notes'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('documents_subject_idx').on(t.subjectType, t.subjectId), index('documents_operator_idx').on(t.operatorId)],
);

/** When a driver and vehicle can take airport trips. */
export const availability = pgTable(
  'availability',
  {
    id: pk(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    airportCode: varchar('airport_code', { length: 3 })
      .notNull()
      .references(() => airports.code),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('availability_airport_time_idx').on(t.airportCode, t.startsAt, t.endsAt), check('availability_window_ck', sql`${t.endsAt} > ${t.startsAt}`)],
);

/** Assignment and execution of a ride group by an operator. One row per group. */
export const rideTrips = pgTable(
  'ride_trips',
  {
    groupId: uuid('group_id')
      .primaryKey()
      .references(() => rideGroups.id),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => drivers.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    enRouteAt: timestamp('en_route_at', { withTimezone: true }),
    arrivedAt: timestamp('arrived_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastLat: doublePrecision('last_lat'),
    lastLng: doublePrecision('last_lng'),
    lastLocationAt: timestamp('last_location_at', { withTimezone: true }),
    offRoute: boolean('off_route').notNull().default(false),
    offRouteSince: timestamp('off_route_since', { withTimezone: true }),
    /** Operator earning = vehicle fare minus commission, fixed at completion. */
    operatorEarningMinor: integer('operator_earning_minor'),
    commissionMinor: integer('commission_minor'),
    settlementId: uuid('settlement_id'),
  },
  (t) => [index('ride_trips_operator_idx').on(t.operatorId), index('ride_trips_driver_idx').on(t.driverId)],
);

export const tripReleases = pgTable('trip_releases', {
  id: pk(),
  groupId: uuid('group_id')
    .notNull()
    .references(() => rideGroups.id),
  operatorId: uuid('operator_id')
    .notNull()
    .references(() => operators.id),
  reason: text('reason').notNull(),
  createdAt: createdAt(),
});

export const incidentCategoryEnum = pgEnum('incident_category', ['safety', 'accident', 'vehicle', 'passenger_conduct', 'driver_conduct', 'lost_item', 'other']);
export const incidentSeverityEnum = pgEnum('incident_severity', ['low', 'medium', 'high', 'critical']);
export const incidentStatusEnum = pgEnum('incident_status', ['open', 'investigating', 'resolved']);

export const safetyIncidents = pgTable(
  'safety_incidents',
  {
    id: pk(),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id),
    reporterRole: varchar('reporter_role', { length: 16 }).notNull(),
    groupId: uuid('group_id').references(() => rideGroups.id),
    operatorId: uuid('operator_id').references(() => operators.id),
    category: incidentCategoryEnum('category').notNull(),
    severity: incidentSeverityEnum('severity').notNull(),
    description: text('description').notNull(),
    status: incidentStatusEnum('status').notNull().default('open'),
    resolution: text('resolution'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('incidents_status_idx').on(t.status, t.severity)],
);

// ---------------------------------------------------------------- refunds & settlements

export const refundStatusEnum = pgEnum('refund_status', ['pending', 'processing', 'succeeded', 'failed']);

/**
 * Every refund owed to a customer. The idempotency key (e.g. "booking:<id>:cancel") makes it
 * impossible to create the same refund twice; amounts are capped against the payment.
 */
export const refunds = pgTable(
  'refunds',
  {
    id: pk(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amountMinor: integer('amount_minor').notNull(),
    reason: varchar('reason', { length: 40 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 120 }).notNull(),
    status: refundStatusEnum('status').notNull().default('pending'),
    providerRefundId: varchar('provider_refund_id', { length: 128 }),
    failureReason: text('failure_reason'),
    attempts: integer('attempts').notNull().default(0),
    requestedBy: varchar('requested_by', { length: 16 }).notNull().default('system'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('refunds_idempotency_uq').on(t.idempotencyKey),
    index('refunds_payment_idx').on(t.paymentId),
    index('refunds_status_idx').on(t.status),
    check('refunds_amount_ck', sql`${t.amountMinor} > 0`),
  ],
);

export const settlementStatusEnum = pgEnum('settlement_status', ['pending', 'paid', 'failed']);

/** Operator payout batch for completed trips in a period. */
export const settlements = pgTable(
  'settlements',
  {
    id: pk(),
    operatorId: uuid('operator_id')
      .notNull()
      .references(() => operators.id),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    tripsCount: integer('trips_count').notNull(),
    grossFareMinor: integer('gross_fare_minor').notNull(),
    commissionMinor: integer('commission_minor').notNull(),
    payoutMinor: integer('payout_minor').notNull(),
    status: settlementStatusEnum('status').notNull().default('pending'),
    /** Bank transfer / payout provider reference, recorded when paid. */
    payoutReference: varchar('payout_reference', { length: 80 }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('settlements_operator_idx').on(t.operatorId, t.periodEnd), check('settlements_amounts_ck', sql`${t.payoutMinor} = ${t.grossFareMinor} - ${t.commissionMinor}`)],
);

// ---------------------------------------------------------------- notifications

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 48 }).notNull(),
    title: varchar('title', { length: 140 }).notNull(),
    body: text('body').notNull(),
    /** In-app path to open, e.g. /trips/flights/<id>. */
    link: varchar('link', { length: 200 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const deliveryChannelEnum = pgEnum('delivery_channel', ['email', 'sms', 'push']);
export const deliveryStatusEnum = pgEnum('delivery_status', ['queued', 'sent', 'failed', 'skipped']);

/** Outbox of outbound messages for each notification. */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    channel: deliveryChannelEnum('channel').notNull(),
    status: deliveryStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('deliveries_queue_idx').on(t.status, t.nextAttemptAt)],
);

// ---------------------------------------------------------------- support

export const ticketCategoryEnum = pgEnum('ticket_category', ['booking', 'ride', 'payment_refund', 'account', 'safety', 'other']);
export const ticketStatusEnum = pgEnum('ticket_status', ['open', 'in_review', 'awaiting_customer', 'resolved', 'closed']);
export const ticketPriorityEnum = pgEnum('ticket_priority', ['normal', 'high', 'urgent']);

export const supportTickets = pgTable(
  'support_tickets',
  {
    id: pk(),
    reference: varchar('reference', { length: 10 }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    category: ticketCategoryEnum('category').notNull(),
    subject: varchar('subject', { length: 140 }).notNull(),
    status: ticketStatusEnum('status').notNull().default('open'),
    priority: ticketPriorityEnum('priority').notNull().default('normal'),
    /** Booking reference (WY…) or ride group id the customer is asking about. */
    relatedBookingRef: varchar('related_booking_ref', { length: 12 }),
    relatedGroupId: uuid('related_group_id'),
    assignedTo: uuid('assigned_to').references(() => users.id),
    incidentId: uuid('incident_id'),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tickets_reference_uq').on(t.reference),
    index('tickets_user_idx').on(t.userId, t.createdAt),
    index('tickets_queue_idx').on(t.status, t.priority, t.lastActivityAt),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: pk(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    authorRole: varchar('author_role', { length: 16 }).notNull(),
    body: text('body').notNull(),
    /** Agent-only note, never shown to the customer. */
    internal: boolean('internal').notNull().default(false),
    attachmentFile: varchar('attachment_file', { length: 80 }),
    attachmentType: varchar('attachment_type', { length: 40 }),
    attachmentName: varchar('attachment_name', { length: 120 }),
    createdAt: createdAt(),
  },
  (t) => [index('support_messages_ticket_idx').on(t.ticketId, t.createdAt)],
);
