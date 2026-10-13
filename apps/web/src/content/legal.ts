import { brand } from '@waylo/shared';

export interface InfoDoc {
  slug: string;
  title: string;
  intro: string;
  /** Draft documents show a prominent "requires legal review" notice. */
  draft: boolean;
  sections: { heading: string; body: string[] }[];
}

const DRAFT_NOTE = 'This is a working draft for the MVP and has not been reviewed by a lawyer. It must be reviewed before WAYLO launches commercially.';

export const LEGAL_DOCS: Record<string, InfoDoc> = {
  terms: {
    slug: 'terms',
    title: 'Terms of use',
    intro: `These terms explain how ${brand.name} works and what you can expect from us. ${DRAFT_NOTE}`,
    draft: true,
    sections: [
      {
        heading: 'What WAYLO is',
        body: [
          `${brand.name} is a marketplace. Flight offers are published by airlines or their authorised distribution partners, who remain the carrier and set fares, inventory, eligibility and fare rules.`,
          'Shared airport rides are provided by independent, approved fleet operators. WAYLO matches passengers and coordinates the trip.',
        ],
      },
      {
        heading: 'Prices and availability',
        body: [
          'Offers can change or sell out until the airline confirms them. We re-check price and availability before you pay, and tell you if anything changed.',
          'A flight booking is confirmed only when the airline issues a ticket. Ride fares shown before confirmation include the vehicle fare share, applicable tolls, parking, platform fees and taxes.',
        ],
      },
      {
        heading: 'Your responsibilities',
        body: [
          'Passenger names must match government ID. You are responsible for travel documents and arriving on time for departure and pickup.',
          'Treat drivers and co-passengers with respect. We may suspend accounts that put others at risk.',
        ],
      },
      {
        heading: 'Cancellations and refunds',
        body: ['Flight refunds follow the airline fare rules shown at booking. Ride cancellations follow the conditions shown before you confirm. See the cancellations page for details.'],
      },
    ],
  },
  privacy: {
    slug: 'privacy',
    title: 'Privacy policy',
    intro: `How ${brand.name} collects, uses and protects personal data. ${DRAFT_NOTE}`,
    draft: true,
    sections: [
      {
        heading: 'What we collect',
        body: [
          'Account details (name, email, optional mobile number and photo), booking and passenger details required by airlines, ride requests (airport, arrival time, destination area, luggage), and payment status from our payment provider.',
          'We never store full card numbers or CVVs. Payments are handled by the payment provider.',
        ],
      },
      {
        heading: 'How we use it',
        body: [
          'To search, book and manage trips, match shared rides, coordinate pickups, provide support and meet legal obligations.',
          'Co-passengers see only your first name, photo (if you add one) and pickup zone. Drivers see the details needed to complete the trip.',
        ],
      },
      {
        heading: 'Your choices',
        body: [
          'You can edit your profile, change notification preferences and delete your account from the Profile page. Deletion erases your personal details; records of past transactions are kept without contact details where the law requires.',
        ],
      },
    ],
  },
  refunds: {
    slug: 'refunds',
    title: 'Cancellations & refunds',
    intro: 'What happens when plans change.',
    draft: true,
    sections: [
      {
        heading: 'Flight bookings',
        body: [
          'Each offer shows whether it is refundable, the cancellation fee and the deadline before you pay. Refunds are processed after the airline confirms the cancellation, back to your original payment method.',
          'If the airline cancels your flight, you are entitled to the remedies set out in the airline’s conditions of carriage and applicable regulations.',
        ],
      },
      {
        heading: 'Shared rides',
        body: [
          'You can cancel free of charge until your ride group is locked. After that, a cancellation fee shown at confirmation may apply because other passengers’ fares depend on the group.',
          'If your flight is delayed, your pickup moves with it within the grace period you agreed. If the operator cancels, you are re-matched or refunded in full.',
        ],
      },
    ],
  },
  safety: {
    slug: 'safety',
    title: 'Trust & safety',
    intro: 'How we keep shared journeys safe and transparent.',
    draft: false,
    sections: [
      {
        heading: 'Approved operators only',
        body: ['Fleet operators are onboarded with vehicle and driver documents checked before they can accept passenger trips. Suspended operators cannot accept rides.'],
      },
      {
        heading: 'Limited sharing of personal details',
        body: ['Co-passengers see first names and pickup zones, not phone numbers or exact addresses. Communication with drivers happens through WAYLO during the trip.'],
      },
      {
        heading: 'Report an issue',
        body: ['Use Support in the app to report a safety concern. Safety reports are escalated to a person on our team as a priority. In an emergency, call 112.'],
      },
    ],
  },
};
