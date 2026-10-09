// ── Metric names the model gives, resolved against the registry (SERVER ONLY) ──
//
// Shared by every tool that takes a metric: get_metric_relationship and
// get_metric_series.

import { metricHasData } from '../../adapters/dataset';
import { getAllMetrics, getMetric, searchMetrics } from '../../metrics/registry';

const squash = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Ids the model may have meant: substring either way ignoring spaces and underscores, then shared words. */
export function suggest(name: string): string[] {
  const q = squash(name);
  if (q.length < 3) return [];
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  const candidates = getAllMetrics().filter(m => metricHasData(m.id));
  const names = (m: (typeof candidates)[number]) => [m.id, m.displayName, ...m.aliases].map(squash);
  const direct = candidates.filter(m => names(m).some(n => n.includes(q) || (n.length >= 4 && q.includes(n))));
  const byWord = candidates.filter(m => !direct.includes(m) && words.some(w => names(m).some(n => n.includes(w))));
  const found = [...direct, ...byWord, ...searchMetrics(name.trim()).filter(m => metricHasData(m.id))];
  return [...new Set(found.map(m => m.id))].slice(0, 5);
}

/** A metric id the model gave, resolved against the registry (id, display name or alias). */
export function resolveMetric(name: string): { id: string } | { error: string; didYouMean: string[] } {
  const raw = String(name).trim();
  if (getMetric(raw)) return { id: raw };
  const lowered = raw.toLowerCase();
  const exact = getAllMetrics().find(m => m.displayName.toLowerCase() === lowered || m.aliases.some(a => a.toLowerCase() === lowered));
  if (exact) return { id: exact.id };
  return { error: `No metric "${raw}". Use an id from the index.`, didYouMean: suggest(raw) };
}

/** Blood pressure is two numbers per reading (systolic and diastolic); the single-number tools leave it out. */
export const PAIRED_REASON =
  'Blood pressure is a pair of numbers per reading (systolic and diastolic). These tools summarise a single number, which would leave out half of it, so it is not summarised here. The Health page lists each reading as systolic/diastolic.';
