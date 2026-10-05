// The Docker build context must never carry personal data into an image.
//
// `docker compose build` uses the working folder as its context, so anything git ignores
// but Docker does not (the uploaded lab PDFs, the saved profile, the training plans, .env)
// ends up in an image layer. CI builds from a clean checkout and is not affected, which is
// exactly how the gap went unnoticed. These tests keep the two ignore files in step.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(join(process.cwd(), name), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

const dockerignore = read('.dockerignore');
const gitignore = read('.gitignore');

/** True when a .dockerignore entry excludes `path` (a file or a directory prefix). */
function excluded(path: string): boolean {
  return dockerignore.some(rule => {
    if (rule.startsWith('!')) return false;
    const r = rule.replace(/\/$/, '');
    if (r === path || path.startsWith(`${r}/`)) return true;
    if (r.endsWith('*')) return path.startsWith(r.slice(0, -1));
    return false;
  });
}

describe('.dockerignore keeps personal data out of the image', () => {
  it('excludes the whole data directory (profile, training plans, uploaded lab documents)', () => {
    for (const path of ['data', 'data/profile.json', 'data/training-plans.json', 'data/lab', 'data/lab/abc123.pdf']) {
      expect(excluded(path), `${path} must be in .dockerignore`).toBe(true);
    }
  });

  it('excludes environment files, but not the committed example', () => {
    for (const path of ['.env', '.env.local', '.env.production.local']) expect(excluded(path), path).toBe(true);
    expect(dockerignore).toContain('!.env.example');
  });

  it('covers every data/ or .env path that .gitignore keeps out of git', () => {
    const personal = gitignore.filter(rule => rule.startsWith('data/') || rule.startsWith('.env'));
    expect(personal.length).toBeGreaterThan(0);
    for (const rule of personal) {
      // A wildcard rule is checked with a concrete file it would match.
      const sample = rule.replace(/\*/g, 'x').replace(/\/$/, '/sample');
      expect(excluded(sample), `.gitignore keeps ${rule} out of git, so .dockerignore must keep it out of the image`).toBe(true);
    }
  });
});
