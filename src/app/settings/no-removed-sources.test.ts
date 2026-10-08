import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

// v0.3.1: a removed source's data is erased at once, so nothing "removed" is ever shown.
describe('no Removed sources anywhere', () => {
  it('has no panel, no list route and no delete-now route', () => {
    for (const path of [
      'src/components/settings/RemovedSources.tsx',
      'src/app/api/sources/removed/route.ts',
      'src/app/api/sources/[id]/data/route.ts',
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }
  });

  it('Settings mentions neither a removed source nor a grace period', () => {
    const page = readFileSync(join(root, 'src/app/settings/page.tsx'), 'utf8');
    expect(page).not.toMatch(/RemovedSources|removed source|grace period|Delete now/i);
  });

  it('the grace-day setting is gone from compose and .env.example', () => {
    for (const file of ['docker-compose.yml', '.env.example']) {
      expect(readFileSync(join(root, file), 'utf8'), file).not.toContain('VITAL_SOURCE_PURGE_GRACE_DAYS');
    }
  });
});
