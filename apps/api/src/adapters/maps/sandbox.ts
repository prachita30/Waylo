import { citySpeedKmh, haversineKm, localHour, ROAD_FACTOR } from '@waylo/shared';
import type { AdapterInfo } from '../../context';
import { type LatLng, type MapsAdapter, MapsUnavailableError, type Place, type RouteEstimate } from './types';

/**
 * Approximate locality centroids (public reference geography). Good enough for matching
 * demos; a live provider replaces this with real geocoding and road routing.
 */
const GAZETTEER: { area: string; city: string; lat: number; lng: number; landmarks?: string[] }[] = [
  { area: 'Colaba', city: 'Mumbai', lat: 18.9067, lng: 72.8147, landmarks: ['Colaba Causeway', 'Gateway of India'] },
  { area: 'Nariman Point', city: 'Mumbai', lat: 18.9256, lng: 72.8242 },
  { area: 'Churchgate', city: 'Mumbai', lat: 18.9322, lng: 72.8264 },
  { area: 'Fort', city: 'Mumbai', lat: 18.9345, lng: 72.8356, landmarks: ['Kala Ghoda', 'CSMT'] },
  { area: 'Marine Lines', city: 'Mumbai', lat: 18.9447, lng: 72.8235, landmarks: ['Marine Drive'] },
  { area: 'Malabar Hill', city: 'Mumbai', lat: 18.9548, lng: 72.7985 },
  { area: 'Byculla', city: 'Mumbai', lat: 18.9767, lng: 72.8327 },
  { area: 'Worli', city: 'Mumbai', lat: 19.0176, lng: 72.8172, landmarks: ['Worli Sea Face'] },
  { area: 'Lower Parel', city: 'Mumbai', lat: 18.9953, lng: 72.8302, landmarks: ['Phoenix Palladium'] },
  { area: 'Prabhadevi', city: 'Mumbai', lat: 19.0166, lng: 72.8287 },
  { area: 'Dadar', city: 'Mumbai', lat: 19.0178, lng: 72.8478, landmarks: ['Shivaji Park'] },
  { area: 'Mahim', city: 'Mumbai', lat: 19.0402, lng: 72.84 },
  { area: 'Bandra West', city: 'Mumbai', lat: 19.0596, lng: 72.8295, landmarks: ['Bandstand', 'Linking Road'] },
  { area: 'Bandra Kurla Complex', city: 'Mumbai', lat: 19.0662, lng: 72.8656, landmarks: ['BKC'] },
  { area: 'Khar West', city: 'Mumbai', lat: 19.0728, lng: 72.8362 },
  { area: 'Santacruz West', city: 'Mumbai', lat: 19.0812, lng: 72.8372 },
  { area: 'Juhu', city: 'Mumbai', lat: 19.1075, lng: 72.8263, landmarks: ['Juhu Beach'] },
  { area: 'Vile Parle East', city: 'Mumbai', lat: 19.0996, lng: 72.8519 },
  { area: 'Andheri East', city: 'Mumbai', lat: 19.1136, lng: 72.8697, landmarks: ['MIDC', 'Marol'] },
  { area: 'Andheri West', city: 'Mumbai', lat: 19.1364, lng: 72.8296, landmarks: ['Lokhandwala', 'Versova'] },
  { area: 'Powai', city: 'Mumbai', lat: 19.1176, lng: 72.906, landmarks: ['Hiranandani Gardens', 'IIT Bombay'] },
  { area: 'Kurla', city: 'Mumbai', lat: 19.0726, lng: 72.8845 },
  { area: 'Ghatkopar', city: 'Mumbai', lat: 19.0858, lng: 72.9081 },
  { area: 'Chembur', city: 'Mumbai', lat: 19.0522, lng: 72.9005 },
  { area: 'Goregaon', city: 'Mumbai', lat: 19.1663, lng: 72.8526, landmarks: ['Film City'] },
  { area: 'Malad West', city: 'Mumbai', lat: 19.1874, lng: 72.8484, landmarks: ['Mindspace'] },
  { area: 'Borivali', city: 'Mumbai', lat: 19.2307, lng: 72.8567 },
  { area: 'Thane West', city: 'Thane', lat: 19.2183, lng: 72.9781 },
  { area: 'Vashi', city: 'Navi Mumbai', lat: 19.0771, lng: 72.9986 },
  { area: 'CBD Belapur', city: 'Navi Mumbai', lat: 19.0237, lng: 73.0402 },
  { area: 'Panaji', city: 'Goa', lat: 15.4909, lng: 73.8278 },
  { area: 'Calangute', city: 'Goa', lat: 15.5439, lng: 73.7553 },
  { area: 'Margao', city: 'Goa', lat: 15.2832, lng: 73.9862 },
  { area: 'Vasco da Gama', city: 'Goa', lat: 15.3982, lng: 73.8113 },
  { area: 'Palolem', city: 'Goa', lat: 15.01, lng: 74.0232 },
];


const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');

export class SandboxMapsAdapter implements MapsAdapter {
  readonly info: AdapterInfo = { kind: 'maps', provider: 'sandbox-maps', mode: 'sandbox' };
  outage = false;

  async searchPlaces(query: string, near: LatLng, radiusKm: number): Promise<Place[]> {
    if (this.outage) throw new MapsUnavailableError();
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const results: (Place & { score: number })[] = [];
    for (const g of GAZETTEER) {
      const km = haversineKm(near, g);
      if (km > radiusKm) continue;
      const names = [g.area, ...(g.landmarks ?? [])];
      for (const name of names) {
        const n = name.toLowerCase();
        const idx = n.indexOf(q);
        if (idx === -1 && !g.area.toLowerCase().includes(q)) continue;
        const isLandmark = name !== g.area;
        results.push({
          placeId: `sbx:${slug(g.area)}${isLandmark ? `:${slug(name)}` : ''}`,
          label: isLandmark ? `${name}, ${g.area}, ${g.city}` : `${g.area}, ${g.city}`,
          area: g.area,
          lat: g.lat,
          lng: g.lng,
          score: (idx === 0 ? 0 : 1) + (isLandmark ? 0.5 : 0) + km / 1000,
        });
        if (!isLandmark) break;
      }
    }
    const seen = new Set<string>();
    return results
      .sort((a, b) => a.score - b.score)
      .filter((r) => !seen.has(r.placeId) && seen.add(r.placeId))
      .slice(0, 8)
      .map(({ score: _s, ...p }) => p);
  }

  async estimateRoute(stops: LatLng[], departAt: Date): Promise<RouteEstimate> {
    if (this.outage) throw new MapsUnavailableError();
    const speed = citySpeed(departAt);
    const legs = stops.slice(1).map((to, i) => {
      const km = haversineKm(stops[i]!, to) * ROAD_FACTOR;
      return { distanceMeters: Math.round(km * 1000), durationSeconds: Math.round((km / speed) * 3600) };
    });
    return {
      distanceMeters: legs.reduce((s, l) => s + l.distanceMeters, 0),
      durationSeconds: legs.reduce((s, l) => s + l.durationSeconds, 0),
      legs,
      path: stops,
    };
  }
}

function citySpeed(at: Date) {
  return citySpeedKmh(localHour(at, 'Asia/Kolkata'));
}
