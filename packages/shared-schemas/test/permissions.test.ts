import { describe, expect, it } from 'vitest';
import { ROLES, STAFF_ROLES } from '../src/enums.js';
import { PERMISSIONS, ROLE_PERMISSIONS, SELF_REGISTRABLE_ROLES, hasPermission } from '../src/permissions.js';

describe('role permissions', () => {
  it('defines a permission set for every role', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  it('never gives non-staff roles staff permissions', () => {
    const staffOnly = PERMISSIONS.filter((p) => !p.endsWith('.own') && p !== 'order.place');
    for (const role of ['CUSTOMER', 'VENDOR', 'RIDER'] as const) {
      for (const p of staffOnly) expect(hasPermission(role, p), `${role} ${p}`).toBe(false);
    }
  });

  it('gives every staff role the dashboard and nothing marked .own', () => {
    for (const role of STAFF_ROLES) {
      expect(hasPermission(role, 'dashboard.view')).toBe(true);
      for (const p of ROLE_PERMISSIONS[role]) expect(p.endsWith('.own')).toBe(false);
    }
  });

  it('separates duties: support cannot approve refunds or change config; finance cannot dispatch', () => {
    expect(hasPermission('SUPPORT', 'refund.approve')).toBe(false);
    expect(hasPermission('SUPPORT', 'config.manage')).toBe(false);
    expect(hasPermission('FINANCE', 'dispatch.manage')).toBe(false);
    expect(hasPermission('OPERATIONS', 'payout.manage')).toBe(false);
    expect(hasPermission('ADMIN', 'staff.manage')).toBe(true);
  });

  it('does not allow self-registration as staff', () => {
    for (const r of STAFF_ROLES) expect((SELF_REGISTRABLE_ROLES as readonly string[]).includes(r)).toBe(false);
  });
});
