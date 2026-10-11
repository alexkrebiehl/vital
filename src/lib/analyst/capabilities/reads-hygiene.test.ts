// ── Hygiene of the capability reads and areas ───────────────────────────────
//
// Design §9.1: no module-level cache (a read looks at the live state of this
// question), nothing that writes, and no data-source product name in text the model
// reads (the app.pipeline capability is the one place that may name sources).

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES } from './registry';

const DIR = __dirname;
const sources = ['reads', 'areas'].flatMap(d =>
  fs.readdirSync(path.join(DIR, d)).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => ({ file: `${d}/${f}`, text: fs.readFileSync(path.join(DIR, d, f), 'utf8') }))
);

describe('capability reads and areas', () => {
  it('scans the new reads', () => {
    expect(sources.map(s => s.file)).toEqual(expect.arrayContaining(['reads/metric-series.ts', 'reads/workouts-sessions.ts', 'reads/sleep.ts', 'reads/blood-pressure.ts']));
  });

  it.each(sources.map(s => [s.file, s.text]))('%s keeps no module-level state', (file, text) => {
    const lines = text.split('\n').filter(l => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'));
    const state = lines.filter(l => /^(let|var)\s/.test(l) || /^(export\s+)?const\s+\w+\s*(:[^=]+)?=\s*new\s+(Map|Set|WeakMap|WeakSet)\b/.test(l) || /^(export\s+)?const\s+\w*[Cc]ache\w*\s*=/.test(l));
    expect(state, `${file} holds state between questions; read live state per question`).toEqual([]);
  });

  it.each(sources.map(s => [s.file, s.text]))('%s imports no writer', (file, text) => {
    const imports = [...text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)];
    const bad = imports.filter(([whole, names, from]) => !whole.startsWith('import type') && (/routine\/actions$/.test(from) || /\/db\/[\w-]+-store$/.test(from)) && /\b(write|save|put|update|delete|create|insert|upsert|archive|replace|remove|set)[A-Z]\w*/.test(names));
    expect(bad.map(b => b[0])).toEqual([]);
  });

  it.each(sources.filter(s => !s.file.endsWith('legacy.ts')).map(s => [s.file, s.text]))('%s names no data-source product', (file, text) => {
    expect(text).not.toMatch(/\bhevy\b|health auto export|\boura\b|\bHAE\b/i);
  });

  it('describes every capability without naming a data source', () => {
    for (const c of CAPABILITIES) expect(`${c.title} ${c.description} ${c.statusLabel}`, c.id).not.toMatch(/\bhevy\b|health auto export|\boura\b|\bHAE\b/i);
  });
});
