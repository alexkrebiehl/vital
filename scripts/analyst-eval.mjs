#!/usr/bin/env node
// ── Live analyst evaluation (design §12) ─────────────────────────────────────
//
//   VITAL_PG_PASSWORD=... VITAL_SECRET_KEY=... npm run analyst:eval -- --yes [--only 1,4,32]
//
// Sends the 32 evaluation questions, one request each, through the analyst service to
// the model chosen for the Analyst in Settings, against the dataset the app is serving
// (installDataset, as the route does). ~30 questions are ~30+ model calls and each tool
// round is another: run on demand only. It is NOT part of the test suite and never runs in CI.
//
// It refuses to run unless the Analyst has a usable provider and model AND --yes is given.
// The choice is read from the database the app uses (VITAL_PG_* or DATABASE_URL), and the
// provider's key is decrypted with VITAL_SECRET_KEY. Those are read from the process
// environment only: export them in your shell or set them on the command line. This script
// and its docs never source a .env.
//
// To evaluate a model without changing Settings, pass `--settings <file.json>` instead:
//   { "kind": "openai" | "anthropic", "baseUrl": "...", "apiKey": "...", "model": "...", "options": { ... } }
// The file is read once; no database is needed, and its key is never printed.
//
// For each question it prints whether the expected tool was called, whether the window
// resolved to the expected month/day/span, and whether the final answer still makes an
// absence claim the coverage index contradicts. It prints tool NAMES and yes/no only:
// no value, no answer text, no argument, no host, no key.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTypeScript } from './ts-register.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(REPO, 'src');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run analyst:eval -- --yes [--only 1,4,32] [--settings file.json]\nWithout --settings, needs the database settings (VITAL_PG_* or DATABASE_URL) and VITAL_SECRET_KEY in the process environment, and an Analyst model chosen in Settings.');
  process.exit(0);
}

registerTypeScript(REPO);
const { resolveAnalystConfig } = await import(join(SRC, 'lib/analyst/resolve-config.ts'));
const { readAiSettings } = await import(join(SRC, 'lib/ai/settings.ts'));
const { parseOptions } = await import(join(SRC, 'lib/ai/types.ts'));

/** The settings from --settings <file>, shaped as the database would return them. */
function settingsFromFile(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.error('Refusing to run: the --settings file could not be read as JSON.');
    process.exit(2);
  }
  if (raw?.kind !== 'openai' && raw?.kind !== 'anthropic') {
    console.error('Refusing to run: the --settings file must name "kind": "openai" or "anthropic".');
    process.exit(2);
  }
  const apiKey = typeof raw?.apiKey === 'string' && raw.apiKey.trim() ? raw.apiKey.trim() : null;
  const at = new Date().toISOString();
  return {
    providers: [{ id: 'eval', name: 'eval', kind: raw?.kind, baseUrl: String(raw?.baseUrl ?? ''), apiKey, keyState: apiKey ? 'ok' : 'none', updatedAt: at, revision: 1 }],
    assignments: [{ use: 'analyst', providerId: 'eval', model: String(raw?.model ?? ''), options: parseOptions('analyst', raw?.options), updatedAt: at, revision: 1 }],
  };
}

const settingsAt = args.indexOf('--settings');
const aiSettings = settingsAt >= 0 && args[settingsAt + 1] ? settingsFromFile(args[settingsAt + 1]) : await readAiSettings({ env: process.env });
const config = await resolveAnalystConfig({ env: process.env, aiSettings });

if (config.provider === 'demo' || config.misconfiguredReason) {
  console.error(
    config.provider === 'demo' && !config.misconfiguredReason
      ? 'Refusing to run: no model is chosen for the Analyst in Settings (the demo analyst answers offline and is not evaluated).'
      : `Refusing to run: the analyst configuration is not usable (${config.misconfiguredReason}).`
  );
  process.exit(2);
}
if (!args.includes('--yes')) {
  console.error('Refusing to run without --yes: this sends 32 questions, and every tool round, to the configured model.\nRe-run with: npm run analyst:eval -- --yes');
  process.exit(2);
}

const only = (() => {
  const i = args.indexOf('--only');
  return i >= 0 && args[i + 1] ? new Set(args[i + 1].split(',').map(Number)) : null;
})();

const { askAnalyst } = await import(join(SRC, 'lib/analyst/service.ts'));
const { installDataset } = await import(join(SRC, 'lib/adapters/runtime.ts'));
const { dataMode } = await import(join(SRC, 'lib/adapters/dataset.ts'));
const { EVAL_QUESTIONS } = await import(join(SRC, 'lib/analyst/eval/questions.ts'));
const { scoreCalls, liveAuditEntries, hasAbsenceViolation } = await import(join(SRC, 'lib/analyst/eval/score.ts'));
const { callsFromRequest } = await import(join(SRC, 'lib/analyst/eval/calls.ts'));

try {
  await installDataset();
} catch (error) {
  // The class of failure only: a detail can carry a host.
  console.error(`Could not install the dataset (${error instanceof Error ? error.name : 'error'}). Nothing was sent to the model.`);
  process.exit(1);
}

// The tool calls a question made are read from the last request the service sent the model
// (it carries the whole exchange). Bodies are held in memory and never printed.
let lastCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  try {
    if (typeof init?.body === 'string' && init.body.includes('"messages"')) lastCalls = callsFromRequest(JSON.parse(init.body));
  } catch {
    /* not a model request */
  }
  return realFetch(input, init);
};

console.log(`analyst:eval · provider ${config.provider} · model ${config.model ?? 'default'} · context ${config.context} · tools ${config.tools} · dataset ${dataMode()}`);
const pad = (n) => String(n).padStart(2, '0');
const yn = (b) => (b === null ? 'n/a' : b ? 'yes' : 'no');
const totals = { run: 0, answered: 0, tool: 0, window: 0, windowApplicable: 0, absence: 0 };

for (const q of EVAL_QUESTIONS) {
  if (only && !only.has(q.n)) continue;
  lastCalls = [];
  let response;
  try {
    response = await askAnalyst({ query: q.text, system: 'metric' }, { aiSettings });
  } catch (error) {
    response = { status: 'error', toolsUsed: [] };
  }
  const result = { ...scoreCalls(q, lastCalls), absenceViolation: hasAbsenceViolation(response, await liveAuditEntries('metric'), lastCalls) };
  totals.run += 1;
  if (response.status === 'ok') totals.answered += 1;
  if (result.toolCalled) totals.tool += 1;
  if (result.windowMatched !== null) totals.windowApplicable += 1;
  if (result.windowMatched) totals.window += 1;
  if (result.absenceViolation) totals.absence += 1;
  console.log(
    `Q${pad(q.n)} answered ${response.status === 'ok' ? 'yes' : 'no '} · expected tool called ${yn(result.toolCalled)} · window matched ${yn(result.windowMatched)} · absence violation ${yn(result.absenceViolation)} · tools: ${[...new Set(lastCalls.map(c => c.tool))].join(', ') || 'none'}`
  );
}

console.log(
  `\nTotals over ${totals.run} questions: answered ${totals.answered} · expected tool called ${totals.tool} · window matched ${totals.window}/${totals.windowApplicable} · absence violations ${totals.absence}`
);
process.exit(0);
