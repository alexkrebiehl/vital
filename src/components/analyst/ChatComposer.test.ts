import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatComposer } from './ChatComposer';
import { ChatThread } from './ChatThread';

const composer = (props: Partial<Parameters<typeof ChatComposer>[0]> = {}) =>
  renderToStaticMarkup(createElement(ChatComposer, { onSend: () => {}, pending: false, providerReady: true, ...props }));

describe('the composer Stop button', () => {
  it('shows Send, and no Stop, while nothing is being answered', () => {
    const html = composer({ onStop: () => {} });
    expect(html).toContain('Send your question');
    expect(html).not.toContain('Stop answering');
  });

  it('replaces Send with an enabled Stop while a question is pending', () => {
    const html = composer({ pending: true, onStop: () => {} });
    expect(html).toContain('aria-label="Stop answering this question"');
    expect(html).toMatch(/>Stop</);
    expect(html).not.toContain('Sending your question');
    expect(html).not.toMatch(/Stop answering this question"[^>]*disabled/);
    expect(html).toContain('Press Stop to cancel; nothing is saved.');
  });

  it('keeps the old Working button where no stop handler is given', () => {
    const html = composer({ pending: true });
    expect(html).toContain('Sending your question');
    expect(html).not.toContain('Stop answering');
  });
});

describe('a stopped question in the thread', () => {
  const thread = (ex: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(ChatThread, {
        exchanges: [{ id: 1, question: 'How is my sleep?', response: null, pending: false, failed: null, ...ex }] as never,
        pending: false,
        onAsk: () => {},
        empty: null,
      })
    );

  it('says it was stopped and that nothing was saved, and offers to ask again', () => {
    const html = thread({ stopped: true });
    expect(html).toContain('You stopped this question before it was answered. Nothing was saved.');
    expect(html).toContain('Ask it again');
    expect(html).not.toContain('could not be answered');
  });

  it('shows nothing of the kind for a question that was answered or is still running', () => {
    expect(thread({})).not.toContain('You stopped');
    expect(thread({ pending: true, stopped: false })).not.toContain('You stopped');
  });
});
