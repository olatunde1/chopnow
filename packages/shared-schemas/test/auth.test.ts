import { describe, expect, it } from 'vitest';
import { LoginRequestSchema, NigerianPhoneSchema, RegisterRequestSchema } from '../src/auth.js';

describe('auth request schemas', () => {
  it('normalises email and Nigerian phone numbers', () => {
    const r = RegisterRequestSchema.parse({
      email: '  Ada@Example.COM ',
      password: 'jollof123',
      fullName: 'Ada Obi',
      phone: '0803 123 4567',
    });
    expect(r.email).toBe('ada@example.com');
    expect(r.phone).toBe('+2348031234567');
    expect(r.role).toBe('CUSTOMER');
    expect(NigerianPhoneSchema.parse('2348031234567')).toBe('+2348031234567');
  });

  it('rejects staff roles at self-registration', () => {
    const res = RegisterRequestSchema.safeParse({ email: 'a@b.co', password: 'abc12345', fullName: 'X Y', role: 'ADMIN' });
    expect(res.success).toBe(false);
  });

  it('rejects unknown fields (no mass assignment)', () => {
    const res = RegisterRequestSchema.safeParse({
      email: 'a@b.co',
      password: 'abc12345',
      fullName: 'X Y',
      status: 'ACTIVE',
    });
    expect(res.success).toBe(false);
  });

  it('requires vehicle details and phone for riders', () => {
    const base = { email: 'r@b.co', password: 'abc12345', fullName: 'Rider One', role: 'RIDER' };
    expect(RegisterRequestSchema.safeParse(base).success).toBe(false);
    expect(
      RegisterRequestSchema.safeParse({ ...base, phone: '08031234567', rider: { vehicleType: 'MOTORCYCLE' } }).success,
    ).toBe(true);
  });

  it('enforces password strength', () => {
    const base = { email: 'a@b.co', fullName: 'X Y' };
    expect(RegisterRequestSchema.safeParse({ ...base, password: 'short1' }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...base, password: 'lettersonly' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
