import { sql } from 'drizzle-orm';
import { doublePrecision, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

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
