// ── The privacy hook on every tool (design §9.2) ─────────────────────────────
//
// `CapabilityContext.policy` is ALLOW_ALL today. A policy that withholds a category
// makes every capability that sends it answer `privacy_blocked`, directly and through
// the tool the model calls, and nothing is read.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetToDemoDataset } from '../../adapters/dataset';
import { runTool } from '../tools';
import { ARGS, toolArgs } from './privacy.fake';
import { CAPABILITIES } from './registry';
import { installTestDataset } from './test-dataset.fake';
import { testCtx } from './test-context.fake';
import { ALLOW_ALL, type PrivacyPolicy } from './types';

beforeEach(() => void installTestDataset());
afterEach(() => resetToDemoDataset());

const DENY_ALL: PrivacyPolicy = { allows: () => false };

describe('a policy that withholds everything', () => {
  it.each(CAPABILITIES.map(c => c.id))('%s answers privacy_blocked and returns no data', async id => {
    const cap = CAPABILITIES.find(c => c.id === id)!;
    const env = await cap.read(ARGS[id] ?? {}, testCtx({ policy: DENY_ALL }));
    expect(env.status).toBe('privacy_blocked');
    expect(env.data).toBeUndefined();
    expect(env.next).toBe(`${cap.title} is withheld from the model by the AI privacy setting.`);
  });

  it.each(CAPABILITIES.map(c => c.id))('%s is refused through its tool too', async id => {
    const cap = CAPABILITIES.find(c => c.id === id)!;
    const c = testCtx({ policy: DENY_ALL });
    const r = await runTool(cap.tool, toolArgs(cap), { system: 'metric', deps: c.routine, changes: [], data: { ...c.access, policy: DENY_ALL } });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content).status).toBe('privacy_blocked');
  });
});

describe('a policy that withholds one category', () => {
  const policy: PrivacyPolicy = { allows: c => c !== 'sleep-nights' };

  it('blocks only the capabilities that send it', async () => {
    for (const cap of CAPABILITIES) {
      const env = await cap.read(ARGS[cap.id] ?? {}, testCtx({ policy }));
      expect(env.status === 'privacy_blocked', cap.id).toBe(cap.category === 'sleep-nights');
    }
  });

  it('leaves ALLOW_ALL allowing every category', () => {
    for (const cap of CAPABILITIES) expect(ALLOW_ALL.allows(cap.category)).toBe(true);
  });
});
