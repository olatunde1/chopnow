/**
 * npm run admin:bootstrap -w @chopnow/api
 *
 * Creates the FIRST administrator from BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD.
 * - Refuses if any ADMIN already exists (further staff are created from the dashboard by an admin).
 * - Validates the password against the normal password policy.
 * - Writes an audit log entry.
 * Remove both variables from the environment once it has run. See docs/OPERATIONS_RUNBOOK.md.
 */
import { EmailSchema, PasswordSchema } from '@chopnow/shared-schemas';
import { createPrismaClient } from '../db/client.js';
import { hashPassword } from '../modules/auth/password.js';
import { writeAudit } from '../modules/audit/audit.js';

const url = process.env.DATABASE_URL;
const email = EmailSchema.safeParse(process.env.BOOTSTRAP_ADMIN_EMAIL ?? '');
const password = PasswordSchema.safeParse(process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '');

if (!url || !email.success || !password.success) {
  console.error('Set DATABASE_URL, a valid BOOTSTRAP_ADMIN_EMAIL and a BOOTSTRAP_ADMIN_PASSWORD that meets the password policy.');
  process.exit(1);
}
if (process.env.APP_ENV === 'production' && password.data.length < 16) {
  console.error('In production the bootstrap admin password must be at least 16 characters.');
  process.exit(1);
}

const db = createPrismaClient(url);
try {
  const created = await db.$transaction(async (tx) => {
    if ((await tx.user.count({ where: { role: 'ADMIN' } })) > 0) return null;
    const user = await tx.user.create({
      data: { email: email.data, fullName: 'Platform Administrator', role: 'ADMIN', passwordHash: await hashPassword(password.data) },
    });
    await writeAudit(tx, { actorUserId: null, actorRole: 'SYSTEM', action: 'staff.bootstrap_admin', entityType: 'User', entityId: user.id, after: { email: user.email, role: 'ADMIN' } });
    return user;
  });
  if (!created) {
    console.error('An ADMIN account already exists. Bootstrap is disabled; create further staff from the admin dashboard.');
    process.exitCode = 2;
  } else {
    console.log(`Created ADMIN ${created.email}. Now remove BOOTSTRAP_ADMIN_* from the environment.`);
  }
} finally {
  await db.$disconnect();
}
