import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { VehicleClass } from '@waylo/shared';
import { and, asc, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import type { AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { availability, drivers, operatorDocuments, operatorMembers, operators, users, vehicles } from '../../db/schema';
import { badRequest, conflict, notFound } from '../../http/errors';
import { recordAudit } from '../../lib/audit';
import { setSupplyProvider } from '../rides/groups';

/** Supported document uploads: PDF, PNG, JPEG (checked by magic bytes). */
export function sniffDocument(buf: Buffer): { ext: 'pdf' | 'png' | 'jpg'; type: string } | null {
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { ext: 'pdf', type: 'application/pdf' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  return null;
}

export const documentDir = (ctx: AppContext) => path.resolve(ctx.config.UPLOAD_DIR, 'documents');

export async function storeDocument(
  ctx: AppContext,
  input: { operatorId: string; uploadedBy: string; subjectType: 'operator' | 'driver' | 'vehicle'; subjectId: string; docType: (typeof operatorDocuments.$inferInsert)['docType']; expiresOn?: string; file: Buffer },
) {
  const kind = sniffDocument(input.file);
  if (!kind) throw badRequest('Upload a PDF, PNG or JPEG file.');
  // The subject must belong to the uploader's operator.
  const owned =
    input.subjectType === 'operator'
      ? input.subjectId === input.operatorId
      : input.subjectType === 'driver'
        ? (await ctx.db.select({ id: drivers.id }).from(drivers).where(and(eq(drivers.id, input.subjectId), eq(drivers.operatorId, input.operatorId)))).length > 0
        : (await ctx.db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.id, input.subjectId), eq(vehicles.operatorId, input.operatorId)))).length > 0;
  if (!owned) throw notFound('Document subject');
  const fileName = `${randomUUID()}.${kind.ext}`;
  await mkdir(documentDir(ctx), { recursive: true });
  await writeFile(path.join(documentDir(ctx), fileName), input.file);
  const [doc] = await ctx.db
    .insert(operatorDocuments)
    .values({
      operatorId: input.operatorId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      docType: input.docType,
      fileName,
      contentType: kind.type,
      expiresOn: input.expiresOn ?? null,
      uploadedBy: input.uploadedBy,
    })
    .returning();
  return doc!;
}

export async function readDocument(ctx: AppContext, docId: string, operatorId: string | null) {
  const [doc] = await ctx.db.select().from(operatorDocuments).where(eq(operatorDocuments.id, docId));
  // Operators see only their own documents; administrators (operatorId null) see all.
  if (!doc || (operatorId !== null && doc.operatorId !== operatorId)) throw notFound('Document');
  const data = await readFile(path.join(documentDir(ctx), doc.fileName)).catch(() => null);
  if (!data) throw notFound('Document file');
  return { doc, data };
}

export async function fleetOverview(ctx: AppContext, operatorId: string) {
  const [vs, ds, docs, slots] = await Promise.all([
    ctx.db.select().from(vehicles).where(eq(vehicles.operatorId, operatorId)).orderBy(asc(vehicles.createdAt)),
    ctx.db.select().from(drivers).where(eq(drivers.operatorId, operatorId)).orderBy(asc(drivers.createdAt)),
    ctx.db.select().from(operatorDocuments).where(eq(operatorDocuments.operatorId, operatorId)).orderBy(desc(operatorDocuments.createdAt)),
    ctx.db
      .select()
      .from(availability)
      .where(and(eq(availability.operatorId, operatorId), gt(availability.endsAt, new Date())))
      .orderBy(asc(availability.startsAt))
      .limit(100),
  ]);
  return {
    vehicles: vs,
    drivers: ds.map((d) => ({ ...d, licenceLast4: d.licenceLast4 })),
    documents: docs.map(({ fileName: _f, ...d }) => d),
    availability: slots,
  };
}

export async function addDriver(ctx: AppContext, operatorId: string, actorId: string, input: { fullName: string; phone: string; licenceLast4: string; userEmail?: string }) {
  let userId: string | null = null;
  if (input.userEmail) {
    const [u] = await ctx.db.select().from(users).where(eq(users.email, input.userEmail));
    if (!u || u.role !== 'operator') throw badRequest('That email does not belong to an operator-role WAYLO account.');
    const [m] = await ctx.db.select().from(operatorMembers).where(eq(operatorMembers.userId, u.id));
    if (m && m.operatorId !== operatorId) throw conflict('driver_taken', 'That account already belongs to another operator.');
    userId = u.id;
    if (!m) await ctx.db.insert(operatorMembers).values({ operatorId, userId: u.id, role: 'driver' });
  }
  const [d] = await ctx.db.insert(drivers).values({ operatorId, userId, fullName: input.fullName, phone: input.phone, licenceLast4: input.licenceLast4 }).returning();
  await recordAudit(ctx.db, { actorUserId: actorId, actorRole: 'operator', action: 'driver.added', entityType: 'driver', entityId: d!.id });
  return d!;
}

export async function addVehicle(ctx: AppContext, operatorId: string, actorId: string, input: typeof vehicles.$inferInsert) {
  const [exists] = await ctx.db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.registration, input.registration));
  if (exists) throw conflict('vehicle_exists', 'A vehicle with this registration is already registered.');
  const [v] = await ctx.db.insert(vehicles).values({ ...input, operatorId }).returning();
  await recordAudit(ctx.db, { actorUserId: actorId, actorRole: 'operator', action: 'vehicle.added', entityType: 'vehicle', entityId: v!.id });
  return v!;
}

export async function addAvailability(ctx: AppContext, operatorId: string, input: { driverId: string; vehicleId: string; airport: string; startsAt: string; endsAt: string }) {
  const [op] = await ctx.db.select().from(operators).where(eq(operators.id, operatorId));
  if (!op!.airports.includes(input.airport)) throw badRequest('Add this airport to your service area first.');
  const [d] = await ctx.db.select().from(drivers).where(and(eq(drivers.id, input.driverId), eq(drivers.operatorId, operatorId)));
  const [v] = await ctx.db.select().from(vehicles).where(and(eq(vehicles.id, input.vehicleId), eq(vehicles.operatorId, operatorId)));
  if (!d || !v) throw notFound('Driver or vehicle');
  if (d.status !== 'approved' || v.status !== 'approved') throw conflict('not_approved', 'Only approved drivers and vehicles can be scheduled.');
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const overlap = await ctx.db
    .select({ id: availability.id })
    .from(availability)
    .where(and(inArray(availability.driverId, [d.id]), lt(availability.startsAt, endsAt), gt(availability.endsAt, startsAt)));
  if (overlap.length) throw conflict('overlap', 'This driver already has a shift in that time.');
  const [a] = await ctx.db.insert(availability).values({ operatorId, driverId: d.id, vehicleId: v.id, airportCode: input.airport, startsAt, endsAt }).returning();
  return a!;
}

/** How far ahead approved fleet capacity counts as supply without a scheduled shift. */
const SHIFT_REQUIRED_WITHIN_HOURS = 48;

/**
 * Vehicle classes approved operators can supply at an airport around a time. Within 48 hours a
 * scheduled shift is required; further ahead, approved fleet capacity counts as planned supply.
 */
export async function availableClasses(db: DbOrTx, airport: string, at: Date): Promise<VehicleClass[]> {
  const hoursAhead = (at.getTime() - Date.now()) / 3_600_000;
  const approvedOps = (await db.select().from(operators).where(eq(operators.status, 'approved'))).filter((o) => o.airports.includes(airport));
  if (!approvedOps.length) return [];
  const opIds = approvedOps.map((o) => o.id);
  let rows: { vehicleClass: VehicleClass }[];
  if (hoursAhead > SHIFT_REQUIRED_WITHIN_HOURS) {
    rows = await db
      .select({ vehicleClass: vehicles.vehicleClass })
      .from(vehicles)
      .where(and(inArray(vehicles.operatorId, opIds), eq(vehicles.status, 'approved')));
  } else {
    rows = await db
      .select({ vehicleClass: vehicles.vehicleClass })
      .from(availability)
      .innerJoin(vehicles, eq(vehicles.id, availability.vehicleId))
      .innerJoin(drivers, eq(drivers.id, availability.driverId))
      .where(
        and(
          inArray(availability.operatorId, opIds),
          eq(availability.airportCode, airport),
          lt(availability.startsAt, new Date(at.getTime() + 30 * 60_000)),
          gt(availability.endsAt, new Date(at.getTime() + 60 * 60_000)),
          eq(vehicles.status, 'approved'),
          eq(drivers.status, 'approved'),
        ),
      );
  }
  return [...new Set(rows.map((r) => r.vehicleClass))];
}

export function registerSupply() {
  setSupplyProvider((_ctx, db, airport, at) => availableClasses(db, airport, at));
}
