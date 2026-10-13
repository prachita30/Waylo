export const ROLES = ['passenger', 'operator', 'partner', 'admin'] as const;
export type Role = (typeof ROLES)[number];
