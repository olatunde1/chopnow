import { z } from 'zod';
import { SELF_REGISTRABLE_ROLES } from './permissions.js';

export const VEHICLE_TYPES = ['BICYCLE', 'MOTORCYCLE', 'CAR', 'ON_FOOT'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

/** Nigerian mobile numbers normalised to E.164 (+234…). Accepts 080…, 234…, +234…. */
export const NigerianPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ''))
  .transform((v) => (v.startsWith('0') ? `+234${v.slice(1)}` : v.startsWith('234') ? `+${v}` : v))
  .pipe(z.string().regex(/^\+234[789][01]\d{8}$/, 'Enter a valid Nigerian mobile number'));

export const PasswordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'Use at most 128 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use at least one letter and one number');

export const RegisterRequestSchema = z
  .object({
    email: EmailSchema,
    password: PasswordSchema,
    fullName: z.string().trim().min(2, 'Enter your full name').max(120),
    phone: NigerianPhoneSchema.optional(),
    role: z.enum(SELF_REGISTRABLE_ROLES).default('CUSTOMER'),
    /** Required when role is RIDER. */
    rider: z
      .object({
        vehicleType: z.enum(VEHICLE_TYPES),
        vehiclePlate: z.string().trim().max(20).optional(),
        vehicleDescription: z.string().trim().max(120).optional(),
      })
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.role === 'RIDER' && !v.rider) {
      ctx.addIssue({ code: 'custom', path: ['rider'], message: 'Vehicle details are required for riders' });
    }
    if (v.role !== 'RIDER' && v.rider) {
      ctx.addIssue({ code: 'custom', path: ['rider'], message: 'Only riders can provide vehicle details' });
    }
    if ((v.role === 'RIDER' || v.role === 'VENDOR') && !v.phone) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'A phone number is required' });
    }
  });
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({
    email: EmailSchema,
    password: z.string().min(1, 'Enter your password').max(128, 'Password is too long'),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;
