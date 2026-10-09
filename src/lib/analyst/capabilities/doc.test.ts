// ── The generated capability table (design §10.1 item 7) ─────

import { describe, expect, it } from 'vitest';
import { renderCapabilityDoc } from './doc';
import { CAPABILITIES } from './registry';

const doc = renderCapabilityDoc(CAPABILITIES);
const rows = doc.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Area') && !l.startsWith('|---'));

describe('renderCapabilityDoc', () => {
  it('says it is generated, and how to regenerate it', () => {
    expect(doc).toContain('npm run analyst:capabilities');
    expect(doc).toMatch(/Do not edit/i);
  });

  it('has the columns of the design', () => {
    expect(doc).toContain('| Area | Capability | Tool | Parameters | What it holds | Privacy category |');
  });

  it('has one row per capability, in registry order, each with its area, id, tool and category', () => {
    expect(rows).toHaveLength(CAPABILITIES.length);
    CAPABILITIES.forEach((c, i) => {
      const cells = rows[i]!.split(' | ').map(x => x.replace(/^\| | \|$/g, ''));
      expect(cells[0], c.id).toBe(c.area);
      expect(cells[1], c.id).toContain(`\`${c.id}\``);
      expect(cells[2], c.id).toBe(`\`${c.tool}\``);
      expect(cells[5], c.id).toBe(`\`${c.category}\``);
    });
  });

  it('lists the parameter names of the tool call, required ones starred, or none', () => {
    const row = (id: string) => rows[CAPABILITIES.findIndex(c => c.id === id)]!;
    expect(row('metrics.series')).toContain('metrics*, window, granularity, compareTo, offset');
    expect(row('training.plan')).toMatch(/\| none \|/);
    expect(row('insights.reports')).toContain('kind*, count, offset');
  });

  it('keeps every cell on one line, with no unescaped pipe', () => {
    for (const r of rows) expect(r.split(/(?<!\\)\|/).length, r).toBe(8);
  });

  it('carries no value: no date, no count of records', () => {
    expect(doc).not.toMatch(/\d{4}-\d\d-\d\d/);
  });

  it('ends with a newline and is deterministic', () => {
    expect(doc.endsWith('\n')).toBe(true);
    expect(renderCapabilityDoc(CAPABILITIES)).toBe(doc);
  });
});
