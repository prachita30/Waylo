import type { Scene } from '@/components/brand/DestinationArt';

/** Editorial destination content. Prices are never stored here; offers come from the API. */
export interface Destination {
  cityId: string;
  name: string;
  airport: string;
  scene: Scene;
  blurb: string;
  tags: string[];
  /** Card height in the masonry grid. */
  shape: 'tall' | 'square' | 'wide';
}

export const DESTINATIONS: Destination[] = [
  { cityId: 'goa', name: 'Goa', airport: 'GOI', scene: 'coast', blurb: 'Monsoon-green hills, quiet beaches and long lunches.', tags: ['Beaches', 'Weekend'], shape: 'tall' },
  { cityId: 'jaipur', name: 'Jaipur', airport: 'JAI', scene: 'desert', blurb: 'Pink-city bazaars and hilltop forts at golden hour.', tags: ['Heritage', 'Food'], shape: 'square' },
  { cityId: 'bengaluru', name: 'Bengaluru', airport: 'BLR', scene: 'city', blurb: 'Garden city cafés, microbreweries and weekend gigs.', tags: ['City', 'Work trip'], shape: 'square' },
  { cityId: 'kochi', name: 'Kochi', airport: 'COK', scene: 'coast', blurb: 'Fort Kochi art walks, Chinese nets and backwater days.', tags: ['Coast', 'Culture'], shape: 'tall' },
  { cityId: 'varanasi', name: 'Varanasi', airport: 'VNS', scene: 'heritage', blurb: 'Dawn boat rides along the ghats and evening aarti.', tags: ['Spiritual', 'Heritage'], shape: 'tall' },
  { cityId: 'delhi', name: 'New Delhi', airport: 'DEL', scene: 'city', blurb: 'Old Delhi food lanes and Lutyens’ leafy avenues.', tags: ['City', 'Food'], shape: 'square' },
  { cityId: 'udaipur', name: 'Udaipur', airport: 'UDR', scene: 'desert', blurb: 'Lake palaces, rooftop dinners and slow mornings.', tags: ['Romantic', 'Heritage'], shape: 'square' },
  { cityId: 'hyderabad', name: 'Hyderabad', airport: 'HYD', scene: 'city', blurb: 'Charminar evenings and the best biryani debate in India.', tags: ['Food', 'City'], shape: 'tall' },
];

export interface TripIdea {
  id: string;
  title: string;
  kicker: string;
  body: string;
  scene: Scene;
  cityId: string;
  airport: string;
}

export const TRIP_IDEAS: TripIdea[] = [
  {
    id: 'goa-long-weekend',
    kicker: '3 days · Beaches',
    title: 'A slow long weekend in South Goa',
    body: 'Fly in Friday evening, share a cab from the airport with travellers heading the same way, and spend Saturday between Palolem and Agonda.',
    scene: 'coast',
    cityId: 'goa',
    airport: 'GOI',
  },
  {
    id: 'jaipur-heritage',
    kicker: '2 days · Heritage',
    title: 'Forts, block prints and a rooftop dinner in Jaipur',
    body: 'Start early at Amber Fort, spend the afternoon in Bapu Bazaar, then watch the sun set over Nahargarh.',
    scene: 'desert',
    cityId: 'jaipur',
    airport: 'JAI',
  },
  {
    id: 'varanasi-dawn',
    kicker: '2 days · Culture',
    title: 'Dawn on the ghats of Varanasi',
    body: 'Take a sunrise boat from Assi Ghat, walk the lanes to Kashi Vishwanath and return for the evening aarti.',
    scene: 'heritage',
    cityId: 'varanasi',
    airport: 'VNS',
  },
];
