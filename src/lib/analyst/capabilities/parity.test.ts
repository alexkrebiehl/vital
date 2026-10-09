// ── The parity guard (design §10) ───────────────────────
//
// Fails the build when the app serves something the analyst cannot reach and
// nobody has said why. Enumerates, from the code itself: API routes, the dataset
// accessors, the registered metrics, the pages and the data sources, and checks
// each against what the capabilities mirror and against EXEMPTIONS.
//
// Not covered yet: item 7 (the generated docs table) arrives with AN-D5.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as dataset from '../../adapters/dataset';
import { getAllMetrics } from '../../metrics/registry';
import { DATA_SOURCES, type DataSourceDef } from '../../sources/registry';
import { createDataAccess } from '../dataAccess';
import { availableTools } from '../tools';
import { ALLOW_TRACKED, EXEMPTIONS, type Exemption } from './exemptions';
import { CAPABILITY_MANIFEST } from './manifest';
import { CAPABILITIES } from './registry';
import type { SourceTag } from './types';

const SRC = path.join(process.cwd(), 'src');
const AREAS = path.join(__dirname, 'areas');

// ── Enumerating the app ─────────────────────────────────

const METHOD = /export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/g;

function filesNamed(dir: string, name: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map(p => p.split(path.sep).join('/'))
    .filter(p => p === name || p.endsWith(`/${name}`))
    .sort();
}

function routeKeys(): { get: string[]; other: string[] } {
  const api = path.join(SRC, 'app/api');
  const get: string[] = [];
  const other: string[] = [];
  for (const file of filesNamed(api, 'route.ts')) {
    const route = `/api/${path.posix.dirname(file)}`.replace(/\/\.$/, '');
    const text = fs.readFileSync(path.join(api, file), 'utf8');
    for (const m of text.matchAll(METHOD)) (m[2] === 'GET' ? get : other).push(`${m[2]} ${route}`);
  }
  return { get: get.sort(), other: other.sort() };
}

function pageRoutes(): string[] {
  return filesNamed(path.join(SRC, 'app'), 'page.tsx').map(f => {
    const dir = path.posix.dirname(f);
    return dir === '.' ? '/' : `/${dir}`;
  });
}

function accessorNames(): string[] {
  return Object.entries(dataset)
    .filter(([, v]) => typeof v === 'function')
    .map(([k]) => k)
    .sort();
}

function metricIds(): string[] {
  return [...new Set([...getAllMetrics().map(m => m.id), ...dataset.availableMetricIds()])].sort();
}

// ── Checks (pure, so the guard itself can be tested) ────

type Kind = Exemption['kind'];
const WHERE: Record<Kind, string> = {
  route: 'mirrors.routes',
  accessor: 'mirrors.accessors',
  page: 'mirrors.pages',
  metric: 'mirrors.metrics',
  source: 'a manifest `sources` tag',
};

/** Keys that are neither mirrored nor exempt, each with the exact fix. */
function unmapped(kind: Kind, actual: readonly string[], mirrored: ReadonlySet<string>, exemptions: readonly Exemption[]): string[] {
  const exempt = new Set(exemptions.filter(e => e.kind === kind).map(e => e.key));
  return actual
    .filter(k => !mirrored.has(k) && !exempt.has(k))
    .map(
      k =>
        `${kind} ${k} has no capability and no exemption. Add it to ${WHERE[kind]} of the capability that serves it (src/lib/analyst/capabilities/areas/), ` +
        `or add { kind: '${kind}', key: '${k}', reason: '<why the analyst does not need it>' } to src/lib/analyst/capabilities/exemptions.permanent.ts ` +
        `(or exemptions.tracked.ts with tracked: true, naming the gate that closes it).`
    );
}

/** Exemptions that are no longer needed: the key is mirrored now, or the thing is gone. */
function stale(kind: Kind, actual: readonly string[], mirrored: ReadonlySet<string>, exemptions: readonly Exemption[]): string[] {
  const exist = new Set(actual);
  return exemptions
    .filter(e => e.kind === kind)
    .flatMap(e =>
      mirrored.has(e.key)
        ? [`STALE exemption: ${kind} ${e.key} is now covered by a capability. Delete its entry from the exemptions files.`]
        : !exist.has(e.key)
          ? [`STALE exemption: ${kind} ${e.key} no longer exists in the app. Delete its entry from the exemptions files.`]
          : []
    );
}

const WRITE_NAME = /^(write|insert|update|delete|replace|pgCreate|pgReplace|pgDelete|pgReorder)|^(createPlan|updateActivePlan|archiveActivePlan|regenerateBriefing|warmBriefing)$/;

/** Imported names in `source` that look like a store write. Type-only imports are ignored. */
function writeImports(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"]/g)) {
    if (m[1]) continue;
    for (const part of m[2].split(',')) {
      const spec = part.trim();
      if (!spec || spec.startsWith('type ')) continue;
      const imported = spec.split(/\s+as\s+/)[0].trim();
      if (WRITE_NAME.test(imported)) found.push(imported);
    }
  }
  return found;
}

// ── What the capabilities mirror ────────────────────────

const mirrored = (pick: (m: (typeof CAPABILITIES)[number]['mirrors']) => string[] | undefined): Set<string> =>
  new Set(CAPABILITIES.flatMap(c => pick(c.mirrors) ?? []));

/** Which source definitions a manifest `sources` tag stands for (src/lib/sources/tagging.ts). */
function tagCovers(tag: SourceTag, def: DataSourceDef): boolean {
  switch (tag) {
    case 'metric-provenance':
    case 'all-health':
      return def.kind === 'health';
    case 'hae':
      return def.id === 'hae';
    case 'lab':
      return def.kind === 'documents';
    case 'workout-detail':
      return def.kind === 'workout-detail';
    case 'configuration':
      return false;
  }
}

function coveredSources(): Set<string> {
  const tags = new Set(CAPABILITY_MANIFEST.map(e => e.sources));
  return new Set(DATA_SOURCES.filter(def => [...tags].some(t => tagCovers(t, def))).map(d => d.id));
}

const routes = routeKeys();
const pages = pageRoutes();

// ── The guard ───────────────────────────────────────────

describe('parity: the app against the analyst', () => {
  it('reaches every GET route or says why not', () => {
    expect(unmapped('route', routes.get, mirrored(m => m.routes), EXEMPTIONS)).toEqual([]);
  });

  it('reaches every dataset accessor or says why not', () => {
    expect(unmapped('accessor', accessorNames(), mirrored(m => m.accessors), EXEMPTIONS)).toEqual([]);
  });

  it('reaches every registered metric or says why not, and the demo metrics are all registered', () => {
    const registered = new Set(getAllMetrics().map(m => m.id));
    expect(dataset.availableMetricIds().filter(id => !registered.has(id))).toEqual([]);
    expect(unmapped('metric', metricIds(), mirrored(m => m.metrics), EXEMPTIONS)).toEqual([]);
  });

  it('reaches every page or says why not', () => {
    expect(unmapped('page', pages, mirrored(m => m.pages), EXEMPTIONS)).toEqual([]);
  });

  it('covers every data source with a capability\'s source tag', () => {
    expect(unmapped('source', DATA_SOURCES.map(d => d.id), coveredSources(), EXEMPTIONS)).toEqual([]);
  });

  it('keeps no exemption that is no longer needed', () => {
    const problems = [
      ...stale('route', routes.get, mirrored(m => m.routes), EXEMPTIONS),
      ...stale('accessor', accessorNames(), mirrored(m => m.accessors), EXEMPTIONS),
      ...stale('metric', metricIds(), mirrored(m => m.metrics), EXEMPTIONS),
      ...stale('page', pages, mirrored(m => m.pages), EXEMPTIONS),
      ...stale('source', DATA_SOURCES.map(d => d.id), coveredSources(), EXEMPTIONS),
    ];
    expect(problems).toEqual([]);
  });

  it('keeps every exemption reasoned, unique, and tracked only while tracked ones are allowed', () => {
    const keys = EXEMPTIONS.map(e => `${e.kind} ${e.key}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i), 'duplicate exemptions').toEqual([]);
    expect(EXEMPTIONS.filter(e => e.reason.length < 30).map(e => `${e.kind} ${e.key}: reason under 30 characters`)).toEqual([]);
    expect(EXEMPTIONS.filter(e => e.tracked && !/^AN-D\d: /.test(e.reason)).map(e => `${e.kind} ${e.key}: a tracked reason must start with the closing gate, e.g. "AN-D2: "`)).toEqual([]);
    if (!ALLOW_TRACKED) expect(EXEMPTIONS.filter(e => e.tracked).map(e => `${e.kind} ${e.key}`), 'tracked exemptions are no longer allowed').toEqual([]);
  });

  it('exempts non-GET routes by rule, and lists them so a new write route is visible in review', () => {
    expect(routes.other.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.info(`Non-GET routes exempt as writes (the analyst is read-only):\n  ${routes.other.join('\n  ')}`);
    for (const key of routes.other) expect(EXEMPTIONS.some(e => e.key === key), `${key} should not need an exemption`).toBe(false);
  });
});

describe('parity: registry hygiene', () => {
  const offered = availableTools({ data: createDataAccess({ system: 'metric', refKey: '2026-09-17', env: { VITAL_DATA_MODE: 'demo' } as unknown as NodeJS.ProcessEnv }) }).map(t => t.name);

  it('has unique ids and a tool the model is offered', () => {
    expect(new Set(CAPABILITIES.map(c => c.id)).size).toBe(CAPABILITIES.length);
    expect(CAPABILITIES.filter(c => !offered.includes(c.tool)).map(c => `${c.id}: tool ${c.tool} is not offered`)).toEqual([]);
  });

  it('describes each capability in at most 400 characters, with a category, a coverage function and absence terms for what it returns', () => {
    for (const c of CAPABILITIES) {
      expect(c.description.length, `${c.id} description`).toBeGreaterThan(0);
      expect(c.description.length, `${c.id} description`).toBeLessThanOrEqual(400);
      expect(c.category, `${c.id} category`).toBeTruthy();
      expect(typeof c.coverage, `${c.id} coverage`).toBe('function');
      if (c.id !== 'training.reference_plans') expect(c.absenceTerms.length, `${c.id} absenceTerms`).toBeGreaterThan(0);
    }
  });

  it('lists the same capabilities as the manifest', () => {
    expect(CAPABILITIES.map(c => c.id)).toEqual(CAPABILITY_MANIFEST.map(e => e.id));
  });
});

describe('parity: read-only', () => {
  const files = fs.readdirSync(AREAS).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  it('scans the area files', () => {
    expect(files).toContain('metrics.ts');
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it.each(files)('%s imports no store write function', file => {
    const bad = writeImports(fs.readFileSync(path.join(AREAS, file), 'utf8'));
    expect(bad, `${file} imports ${bad.join(', ')}; capabilities are read-only (design §9.1). Read through a loader, not a writer.`).toEqual([]);
  });

  it('would catch a write import (the scanner itself)', () => {
    const bad = `import { loadMedications, writeProfile } from '../x';\nimport { pgReplaceCards as replace, type updateX } from '../y';\nimport { createPlan, archiveActivePlan } from '../routine/actions';\nimport type { writeThing } from '../z';`;
    expect(writeImports(bad)).toEqual(['writeProfile', 'pgReplaceCards', 'createPlan', 'archiveActivePlan']);
    expect(writeImports(`import { loadTrainingData, readProfile, workoutList } from '../ok';`)).toEqual([]);
  });
});

describe('parity: the guard itself', () => {
  const none: Exemption[] = [];
  const ex: Exemption[] = [{ kind: 'route', key: 'GET /api/x', reason: 'Not needed because it only serves a probe.' }];

  it('names an unmapped key and says exactly what to add', () => {
    const [msg] = unmapped('route', ['GET /api/new-thing'], new Set(), none);
    expect(msg).toContain('route GET /api/new-thing has no capability and no exemption');
    expect(msg).toContain("mirrors.routes");
    expect(msg).toContain("{ kind: 'route', key: 'GET /api/new-thing', reason:");
  });

  it('accepts a mirrored key and an exempt key', () => {
    expect(unmapped('route', ['GET /api/a', 'GET /api/x'], new Set(['GET /api/a']), ex)).toEqual([]);
  });

  it('flags an exemption that is now mirrored, and one for something that no longer exists', () => {
    expect(stale('route', ['GET /api/x'], new Set(['GET /api/x']), ex)[0]).toMatch(/STALE exemption: route GET \/api\/x is now covered/);
    expect(stale('route', ['GET /api/other'], new Set(), ex)[0]).toMatch(/STALE exemption: route GET \/api\/x no longer exists/);
    expect(stale('route', ['GET /api/x'], new Set(), ex)).toEqual([]);
  });
});
