import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

/**
 * deploy/env/*.env.example must stay in step with the config rules: filled in, each template
 * boots; left with its placeholders, it is refused.
 */
const template = (name: string) => parseEnv(readFileSync(new URL(`../../../deploy/env/${name}.env.example`, import.meta.url), 'utf8')) as Record<string, string>;

function fillIn(env: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === 'PAYSTACK_SECRET_KEY') out[k] = env.APP_ENV === 'production' ? 'sk_live_unittestonly0000' : 'sk_test_unittestonly0000';
    else if (k === 'JWT_ACCESS_SECRET') out[k] = 'Zx8q2Lm7-unit-test-only-Wt4Rv9Kp3Ns6Hb1Jc5Fd0Gy';
    else out[k] = v.replaceAll('replace-in-secret-manager', 'unit-test-value');
  }
  return out;
}

describe.each(['staging', 'production'])('%s template', (name) => {
  it('boots once its secrets are filled in', () => {
    const c = loadConfig(fillIn(template(name)));
    expect(c.APP_ENV).toBe(name);
    expect(c.PAYMENT_PROVIDER).toBe('paystack');
    expect(c.STORAGE_DRIVER).toBe('s3');
  });

  it('is refused while it still has placeholders', () => {
    expect(() => loadConfig(template(name))).toThrow(/JWT_ACCESS_SECRET|PAYSTACK_SECRET_KEY/);
  });
});
