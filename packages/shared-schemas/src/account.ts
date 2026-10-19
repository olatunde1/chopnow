import { z } from 'zod';
import { NigerianPhoneSchema, PasswordSchema } from './auth.js';
import { ROLES } from './enums.js';
import { DateTimeSchema, IdSchema, LatitudeSchema, LongitudeSchema, optionalText, text } from './common.js';

// ---- Session responses ----

export const PublicUserSchema = z.object({
  id: IdSchema,
  email: z.string(),
  phone: z.string().nullable(),
  fullName: z.string(),
  role: z.enum(ROLES),
  /** Staff created with a temporary password must set their own before doing anything else. */
  mustChangePassword: z.boolean().default(false),
});
export type PublicUserDto = z.infer<typeof PublicUserSchema>;

export const AuthResponseSchema = z.object({
  user: PublicUserSchema,
  accessToken: z.string(),
  accessTokenExpiresIn: z.number().int(),
  refreshToken: z.string(),
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

export const MeResponseSchema = PublicUserSchema.extend({
  status: z.string(),
  createdAt: DateTimeSchema,
  defaultAddressId: IdSchema.nullable(),
  rider: z
    .object({
      id: IdSchema,
      riderType: z.string(),
      verificationStatus: z.string(),
      availability: z.string(),
      vehicleType: z.string(),
    })
    .nullable(),
  restaurants: z.array(z.object({ id: IdSchema, name: z.string(), verificationStatus: z.string() })),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

export const UpdateProfileRequestSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: NigerianPhoneSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: PasswordSchema,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a different password' });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// ---- Addresses ----

/** Coordinates are required: delivery eligibility and fees depend on them. Apps take them from GPS or a map pin. */
export const AddressInputSchema = z
  .object({
    label: text(40).min(1, 'Give this address a name, e.g. Home'),
    line1: text(160).min(3, 'Enter the street address'),
    line2: optionalText(160),
    area: text(80).min(2),
    city: text(80).min(2),
    landmark: optionalText(160),
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,
    contactPhone: NigerianPhoneSchema.optional(),
    instructions: optionalText(300),
    makeDefault: z.boolean().optional(),
  })
  .strict();
export type AddressInput = z.infer<typeof AddressInputSchema>;

export const AddressUpdateSchema = AddressInputSchema.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
  .refine((v) => (v.latitude === undefined) === (v.longitude === undefined), 'Send latitude and longitude together');
export type AddressUpdate = z.infer<typeof AddressUpdateSchema>;

export const AddressSchema = z.object({
  id: IdSchema,
  label: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  area: z.string(),
  city: z.string(),
  landmark: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  contactPhone: z.string().nullable(),
  instructions: z.string().nullable(),
  isDefault: z.boolean(),
});
export type AddressDto = z.infer<typeof AddressSchema>;
