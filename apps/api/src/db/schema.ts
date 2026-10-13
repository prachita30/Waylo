import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
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
