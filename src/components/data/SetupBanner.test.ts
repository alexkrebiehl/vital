import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SetupBannerView } from './SetupBanner';

const FAILURE = {
  title: 'No data source is connected',
  message: 'Live mode has no source to read yet.',
  host: null,
  hint: 'Connect a source below, then retry.',
};

describe('SetupBannerView', () => {
  it("shows the failure's title, message and hint and a Retry button", () => {
    const html = renderToStaticMarkup(createElement(SetupBannerView, { failure: FAILURE, retrying: false, onRetry: () => {} }));
    expect(html).toContain('No data source is connected');
    expect(html).toContain('Live mode has no source to read yet.');
    expect(html).toContain('Connect a source below, then retry.');
    expect(html).toContain('Retry');
    expect(html).toContain('role="alert"');
  });

  it('shows progress while retrying and leaves out an absent hint', () => {
    const html = renderToStaticMarkup(
      createElement(SetupBannerView, { failure: { ...FAILURE, hint: undefined }, retrying: true, onRetry: () => {} })
    );
    expect(html).toContain('Retrying…');
    expect(html).not.toContain('Connect a source below');
  });

  it('names no data source of its own', () => {
    const html = renderToStaticMarkup(createElement(SetupBannerView, { failure: FAILURE, retrying: false, onRetry: () => {} }));
    expect(html).not.toMatch(/Health Auto Export|oura/i);
  });
});
