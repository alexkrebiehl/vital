// ── labs.documents (SERVER ONLY) ────────────────────────────────────────────
//
// When the lab documents were produced and collected, by which lab, and how many
// results each holds. Never the file name, the content hash, the stored id, the
// notes or the extraction metadata, and a lab name that looks like a person is left
// out (the lab store's own identity test).

import { redact } from '../../../lab/extract/parse';
import type { ReportSummary } from '../../../db/lab-store';
import { scrubForModel } from '../../scrub';
import { manifestEntry } from '../manifest';
import { ok, pageRows, sourceUnavailable } from '../envelope';
import type { CapabilityContext, Coverage } from '../types';
import { guarded, type Args, type Read } from './common';
import { clean, nothing, NO_DATABASE } from './app-common';
import { readersOf } from './app-readers';
import { plural } from './medications-select';

const MAX_CHARS = 9_500;
const MAX_DOCUMENTS = 40;

/** The day a document is placed on: when it was produced, else when its results were collected. */
const dayOf = (r: ReportSummary): string | null => r.documentDate ?? r.lastResultOn;

function labName(name: string | null): string | undefined {
  // The lab store's redactor replaces a line that carries identity (a person's name, an address) wholesale.
  if (!name || redact(name) !== name.trim()) return undefined;
  return scrubForModel(name, 80);
}

function row(r: ReportSummary) {
  const collected = r.firstResultOn && r.lastResultOn ? (r.firstResultOn === r.lastResultOn ? r.firstResultOn : `${r.firstResultOn} to ${r.lastResultOn}`) : undefined;
  return clean({
    reportDate: r.documentDate,
    collected,
    lab: labName(r.labName),
    kind: r.kind,
    results: r.resultCount,
    display: { results: plural(r.resultCount, 'result') },
  });
}

function spanOf(reports: ReportSummary[]): Coverage {
  const days = reports.map(dayOf).filter((d): d is string => d !== null).sort();
  return { kind: 'known', first: days[0] ?? null, last: days[days.length - 1] ?? null, count: reports.length, unit: 'lab documents' };
}

export async function labDocumentsCoverage(ctx: CapabilityContext): Promise<Coverage> {
  try {
    const reports = await readersOf(ctx).labReports(ctx.env);
    return reports === null ? { kind: 'unavailable', reason: NO_DATABASE } : spanOf(reports);
  } catch (error) {
    return { kind: 'unavailable', reason: scrubForModel(error instanceof Error ? error.message : 'The lab documents could not be read.') };
  }
}

export function readLabDocuments(_args: Args, ctx: CapabilityContext): Promise<Read> {
  const entry = manifestEntry('labs.documents');
  return guarded(entry, ctx, async () => {
    const reports = await readersOf(ctx).labReports(ctx.env);
    if (reports === null) return sourceUnavailable(entry, `${NO_DATABASE} No lab document can be read.`);
    const coverage = spanOf(reports);
    if (reports.length === 0) return nothing(entry, 'No lab documents are stored: the app holds none at all.', coverage);
    const newest = [...reports].sort((a, b) => (dayOf(b) ?? '').localeCompare(dayOf(a) ?? ''));
    const { rows } = pageRows(newest, { limit: MAX_DOCUMENTS, offset: 0, maxChars: MAX_CHARS, render: row });
    const omitted = reports.length - rows.length;
    return ok(entry, { documents: rows, total: reports.length, ...(omitted > 0 ? { display: { omitted: `${plural(omitted, 'older document')} not shown` } } : {}) }, { coverage });
  });
}
