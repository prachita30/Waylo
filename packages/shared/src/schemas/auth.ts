import { z } from 'zod';

/** Shared by the API (authoritative) and web forms (instant feedback). */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Enter your email address.')
  .max(254)
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters.')
  .max(128, 'Use at most 128 characters.')
  .regex(/[A-Za-z]/, 'Include at least one letter.')
  .regex(/[0-9]/, 'Include at least one number.');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your full name.')
  .max(80, 'Name is too long.')
  .regex(/^[\p{L}\p{M}' .-]+$/u, 'Use letters, spaces, apostrophes or hyphens only.');

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Enter a valid mobile number, e.g. +919876543210.');

export const registerSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema.optional().or(z.literal('').transform(() => undefined)),
  acceptTerms: z.literal(true, { error: 'You need to accept the terms to continue.' }),
  /** Business accounts start unapproved and cannot take trips or publish offers until reviewed. */
  accountType: z.enum(['passenger', 'operator', 'partner']).default('passenger'),
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128),
});
export type LoginInput = z.input<typeof loginSchema>;

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema.nullable().or(z.literal('').transform(() => null)),
    homeAirport: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .or(z.literal('').transform(() => null)),
  })
  .partial();
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;

export const preferencesSchema = z.object({
  notifyEmail: z.boolean(),
  notifySms: z.boolean(),
  notifyPush: z.boolean(),
  marketingOptIn: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.').max(128),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used here.',
  });

export const deleteAccountSchema = z.object({
  password: z.string().min(1, 'Enter your password to confirm.').max(128),
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm.' }),
});
