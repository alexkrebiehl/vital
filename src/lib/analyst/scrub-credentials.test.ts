// ── Credential values are removed wherever they turn up ─────────────────────

import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialValues, redactCredentials, REDACTED, safeExcerpt, scrubForModel, scrubText } from './scrub';

afterEach(() => vi.unstubAllEnvs());

const ENV = { HAE_API_KEY: 'hae-key-value-123', OURA_SECRET: 'oura-secret-456', VITAL_PG_PASSWORD: 'x', ANALYST_API_KEY: '  ' } as unknown as NodeJS.ProcessEnv;

describe('credentialValues', () => {
  it('lists the credential variables that are set to something worth matching', () => {
    expect(credentialValues(ENV).sort()).toEqual(['hae-key-value-123', 'oura-secret-456']);
  });

  it('reads the environment it is given each time, and holds nothing', () => {
    expect(credentialValues({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(credentialValues(undefined)).toEqual([]);
    expect(credentialValues(ENV)).toHaveLength(2);
  });
});

describe('redactCredentials', () => {
  it('removes the values of the given environment, wherever they appear', () => {
    const out = redactCredentials('failed: hae-key-value-123 and again hae-key-value-123, then oura-secret-456', ENV);
    expect(out).toBe(`failed: ${REDACTED} and again ${REDACTED}, then ${REDACTED}`);
  });

  it('removes the values of the process environment too', () => {
    vi.stubEnv('HEVY_API_KEY', 'hevy-process-key-789');
    expect(redactCredentials('key hevy-process-key-789 rejected')).toBe(`key ${REDACTED} rejected`);
  });

  it('leaves ordinary text alone', () => {
    expect(redactCredentials('LDL 95 mg/dL on 2026-09-29', ENV)).toBe('LDL 95 mg/dL on 2026-09-29');
  });
});

describe('the scrubbers know the process credentials', () => {
  it('remove a bare value that carries no header or URL around it', () => {
    vi.stubEnv('HAE_TOKEN', 'bare-token-value-321');
    expect(scrubText('upstream said bare-token-value-321 is wrong')).toBe(`upstream said ${REDACTED} is wrong`);
    expect(safeExcerpt('bare-token-value-321')).toBe(REDACTED);
    expect(scrubForModel('bare-token-value-321 at https://host.example.com/x')).not.toMatch(/bare-token-value-321|host\.example/);
  });
});
