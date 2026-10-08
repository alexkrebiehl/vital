import { describe, expect, it } from 'vitest';
import {
  addedMessage, cancelledMessage, droppedMessage, movedMessage, pickedUpMessage, removedMessage,
} from './announce';

describe('announcements', () => {
  it('says what was added and where it landed', () => {
    expect(addedMessage('Steps, today', 7, 7)).toBe('Added Steps, today at position 7 of 7.');
    expect(addedMessage('Steps, Mar 1 – Mar 7, 2026', 1, 1)).toBe('Added Steps, Mar 1 – Mar 7, 2026 at position 1 of 1.');
  });

  it('says what was removed', () => {
    expect(removedMessage('Steps, today')).toBe('Removed Steps, today.');
  });

  it('says what a drag or a move did, with a 1-based position', () => {
    expect(pickedUpMessage('Steps, today', 2, 6)).toBe('Picked up Steps, today. Position 2 of 6.');
    expect(movedMessage('Steps, today', 4, 6)).toBe('Steps, today moved to position 4 of 6.');
    expect(droppedMessage('Steps, today', 4, 6)).toBe('Steps, today dropped at position 4 of 6.');
    expect(cancelledMessage('Steps, today', 2, 6)).toBe('Move cancelled. Steps, today is back at position 2 of 6.');
  });
});
