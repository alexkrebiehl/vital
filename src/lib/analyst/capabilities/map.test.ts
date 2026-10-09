// ── The static capability map and the guide data ────

import { describe, expect, it } from 'vitest';
import { availableTools } from '../tools';
import { checkArgs } from '../tools/args';
import { CAPABILITY_MANIFEST } from './manifest';
import { CAPABILITIES } from './registry';
import { renderCapabilityMap } from './map';
import { EXAMPLES } from './guide.examples';
import { HOLDS } from './guide.holds';
import { parametersText, schemaOfCapability } from './params-text';

describe('the capability map', () => {
  const map = renderCapabilityMap(CAPABILITIES);

  it('stays within 4,000 characters', () => {
    expect(map.length).toBeLessThanOrEqual(4_000);
  });

  it('names every capability, its title and its tool', () => {
    for (const c of CAPABILITIES) {
      expect(map, c.id).toContain(c.id);
      expect(map, c.id).toContain(c.title);
      expect(map, c.id).toContain(c.tool);
    }
  });

  it('holds no digit: no value, date or count', () => {
    expect(map).not.toMatch(/\d/);
  });

  it('groups by area, in the manifest order', () => {
    const areas = [...new Set(CAPABILITY_MANIFEST.map(e => e.area))];
    const at = areas.map(a => map.indexOf(`[${a}]`));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('points at list_capabilities for parameters and coverage', () => {
    expect(map).toContain('list_capabilities');
  });
});

describe('the guide data', () => {
  it('gives every capability a phrase and example calls, and no extra ids', () => {
    const ids = CAPABILITIES.map(c => c.id).sort();
    expect(Object.keys(HOLDS).sort()).toEqual(ids);
    expect(Object.keys(EXAMPLES).sort()).toEqual(ids);
  });

  it('gives two examples where the capability takes parameters, one where it takes none', () => {
    for (const c of CAPABILITIES) {
      const names = Object.keys(schemaOfCapability(c).properties ?? {});
      expect(c.examples?.length, c.id).toBe(names.length > 0 ? 2 : 1);
    }
  });

  it('writes examples the tool itself accepts', () => {
    const tools = availableTools({ data: {} as never });
    for (const c of CAPABILITIES) {
      const tool = tools.find(t => t.name === c.tool);
      expect(tool, c.id).toBeDefined();
      for (const args of c.examples ?? []) {
        expect(checkArgs(tool!.parameters, args), `${c.id} ${JSON.stringify(args)}`).toEqual([]);
        if (c.tool === 'get_app_data') {
          expect(args.capability, c.id).toBe(c.id);
          expect(checkArgs(schemaOfCapability(c), (args.params ?? {}) as Record<string, unknown>, 'params'), c.id).toEqual([]);
        }
      }
    }
  });

  it('keeps every phrase short and plain', () => {
    for (const [id, text] of Object.entries(HOLDS)) {
      expect(text.length, id).toBeLessThanOrEqual(70);
      expect(text, id).not.toMatch(/\d/);
    }
  });
});

describe('parametersText', () => {
  it('lists each parameter with its type, whether it is required, and its description', () => {
    const series = CAPABILITIES.find(c => c.id === 'metrics.series')!;
    const text = parametersText(schemaOfCapability(series));
    expect(text).toContain('metrics (array, required)');
    expect(text).toContain('window (object)');
    expect(text).toContain('granularity (one of auto, summary, day, week, month)');
  });

  it('says so when there are none', () => {
    const plan = CAPABILITIES.find(c => c.id === 'training.plan')!;
    expect(parametersText(schemaOfCapability(plan))).toBe('No parameters.');
  });
});
