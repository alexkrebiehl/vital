// ── Plan patches ────────────────────────────────────────
//
// A small, generic edit language for the analyst's `update_training_plan` tool,
// so a change to one dose does not mean re-sending the whole plan.
//
//   { op: 'set',    path: 'focusAreas[push].paths[horizontal-push].stages[decline-push-up].advanceWhen', value: {…} }
//   { op: 'remove', path: 'focusAreas[core].paths[core].stages[hollow-hold]' }
//   { op: 'insert', path: 'focusAreas[push].paths[horizontal-push].stages', index: 3, value: {…} }
//
// A path is dot-separated keys; `key[x]` picks an array element by its `id`, or
// by position when `x` is a number. `insert` appends when `index` is omitted.
// Patches only move data around: the result is validated as a whole plan, so a
// patch can never produce something `validatePlan` would refuse.

export interface PlanOp {
  op: 'set' | 'remove' | 'insert';
  path: string;
  value?: unknown;
  index?: number;
}

export const MAX_PLAN_OPS = 24;

interface Segment {
  key: string;
  select: string | null;
}

function parsePath(path: string): Segment[] {
  if (typeof path !== 'string' || !path.trim()) throw new Error('path must be a non-empty string.');
  return path.split('.').map(part => {
    const m = /^([A-Za-z][A-Za-z0-9]*)(?:\[([^\]]+)\])?$/.exec(part.trim());
    if (!m) throw new Error(`"${part}" is not a path segment (use key or key[id-or-index]).`);
    return { key: m[1], select: m[2] ?? null };
  });
}

function pick(array: unknown[], select: string, where: string): number {
  if (/^\d+$/.test(select)) {
    const i = Number(select);
    if (i >= array.length) throw new Error(`${where}[${select}] is past the end (${array.length} items).`);
    return i;
  }
  const i = array.findIndex(x => x && typeof x === 'object' && (x as { id?: unknown }).id === select);
  if (i < 0) {
    const ids = array.map(x => (x && typeof x === 'object' ? (x as { id?: unknown }).id : undefined)).filter(Boolean);
    throw new Error(`${where} has no item with id "${select}"${ids.length ? ` (ids: ${ids.join(', ')})` : ''}.`);
  }
  return i;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** Apply ops to a copy of `plan`. Throws with a message naming the failing op. */
export function applyPlanOps(plan: unknown, ops: PlanOp[]): unknown {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('ops must be a non-empty array.');
  if (ops.length > MAX_PLAN_OPS) throw new Error(`At most ${MAX_PLAN_OPS} ops per change.`);
  const doc = structuredClone(plan) as Record<string, unknown>;
  ops.forEach((op, n) => {
    try {
      if (!op || !['set', 'remove', 'insert'].includes(op.op)) throw new Error('op must be "set", "remove" or "insert".');
      const segs = parsePath(op.path);
      let node: unknown = doc;
      let where = 'plan';
      for (const seg of segs.slice(0, -1)) {
        if (!isObj(node)) throw new Error(`${where} is not an object.`);
        let next = node[seg.key];
        where = `${where}.${seg.key}`;
        if (seg.select !== null) {
          if (!Array.isArray(next)) throw new Error(`${where} is not a list.`);
          next = next[pick(next, seg.select, where)];
          where = `${where}[${seg.select}]`;
        }
        if (next === undefined) throw new Error(`${where} does not exist.`);
        node = next;
      }
      const last = segs[segs.length - 1];
      if (!isObj(node)) throw new Error(`${where} is not an object.`);
      const target = `${where}.${last.key}`;

      if (op.op === 'insert') {
        if (last.select !== null) throw new Error('insert takes the path of a list (no [selector] on the last segment).');
        const list = node[last.key] ?? [];
        if (!Array.isArray(list)) throw new Error(`${target} is not a list.`);
        const at = op.index === undefined ? list.length : op.index;
        if (!Number.isInteger(at) || at < 0 || at > list.length) throw new Error(`index must be 0–${list.length}.`);
        list.splice(at, 0, op.value);
        node[last.key] = list;
        return;
      }
      if (last.select !== null) {
        const list = node[last.key];
        if (!Array.isArray(list)) throw new Error(`${target} is not a list.`);
        const i = pick(list, last.select, target);
        if (op.op === 'remove') list.splice(i, 1);
        else list[i] = op.value;
        return;
      }
      if (op.op === 'remove') delete node[last.key];
      else node[last.key] = op.value;
    } catch (error) {
      throw new Error(`ops[${n}] (${op?.op} ${op?.path}): ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return doc;
}
