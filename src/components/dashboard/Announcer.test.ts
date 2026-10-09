import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Announcer } from './Announcer';

describe('Announcer', () => {
  it('is one visually hidden polite live region holding the message', () => {
    const html = renderToStaticMarkup(createElement(Announcer, { message: 'Removed Steps, today.' }));
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('sr-only');
    expect(html).toContain('Removed Steps, today.');
    expect(html.split('aria-live').length - 1).toBe(1);
  });

  it('exists before there is anything to say', () => {
    expect(renderToStaticMarkup(createElement(Announcer, { message: '' }))).toContain('aria-live="polite"');
  });
});
