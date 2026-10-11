// ── Today's briefing: engine resolution, the day schedule and failure ──
//
// Every HTTP call in this file is a stub and nothing reaches a provider: the
// tests replace `globalThis.fetch` — the seam the provider's HTTP path actually
// uses — and restore it afterwards. No credential is needed or used.
//
// What is under test is the behaviour *around* the model: which engine is
// chosen, WHEN a briefing may be written (once per local calendar day, at or
// after the profile's briefing hour), what stays on screen before that hour,
// what happens when the provider is down, and what `Regenerate` actually does.
//
// The clock is injected (`now`) and the profile is passed explicitly, so "today"
// is a fixed instant and the suite never depends on when it is run.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURES, resetToDemoDataset, setActiveDataset } from '@/lib/adapters/dataset';
import { getMetric } from '@/lib/metrics';
import { buildBriefingContext, type BriefingContext } from '@/lib/briefing/context';
import { resolveBriefingEngine, DEFAULT_BRIEFING_MAX_TOKENS, DEFAULT_BRIEFING_TIMEOUT_MS } from '@/lib/briefing/engine';
import { parseBriefingReply } from '@/lib/briefing/validate';
import {
  COMPUTED_ATTRIBUTION,
  awaitBriefingIdle,
  briefingCacheKey,
  briefingSchedule,
  clearBriefingCache,
  hasBriefingAttempt,
  readBriefing,
  regenerateBriefing,
  warmBriefing,
  type BriefingModelTextLike,
  type BriefingView,
} from '@/lib/briefing';
import { resetBriefingEngineMemo } from '@/lib/briefing/engine';
import { defaultProfile, type VitalProfile } from '@/lib/profile/types';
import { aiSettingsFor, NO_AI, type UseSpec } from '@/lib/ai/test-settings';

const REAL_FETCH = globalThis.fetch;

/** The Summary on a model server on this machine (no key). */
const LOCAL: UseSpec = { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model-1', apiKey: null, name: 'Local model' };

/** The Summary on a hosted provider. */
const HOSTED: UseSpec = { baseUrl: 'https://provider.example/v1', model: 'test-model', apiKey: '«redacted:sk-…»', name: 'Hosted' };

/** The Summary fallback a guard-rejected reply is re-asked from once. */
const FALLBACK: UseSpec = { baseUrl: 'https://provider.example/v1', model: 'fallback-model', apiKey: '«redacted:fb-…»', name: 'Fallback' };

const LOCAL_ONLY = aiSettingsFor({ summary: LOCAL });
const LOCAL_WITH_FALLBACK = aiSettingsFor({ summary: LOCAL, summary_fallback: FALLBACK });

/** A server environment, without touching the real process env. */
function envOf(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { ...overrides } as unknown as NodeJS.ProcessEnv;
}

/**
 * The profile the schedule is computed against. UTC keeps the day arithmetic in
 * these tests trivial and unambiguous; the profile's timezone is the app's
 * single source of truth for what day it is.
 */
const PROFILE: VitalProfile = { ...defaultProfile('UTC'), name: 'Test Person', briefingHour: 6 };

/** A fixed clock: 13:00 local, comfortably past the briefing hour. */
const MIDDAY = () => new Date('2026-09-18T13:00:00.000Z');
const instant = (iso: string) => () => new Date(iso);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface StubOptions {
  /** Model ids the local server advertises. */
  models?: string[];
  /** The chat reply content. */
  content?: string;
  /**
   * One reply per chat call, in order; the last entry repeats. Used to model a
   * model that gets it wrong once and right the second time, and to prove that a
   * regeneration really produced new text.
   */
  contents?: string[];
  /** HTTP status for the chat request (>= 400 answers an error body). */
  chatStatus?: number;
  chatBody?: unknown;
  chatModel?: string;
  /** The /models probe fails at the transport level (nothing listening). */
  probeFails?: boolean;
  /** The chat request fails at the transport level. */
  chatFails?: boolean;
  /** Called with every request URL. */
  onCall?: (url: string) => void;
}

function stubFetch(options: StubOptions = {}): typeof fetch {
  let chatCalls = 0;
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    options.onCall?.(url);
    if (url.endsWith('/models')) {
      if (options.probeFails) throw new Error('connect ECONNREFUSED');
      return jsonResponse({ data: (options.models ?? ['local-model-1']).map(id => ({ id })) });
    }
    chatCalls += 1;
    if (options.chatFails) throw new Error('connect ECONNREFUSED');
    if (options.chatStatus && options.chatStatus >= 400) {
      return jsonResponse(options.chatBody ?? { error: { message: 'nope' } }, options.chatStatus);
    }
    const sequence = options.contents;
    const content = sequence && sequence.length > 0
      ? sequence[Math.min(chatCalls - 1, sequence.length - 1)]
      : options.content ?? '{}';
    return jsonResponse({
      model: options.chatModel ?? 'local-model-1',
      choices: [{ message: { content }, finish_reason: 'stop' }],
    });
  }) as unknown as typeof fetch;
}

/** Install the stub the provider's fetch() will pick up. */
function installFetch(options: StubOptions = {}): void {
  globalThis.fetch = stubFetch(options);
}

/** A stub that also counts chat calls (never the /models probe). */
function counting(options: Omit<StubOptions, 'onCall'> = {}): { options: StubOptions; calls: () => number } {
  let calls = 0;
  return {
    options: {
      ...options,
      onCall: (url: string) => {
        if (url.includes('/chat/completions')) calls += 1;
      },
    },
    calls: () => calls,
  };
}

/** Grounded model prose built from the context the model would have been given. */
function groundedReply(
  context: BriefingContext,
  extra = '',
  headline = 'Your week sits close to your own recent baseline.'
): string {
  const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
  return JSON.stringify({
    headline,
    body:
      `Resting heart rate averaged ${rhr.mean7!.display} across the last ${context.windows.evaluatedDays} days, ` +
      `against ${rhr.mean7Prior!.display} in the ${context.windows.priorDays} before.` +
      extra,
    recommendations: ['Keep your bedtime in a steady range.', 'Keep recording as you do now.'],
  });
}

/**
 * A reply that carries a figure the context records under another metric: an
 * HRV value published as resting heart rate. This is the live defect in
 * miniature — the number is real, the label is wrong — and it is the reply the
 * number guard must discard.
 */
function wrongMetricReply(context: BriefingContext): string {
  const hrv = context.metrics.find(m => m.metricId === 'heart_rate_variability')!;
  const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
  return JSON.stringify({
    headline: 'Your heart readings softened this week.',
    body: `Resting heart rate averaged ${hrv.latest!.value} bpm this week, against ${rhr.mean7Prior!.display} before.`,
    recommendations: ['Keep your bedtime steady.'],
  });
}

type BriefingDepsArg = Parameters<typeof readBriefing>[0];
const deps = (overrides: Partial<BriefingDepsArg> = {}): BriefingDepsArg => ({
  aiSettings: LOCAL_ONLY,
  profile: PROFILE,
  now: MIDDAY,
  ...overrides,
});

/**
 * The prose the reader actually sees.
 *
 * A figure the number guard rejected must not appear here — but it must not be
 * checked against the whole serialized payload either. The payload carries live
 * clock values (`generatedAt`, `asOf`), and a rejected two-digit figure collides
 * with those digits by chance: the HRV latest reading is `48`, so
 * `expect(JSON.stringify(view)).not.toContain('48')` failed whenever the wall
 * clock's minute, second or milliseconds happened to contain `48` — about one
 * run in five, in the full suite and alone alike. That is a check against the
 * clock, not a check on the briefing.
 */
function publishedText(view: BriefingView): string {
  return [view.headline, view.body, ...view.recommendations].join('\n');
}

beforeEach(() => {
  clearBriefingCache();
  resetBriefingEngineMemo();
  resetToDemoDataset();
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  clearBriefingCache();
  resetBriefingEngineMemo();
  resetToDemoDataset();
});

describe('resolving the briefing engine', () => {
  it('uses the Summary model chosen in Settings, after checking a local server answers', async () => {
    const seen: string[] = [];
    const engine = await resolveBriefingEngine({
      aiSettings: LOCAL_ONLY,
      fetchImpl: stubFetch({ models: ['qwen3-8b', 'second-model'], onCall: url => seen.push(url) }),
    });

    expect(engine.kind).toBe('primary');
    expect(engine.label).toBe('Local model');
    expect(engine.model).toBe('local-model-1');
    expect(engine.destination).toBe('127.0.0.1:1234');
    // The probe is a bounded GET /models on the provider's base URL.
    expect(seen).toEqual(['http://127.0.0.1:1234/v1/models']);
  });

  it('checks a server off this machine when a fallback could write instead', async () => {
    const lan: UseSpec = { baseUrl: 'https://localai.example/v1', model: 'lan-model', apiKey: 'lan-key-123456', name: 'LAN' };
    const seen: string[] = [];
    const down = await resolveBriefingEngine({
      aiSettings: aiSettingsFor({ summary: lan, summary_fallback: FALLBACK }),
      fetchImpl: stubFetch({ probeFails: true, onCall: url => seen.push(url) }),
    });
    expect(seen).toEqual(['https://localai.example/v1/models']);
    expect(down.kind).toBe('fallback');
    const up = await resolveBriefingEngine({ aiSettings: aiSettingsFor({ summary: lan, summary_fallback: FALLBACK }), fetchImpl: stubFetch({}) });
    expect(up.kind).toBe('primary');
    expect(up.model).toBe('lan-model');
  });

  it('does not probe a hosted provider with no fallback', async () => {
    const seen: string[] = [];
    const engine = await resolveBriefingEngine({ aiSettings: aiSettingsFor({ summary: HOSTED }), fetchImpl: stubFetch({ onCall: url => seen.push(url) }) });
    expect(engine.kind).toBe('primary');
    expect(engine.model).toBe('test-model');
    expect(seen).toEqual([]);
  });

  it('falls through to the Summary fallback when the local server does not answer', async () => {
    const engine = await resolveBriefingEngine({
      aiSettings: LOCAL_WITH_FALLBACK,
      fetchImpl: stubFetch({ probeFails: true }),
    });

    expect(engine.kind).toBe('fallback');
    expect(engine.model).toBe('fallback-model');
    expect(engine.destination).toBe('provider.example');
    expect(engine.detail).toMatch(/could not be reached/);
    expect(engine.detail).toMatch(/summary fallback/);
  });

  it('gives the summary the briefing token budget unless Settings chose another', async () => {
    const engine = await resolveBriefingEngine({ aiSettings: aiSettingsFor({ summary: HOSTED }), fetchImpl: stubFetch({}) });
    expect(engine.config?.maxTokens).toBe(DEFAULT_BRIEFING_MAX_TOKENS);
    expect(engine.config?.tools).toBe('off');
    expect(engine.config?.reasoningEffort).toBeNull();

    // A chosen budget is honoured, and the timeout is still the environment's.
    const tuned = await resolveBriefingEngine({
      aiSettings: aiSettingsFor({ summary: { ...HOSTED, options: { maxTokens: 6000, reasoningEffort: 'low' } } }),
      env: envOf({ BRIEFING_TIMEOUT_MS: '30000' }),
      fetchImpl: stubFetch({}),
    });
    expect(tuned.config?.maxTokens).toBe(6000);
    expect(tuned.config?.reasoningEffort).toBe('low');
    expect(tuned.config?.timeoutMs).toBe(30000);
    const untimed = await resolveBriefingEngine({ aiSettings: aiSettingsFor({ summary: HOSTED }), env: envOf({}), fetchImpl: stubFetch({}) });
    expect(untimed.config?.timeoutMs).toBe(DEFAULT_BRIEFING_TIMEOUT_MS);
  });

  it('reports no engine when no summary model is chosen, and ignores the Analyst choice', async () => {
    const engine = await resolveBriefingEngine({ aiSettings: NO_AI, fetchImpl: stubFetch({}) });
    expect(engine.kind).toBe('none');
    expect(engine.config).toBeNull();
    expect(engine.detail).toMatch(/No summary model is chosen/);

    const analystOnly = await resolveBriefingEngine({ aiSettings: aiSettingsFor({ analyst: HOSTED }), fetchImpl: stubFetch({}) });
    expect(analystOnly.kind).toBe('none');
  });

  it('uses the fallback when the Summary choice is unusable', async () => {
    const engine = await resolveBriefingEngine({
      aiSettings: aiSettingsFor({ summary: { ...HOSTED, apiKey: null }, summary_fallback: FALLBACK }),
      fetchImpl: stubFetch({}),
    });
    expect(engine.kind).toBe('fallback');
    expect(engine.detail).toMatch(/needs an API key/);
  });

  it('states why when the settings could not be read', async () => {
    const engine = await resolveBriefingEngine({ aiSettings: { ...NO_AI, unavailable: 'The AI settings could not be read from the database.' } });
    expect(engine.kind).toBe('none');
    expect(engine.detail).toMatch(/could not be read/);
  });

  it('never puts a credential in the resolved engine description', async () => {
    const engine = await resolveBriefingEngine({
      aiSettings: aiSettingsFor({ summary: { ...LOCAL, apiKey: 'local-secret-key' }, summary_fallback: FALLBACK }),
      fetchImpl: stubFetch({ probeFails: true }),
    });
    const strip = (e: typeof engine): unknown => ({ ...e, config: e.config ? { ...e.config, apiKey: undefined } : null, fallback: e.fallback ? strip(e.fallback) : undefined });
    const serialized = JSON.stringify(strip(engine));
    expect(serialized).not.toContain('local-secret-key');
    expect(serialized).not.toContain('«redacted:fb-…»');
  });
});

describe('resolving the local model engine once a day', () => {
  it('probes the model server once per day and reuses the answer', async () => {
    let probes = 0;
    const fetchImpl = stubFetch({
      models: ['qwen3-8b'],
      onCall: url => {
        if (url.endsWith('/models')) probes += 1;
      },
    });

    const first = await resolveBriefingEngine({ aiSettings: LOCAL_ONLY, fetchImpl, day: '2026-09-18' });
    const second = await resolveBriefingEngine({ aiSettings: LOCAL_ONLY, fetchImpl, day: '2026-09-18' });

    expect(first.kind).toBe('primary');
    expect(second.model).toBe('local-model-1');
    // One GET /models for the whole day, not one per resolution.
    expect(probes).toBe(1);
  });

  it('re-probes when the day changes', async () => {
    let probes = 0;
    const fetchImpl = stubFetch({
      models: ['qwen3-8b'],
      onCall: url => {
        if (url.endsWith('/models')) probes += 1;
      },
    });

    await resolveBriefingEngine({ aiSettings: LOCAL_ONLY, fetchImpl, day: '2026-09-18' });
    await resolveBriefingEngine({ aiSettings: LOCAL_ONLY, fetchImpl, day: '2026-09-19' });
    expect(probes).toBe(2);
  });

  it('does not let a memoized "unavailable" mask a recovery for the regenerate path', async () => {
    // Day one: the local server is down, so the engine is the fallback.
    const down = stubFetch({ probeFails: true });
    const before = await resolveBriefingEngine({ aiSettings: LOCAL_WITH_FALLBACK, fetchImpl: down, day: '2026-09-18' });
    expect(before.kind).toBe('fallback');

    // The server comes back. An automatic resolution still sees the memo…
    const up = stubFetch({ models: ['qwen3-8b'] });
    const cached = await resolveBriefingEngine({ aiSettings: LOCAL_WITH_FALLBACK, fetchImpl: up, day: '2026-09-18' });
    expect(cached.kind).toBe('fallback');

    // …but an explicit re-probe (the Regenerate control) recovers it.
    const forced = await resolveBriefingEngine({
      aiSettings: LOCAL_WITH_FALLBACK,
      fetchImpl: up,
      day: '2026-09-18',
      forceProbe: true,
    });
    expect(forced.kind).toBe('primary');
    expect(forced.model).toBe('local-model-1');
  });
});

describe('the briefing day schedule', () => {
  it('is keyed on the local calendar day, with no dataset identity in the key', () => {
    const schedule = briefingSchedule(PROFILE, MIDDAY());
    expect(schedule.coversDay).toBe('2026-09-18');
    expect(schedule.allowed).toBe(true);

    const key = briefingCacheKey(schedule, 'metric', PROFILE);
    expect(key).toContain('2026-09-18');

    // New observations landing later the same day must NOT change the key: that
    // is the whole defect this schedule exists to fix.
    setActiveDataset(
      {
        ...FIXTURES,
        referenceDate: '2026-09-18T23:00:00.000Z',
        windowEnd: '2026-09-18T23:00:00.000Z',
      },
      { mode: 'demo', dataAsOf: '2026-09-18T23:00:00.000Z' }
    );
    expect(FIXTURES.referenceDate).not.toBe('2026-09-18T23:00:00.000Z');
    const later = briefingSchedule(PROFILE, new Date('2026-09-18T23:00:00.000Z'));
    expect(briefingCacheKey(later, 'metric', PROFILE)).toBe(key);
  });

  it('covers yesterday until the profile hour has passed', () => {
    const before = briefingSchedule(PROFILE, new Date('2026-09-18T05:59:00.000Z'));
    expect(before.allowed).toBe(false);
    expect(before.coversDay).toBe('2026-09-17');

    const at = briefingSchedule(PROFILE, new Date('2026-09-18T06:00:00.000Z'));
    expect(at.allowed).toBe(true);
    expect(at.coversDay).toBe('2026-09-18');
  });

  it('honours a differently configured briefing hour', () => {
    const late = { ...PROFILE, briefingHour: 9 };
    expect(briefingSchedule(late, new Date('2026-09-18T08:00:00.000Z')).coversDay).toBe('2026-09-17');
    expect(briefingSchedule(late, new Date('2026-09-18T09:00:00.000Z')).coversDay).toBe('2026-09-18');
  });

  it('keys the cache by unit system and by the profile that reaches the prompt', () => {
    const schedule = briefingSchedule(PROFILE, MIDDAY());
    expect(briefingCacheKey(schedule, 'metric', PROFILE)).not.toBe(briefingCacheKey(schedule, 'imperial', PROFILE));
    // A renamed profile is a different prompt, so it is a different entry.
    const renamed = { ...PROFILE, name: 'Someone Else' };
    expect(briefingCacheKey(schedule, 'metric', renamed)).not.toBe(briefingCacheKey(schedule, 'metric', PROFILE));

    // Imperial formatting is what the model is given for an imperial reader.
    const context = buildBriefingContext('imperial');
    const weight = context.metrics.find(m => m.metricId === 'weight_body_mass');
    if (weight?.latest) expect(weight.latest.display).toMatch(/lb/);
    expect(getMetric('weight_body_mass')).toBeDefined();
  });
});

describe("reading today's briefing", () => {
  it('serves the computed fallback on a cold read without waiting for the model', async () => {
    installFetch();
    const view = readBriefing(deps());
    // Nothing was awaited: the payload is complete and honestly attributed.
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.headline.length).toBeGreaterThan(0);
    expect(view.body.length).toBeGreaterThan(0);
    expect(view.recommendations).toEqual([]);
    expect(view.cached).toBe(false);
    expect(view.coversDay).toBe('2026-09-18');
    expect(view.scheduledHour).toBe(6);
    await awaitBriefingIdle();
  });

  it('serves the written briefing once the background generation lands', async () => {
    installFetch({ content: groundedReply(buildBriefingContext('metric')) });

    readBriefing(deps());
    await awaitBriefingIdle();

    const view = readBriefing(deps());
    expect(view.kind).toBe('model');
    expect(view.attribution).toBe('Written by local-model-1');
    expect(view.model).toBe('local-model-1');
    expect(view.provider).toBe('Local model');
    expect(view.engine).toBe('primary');
    expect(view.cached).toBe(true);
    expect(view.coversDay).toBe('2026-09-18');
    expect(view.recommendations).toHaveLength(2);
    // Every figure in the published text was audited against the context.
    expect(view.traceability.checked).toBeGreaterThan(0);
    expect(view.traceability.unmatched).toEqual([]);
    expect(view.latencyMs).not.toBeNull();
    // The headline is the model's, not the computed one.
    expect(view.headline).toBe('Your week sits close to your own recent baseline.');
  });

  it('discards the model text and renders the computed briefing when a figure is invented', async () => {
    installFetch({
      contents: [groundedReply(buildBriefingContext('metric'), ' Your recovery score is 4242 today.')],
    });

    readBriefing(deps());
    await awaitBriefingIdle();

    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/not in the recorded data/);
    expect(publishedText(view)).not.toContain('4242');
  });

  it('re-asks the fallback provider once when the preferred reply fails the guard', async () => {
    const context = buildBriefingContext('metric');
    const wrong = wrongMetricReply(context);
    // The crafted reply really is a guard violation for this context — the test
    // fails loudly here rather than silently testing nothing if the data drifts.
    expect(parseBriefingReply(wrong, context).ok).toBe(false);

    const counter = counting({ contents: [wrong, groundedReply(context)] });
    installFetch(counter.options);

    readBriefing(deps({ aiSettings: LOCAL_WITH_FALLBACK }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ aiSettings: LOCAL_WITH_FALLBACK }));
    // The rejected reply was discarded; the fallback's grounded reply is what is
    // published, and the payload says the fallback wrote it.
    expect(view.kind).toBe('model');
    expect(view.engine).toBe('fallback');
    expect(view.provider).toBe('Fallback');
    expect(view.destination).toBe('provider.example');
    expect(view.headline).not.toBe(JSON.parse(wrong).headline);
    expect(view.traceability.unmatched).toEqual([]);
    expect(view.adjustments.join(' ')).toMatch(/fallback provider/);
    // Exactly one primary attempt and exactly one fallback attempt.
    expect(counter.calls()).toBe(2);
  });

  it('serves the computed briefing when the fallback reply fails the same check', async () => {
    const context = buildBriefingContext('metric');
    const wrong = wrongMetricReply(context);
    const counter = counting({ contents: [wrong, wrong] });
    installFetch(counter.options);

    const aiSettings = LOCAL_WITH_FALLBACK;
    readBriefing(deps({ aiSettings }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ aiSettings }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/failed the same check/);
    // The offending figure is never published in the briefing text.
    const offending = String(JSON.parse(wrong).body.match(/[\d.]+/)![0]);
    expect(publishedText(view)).not.toContain(offending);
    // One primary attempt + one fallback attempt, and no loop.
    expect(counter.calls()).toBe(2);
  });

  it('does not ask the fallback twice when it already wrote the rejected reply', async () => {
    // The local server is down, so the fallback writes; its reply fails the guard.
    const context = buildBriefingContext('metric');
    const counter = counting({ contents: [wrongMetricReply(context), groundedReply(context)], probeFails: true });
    installFetch(counter.options);

    readBriefing(deps({ aiSettings: LOCAL_WITH_FALLBACK }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ aiSettings: LOCAL_WITH_FALLBACK }));
    expect(view.kind).toBe('computed');
    expect(view.reason).toMatch(/came from the summary fallback itself/);
    expect(counter.calls()).toBe(1);
  });

  it('serves the computed briefing with exactly one attempt when no fallback is configured', async () => {
    const context = buildBriefingContext('metric');
    const counter = counting({ contents: [wrongMetricReply(context)] });
    installFetch(counter.options);

    // The Summary only: no fallback is chosen.
    readBriefing(deps());
    await awaitBriefingIdle();

    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/No fallback provider is available/);
    // Exactly one attempt: the primary. Nothing is re-rolled.
    expect(counter.calls()).toBe(1);
  });

  it('keeps the day cached after a failed guard, so the view does not regenerate', async () => {
    const context = buildBriefingContext('metric');
    const counter = counting({ contents: [wrongMetricReply(context), wrongMetricReply(context)] });
    installFetch(counter.options);

    const aiSettings = LOCAL_WITH_FALLBACK;
    readBriefing(deps({ aiSettings }));
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);

    // Further reads the same day are served the computed briefing and open no
    // new request: a failed guard is not retried on every view.
    const first = readBriefing(deps({ aiSettings }));
    const second = readBriefing(deps({ aiSettings }));
    await awaitBriefingIdle();
    expect(first.kind).toBe('computed');
    expect(second.kind).toBe('computed');
    expect(counter.calls()).toBe(2);
  });

  it('degrades to the computed briefing when the provider refuses, without leaking the key', async () => {
    installFetch({
      chatStatus: 401,
      chatBody: { error: { message: 'invalid api key «redacted:sk-…»' } },
    });

    readBriefing(deps({ aiSettings: aiSettingsFor({ summary: HOSTED }) }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ aiSettings: aiSettingsFor({ summary: HOSTED }) }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/HTTP 401/);
    expect(JSON.stringify(view)).not.toContain('«redacted:sk-…»');
  });

  it('degrades to the computed briefing when no engine is configured at all', async () => {
    installFetch();
    readBriefing(deps({ aiSettings: NO_AI }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ aiSettings: NO_AI }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/No summary model is chosen/);
  });

  it('degrades to the computed briefing when the provider does not answer in time', async () => {
    // A stub that honours the abort signal the way a real fetch does: the
    // configured timeout has to actually bound the call, not just be recorded.
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/models')) {
        return Promise.resolve(jsonResponse({ data: [{ id: 'local-model-1' }] }));
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }))
        );
      });
    }) as unknown as typeof fetch;

    const env = envOf({ BRIEFING_TIMEOUT_MS: '100' });
    readBriefing(deps({ env }));
    await awaitBriefingIdle();

    const view = readBriefing(deps({ env }));
    expect(view.kind).toBe('computed');
    expect(view.attribution).toBe(COMPUTED_ATTRIBUTION);
    expect(view.reason).toMatch(/did not respond within 100 ms/);
  });
});

describe('one briefing per local day', () => {
  it('generates once for the day, and never again when new data lands mid-day', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    readBriefing(deps());
    readBriefing(deps());
    readBriefing(deps());
    await awaitBriefingIdle();
    readBriefing(deps());
    expect(counter.calls()).toBe(1);

    // The dataset moves on — a new observation lands five hours later, still the
    // same local day. The briefing written this morning stays; it describes the
    // last seven days, and none of that changes within a day.
    setActiveDataset(
      {
        ...FIXTURES,
        referenceDate: '2026-09-18T22:00:00.000Z',
        windowEnd: '2026-09-18T22:00:00.000Z',
      },
      { mode: 'demo', dataAsOf: '2026-09-18T22:00:00.000Z' }
    );
    const later = readBriefing(deps({ now: instant('2026-09-18T22:00:00.000Z') }));
    expect(later.cached).toBe(true);
    expect(later.coversDay).toBe('2026-09-18');
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // The next local day, past the hour: a new briefing is written exactly once.
    readBriefing(deps({ now: instant('2026-09-19T07:00:00.000Z') }));
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);
  });

  it('keeps the previous day on screen, labelled, until the hour has passed', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const dayOne = deps({ now: instant('2026-09-17T13:00:00.000Z') });
    readBriefing(dayOne);
    await awaitBriefingIdle();
    const writtenDayOne = readBriefing(dayOne);
    expect(writtenDayOne.kind).toBe('model');
    expect(writtenDayOne.coversDay).toBe('2026-09-17');
    expect(counter.calls()).toBe(1);

    // 05:00 the next day: before the briefing hour. Yesterday's briefing is
    // still what is current, it is labelled with its own day, and NO generation
    // is started for the new day.
    const before = readBriefing(deps({ now: instant('2026-09-18T05:00:00.000Z') }));
    expect(before.coversDay).toBe('2026-09-17');
    expect(before.kind).toBe('model');
    expect(before.headline).toBe(writtenDayOne.headline);
    expect(before.cached).toBe(true);
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // 06:00: the day rolls over and the first request writes today's briefing.
    const rollover = readBriefing(deps({ now: instant('2026-09-18T06:00:00.000Z') }));
    expect(rollover.coversDay).toBe('2026-09-18');
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);
    expect(readBriefing(deps({ now: instant('2026-09-18T06:30:00.000Z') })).coversDay).toBe('2026-09-18');
  });

  it('labels the previous day and calls no model before the hour on a cold process', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const view = readBriefing(deps({ now: instant('2026-09-18T05:00:00.000Z') }));
    expect(view.kind).toBe('computed');
    expect(view.coversDay).toBe('2026-09-17');
    await awaitBriefingIdle();
    // A request before the hour never calls the model.
    expect(counter.calls()).toBe(0);
  });
});

describe('a day is terminal after one attempt (the whole point)', () => {
  /**
   * The generator seam: it is the ONLY thing that would reach the model, so
   * counting its calls is counting model connections. It returns a complete,
   * attributed payload so the success path is exercised for real.
   */
  function spyGenerate(): {
    calls: () => number;
    generate: (context: BriefingContext, engine: unknown) => Promise<BriefingModelTextLike>;
  } {
    let calls = 0;
    return {
      calls: () => calls,
      generate: async (context: BriefingContext) => {
        calls += 1;
        const rhr = context.metrics.find(m => m.metricId === 'resting_heart_rate')!;
        return {
          headline: 'A written briefing.',
          body: `Resting heart rate averaged ${rhr.mean7!.display} over the last week.`,
          recommendations: ['Keep recording.'],
          model: 'test-model',
          latencyMs: 12,
          traceability: { checked: 1, unmatched: [] },
          adjustments: [],
        };
      },
    };
  }

  it('a second read after a FAILED attempt starts no second generation', async () => {
    let calls = 0;
    const failing = async (): Promise<BriefingModelTextLike> => {
      calls += 1;
      throw new Error('The provider could not be reached.');
    };

    // Two synchronous reads, as two page renders (or two route reads) would be.
    const first = readBriefing(deps({ generate: failing }));
    const second = readBriefing(deps({ generate: failing }));
    await awaitBriefingIdle();

    // Both reads served the computed briefing, and only ONE generation ran.
    expect(first.kind).toBe('computed');
    expect(second.kind).toBe('computed');
    expect(calls).toBe(1);

    // A later read — long after the failure — still starts nothing.
    const third = readBriefing(deps({ generate: failing }));
    await awaitBriefingIdle();
    expect(calls).toBe(1);
    expect(third.kind).toBe('computed');
    // The failure is visible, not swallowed.
    expect(third.reason).toMatch(/could not be reached/);
    expect(third.pending).toBe(false);
  });

  it('a SUCCESSFUL day is never regenerated by a later render', async () => {
    const spy = spyGenerate();

    readBriefing(deps({ generate: spy.generate }));
    await awaitBriefingIdle();
    expect(spy.calls()).toBe(1);

    const written = readBriefing(deps({ generate: spy.generate }));
    expect(written.kind).toBe('model');
    expect(written.attribution).toBe('Written by test-model');
    expect(written.cached).toBe(true);

    // Many later renders, same day: the cache answers and nothing regenerates.
    readBriefing(deps({ generate: spy.generate }));
    readBriefing(deps({ generate: spy.generate }));
    await awaitBriefingIdle();
    expect(spy.calls()).toBe(1);
  });

  it('the explicit regenerate still generates even when the day is terminal', async () => {
    // A FAILED day: the first automatic attempt is terminal.
    let autoCalls = 0;
    const failing = async (): Promise<BriefingModelTextLike> => {
      autoCalls += 1;
      throw new Error('The provider could not be reached.');
    };
    readBriefing(deps({ generate: failing }));
    await awaitBriefingIdle();
    expect(autoCalls).toBe(1);
    expect(hasBriefingAttempt(briefingCacheKey(briefingSchedule(PROFILE, MIDDAY()), 'metric', PROFILE))).toBe(true);

    // The user's explicit Regenerate ignores the day-terminal rule and writes.
    const spy = spyGenerate();
    const replaced = await regenerateBriefing(deps({ generate: spy.generate }));
    expect(spy.calls()).toBe(1);
    expect(replaced.kind).toBe('model');
    expect(replaced.headline).toBe('A written briefing.');

    // The day is now cached; a later render serves the replacement, still once.
    const after = readBriefing(deps({ generate: spy.generate }));
    expect(after.cached).toBe(true);
    await awaitBriefingIdle();
    expect(spy.calls()).toBe(1);
  });
});

describe('manual regeneration', () => {
  it('replaces the current day once, with new text, and does not loop', async () => {
    const context = buildBriefingContext('metric');
    const counter = counting({
      contents: [
        groundedReply(context, '', 'First briefing.'),
        groundedReply(context, '', 'Second briefing.'),
      ],
    });
    installFetch(counter.options);

    readBriefing(deps());
    await awaitBriefingIdle();
    const first = readBriefing(deps());
    expect(first.kind).toBe('model');
    expect(first.headline).toBe('First briefing.');
    expect(counter.calls()).toBe(1);

    const replaced = await regenerateBriefing(deps());
    expect(replaced.kind).toBe('model');
    expect(replaced.headline).toBe('Second briefing.');
    expect(replaced.cached).toBe(false);
    expect(replaced.coversDay).toBe(first.coversDay);
    expect(counter.calls()).toBe(2);

    // Exactly one generation: a later read serves the replacement from cache.
    const after = readBriefing(deps());
    expect(after.headline).toBe('Second briefing.');
    expect(after.cached).toBe(true);
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(2);
  });

  it('reports a failure instead of a briefing when the model cannot be reached', async () => {
    installFetch({ chatFails: true });
    await expect(regenerateBriefing(deps())).rejects.toThrow();
    // The day is left unwritten; the read path then says why it is computed.
    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.reason).toBeTruthy();
  });
});

describe('failure handling — a day is attempted at most once', () => {
  it('does not retry a dead provider on every view, and the failure is visible', async () => {
    const counter = counting({ chatFails: true });
    installFetch(counter.options);

    readBriefing(deps());
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // The day is TERMINAL after the failed attempt: asking again — however many
    // times, however long after — must not open another request. There is no
    // cooldown that would allow a second attempt later the same day.
    readBriefing(deps());
    readBriefing(deps());
    await awaitBriefingIdle();
    expect(counter.calls()).toBe(1);

    // The failed attempt is on record, and the hero says why it is computed.
    const view = readBriefing(deps());
    expect(view.kind).toBe('computed');
    expect(view.reason).toBeTruthy();
  });
});

describe('the briefing warm-up entry point', () => {
  it('fills the current day once and reports the engine and model', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const outcome = await warmBriefing(deps());
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.engine).toBe('primary');
      expect(outcome.model).toBe('local-model-1');
    }
    expect(counter.calls()).toBe(1);

    // The request path then serves what the fill stored, with no second call.
    const view = readBriefing(deps());
    expect(view.kind).toBe('model');
    expect(counter.calls()).toBe(1);
  });

  it('does not generate before the briefing hour', async () => {
    const counter = counting({ content: groundedReply(buildBriefingContext('metric')) });
    installFetch(counter.options);

    const outcome = await warmBriefing(deps({ now: instant('2026-09-18T05:00:00.000Z') }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/before the briefing hour/);
    expect(counter.calls()).toBe(0);
  });

  it('reports the absence of a model as an outcome rather than throwing', async () => {
    installFetch();
    const outcome = await warmBriefing(deps({ aiSettings: NO_AI }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/No summary model is chosen/);
  });
});
