// # Vital — demo body-composition and energy series
//
// Adds the series the Body goal reads to a fixture dataset: body fat and lean
// mass (measured by the same scale, on the same mornings as the weigh-ins),
// basal energy (the watch's daily resting burn, which tracks lean mass) and
// dietary fiber (logged on the days calories were logged).
//
// Deterministic, with its own PRNG seed, and derived only from series already
// in the dataset, so adding these never changes any existing value.
//
//   import { addBodySeries } from './body-series.mjs'   — used by seed.mjs
//   node scripts/body-series.mjs                         — adds them to the committed fixtures

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function coverageOf(records, expectedDays, samplingFrequency) {
  return {
    firstObservation: records[0].date,
    lastObservation: records[records.length - 1].date,
    observedDays: records.length,
    expectedDays,
    samplingFrequency,
    sourceNames: [...new Set(records.map(r => r.source))],
  };
}

/** Add body_fat_percentage, lean_body_mass, basal_energy_burned and dietary_fiber to `fixtures` in place. */
export function addBodySeries(fixtures) {
  const rng = mulberry32(20261004);
  const gaussian = (mean, std) => {
    const u1 = rng();
    const u2 = rng();
    return mean + Math.sqrt(-2 * Math.log(u1 + 0.00001)) * Math.cos(2 * Math.PI * u2) * std;
  };
  const round1 = v => Math.round(v * 10) / 10;
  const metrics = fixtures.metrics;
  const expected = fixtures.coverage.weight_body_mass?.expectedDays ?? fixtures.days + 1;
  const weights = metrics.weight_body_mass;

  // Body fat drifts slowly around 22 %, and moves with weight; the scale's
  // bioimpedance reading adds ~0.6 points of noise on top.
  let drift = 22.4;
  const bodyFat = [];
  const lean = [];
  for (const w of weights) {
    drift += gaussian(-0.01, 0.08);
    const pct = round1(drift + (w.qty - 76.5) * 0.45 + gaussian(0, 0.6));
    bodyFat.push({ date: w.date, qty: pct, units: '%', source: w.source });
    lean.push({ date: w.date, qty: round1(w.qty * (1 - pct / 100)), units: 'kg', source: w.source });
  }

  // Basal energy: Katch–McArdle from the latest lean mass, daily, from the watch.
  const basal = [];
  let leanNow = lean[0].qty;
  let li = 0;
  for (const a of metrics.active_energy) {
    while (li < lean.length && lean[li].date <= a.date) leanNow = lean[li++].qty;
    basal.push({ date: a.date, qty: Math.round(370 + 21.6 * leanNow + gaussian(0, 25)), units: 'kcal', source: a.source });
  }

  // Fiber: ~11 g per 1,000 kcal on the days calories were logged.
  const fiber = metrics.dietary_energy.map(e => ({
    date: e.date,
    qty: Math.max(4, Math.round((e.qty / 1000) * gaussian(11, 3))),
    units: 'g',
    source: e.source,
  }));

  metrics.body_fat_percentage = bodyFat;
  metrics.lean_body_mass = lean;
  metrics.basal_energy_burned = basal;
  metrics.dietary_fiber = fiber;
  fixtures.coverage.body_fat_percentage = coverageOf(bodyFat, expected, '2-3/week');
  fixtures.coverage.lean_body_mass = coverageOf(lean, expected, '2-3/week');
  fixtures.coverage.basal_energy_burned = coverageOf(basal, expected, 'daily');
  fixtures.coverage.dietary_fiber = coverageOf(fiber, expected, 'daily');
  return fixtures;
}

const ADDED = ['body_fat_percentage', 'lean_body_mass', 'basal_energy_burned', 'dietary_fiber'];

/**
 * Splice the new series into the fixture file's text, after the opening of
 * `metrics` and `coverage`, so every existing byte (the fixture keeps values
 * such as `424.0` that a full re-serialisation would rewrite as `424`) stays
 * as it is.
 */
function spliceInto(text, block, entries) {
  const opening = `\n  "${block}": {\n`;
  const at = text.indexOf(opening);
  if (at < 0) throw new Error(`No "${block}" block in the fixture file.`);
  const body = entries
    .map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value, null, 2).replace(/\n/g, '\n    ')},\n`)
    .join('');
  const end = at + opening.length;
  return text.slice(0, end) + body + text.slice(end);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'health-fixtures.json');
  const text = readFileSync(path, 'utf8');
  const fixtures = JSON.parse(text);
  const present = ADDED.filter(k => k in fixtures.metrics);
  if (present.length) {
    console.log(`health-fixtures.json already has ${present.join(', ')}; nothing to do.`);
  } else {
    addBodySeries(fixtures);
    let out = spliceInto(text, 'metrics', ADDED.map(k => [k, fixtures.metrics[k]]));
    out = spliceInto(out, 'coverage', ADDED.map(k => [k, fixtures.coverage[k]]));
    JSON.parse(out);
    writeFileSync(path, out);
    console.log(`Added ${ADDED.join(', ')} to health-fixtures.json`);
  }
}
