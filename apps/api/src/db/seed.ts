import { sql } from 'drizzle-orm';
import type { Db } from './client';
import { seedDemoAccounts } from './demo-accounts';
import { airports, appConfig, cities, pickupZones } from './schema';

/** Real Indian cities and airports (public reference data). Coordinates are approximate. */
export const SEED_CITIES = [
  { id: 'mumbai', name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lng: 72.8777 },
  { id: 'delhi', name: 'New Delhi', state: 'Delhi', lat: 28.6139, lng: 77.209 },
  { id: 'bengaluru', name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  { id: 'goa', name: 'Goa', state: 'Goa', lat: 15.2993, lng: 74.124 },
  { id: 'hyderabad', name: 'Hyderabad', state: 'Telangana', lat: 17.385, lng: 78.4867 },
  { id: 'chennai', name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
  { id: 'kolkata', name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lng: 88.3639 },
  { id: 'jaipur', name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  { id: 'kochi', name: 'Kochi', state: 'Kerala', lat: 9.9312, lng: 76.2673 },
  { id: 'ahmedabad', name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lng: 72.5714 },
  { id: 'udaipur', name: 'Udaipur', state: 'Rajasthan', lat: 24.5854, lng: 73.7125 },
  { id: 'varanasi', name: 'Varanasi', state: 'Uttar Pradesh', lat: 25.3176, lng: 82.9739 },
];

const TZ = 'Asia/Kolkata';
export const SEED_AIRPORTS = [
  { code: 'BOM', name: 'Chhatrapati Shivaji Maharaj International Airport', cityId: 'mumbai', lat: 19.0896, lng: 72.8656 },
  { code: 'DEL', name: 'Indira Gandhi International Airport', cityId: 'delhi', lat: 28.5562, lng: 77.1 },
  { code: 'BLR', name: 'Kempegowda International Airport', cityId: 'bengaluru', lat: 13.1986, lng: 77.7066 },
  { code: 'GOI', name: 'Dabolim Airport', cityId: 'goa', lat: 15.3808, lng: 73.8314 },
  { code: 'GOX', name: 'Manohar International Airport', cityId: 'goa', lat: 15.7442, lng: 73.8606 },
  { code: 'HYD', name: 'Rajiv Gandhi International Airport', cityId: 'hyderabad', lat: 17.2403, lng: 78.4294 },
  { code: 'MAA', name: 'Chennai International Airport', cityId: 'chennai', lat: 12.9941, lng: 80.1709 },
  { code: 'CCU', name: 'Netaji Subhas Chandra Bose International Airport', cityId: 'kolkata', lat: 22.6547, lng: 88.4467 },
  { code: 'JAI', name: 'Jaipur International Airport', cityId: 'jaipur', lat: 26.8242, lng: 75.8122 },
  { code: 'COK', name: 'Cochin International Airport', cityId: 'kochi', lat: 10.152, lng: 76.4019 },
  { code: 'AMD', name: 'Sardar Vallabhbhai Patel International Airport', cityId: 'ahmedabad', lat: 23.0772, lng: 72.6347 },
  { code: 'UDR', name: 'Maharana Pratap Airport', cityId: 'udaipur', lat: 24.6177, lng: 73.8961 },
  { code: 'VNS', name: 'Lal Bahadur Shastri International Airport', cityId: 'varanasi', lat: 25.4524, lng: 82.8593 },
].map((a) => ({ ...a, timezone: TZ }));

/**
 * Pickup zones for airports where shared rides operate. Coordinates and wording are
 * approximate and must be verified on site with the airport operator before launch.
 */
export const SEED_PICKUP_ZONES = [
  {
    airportCode: 'BOM',
    terminal: 'T2',
    name: 'T2 Arrivals · App-cab pickup',
    instructions: 'After exiting arrivals, follow signs for “App-based cabs” and wait at the shared-ride bay. Your driver will message you on arrival.',
    lat: 19.0988,
    lng: 72.8742,
  },
  {
    airportCode: 'BOM',
    terminal: 'T1',
    name: 'T1 Arrivals · Pickup lane',
    instructions: 'Exit arrivals at Terminal 1 and cross to the pickup lane opposite gate 8. Wait in the marked shared-ride area.',
    lat: 19.0919,
    lng: 72.8534,
  },
  {
    airportCode: 'GOI',
    terminal: 'Main',
    name: 'Arrivals · Cab pickup',
    instructions: 'Exit arrivals and walk to the cab pickup area on the left. Look for the shared-ride sign.',
    lat: 15.3812,
    lng: 73.8341,
  },
];

export const DEFAULT_CONFIG:{ key: string; value: unknown; description: string }[] = [
  { key: 'platform.currency', value: 'INR', description: 'Settlement currency for the home market.' },
];

/** Idempotent: safe to run repeatedly. Reference data is upserted. */
export async function seedReferenceData(db: Db): Promise<void> {
  await db
    .insert(cities)
    .values(SEED_CITIES)
    .onConflictDoUpdate({ target: cities.id, set: { name: sql`excluded.name`, lat: sql`excluded.lat`, lng: sql`excluded.lng` } });
  await db
    .insert(airports)
    .values(SEED_AIRPORTS)
    .onConflictDoUpdate({ target: airports.code, set: { name: sql`excluded.name`, lat: sql`excluded.lat`, lng: sql`excluded.lng` } });
  await db.insert(appConfig).values(DEFAULT_CONFIG).onConflictDoNothing();
  await db.insert(pickupZones).values(SEED_PICKUP_ZONES).onConflictDoNothing();
}

export interface SeedOptions {
  /** Demo accounts and sample data are only loaded in demo mode. */
  demo: boolean;
}

export async function seed(db: Db, opts: SeedOptions = { demo: true }): Promise<void> {
  await seedReferenceData(db);
  if (!opts.demo) return;
  await seedDemoAccounts(db);
}
