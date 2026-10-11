#!/usr/bin/env node
// ── Live analyst evaluation (design §12) ─────────────────────────────────────
//
//   ANALYST_PROVIDER=... ANALYST_MODEL=... ANALYST_API_URL=... ANALYST_API_KEY=... \
//     npm run analyst:eval -- --yes [--only 1,4,32]
//
// Sends the 32 evaluation questions, one request each, through the analyst service to
// the configured model, against the dataset the app is serving (installDataset, as the
// route does). ~30 questions are ~30+ model calls and each tool round is another: run on
// demand only. It is NOT part of the test suite and never runs in CI.
//
// It refuses to run unless ANALYST_PROVIDER names a usable provider AND --yes is given.
// Configuration is read from the process environment only: export the variables in your
// shell or set them on the command line. This script and its docs never source a .env.
//
// For each question it prints whether the expected tool was called, whether the window
// resolved to the expected month/day/span, and whether the final answer still makes an
// absence claim the coverage index contradicts. It prints tool NAMES and yes/no only:
// no value, no answer text, no argument, no host, no key.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTypeScript } from './ts-register.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SRC = join(REPO, 'src');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run analyst:eval -- --yes [--only 1,4,32]\nNeeds ANALYST_PROVIDER (and the provider settings) in the process environment.');
  process.exit(0);
}

registerTypeScript(REPO);
const { readAnalystConfig } = await import(join(SRC, 'lib/analyst/config.ts'));
const config = readAnalystConfig(process.env);

if (config.provider === 'demo' || config.misconfiguredReason) {
  console.error(
    config.provider === 'demo' && !config.misconfiguredReason
      ? 'Refusing to run: ANALYST_PROVIDER is not set to a model provider (the demo analyst answers offline and is not evaluated).'
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
    response = await askAnalyst({ query: q.text, system: 'metric' });
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
