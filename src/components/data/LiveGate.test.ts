import { describe, expect, it } from 'vitest';
import { showsConnectionError } from './LiveGate';

describe('showsConnectionError', () => {
  it('replaces data pages', () => {
    for (const p of ['/', '/sleep', '/activity', '/analyst', null]) expect(showsConnectionError(p)).toBe(true);
  });
  it('never replaces Settings, where a source is connected', () => {
    for (const p of ['/settings', '/settings/', '/settings/anything']) expect(showsConnectionError(p)).toBe(false);
  });
  it('does not treat look-alike paths as Settings', () => {
    expect(showsConnectionError('/settingsx')).toBe(true);
  });
});
