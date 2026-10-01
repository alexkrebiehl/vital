// ── The MyChart (Epic) results layout ───────────────────────────────────────
//
// These tests build SYNTHETIC MyChart documents. No real patient document is
// stored in this repository: the fixture below reproduces the layout's geometry
// (two analyte columns, the value/flag split, the chart axis line, the narrative
// pages) with invented numbers and a placeholder patient.
//
// The layout is defined by GEOMETRY, so the fixture is built from positioned text
// runs rather than from a PDF: `buildLayout` is fed the same `DocumentLayout`
// shape the reader produces, which is exactly the seam the interpreter reads.

import { describe, expect, it } from 'vitest';
import type { DocumentLayout, LayoutLine } from './layout';
import type { PdfTextItem } from './pdf-items';
import {
  hasMyChartTable,
  interpretMyChart,
  isAxisLine,
  isMyChartResultsLayout,
  myChartPatient,
  mychartDocumentDate,
  parsePrintedInterval,
  valueRuns,
} from './mychart';

const MID = 306; // a page 612pt wide, so the left column is < 306 and the right > 306

function item(str: string, x: number, width = str.length * 5.4): PdfTextItem {
  return { str, x, y: 0, width, height: 9 };
}

/** One line at `y`, from `(text, x)` pairs. */
function line(page: number, lineNo: number, y: number, runs: [string, number][]): LayoutLine {
  const items = runs.map(([text, x]) => item(text, x));
  return { page, lineNo, y, items, text: runs.map(([text]) => text).join(' ') };
}

function layoutOf(lines: LayoutLine[], pages = 2): DocumentLayout {
  return {
    pages: Array.from({ length: pages }, (_, i) => ({
      page: i + 1,
      width: 612,
      height: 792,
      itemCount: 0,
      lineCount: 0,
    })),
    headers: [],
    blocks: [],
    lines,
    classified: [],
    warnings: [],
  };
}

/** The patient header MyChart prints at the top of the first page. */
const HEADER = line(1, 1, 760, [
  ['Name: Testpatient Placeholder | DOB: 1/1/2015 | MRN: M00000 | PCP: Example, MD', 47],
]);
const PANEL = line(1, 2, 700, [['CBC With Differential (Testpatient)', 54]]);
const COLLECTED = line(1, 3, 680, [['Collected on Jan 2, 2026 12:20 PM', 54]]);

/** A narrative page: prose that must produce NO rows. */
const NARRATIVE = [
  line(1, 4, 600, [['Here are the results of the recent blood testing.', 51]]),
  line(1, 5, 583, [['Related values:', 51]]),
  line(1, 6, 566, [['- Hemoglobin (HGB) 10.9 g/dL', 51]]),
  line(1, 7, 549, [['- Hematocrit (HCT) 34.9 %', 51]]),
];

/**
 * A two-row, two-column table, exactly the shape MyChart prints:
 *
 *   HGB              HCT
 *   Normal range: …  Normal range: …
 *   10.9Low          34.9Low
 *   11.511.5 15.515.5  3535 4545
 */
const TABLE = [
  line(2, 10, 700, [['HGB', 57], ['HCT', 318]]),
  line(2, 11, 683, [['Normal range: 11.5 - 15.5 g/dl', 57], ['Normal range: 35.0 - 45.0 %', 318]]),
  line(2, 12, 661, [['10.9', 71], ['Low', 104], ['34.9', 348], ['Low', 382]]),
  line(2, 13, 627, [['11.5', 108], ['11.5', 108], ['15.5', 227], ['15.5', 227], ['35', 373], ['35', 373], ['45', 491], ['45', 491]]),
  line(2, 14, 590, [['MCHC', 57], ['PLT', 318]]),
  line(2, 15, 573, [['Normal range: 31.0 - 37.0 g/dl', 57], ['Normal range: 150.00 - 400.00 K/ul', 318]]),
  line(2, 16, 551, [['31.2', 110], ['223', 403]]),
  line(2, 17, 517, [['31', 112], ['31', 112], ['37', 230], ['37', 230], ['150', 370], ['150', 370], ['400', 489], ['400', 489]]),
];

const DOC = layoutOf([...([HEADER, PANEL, COLLECTED] as LayoutLine[]), ...NARRATIVE, ...TABLE]);

describe('MyChart layout recognition', () => {
  it('recognises the layout from the patient header AND the table structure', () => {
    expect(isMyChartResultsLayout(DOC)).toBe(true);
    expect(hasMyChartTable(DOC)).toBe(true);
  });

  it('does not claim a document with a patient header but no table', () => {
    const noTable = layoutOf([HEADER, PANEL, ...NARRATIVE]);
    expect(hasMyChartTable(noTable)).toBe(false);
    expect(isMyChartResultsLayout(noTable)).toBe(false);
  });

  it('reads the patient header as provenance, wherever it sits', () => {
    const patient = myChartPatient(DOC);
    expect(patient?.name).toBe('Testpatient Placeholder');
    expect(patient?.mrn).toBe('M00000');
  });

  it('reads the collection date for the document', () => {
    expect(mychartDocumentDate(DOC)).toBe('2026-01-02');
  });
});

describe('parsing what the report prints', () => {
  it('reads a two-sided interval with its unit', () => {
    const parsed = parsePrintedInterval('Normal range: 11.5 - 15.5 g/dl');
    expect(parsed).toMatchObject({ low: 11.5, high: 15.5, unit: 'g/dl', oneSided: false });
  });

  it('reads an expectation the report states one-sidedly, without inventing a pair', () => {
    const parsed = parsePrintedInterval('Normal value: <1.0 mg/dL');
    expect(parsed?.high).toBe(1);
    expect(parsed?.low).toBeNull();
    expect(parsed?.oneSided).toBe(true);
  });

  it('does not read a plain value line as an interval', () => {
    expect(parsePrintedInterval('10.9 Low 34.9 Low')).toBeNull();
  });
});

describe('the value and its flag are read from geometry, not from the joined text', () => {
  it('splits `13.5` from `High` where the text concatenates them', () => {
    // The printed text is "13.58High": value 13.5, flag "High".
    const runs = valueRuns([item('13.58', 71), item('High', 104)]);
    expect(runs).toHaveLength(1);
    expect(runs[0].text).toBe('13.58');
    expect(runs[0].flag).toBe('High');
  });

  it('reads two values and two flags from one line', () => {
    const runs = valueRuns([item('10.9', 71), item('Low', 104), item('34.9', 348), item('Low', 382)]);
    expect(runs.map(run => run.text)).toEqual(['10.9', '34.9']);
    expect(runs.map(run => run.flag)).toEqual(['Low', 'Low']);
  });

  it('does not attach a distant word as a flag', () => {
    const runs = valueRuns([item('10.9', 71), item('Low', 400)]);
    expect(runs[0].flag).toBeNull();
  });
});

describe('the chart axis line is never a result', () => {
  it('recognises the doubled bounds as axis noise', () => {
    const interval = parsePrintedInterval('Normal range: 11.5 - 15.5 g/dl');
    const axis = [item('11.5', 108), item('11.5', 108), item('15.5', 227), item('15.5', 227)];
    expect(isAxisLine(axis, interval)).toBe(true);
  });

  it('does not mistake a real value line for axis noise', () => {
    const interval = parsePrintedInterval('Normal range: 11.5 - 15.5 g/dl');
    const values = [item('10.9', 71), item('Low', 104), item('34.9', 348), item('Low', 382)];
    expect(isAxisLine(values, interval)).toBe(false);
  });

  it('never turns an axis number into a value', () => {
    const rows = interpretMyChart(DOC).observations;
    // 15.5 and 11.5 are only ever axis bounds here; no row may carry them.
    expect(rows.some(row => row.value === 15.5 || row.value === 11.5)).toBe(false);
    // The real values are imported.
    expect(rows.map(row => row.value)).toEqual([10.9, 34.9, 31.2, 223]);
  });
});

describe('rows carry what the report printed', () => {
  const result = interpretMyChart(DOC);
  const rows = result.observations;

  it('attributes each value to the analyte name printed above it in its column', () => {
    expect(rows.map(row => [row.printedName, row.value])).toEqual([
      ['HGB', 10.9],
      ['HCT', 34.9],
      ['MCHC', 31.2],
      ['PLT', 223],
    ]);
  });

  it('carries the report’s own interval, unit and flag verbatim', () => {
    const hgb = rows.find(row => row.printedName === 'HGB')!;
    expect(hgb.refText).toBe('Normal range: 11.5 - 15.5 g/dl');
    expect(hgb.refLow).toBe(11.5);
    expect(hgb.refHigh).toBe(15.5);
    expect(hgb.unit).toBe('g/dl');
    expect(hgb.printedFlag).toBe('Low');
    expect(hgb.refSource).toBe('report');
    expect(hgb.resultOn).toBe('2026-01-02');
  });

  it('leaves a value with no printed flag unflagged rather than inferring one', () => {
    const plt = rows.find(row => row.printedName === 'PLT')!;
    expect(plt.printedFlag).toBeNull();
    expect(plt.value).toBe(223);
  });

  it('carries the analyte’s own key, not a raw label, as the registry key', () => {
    expect(rows.every(row => typeof row.analyteKey === 'string' && row.analyteKey.length > 0)).toBe(true);
    expect(rows.find(row => row.printedName === 'HGB')!.analyteKey).not.toBe('HGB');
  });
});

describe('the narrative pages produce no rows', () => {
  it('refuses the prose and the summary bullets instead of reading them as results', () => {
    const result = interpretMyChart(DOC);
    // Nothing resembling the narrative may appear as an observation.
    expect(
      result.observations.some(row => /Related values|Hemoglobin \(HGB\) 10\.9/.test(row.printedName))
    ).toBe(false);
    // The bullets quote 10.9 and 34.9 too; they must appear ONCE each, from the
    // table — not twice.
    expect(result.observations.filter(row => row.value === 10.9)).toHaveLength(1);
    expect(result.observations.filter(row => row.value === 34.9)).toHaveLength(1);
    expect(result.tablePages).toEqual([2]);
  });

  it('refuses the patient identity line rather than importing it', () => {
    const result = interpretMyChart(DOC);
    expect(result.rejections.some(rejection => rejection.reason === 'identity_line')).toBe(true);
  });
});

describe('a row with no numeric value is carried as text, never as a number', () => {
  it('imports a `Value` row with its stated expectation and no invented figure', () => {
    const rows = [
      line(2, 20, 400, [['CRP', 57]]),
      line(2, 21, 383, [['Normal value: <1.0 mg/dL', 51]]),
      line(2, 22, 360, [['Value', 70]]),
    ];
    const doc = layoutOf([HEADER, PANEL, COLLECTED, ...rows]);
    const result = interpretMyChart(doc);
    const row = result.observations.find(observation => observation.printedName === 'CRP');
    expect(row).toBeDefined();
    expect(row!.value).toBeNull();
    expect(row!.valueText).toBe('Value');
    expect(row!.refText).toBe('Normal value: <1.0 mg/dL');
    expect(row!.refSource).toBe('report');
  });

  it('joins a wrapped label over two lines into one name', () => {
    const rows = [
      line(2, 30, 400, [['INR', 51]]),
      line(2, 31, 383, [['ratio', 51]]),
      line(2, 32, 354, [['Value', 70]]),
      line(2, 33, 338, [['1.06', 70]]),
    ];
    const doc = layoutOf([HEADER, PANEL, COLLECTED, ...rows]);
    const result = interpretMyChart(doc);
    const row = result.observations[0];
    expect(row?.printedName).toBe('INR ratio');
    expect(row?.value).toBe(1.06);
    // No interval was printed for this row, and none is invented.
    expect(row?.refText).toBeNull();
    expect(row?.refSource).toBe('none');
  });
});
