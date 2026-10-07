// Guard for the user-level / admin-level split: the Oura app credentials and the
// Hevy key and URL live in Postgres (Settings → Connections). Nothing in the
// application may read them from the environment, so their names must not appear
// in the source tree outside tests.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REMOVED = [
  'OURA_CLIENT_ID',
  'OURA_CLIENT_SECRET',
  'OURA_REDIRECT_URI',
  'HEVY_API_KEY',
  'HEVY_API_URL',
] as const;

const SRC = path.resolve(__dirname, '..');
const ROOT = path.resolve(SRC, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return [];
    return /\.(?:[cm]?[jt]sx?|json|sql|md|ya?ml)$/.test(name) ? [full] : [];
  });
}

describe('env split', () => {
  it('finds source files to scan', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(50);
  });

  it.each(REMOVED)('%s does not appear in src/ outside tests', name => {
    const hits = sourceFiles(SRC)
      .filter(file => readFileSync(file, 'utf8').includes(name))
      .map(file => path.relative(ROOT, file));
    expect(hits).toEqual([]);
  });

  it.each(['.env.example', 'docker-compose.yml'])('%s does not define a removed variable', file => {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    const hits = REMOVED.filter(name => text.includes(name));
    expect(hits).toEqual([]);
  });
});
