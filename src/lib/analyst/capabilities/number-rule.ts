// ── The number rule (design §9.1) ───────────────────────
//
// Every numeric field a capability returns has a display string beside it, made by
// the registry formatters, so the model quotes a formatted figure and never
// re-derives one. This walker checks a result for it. A count, an offset and a
// coefficient are exempt by key name; a number that is not a finite number never
// passes (a missing value is left out, not sent as NaN or zero).

export const COUNT_KEYS: ReadonlySet<string> = new Set([
  'observations',
  'count',
  'total',
  'returned',
  'offset',
  'nextOffset',
  'nights',
  'sessions',
  'pairedDays',
  'coefficient',
  'limit',
]);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasDisplay = (o: Record<string, unknown>): boolean => typeof o.display === 'string' || isObject(o.display);

/** One line per violation, each naming the path. Empty when the result obeys the rule. */
export function numberRuleViolations(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    const bare = value.some(item => typeof item === 'number');
    return [
      ...(bare ? [`${path}: a list of bare numbers; give each value as an object with a display string`] : []),
      ...value.flatMap((item, i) => numberRuleViolations(item, `${path}[${i}]`)),
    ];
  }
  if (!isObject(value)) return [];
  const out: string[] = [];
  const displayed = hasDisplay(value);
  if ('display' in value && !displayed) out.push(`${path}.display: must be a string or an object of strings`);
  for (const [key, v] of Object.entries(value)) {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) out.push(`${path}.${key}: ${String(v)} is not a finite number`);
      else if (!COUNT_KEYS.has(key) && !displayed) out.push(`${path}.${key}: ${v} has no display string beside it`);
    } else if (key !== 'display') out.push(...numberRuleViolations(v, `${path}.${key}`));
  }
  return out;
}

/** For tests: throws with every violation. */
export function assertNumberRule(value: unknown): void {
  const found = numberRuleViolations(value);
  if (found.length) throw new Error(`The number rule is broken:\n${found.join('\n')}`);
}
