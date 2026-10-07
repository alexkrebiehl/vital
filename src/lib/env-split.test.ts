// Guard for the user-level / admin-level split: the Oura app credentials and the
// Hevy key and URL live in Postgres (Settings → Sources). Nothing in the
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

  // v0.3.1: a removal erases at once, so the grace setting and the "Removed sources"
  // panel are gone for good.
  it('has no grace-period variable or "Removed sources" in src/ outside tests', () => {
    const hits = sourceFiles(SRC)
      .filter(file => {
        const text = readFileSync(file, 'utf8');
        return text.includes('VITAL_SOURCE_PURGE_GRACE_DAYS') || text.includes('Removed sources');
      })
      .map(file => path.relative(ROOT, file));
    expect(hits).toEqual([]);
  });

  it('docs do not send Health Auto Export or Oura to Settings → Connections', () => {
    const files = ['README.md', ...readdirSync(path.join(ROOT, 'docs')).filter(n => n.endsWith('.md')).map(n => `docs/${n}`)];
    // Connections is right only for the data pipeline; every connection is under Sources.
    const wrong = /Settings → Connections(?! → Data pipeline)/g;
    const bad: string[] = [];
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8');
      for (const m of text.matchAll(wrong)) {
        const start = text.lastIndexOf('\n', m.index) + 1;
        const end = text.indexOf('\n', m.index);
        const near = text.slice(start, end === -1 ? undefined : end);
        if (/Health Auto Export|Oura/.test(near)) bad.push(`${file}: ${near.replace(/\s+/g, ' ')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('docs put Workout sources and Map sources under Sources, and the pipeline under Connections', () => {
    const text = ['README.md', 'docs/data-sources.md', 'docs/configuration.md']
      .map(n => readFileSync(path.join(ROOT, n), 'utf8'))
      .join('\n');
    expect(text).toContain('Settings → Sources → Workout sources');
    expect(text).toContain('Settings → Sources → Map sources');
    expect(text).toContain('Settings → Connections → Data pipeline');
    expect(text).not.toMatch(/Settings → Connections → (?:Workout|Map) sources/);
    expect(text).not.toMatch(/Settings → Sources → Data pipeline/);
  });
});
