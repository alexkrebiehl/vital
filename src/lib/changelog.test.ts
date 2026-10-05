import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const text = readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8');
const headings = [...text.matchAll(/^## (.+)$/gm)].map(m => m[1]);

describe('CHANGELOG.md', () => {
  it('starts with an Unreleased section, followed by releases newest first', () => {
    expect(headings[0]).toBe('Unreleased');
    const versions = headings.slice(1).map(h => /^(\d+)\.(\d+)\.(\d+)/.exec(h)?.slice(1).map(Number));
    for (const v of versions) expect(v).toBeTruthy();
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [versions[i - 1]!, versions[i]!];
      const newer = a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])));
      expect(newer).toBe(true);
    }
  });

  it('keeps to the four categories', () => {
    const cats = [...text.matchAll(/^### (.+)$/gm)].map(m => m[1]);
    for (const c of cats) expect(['Added', 'Removed', 'Fixed', 'Changed']).toContain(c);
  });

  it('carries nothing that identifies a person, host or path', () => {
    expect(text).not.toMatch(/serverpile|\/home\/|homeserver|192\.168\.|\bsk-/i);
  });
});
