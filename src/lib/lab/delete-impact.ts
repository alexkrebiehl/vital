// ── What deleting a lab report would take with it (SERVER + CLIENT SAFE) ────
//
// v0.3.1: deleting the LAST lab report removes the lab source, and a removed
// source's data is erased at once, so the analyst conversations that used lab
// results are deleted with it. Settings says so, with the number, BEFORE the
// delete. Counts only: no lab value is read.

import type { PoolLike } from '@/lib/db/pool';

export interface LabDeleteImpact {
  /** Lab reports stored now. */
  reports: number;
  /** Deleting any one report removes the lab source (exactly one is stored). */
  lastReport: boolean;
  /** Conversations that would be deleted: those tagged lab, and only when it is the last report. */
  conversations: number;
}

const COUNTS = `
  SELECT (SELECT count(*)::int FROM lab_reports) AS reports,
         (SELECT count(*)::int FROM analyst_conversations WHERE source_ids @> ARRAY['lab']::text[]) AS conversations
`;

export async function readLabDeleteImpact(client: PoolLike): Promise<LabDeleteImpact> {
  const row = (await client.query(COUNTS)).rows[0] ?? {};
  const reports = Number(row.reports ?? 0);
  const lastReport = reports === 1;
  return { reports, lastReport, conversations: lastReport ? Number(row.conversations ?? 0) : 0 };
}

/**
 * The confirmation text for a delete. `impact` is null when it could not be
 * read: the warning is then given without a number.
 */
export function deleteConfirmMessage(base: string, impact: LabDeleteImpact | null): string {
  const plain = `${base} Its observations are removed with it. This cannot be undone.`;
  if (impact && !impact.lastReport) return plain;
  const tail = 'Upload replacement reports first if you want to keep lab results available.';
  if (!impact) {
    return `${plain}\n\nIf this is your last lab report, the conversations that used lab results are deleted too. ${tail}`;
  }
  if (impact.conversations === 0) {
    return `${plain}\n\nThis is your last lab report. ${tail}`;
  }
  const noun = impact.conversations === 1 ? 'conversation' : 'conversations';
  return (
    `${plain}\n\nThis is your last lab report, so the ${impact.conversations} ${noun} that used lab results ` +
    `will be deleted with it, at once. Upload replacement reports first if you want to keep them.`
  );
}
