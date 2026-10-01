// ── The MyChart (Epic) results layout ───────────────────────────────────────
//
// A THIRD layout family, alongside the LabCorp trend matrix (./layout.ts) and
// the Quest results table (./quest.ts). A MyChart "Test Details" / "Test Results"
// export opens with a patient header, a panel title and a collection date, then
// (after any number of narrative pages) prints a result table whose rows come in
// small vertical groups of four lines:
//
//     HGB                                HCT                            ← names
//     Normal range: 11.5 - 15.5 g/dl      Normal range: 35.0 - 45.0 %   ← intervals
//     10.9Low                            34.9Low                        ← values + flags
//     11.511.5  15.515.5                 3535  4545                     ← chart axis
//
// TWO ANALYTES PER LINE. Every line of the table is printed TWO-WIDE: a left
// column at x≈51–57 and a right column at x≈318. A name line carries two names
// (`HGB` and `HCT`), an interval line two intervals, and a value line up to four
// runs — two values, each with its own flag. A run left of the page's midpoint
// belongs to the left analyte, a run right of it to the right one.
//
// WHAT IS GEOMETRY HERE. The value line's JOINED TEXT concatenates digits and
// flag (`10.9Low`, `13.58High`, `223`), which is ambiguous — `13.58High` is the
// value 13.5 followed by `High`. The line's ITEMS are not ambiguous: the value
// and its flag are separate runs at separate x (`10.9@71` … `Low@104`). Values
// are therefore read from items, never from `line.text`, and a flag is a run to
// the immediate right of a value within a small gap that is one of the report's
// own flag words.
//
// THE AXIS LINE IS NOT A RESULT. The fourth line prints each interval bound twice
// (`11.511.5 15.515.5`) because the document draws them on a chart axis. It is
// recognised as runs that are all numbers, each x repeated an even number of
// times, each duplicating a bound stated on the interval line above — and refused
// by name. It must never become a value or a second interval.
//
// THE NARRATIVE PAGES ARE NOT RESULTS. A MyChart export's opening pages are the
// clinician's letter and an auto-generated summary: prose, plus bullet lines that
// quote real values in passing (`- Alanine Aminotransferase (ALT) 214.0 IU/L`).
// Those bullets duplicate table rows and must not become observations. Rows are
// only ever built from the four-line group structure, so prose has no path to a
// row.
//
// WHAT IS CARRIED VERBATIM. `Normal range: 11.5 - 15.5 g/dl` is carried as the
// row's reference text with its own bounds and unit — it is the interval the
// reporting laboratory chose, and for a paediatric result it is the ONLY correct
// interval this app has (its registry holds no paediatric bands). The rule that a
// printed interval beats any fallback band holds here. The flag (`Low`, `High`,
// `Abnormal`) is carried verbatim as `printedFlag` and is CORROBORATION ONLY:
// status is decided from the printed interval by ../status.ts, so a flag can
// never silently override an interval that places the value inside it.
//
// A row whose report states an expectation rather than a pair (`Normal value:
// <1.0 mg/dL`, `Normal value: >75.00 mL/min/1.73m^2`) is carried with the bound
// the symbol actually states and the rest left null, so the expectation is
// visible without a number being invented.

import type { DocumentLayout, LayoutLine } from './layout';
import type { PdfTextItem } from './pdf-items';
import type {
  ExtractionRejection,
  ExtractionRejectionReason,
  ExtractionWarning,
  ExtractedObservation,
} from '../types';
import { analyteKeyFor, redact } from './parse';

/** The report's own flag words, as printed beside a value. */
export const MYCHART_FLAG_TOKENS = new Set(['low', 'high', 'abnormal']);

/** `Normal range: 11.5 - 15.5 g/dl` — the interval the laboratory chose. */
const NORMAL_RANGE = /^normal\s*range\s*:\s*(.*)$/i;

/**
 * `Normal value: <1.0 mg/dL`, `Normal value: >75.00 mL/min/1.73m^2` — an
 * expectation the report states without a low/high pair.
 */
const NORMAL_VALUE = /^normal\s*value\s*:\s*(.*)$/i;

/** `Nonfasting Range: 70-130 mg/dl` — an alternative interval form. */
const NONFASTING_RANGE = /^nonfasting\s*range\s*:\s*(.*)$/i;

/** `Name: <patient> | DOB: <date> | MRN: <number> | PCP: <name>` */
const PATIENT_HEADER = /\bName:\s*([^|]+)\|\s*DOB:\s*([^|]+)\|\s*MRN:\s*([^|]+)/i;

/** `Collected on Sep 29, 2026 12:20 PM` and the footer's `Collection date:…`. */
const COLLECTED_ON = /\bCollected on\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i;
const COLLECTION_DATE_FOOTER = /\bCollection date\s*:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})/i;

/** `<Panel name> (<Patient first name>)` — the panel, with the patient's first name. */
const PANEL_TITLE = /^(.{2,60}?)\s*\(([A-Z][a-z]+)\)\s*$/;

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** Footer and furniture lines: never results, always refused by name. */
const FURNITURE: { re: RegExp; reason: ExtractionRejectionReason }[] = [
  { re: /^MyChart®/i, reason: 'letterhead_line' },
  { re: /licensed from Epic Systems/i, reason: 'letterhead_line' },
  { re: /^Authorizing provider\s*:/i, reason: 'letterhead_line' },
  { re: /^(Collection|Result) date\s*:/i, reason: 'not_a_result_line' },
  { re: /^Collected on\b/i, reason: 'not_a_result_line' },
  { re: /^Per federal requirements\b/i, reason: 'notice_line' },
  { re: PATIENT_HEADER, reason: 'identity_line' },
  { re: /^Name:\s*/i, reason: 'identity_line' },
  { re: /^Results$/i, reason: 'document_title' },
];

export const MYCHART_KIND_REASON =
  'The document carries a MyChart (Epic) patient header and a per-analyte table of "Normal range:" intervals.';

export interface MyChartPatient {
  /** As printed. Recorded as provenance; the app does not match it to a profile. */
  name: string;
  dateOfBirth: string;
  mrn: string;
}

export interface MyChartInterpretation {
  observations: ExtractedObservation[];
  warnings: ExtractionWarning[];
  rejections: ExtractionRejection[];
  patient: MyChartPatient | null;
  panel: string | null;
  collectedOn: string | null;
  tablePages: number[];
}

// ── Recognition ─────────────────────────────────────────

/** The patient header, wherever it appears in the document. */
export function myChartPatient(layout: DocumentLayout): MyChartPatient | null {
  for (const line of layout.lines) {
    const match = PATIENT_HEADER.exec(line.text);
    if (match) {
      return { name: match[1].trim(), dateOfBirth: match[2].trim(), mrn: match[3].trim() };
    }
  }
  return null;
}

/**
 * True when the document prints at least one row in MyChart's group structure: a
 * line whose neighbour directly beneath it is an interval or a bare value.
 */
export function hasMyChartTable(layout: DocumentLayout): boolean {
  const lines = layout.lines;
  return lines.some((line, i) => {
    const next = lines[i + 1];
    if (next === undefined || next.page !== line.page) return false;
    if (next.y >= line.y || line.y - next.y > 30) return false;
    return (
      parsePrintedInterval(next.text) !== null ||
      /^(\d+(?:\.\d+)?|value)\s*(low|high|abnormal)?$/i.test(next.text.trim())
    );
  });
}

/**
 * The MyChart layout is recognised by its patient header AND its table
 * structure. Both are required: a patient header alone could head any export, and
 * a bare numeric line could appear on another vendor's report.
 */
export function isMyChartResultsLayout(layout: DocumentLayout): boolean {
  return myChartPatient(layout) !== null && hasMyChartTable(layout);
}

/** The panel title (`<Panel> (<First name>)`) and the collection date. */
export function myChartPanelAndDate(layout: DocumentLayout): {
  panel: string | null;
  collectedOn: string | null;
} {
  let panel: string | null = null;
  let collectedOn: string | null = null;
  for (const line of layout.lines) {
    const text = line.text.trim();
    if (panel === null) {
      const match = PANEL_TITLE.exec(text);
      if (match && !/[.!?]/.test(text)) panel = match[1].trim();
    }
    if (collectedOn === null) {
      const on = COLLECTED_ON.exec(text) ?? COLLECTION_DATE_FOOTER.exec(text);
      if (on) collectedOn = on[1];
    }
  }
  return { panel, collectedOn };
}

// ── Line-level parsing ──────────────────────────────────

export interface PrintedInterval {
  /** The interval exactly as printed after its label. */
  text: string;
  /** The label the report actually printed: `Normal range`, `Normal value`, … */
  label: string;
  low: number | null;
  high: number | null;
  unit: string | null;
  /** True when the report states an expectation rather than a low/high pair. */
  oneSided: boolean;
}

/** Parse any interval form MyChart prints, or null when the line is not one. */
export function parsePrintedInterval(text: string): PrintedInterval | null {
  const trimmed = text.trim();
  const range = NORMAL_RANGE.exec(trimmed);
  const single = NORMAL_VALUE.exec(trimmed) ?? NONFASTING_RANGE.exec(trimmed);
  const body = range ? range[1].trim() : single ? single[1].trim() : null;
  if (body === null) return null;
  // The label as printed, so a `Normal value:` line is never restated as a
  // `Normal range:` — the report's own wording is part of what is carried.
  const label = trimmed.slice(0, trimmed.indexOf(':')).trim();

  const bounds = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(body);
  if (bounds) {
    return {
      text: body,
      label,
      low: Number(bounds[1]),
      high: Number(bounds[2]),
      unit: bounds[3].trim() || null,
      oneSided: false,
    };
  }

  // `<1.0 mg/dL`, `>75.00 mL/min/1.73m^2`: an expectation, not a low/high pair.
  const expectation = /^([<>])\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(body);
  if (expectation) {
    return {
      text: body,
      label,
      low: expectation[1] === '>' ? Number(expectation[2]) : null,
      high: expectation[1] === '<' ? Number(expectation[2]) : null,
      unit: expectation[3].trim() || null,
      oneSided: true,
    };
  }

  return { text: body, label, low: null, high: null, unit: null, oneSided: true };
}

/**
 * True when a line is the chart's axis noise.
 *
 * Every run is a number, each x position repeats an even number of times, and
 * each printed number duplicates a bound stated on the interval line above.
 * `11.511.5 15.515.5` for `11.5 - 15.5`; `00 2323` for `0 - 23`.
 */
export function isAxisLine(items: PdfTextItem[], interval: PrintedInterval | null): boolean {
  const runs = items.filter(item => item.str.trim() !== '');
  if (runs.length < 2) return false;
  if (!runs.every(item => NUMERIC.test(item.str.trim()))) return false;

  const counts = new Map<number, number>();
  for (const run of runs) counts.set(run.x, (counts.get(run.x) ?? 0) + 1);
  if (![...counts.values()].every(count => count % 2 === 0)) return false;

  const printed = new Set(runs.map(run => run.str.trim()));
  const bounds = [interval?.low, interval?.high].filter((b): b is number => b != null);
  if (bounds.length === 0) return true;
  return bounds.every(bound => printed.has(`${bound}${bound}`) || printed.has(String(bound)));
}

/** A value run and the flag that may follow it, read from a line's items. */
export interface ValueRun {
  x: number;
  text: string;
  flag: string | null;
  numeric: boolean;
}

/** Read a line's items into value runs, left to right. */
export function valueRuns(items: PdfTextItem[]): ValueRun[] {
  const runs: ValueRun[] = [];
  const usable = items
    .filter(item => item.str.trim() !== '')
    .slice()
    .sort((a, b) => a.x - b.x);
  for (let i = 0; i < usable.length; i += 1) {
    const item = usable[i];
    const text = item.str.trim();
    const numeric = NUMERIC.test(text);
    const qualitative = /^(value|no value)$/i.test(text);
    if (!numeric && !qualitative) continue;
    const next = usable[i + 1];
    let flag: string | null = null;
    if (next && MYCHART_FLAG_TOKENS.has(next.str.trim().toLowerCase())) {
      const gap = next.x - (item.x + (item.width ?? 0));
      if (gap >= -2 && gap <= 45) flag = next.str.trim();
    }
    runs.push({ x: item.x, text, flag, numeric });
  }
  return runs;
}

// ── Interpretation ──────────────────────────────────────

function toIsoDate(printed: string | null): string | null {
  if (!printed) return null;
  const parsed = new Date(printed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * True when a run could be an analyte name.
 *
 * A label, not prose: short, no sentence punctuation, not a number or a flag, and
 * at most a few words. A narrative line quoted in passing must never be taken for
 * a name — that is what put `reasons, such as iron deficiency…` on a row.
 */
/**
 * True when a run continues a wrapped label rather than starting prose.
 *
 * `INR` over `ratio`, `Globulin` over `Total`: the continuation is lowercase and a
 * single short word. A wrapped SENTENCE fragment is also lowercase, so this is
 * only ever consulted for the line directly beneath a label line.
 */
function labelContinuation(text: string): boolean {
  const t = text.trim();
  if (!/^[a-z][a-z-]{1,14}$/.test(t)) return false;
  return !FURNITURE.some(item => item.re.test(t));
}

function nameLike(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (FURNITURE.some(item => item.re.test(t))) return false;
  // A label starts with a capital: prose fragments that wrap mid-sentence start
  // lowercase (`reasons, such as iron deficiency…`) and must not be taken for one.
  if (!/^[A-Z0-9]/.test(t)) return false;
  // A sentence ends with a full stop; a label does not. `ESR (Sed Rate), Automated`
  // and `C-Reactive Protein` keep their commas and brackets.
  if (/[.!?]\s*$/.test(t)) return false;
  if (/^\d+\.\s/.test(t)) return false;
  if (NUMERIC.test(t)) return false;
  if (MYCHART_FLAG_TOKENS.has(t.toLowerCase())) return false;
  if (/^normal (range|value)\s*:/i.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  // A label is a handful of words; a wrapped sentence fragment is many.
  return t.split(/\s+/).length <= 6;
}

interface ColumnName {
  text: string;
  x: number;
  y: number;
}

/**
 * True when `above` is the analyte label for the `value` line beneath it.
 *
 * Used by the qualitative shape, where the row prints a label and a `Value`
 * marker with no interval line between them: the label must be directly above,
 * be label-shaped, and share the value's column.
 */
function intervalLineAbove(above: LayoutLine, value: LayoutLine): boolean {
  if (above.page !== value.page) return false;
  if (above.y <= value.y) return false;
  // The label can sit one or two lines above the marker: `INR` / `ratio` / `Value`
  // is a 46pt drop, so the reach must cover two wrapped label lines.
  if (above.y - value.y > 60) return false;
  if (above.items.some(item => nameLike(item.str))) return true;
  // The label may wrap: `INR` over `ratio`, with the marker beneath both.
  return above.items.some(item => labelContinuation(item.str));
}

/**
 * Interpret a MyChart export.
 *
 * Anchors on each printed interval line, takes the name printed directly above it
 * in the SAME column (the page's midpoint separates the two columns), then reads
 * the value line beneath. Every line that is not part of that structure is
 * refused with a reason — prose, bullets and axis noise have no path to a row.
 */
export function interpretMyChart(layout: DocumentLayout): MyChartInterpretation {
  const observations: ExtractedObservation[] = [];
  const warnings: ExtractionWarning[] = [...layout.warnings];
  const rejections: ExtractionRejection[] = [];
  const tablePages: number[] = [];
  let qualitativeRead = 0;

  const patient = myChartPatient(layout);
  const { panel, collectedOn } = myChartPanelAndDate(layout);
  const resultOn = toIsoDate(collectedOn);

  const refuse = (
    line: LayoutLine,
    reason: ExtractionRejectionReason,
    text: string = redact(line.text)
  ) => {
    rejections.push({ page: line.page, lineNo: line.lineNo, text, reason });
  };

  for (const page of layout.pages) {
    const pageLines = layout.lines
      .filter(line => line.page === page.page)
      .sort((a, b) => b.y - a.y || a.lineNo - b.lineNo);
    const midX = page.width / 2;

    const intervalIdx = pageLines
      .map((line, i) => (parsePrintedInterval(line.text) ? i : -1))
      .filter(i => i >= 0);

    // A QUALITATIVE ROW prints a label and a `Value` marker instead of an
    // interval: the INR panel's `INR` / `ratio` / `Value` / `1.06`, and the CRP
    // panel's `Normal value: <1.0 mg/dL` / `Value`. Those rows are imported as
    // text with the bounds the report stated (or none): no number is invented for
    // them.
    //
    // The label may itself wrap (`INR` over `ratio`), so the row's name is the
    // label lines directly above the marker, joined in reading order.
    const qualitativeIdx = pageLines
      .map((line, i) => {
        if (parsePrintedInterval(line.text)) return -1;
        if (!valueRuns(line.items).some(run => !run.numeric)) return -1;
        if (i === 0) return -1;
        // A label sits directly above the marker.
        return intervalLineAbove(pageLines[i - 1], line) ? i : -1;
      })
      .filter(i => i >= 0);

    if (intervalIdx.length === 0 && qualitativeIdx.length === 0) {
      for (const line of pageLines) {
        const furniture = FURNITURE.find(item => item.re.test(line.text.trim()));
        refuse(line, furniture ? furniture.reason : 'not_a_result_line');
      }
      continue;
    }

    tablePages.push(page.page);
    const consumed = new Set<number>();

    for (const idx of intervalIdx) {
      const intervalLine = pageLines[idx];

      // One entry per interval printed on this line, keyed by its own column x.
      const intervalByColumn = intervalLine.items
        .filter(item => item.str.trim() !== '')
        .map(item => ({ x: item.x, interval: parsePrintedInterval(item.str) }))
        .filter((entry): entry is { x: number; interval: PrintedInterval } => entry.interval !== null);

      if (intervalByColumn.length === 0) {
        refuse(intervalLine, 'no_result');
        continue;
      }

      // The name printed directly above, in the same column.
      // The label sits above the interval line, but how far above varies: in the
      // two-column tables it is the next line (≈17pt), and in a single-analyte
      // panel it can be two lines up (≈30–45pt). The reach is therefore generous,
      // and the NEAREST label in y wins.
      const namesAbove: ColumnName[] = [];
      for (const candidate of pageLines) {
        if (candidate.y <= intervalLine.y) continue;
        if (intervalLine.y - candidate.y > 60) continue;
        for (const item of candidate.items) {
          if (!nameLike(item.str)) continue;
          const sameColumn = intervalByColumn.some(entry => (entry.x < midX) === (item.x < midX));
          if (sameColumn) namesAbove.push({ text: item.str.trim(), x: item.x, y: candidate.y });
        }
      }

      const valueLine =
        pageLines.slice(idx + 1).find(line => {
          if (parsePrintedInterval(line.text)) return false;
          if (intervalLine.y - line.y > 45) return false;
          if (valueRuns(line.items).length === 0) return false;
          // The axis line is number-only and must never be read as values.
          return !isAxisLine(line.items, intervalByColumn[0].interval);
        }) ?? null;

      const runs = valueLine ? valueRuns(valueLine.items) : [];

      // The page midpoint separates the columns ONLY when the line carries two
      // intervals. A single-analyte panel draws its value wherever the chart puts
      // it — `Normal range: 0 - 23 mm/Hr.` at x51 with its value `14` at x317 — so
      // with one interval the nearest run is the row's value, whichever half of
      // the page it sits in.
      const twoColumns = intervalByColumn.length > 1;
      const sameColumnAs = (entryX: number, otherX: number): boolean =>
        twoColumns ? (entryX < midX) === (otherX < midX) : true;

      for (const entry of intervalByColumn) {
        // The owning name is the label printed IMMEDIATELY above this interval in
        // this column — nearest in y first, and only then nearest in x. Sorting by
        // x alone made every row reuse the first name on the page.
        const nearest = namesAbove
          .filter(name => sameColumnAs(entry.x, name.x))
          .sort(
            (a, b) =>
              Math.abs(a.y - intervalLine.y) - Math.abs(b.y - intervalLine.y) ||
              Math.abs(a.x - entry.x) - Math.abs(b.x - entry.x)
          )[0];

        // A single-analyte panel prints its name as the PANEL TITLE at the top of
        // the page (`PT Screening (Alex)`, `ESR (Sed Rate), Automated (Alex)`)
        // and nothing beside the interval, so the panel name is the row's name.
        // The parenthesised first name is stripped: it is the patient, not a
        // qualifier.
        const owner: ColumnName | null =
          nearest ??
          (panel
            ? { text: panel.replace(/\s*\([^)]*\)\s*$/, '').trim(), x: entry.x, y: intervalLine.y }
            : null);
        if (!owner || !owner.text) {
          refuse(intervalLine, 'no_result');
          continue;
        }

        const run = runs
          .filter(candidate => sameColumnAs(entry.x, candidate.x))
          .sort((a, b) => Math.abs(a.x - entry.x) - Math.abs(b.x - entry.x))[0];

        if (!run) {
          warnings.push({
            code: 'unparsable_value',
            message: `${owner.text} prints an interval but no readable value beside it; it is not imported.`,
            page: intervalLine.page,
            line: intervalLine.lineNo,
          });
          continue;
        }

        if (!run.numeric) qualitativeRead += 1;
        consumed.add(intervalLine.lineNo);
        if (valueLine) consumed.add(valueLine.lineNo);

        observations.push({
          lineNo: intervalLine.lineNo,
          analyteKey: analyteKeyFor(owner.text),
          printedName: owner.text,
          panel,
          resultOn: resultOn ?? '',
          value: run.numeric ? Number(run.text) : null,
          valueText: run.numeric ? null : run.text,
          unit: entry.interval.unit,
          refLow: entry.interval.low,
          refHigh: entry.interval.high,
          refText: `${entry.interval.label}: ${entry.interval.text}`,
          printedFlag: run.flag,
          refSource: 'report',
          refBasis: null,
          category: null,
          extractionMethod: 'deterministic',
          confidence: null,
          sourceLine: redact(owner.text),
        });
      }
    }

    // The qualitative rows: a label (possibly wrapped over two lines) plus a
    // `Value` marker, and the value on the line beneath the marker when the
    // report prints it that way. The numeric value is kept when it is a real
    // number — `1.06` for the INR ratio — and the row still carries no invented
    // interval: its refText is whatever the report itself stated, or null.
    for (const idx of qualitativeIdx) {
      const marker = pageLines[idx];
      if (consumed.has(marker.lineNo)) continue;

      // The label: the label-shaped lines directly above the marker, in reading
      // order, joined (`INR` + `ratio`). Stop at anything else.
      const parts: ColumnName[] = [];
      for (let j = idx - 1; j >= 0; j -= 1) {
        const candidate = pageLines[j];
        if (marker.y - candidate.y > 60) break;
        // A label line is either label-shaped (`HGB`), or the lowercase
        // continuation of one directly above it (`ratio` under `INR`) — the
        // continuation is only accepted once a label has already been collected,
        // OR when the line above IT is label-shaped (which is how the pair is
        // seeded when the marker sits beneath only the continuation).
        const above = pageLines[j - 1];
        const gathersLabels =
          parts.length > 0 ||
          (above !== undefined &&
            above.items.some(item => nameLike(item.str)) &&
            candidate.items.some(item => labelContinuation(item.str)));
        let labels = candidate.items.filter(item => nameLike(item.str));
        if (labels.length === 0 && gathersLabels) {
          labels = candidate.items.filter(item => labelContinuation(item.str));
        }
        if (labels.length === 0) break;
        for (const item of labels) parts.push({ text: item.str.trim(), x: item.x, y: candidate.y });
      }
      const label = parts.reverse().map(part => part.text).join(' ');
      const owner = label || panel?.replace(/\s*\([^)]*\)\s*$/, '').trim() || null;
      if (!owner) {
        refuse(marker, 'no_result');
        continue;
      }

      // The value: the number on the marker's own line, or on the line directly
      // beneath it when the report prints the marker and the value separately.
      const onMarker = valueRuns(marker.items).filter(run => run.numeric);
      const below = pageLines.slice(idx + 1).find(candidate => {
        if (marker.y - candidate.y > 30) return false;
        return valueRuns(candidate.items).some(run => run.numeric);
      });
      const valueRun =
        onMarker[0] ??
        (below ? valueRuns(below.items).filter(run => run.numeric)[0] : undefined) ??
        null;

      // The report's own stated expectation, when it printed one near this row.
      const stated = pageLines
        .slice(0, idx)
        .map(candidate => parsePrintedInterval(candidate.text))
        .find(interval => interval !== null && interval.oneSided) ?? null;

      qualitativeRead += 1;
      consumed.add(marker.lineNo);
      if (below) consumed.add(below.lineNo);
      for (let j = idx - 1; j >= 0 && parts.length > 0; j -= 1) consumed.add(pageLines[j].lineNo);

      observations.push({
        lineNo: marker.lineNo,
        analyteKey: analyteKeyFor(owner),
        printedName: owner,
        panel,
        resultOn: resultOn ?? '',
        value: valueRun ? Number(valueRun.text) : null,
        valueText: valueRun ? null : 'Value',
        unit: stated?.unit ?? null,
        refLow: stated?.low ?? null,
        refHigh: stated?.high ?? null,
        refText: stated ? `${stated.label}: ${stated.text}` : null,
        printedFlag: valueRun?.flag ?? null,
        refSource: stated ? 'report' : 'none',
        refBasis: stated ? null : 'the report printed no reference interval for this row',
        category: null,
        extractionMethod: 'deterministic',
        confidence: null,
        sourceLine: redact(owner),
      });
    }

    // Everything else on the page is refused with its reason.
    for (const line of pageLines) {
      const furniture = FURNITURE.find(item => item.re.test(line.text.trim()));
      if (furniture) {
        refuse(line, furniture.reason);
        continue;
      }
      if (consumed.has(line.lineNo)) continue;
      if (line.items.length === 0) continue;
      if (parsePrintedInterval(line.text)) continue;
      if (line.items.some(item => nameLike(item.str))) continue;
      if (isAxisLine(line.items, null)) {
        refuse(line, 'non_metric_row');
        continue;
      }
      refuse(line, 'not_a_result_line');
    }
  }

  if (resultOn === null) {
    warnings.push({
      code: 'document_date_absent',
      message:
        'No collection date was found, so these rows carry no result date and cannot be imported.',
      page: 1,
      line: null,
    });
  }

  if (qualitativeRead > 0) {
    warnings.push({
      code: 'non_numeric_result',
      message: `${qualitativeRead} row${qualitativeRead === 1 ? '' : 's'} print text rather than a number and are carried as text with the report's own stated interval.`,
      page: 1,
      line: null,
    });
  }

  return { observations, warnings, rejections, patient, panel, collectedOn, tablePages };
}

/**
 * The document's collection date, ISO (YYYY-MM-DD), or null.
 *
 * A MyChart export states one collection date for the whole panel, exactly as
 * `questDocumentDate` is Quest's.
 */
export function mychartDocumentDate(layout: DocumentLayout): string | null {
  const { collectedOn } = myChartPanelAndDate(layout);
  return toIsoDate(collectedOn);
}

export { FURNITURE as MYCHART_FURNITURE };
