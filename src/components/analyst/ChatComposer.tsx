'use client';

// ── Analyst composer (SPEC §8) ──────────────────────────
//
// The question box, Send button and the line that says what Send will do.
// Shared by the AI Analyst page and the "Discuss with analyst" dialog.

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/primitives';

/** QUERY_MAX_CHARS in lib/analyst/service.ts, which is server-only. */
const QUERY_MAX_CHARS = 400;

export function ChatComposer({
  onSend,
  pending,
  providerReady,
  placeholder,
  autoFocus,
}: {
  onSend: (question: string) => void;
  pending: boolean;
  providerReady: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState('');
  const stateId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // After mount, so a dialog that focuses its own panel on open does not take
  // focus back from the question box.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  const send = () => {
    const question = input.trim();
    if (!question || pending) return;
    setInput('');
    onSend(question);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 p-2 bg-surface border border-border rounded-control">
        <label className="flex-1">
          <span className="sr-only">Ask a question about your health data</span>
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={
              placeholder ??
              (providerReady ? 'Ask anything about your sleep, recovery, activity…' : 'Ask about your sleep, recovery, activity…')
            }
            className="w-full bg-transparent border-none outline-none px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary"
            maxLength={QUERY_MAX_CHARS}
            aria-describedby={stateId}
            ref={inputRef}
          />
        </label>
        <Button
          variant="primary"
          size="md"
          onClick={send}
          disabled={!input.trim() || pending}
          aria-label={pending ? 'Sending your question' : 'Send your question'}
        >
          {pending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
          <span className="ml-1.5">{pending ? 'Working' : 'Send'}</span>
        </Button>
      </div>
      <p id={stateId} className="text-[11px] text-text-secondary">
        {pending
          ? providerReady
            ? 'Waiting for the configured provider to answer…'
            : 'Answering from your dataset…'
          : input.trim()
            ? 'Press Send or Enter to ask.'
            : `Enter a question to enable Send. Questions are limited to ${QUERY_MAX_CHARS} characters.`}
      </p>
    </div>
  );
}
