import type { Adapter } from '../../context';

export type LiveFlightStatus = 'scheduled' | 'delayed' | 'cancelled' | 'departed' | 'landed';

export interface FlightStatusQuery {
  airlineCode: string;
  flightNumber: string;
  scheduledDepartAt: Date;
  scheduledArriveAt: Date;
}

export interface FlightStatusResult {
  status: LiveFlightStatus;
  /** Best current arrival estimate, or null when the source does not provide one. */
  estimatedArriveAt: Date | null;
  /** Actual touchdown time once landed. */
  actualArriveAt: Date | null;
  source: string;
  fetchedAt: Date;
}

/** Flight status provider boundary (e.g. an airline feed or an aviation data API). */
export interface FlightStatusAdapter extends Adapter {
  getStatus(q: FlightStatusQuery): Promise<FlightStatusResult>;
}
