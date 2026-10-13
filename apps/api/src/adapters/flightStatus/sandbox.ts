import type { AdapterInfo } from '../../context';
import type { FlightStatusAdapter, FlightStatusQuery, FlightStatusResult } from './types';

interface Override {
  delayMinutes?: number;
  cancelled?: boolean;
}

/**
 * Sandbox flight-status source. Flights run on schedule unless an administrator (or a test)
 * sets a delay or cancellation, so demos never show invented disruptions.
 */
export class SandboxFlightStatusAdapter implements FlightStatusAdapter {
  readonly info: AdapterInfo = { kind: 'flight_status', provider: 'sandbox-flight-status', mode: 'sandbox' };
  private readonly overrides = new Map<string, Override>();
  outage = false;

  constructor(private readonly now: () => Date = () => new Date()) {}

  private key(q: Pick<FlightStatusQuery, 'flightNumber' | 'scheduledDepartAt'>) {
    return `${q.flightNumber}|${q.scheduledDepartAt.toISOString()}`;
  }

  /** Sandbox control: simulate a delay (minutes) or a cancellation. */
  setOverride(q: Pick<FlightStatusQuery, 'flightNumber' | 'scheduledDepartAt'>, o: Override) {
    this.overrides.set(this.key(q), o);
  }

  async getStatus(q: FlightStatusQuery): Promise<FlightStatusResult> {
    if (this.outage) throw new Error('Flight status source unavailable');
    const now = this.now();
    const o = this.overrides.get(this.key(q)) ?? {};
    const base = { source: this.info.provider, fetchedAt: now };
    if (o.cancelled) return { ...base, status: 'cancelled', estimatedArriveAt: null, actualArriveAt: null };
    const delay = (o.delayMinutes ?? 0) * 60_000;
    const departAt = new Date(q.scheduledDepartAt.getTime() + delay);
    const arriveAt = new Date(q.scheduledArriveAt.getTime() + delay);
    if (arriveAt <= now) return { ...base, status: 'landed', estimatedArriveAt: arriveAt, actualArriveAt: arriveAt };
    if (departAt <= now) return { ...base, status: 'departed', estimatedArriveAt: arriveAt, actualArriveAt: null };
    return { ...base, status: delay > 0 ? 'delayed' : 'scheduled', estimatedArriveAt: arriveAt, actualArriveAt: null };
  }
}
