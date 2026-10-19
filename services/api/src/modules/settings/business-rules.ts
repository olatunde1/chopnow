import { BusinessRulesSchema, defaultBusinessRules, type BusinessRules } from '@chopnow/shared-schemas';
import type { DbOrTx } from '../../db/client.js';

// The schema and defaults live in @chopnow/shared-schemas so the admin dashboard can validate edits.
export { BusinessRulesSchema, defaultBusinessRules, type BusinessRules };

export const BUSINESS_RULES_KEY = 'business_rules';

/** Reads the current rules; falls back to defaults if the row is missing, and fails loudly if it is malformed. */
export async function getBusinessRules(db: DbOrTx): Promise<BusinessRules> {
  const row = await db.platformSetting.findUnique({ where: { key: BUSINESS_RULES_KEY } });
  if (!row) return defaultBusinessRules();
  return BusinessRulesSchema.parse(row.value);
}
