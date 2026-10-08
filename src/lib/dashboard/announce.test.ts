import { describe, expect, it } from 'vitest';
import { addedMessage, removedMessage } from './announce';

describe('announcements', () => {
  it('says what was added and where it landed', () => {
    expect(addedMessage('Steps, today', 7, 7)).toBe('Added Steps, today at position 7 of 7.');
    expect(addedMessage('Steps, Mar 1 – Mar 7, 2026', 1, 1)).toBe('Added Steps, Mar 1 – Mar 7, 2026 at position 1 of 1.');
  });

  it('says what was removed', () => {
    expect(removedMessage('Steps, today')).toBe('Removed Steps, today.');
  });
});
