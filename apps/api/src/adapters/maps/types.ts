import type { Adapter } from '../../context';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  placeId: string;
  /** Full label, e.g. "Colaba Causeway, Colaba, Mumbai". Shown only to the requester and driver. */
  label: string;
  /** Coarse area shown to co-riders, e.g. "Colaba". */
  area: string;
}

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  legs: { distanceMeters: number; durationSeconds: number }[];
  /** Straight segments between stops; a live provider returns a road polyline. */
  path: LatLng[];
}

/**
 * Mapping provider boundary (geocoding, routing, ETAs). Implementations run server-side so
 * provider keys never reach the browser.
 */
export interface MapsAdapter extends Adapter {
  searchPlaces(query: string, near: LatLng, radiusKm: number): Promise<Place[]>;
  estimateRoute(stops: LatLng[], departAt: Date): Promise<RouteEstimate>;
}

export class MapsUnavailableError extends Error {
  constructor(message = 'Maps provider unavailable') {
    super(message);
    this.name = 'MapsUnavailableError';
  }
}
