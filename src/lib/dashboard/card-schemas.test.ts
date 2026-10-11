import { describe, expect, it } from 'vitest';
import {
  getCardSchema,
  listCardSchemas,
  readStoredCard,
  registerCardSchema,
  validateCardInput,
  type CardTypeSchema,
  type StoredCardRow,
} from './card-schemas';
import { MAX_SPEC_BYTES } from './types';

const fake: CardTypeSchema<{ n: number }> = {
  type: 'fake',
  version: 2,
  label: 'Fake',
  sizes: [{ w: 1, h: 1 }, { w: 2, h: 2 }],
  defaultSize: { w: 2, h: 2 },
  validate: input => {
    const n = (input as { n?: unknown } | null)?.n;
    return typeof n === 'number' ? { ok: true, spec: { n } } : { ok: false, errors: ['n must be a number.'] };
  },
  // v1 stored the number as `count`
  migrate: (spec, from) => (from < 2 ? { n: (spec as { count: number }).count } : spec),
};

const row = (over: Partial<StoredCardRow> = {}): StoredCardRow => ({
  id: 'card-1',
  card_type: 'value',
  spec: { metricId: 'resting_heart_rate', date: { kind: 'today' } },
  schema_version: 1,
  position: 3,
  width: 1,
  height: 1,
  revision: 4,
  created_at: new Date('2026-10-08T10:00:00Z'),
  updated_at: '2026-10-08T11:00:00.000Z',
  ...over,
});

describe('card schema registry', () => {
  it('holds the value type, with unique ids and a default size that is offered', () => {
    const all = listCardSchemas();
    expect(all.map(s => s.type)).toContain('value');
    expect(new Set(all.map(s => s.type)).size).toBe(all.length);
    for (const s of all) {
      expect(s.sizes.some(z => z.w === s.defaultSize.w && z.h === s.defaultSize.h), s.type).toBe(true);
      expect(s.type).toMatch(/^[a-z][a-z0-9-]{0,31}$/); // the table CHECK on card_type
    }
  });

  it('migrate is the identity at the current version', () => {
    for (const s of listCardSchemas()) {
      const spec = { anything: [1, 2] };
      expect(s.migrate(spec, s.version), s.type).toBe(spec);
    }
  });

  it('registers a fake type and removes it again', () => {
    expect(getCardSchema('fake')).toBeUndefined();
    const unregister = registerCardSchema(fake);
    expect(getCardSchema('fake')).toBe(fake);
    expect(listCardSchemas().map(s => s.type)).toContain('fake');
    unregister();
    expect(getCardSchema('fake')).toBeUndefined();
    expect(listCardSchemas().map(s => s.type)).not.toContain('fake');
  });

  it('refuses a second schema with the same type, and a default size that is not offered', () => {
    expect(() => registerCardSchema({ ...fake, type: 'value' })).toThrow(/already/);
    expect(() => registerCardSchema({ ...fake, type: 'odd', defaultSize: { w: 3, h: 3 } })).toThrow(/default size/);
  });
});

describe('validateCardInput', () => {
  const good = { type: 'value', spec: { metricId: 'resting_heart_rate', date: { kind: 'yesterday' } } };

  it('accepts a valid card and defaults the size', () => {
    expect(validateCardInput(good)).toEqual({
      ok: true,
      type: 'value',
      spec: good.spec,
      schemaVersion: 1,
      size: { w: 1, h: 1 },
    });
  });

  it('refuses an unknown type with a sentence', () => {
    const r = validateCardInput({ type: 'nope', spec: {} });
    expect(r).toEqual({ ok: false, errors: ['There is no card type "nope".'] });
  });

  it('refuses a missing type on create', () => {
    expect(validateCardInput({ spec: {} }).ok).toBe(false);
  });

  it('refuses a spec the type refuses', () => {
    const r = validateCardInput({ type: 'value', spec: { metricId: 'no_such_metric', date: { kind: 'today' } } });
    expect(r.ok).toBe(false);
  });

  it('refuses a spec over the byte limit', () => {
    const r = validateCardInput({ type: 'value', spec: { metricId: 'x'.repeat(MAX_SPEC_BYTES), date: { kind: 'today' } } });
    expect(r).toEqual({ ok: false, errors: [`The card settings are larger than ${MAX_SPEC_BYTES} bytes.`] });
  });

  it('refuses a size the type does not offer, and a malformed size', () => {
    expect(validateCardInput({ ...good, size: { w: 2, h: 1 } })).toEqual({
      ok: false,
      errors: ['A Value card cannot be 2×1.'],
    });
    for (const size of [{ w: 1 }, { w: 1.5, h: 1 }, 'big', null, { w: 1, h: 1, d: 1 }]) {
      expect(validateCardInput({ ...good, size }).ok, JSON.stringify(size)).toBe(false);
    }
  });

  it('works with a registered fake type, using its default size', () => {
    const unregister = registerCardSchema(fake);
    try {
      expect(validateCardInput({ type: 'fake', spec: { n: 3 } })).toMatchObject({ ok: true, size: { w: 2, h: 2 }, schemaVersion: 2 });
      expect(validateCardInput({ type: 'fake', spec: { n: 3 }, size: { w: 1, h: 1 } }).ok).toBe(true);
      expect(validateCardInput({ type: 'fake', spec: { n: 'x' } })).toEqual({ ok: false, errors: ['n must be a number.'] });
    } finally {
      unregister();
    }
  });

  describe('against a stored card (edit)', () => {
    const stored = { type: 'value', size: { w: 1, h: 1 } };

    it('validates the spec against the stored type; type may be omitted', () => {
      expect(validateCardInput({ spec: good.spec }, stored)).toMatchObject({ ok: true, type: 'value' });
    });

    it('refuses a change of type', () => {
      expect(validateCardInput({ type: 'fake', spec: {} }, stored)).toEqual({
        ok: false,
        errors: ['The type of a card cannot be changed.'],
      });
    });

    it('keeps the stored size when none is sent', () => {
      const unregister = registerCardSchema(fake);
      try {
        const r = validateCardInput({ spec: { n: 1 } }, { type: 'fake', size: { w: 1, h: 1 } });
        expect(r).toMatchObject({ ok: true, size: { w: 1, h: 1 } });
      } finally {
        unregister();
      }
    });
  });
});

describe('readStoredCard', () => {
  it('serves a good row as ok, with the layout and ISO timestamps', () => {
    expect(readStoredCard(row())).toEqual({
      id: 'card-1',
      type: 'value',
      spec: { metricId: 'resting_heart_rate', date: { kind: 'today' } },
      schemaVersion: 1,
      layout: { order: 3, w: 1, h: 1 },
      revision: 4,
      createdAt: '2026-10-08T10:00:00.000Z',
      updatedAt: '2026-10-08T11:00:00.000Z',
      status: 'ok',
    });
  });

  it('an unknown type is unreadable, not dropped', () => {
    const card = readStoredCard(row({ card_type: 'gauge' }));
    expect(card).toMatchObject({
      status: 'unreadable',
      spec: null,
      type: 'gauge',
      id: 'card-1',
      problem: 'This card was made by a newer version of Vital, or its type was removed.',
    });
  });

  it('a version above the type is unreadable (downgrade)', () => {
    const card = readStoredCard(row({ schema_version: 2 }));
    expect(card).toMatchObject({ status: 'unreadable', spec: null, problem: 'This card was saved by a newer version of Vital.' });
  });

  it('a spec that fails validation is unreadable with the validator reason', () => {
    const card = readStoredCard(row({ spec: { metricId: 'no_such_metric', date: { kind: 'today' } } }));
    expect(card.status).toBe('unreadable');
    expect(card.spec).toBeNull();
    expect(card.problem).toMatch(/no_such_metric/);
    expect(card.layout).toEqual({ order: 3, w: 1, h: 1 });
  });

  it('a spec that is not an object is unreadable', () => {
    expect(readStoredCard(row({ spec: 'oops' })).status).toBe('unreadable');
  });

  it('an older version is migrated in memory, then validated', () => {
    const unregister = registerCardSchema(fake);
    try {
      const card = readStoredCard(row({ card_type: 'fake', schema_version: 1, spec: { count: 7 } }));
      expect(card).toMatchObject({ status: 'ok', spec: { n: 7 }, schemaVersion: 1 });
    } finally {
      unregister();
    }
  });

  it('a migrate that throws makes the card unreadable instead of failing the list', () => {
    const unregister = registerCardSchema(fake);
    try {
      const card = readStoredCard(row({ card_type: 'fake', schema_version: 1, spec: null }));
      expect(card.status).toBe('unreadable');
    } finally {
      unregister();
    }
  });
});
