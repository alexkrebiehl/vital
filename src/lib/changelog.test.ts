import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// CHANGELOG.md follows Common Changelog (https://common-changelog.org/).
const text = readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
const releases = [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/gm)];
const CATEGORIES = ['Changed', 'Added', 'Removed', 'Fixed'];

function bodyOf(i: number): string {
  const start = releases[i]!.index! + releases[i]![0].length;
  const end = i + 1 < releases.length ? releases[i + 1]!.index! : text.length;
  return text.slice(start, end);
}

const rank = (v: string) => {
  const [a, b, c] = v.split('.').map(Number);
  return a! * 1e6 + b! * 1e3 + c!;
};

describe('CHANGELOG.md', () => {
  it('starts with the Changelog heading and has only linked, dated releases', () => {
    expect(text.startsWith('# Changelog\n')).toBe(true);
    expect([...text.matchAll(/^## /gm)].length).toBe(releases.length);
  });

  it('lists releases newest first, each linked by a reference definition', () => {
    for (let i = 1; i < releases.length; i++) {
      expect(rank(releases[i - 1]![1]!)).toBeGreaterThan(rank(releases[i]![1]!));
    }
    for (const r of releases) {
      expect(text).toMatch(new RegExp(`^\\[${r[1]!.replace(/\./g, '\\.')}\\]: https://`, 'm'));
    }
  });

  it('uses the four categories, in order', () => {
    for (let i = 0; i < releases.length; i++) {
      const cats = [...bodyOf(i).matchAll(/^### (.+)$/gm)].map(m => m[1]!);
      expect(cats.length).toBeGreaterThan(0);
      for (const c of cats) expect(CATEGORIES).toContain(c);
      const order = cats.map(c => CATEGORIES.indexOf(c));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it('writes each change as one imperative line that ends with a commit link', () => {
    const lines = text.split('\n').filter(l => l.startsWith('- '));
    expect(lines.length).toBeGreaterThan(30);
    const link = '\\[`[0-9a-f]{7}`\\]\\(https://github\\.com/[^)]+/commit/[0-9a-f]{7}\\)';
    const end = new RegExp(`\\(${link}(, ${link})*\\)$`);
    for (const l of lines) {
      expect(l).toMatch(/^- (\*\*Breaking:\*\* )?[A-Z][a-z]+ /);
      expect(l).toMatch(end);
    }
  });

  it('carries nothing that identifies a person, host or path', () => {
    expect(text).not.toMatch(/serverpile|\/home\/|homeserver|192\.168\.|\bsk-/i);
  });
});
