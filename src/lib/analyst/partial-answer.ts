// ── Partial answer, while it streams (SPEC §8) ──────────
//
// The analyst's answer is a JSON object, so the text that streams in is JSON
// cut off at an arbitrary point. Showing it raw defeats streaming; this reads
// whatever is complete so far — the title and the section lines, the last one
// still growing — so the reader sees the answer take shape.
//
// This is display only. The streamed text is never trusted as the answer: the
// finished reply still goes through parseAnalystReply and the grounding audit
// on the server, and the validated answer replaces this preview.
//
// Pure TypeScript with no server imports, so the client can use it.

/** What of the answer can be shown before it is complete. */
export interface PartialAnswer {
  title: string;
  observed: string[];
  interpretation: string[];
  uncertainty: string[];
}

interface Parsed {
  value: unknown;
  /** False when the text ended inside this value. */
  complete: boolean;
}

/**
 * Parse JSON that may be cut off. Returns what was read up to the end of the
 * text — a string ends where the text does, an array or object holds the items
 * read so far — or undefined when not even the start of a value was read.
 */
export function parsePartialJson(text: string): unknown {
  return new PartialParser(text).value()?.value;
}

class PartialParser {
  private i = 0;
  constructor(private readonly s: string) {}

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }

  private get end(): boolean {
    return this.i >= this.s.length;
  }

  value(): Parsed | undefined {
    this.ws();
    if (this.end) return undefined;
    const c = this.s[this.i];
    if (c === '{') return this.object();
    if (c === '[') return this.array();
    if (c === '"') return this.string();
    return this.literal();
  }

  private object(): Parsed {
    this.i++;
    const out: Record<string, unknown> = {};
    for (;;) {
      this.ws();
      if (this.end) return { value: out, complete: false };
      if (this.s[this.i] === '}') {
        this.i++;
        return { value: out, complete: true };
      }
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      if (this.s[this.i] !== '"') return { value: out, complete: false };
      const key = this.string();
      if (!key.complete) return { value: out, complete: false };
      this.ws();
      if (this.s[this.i] !== ':') return { value: out, complete: false };
      this.i++;
      const item = this.value();
      if (!item) return { value: out, complete: false };
      out[key.value as string] = item.value;
      if (!item.complete) return { value: out, complete: false };
    }
  }

  private array(): Parsed {
    this.i++;
    const out: unknown[] = [];
    for (;;) {
      this.ws();
      if (this.end) return { value: out, complete: false };
      if (this.s[this.i] === ']') {
        this.i++;
        return { value: out, complete: true };
      }
      if (this.s[this.i] === ',') {
        this.i++;
        continue;
      }
      const item = this.value();
      if (!item) return { value: out, complete: false };
      out.push(item.value);
      if (!item.complete) return { value: out, complete: false };
    }
  }

  private string(): Parsed {
    this.i++;
    let out = '';
    while (!this.end) {
      const c = this.s[this.i];
      if (c === '"') {
        this.i++;
        return { value: out, complete: true };
      }
      if (c !== '\\') {
        out += c;
        this.i++;
        continue;
      }
      // An escape cut off by the end of the text is dropped, not shown half-read.
      const next = this.s[this.i + 1];
      if (next === undefined) break;
      if (next === 'u') {
        const hex = this.s.slice(this.i + 2, this.i + 6);
        if (hex.length < 4) break;
        out += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : '';
        this.i += 6;
        continue;
      }
      out += ESCAPES[next] ?? next;
      this.i += 2;
    }
    this.i = this.s.length;
    return { value: out, complete: false };
  }

  private literal(): Parsed | undefined {
    const rest = this.s.slice(this.i);
    const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (number) {
      this.i += number[0].length;
      return { value: Number(number[0]), complete: !this.end };
    }
    for (const [word, value] of LITERALS) {
      if (rest.startsWith(word)) {
        this.i += word.length;
        return { value, complete: true };
      }
    }
    // A cut-off literal ("tr") or something that is not JSON: nothing to show.
    this.i = this.s.length;
    return undefined;
  }
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
const LITERALS: [string, unknown][] = [
  ['true', true],
  ['false', false],
  ['null', null],
];

function lines(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : [raw];
  return items.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

/**
 * The answer as far as it has streamed, or null when the text is not (yet) a
 * JSON object — a preamble before a tool call, or a prose reply, which the
 * caller shows as text. Text before the first `{` (a code fence, a sentence)
 * is skipped, as the server's parser skips it.
 */
export function partialAnswer(text: string): PartialAnswer | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const raw = parsePartialJson(text.slice(start));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  return {
    title: typeof source.title === 'string' ? source.title : '',
    observed: lines(source.observed),
    interpretation: lines(source.interpretation),
    uncertainty: lines(source.uncertainty),
  };
}
