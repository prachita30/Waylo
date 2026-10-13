/**
 * Central brand configuration. Every customer-facing surface (web app, emails,
 * receipts, manifest) reads from here, so a rename or re-skin is a one-file change.
 */
export const brand = {
  name: 'WAYLO',
  legalName: 'WAYLO',
  tagline: 'Travel smarter. Spend less. Get there together.',
  heroHeadline: 'Your next journey, for less.',
  description:
    'Airline-authorised flight offers and shared airport rides, in one simple app.',
  /** Set before launch. Shown in footers, emails and support screens. */
  supportEmail: 'support@waylo.app',
  homeMarket: { city: 'Mumbai', airportCode: 'BOM', currency: 'INR', locale: 'en-IN' },
  colors: {
    ivory: '#FAF7F2',
    midnight: '#0E1A2B',
    cobalt: '#2648E8',
    mint: '#13A88A',
    lavender: '#ECE9FB',
    sky: '#E5F1FB',
    coral: '#F2705B',
    grey: '#E4E1DA',
  },
} as const;

export type Brand = typeof brand;
