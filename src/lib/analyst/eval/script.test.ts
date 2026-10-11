// ── scripts/analyst-eval.mjs, run as a child process ────────────────────────
//
// The guards (no provider, no --yes) and one full pass against a scripted model on
// 127.0.0.1, chosen with --settings. The child gets a minimal environment: nothing of
// the developer's shell, no .env, no database, no credential.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeModels, fakeModel, lastUser, reply } from '../integration.fake';

const SCRIPT = join(process.cwd(), 'scripts', 'analyst-eval.mjs');

function runScript(args: string[], env: Record<string, string>): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--no-warnings', SCRIPT, ...args], { env: { PATH: process.env.PATH ?? '', ...env } as unknown as NodeJS.ProcessEnv, cwd: process.cwd() });
    let out = '';
    let err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('close', code => resolve({ code, out, err }));
  });
}

const dirs: string[] = [];
afterEach(async () => {
  await closeModels();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A --settings file choosing this provider and model for the Analyst. */
function settingsFile(value: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'vital-eval-'));
  dirs.push(dir);
  const file = join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(value));
  return file;
}

describe('analyst-eval guards', () => {
  it('refuses without a provider, and says why', async () => {
    const r = await runScript(['--yes'], {});
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no model is chosen for the Analyst/);
    expect(r.out).toBe('');
  });

  it('refuses a provider that is not usable', async () => {
    const r = await runScript(['--yes', '--settings', settingsFile({ kind: 'openai', baseUrl: 'https://example.invalid/v1', model: 'm' })], {});
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not usable/);
  });

  it('refuses without --yes even when the provider is configured, and sends nothing', async () => {
    const model = await fakeModel(() => ({ say: reply('x') }));
    const r = await runScript(['--settings', settingsFile({ kind: 'openai', baseUrl: model.url, model: 'm', apiKey: 'test-key' })], {});
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/without --yes/);
    expect(model.bodies).toHaveLength(0);
  });
});

describe('analyst-eval run', () => {
  it('sends the chosen questions, scores them, and prints no value, answer text or key', async () => {
    const model = await fakeModel((_n, body) => {
      if (body.messages.some(m => m.role === 'tool')) return { say: reply('Everything is in the lookup.') };
      const march = /March/.test(lastUser(body));
      return { call: [['get_workouts', { window: march ? { month: '2026-03' } : { start: '2024-01-01', end: '2024-12-31' }, view: 'summary' }]] };
    });
    const file = settingsFile({ kind: 'openai', baseUrl: model.url, model: 'm', apiKey: 'sk-test-canary-1234' });
    const r = await runScript(['--yes', '--only', '2,32', '--settings', file], { VITAL_DATA_MODE: 'demo' });
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(r.out).toContain('Q02 answered yes · expected tool called yes · window matched yes · absence violation no · tools: get_workouts');
    expect(r.out).toContain('Q32 answered yes · expected tool called yes · window matched yes · absence violation no · tools: get_workouts');
    expect(r.out).toContain('Totals over 2 questions: answered 2 · expected tool called 2 · window matched 2/2 · absence violations 0');
    expect(r.out).not.toContain('Q01');
    // Nothing the model said, nothing the tools returned, no key and no address.
    expect(r.out).not.toContain('Everything is in the lookup');
    expect(r.out).not.toContain('sk-test-canary');
    expect(r.out).not.toContain('127.0.0.1');
    expect(r.out).not.toMatch(/\d{4}-\d\d-\d\d/);
    expect(model.bodies.length).toBeGreaterThanOrEqual(4);
  });
});
