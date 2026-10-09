// ── Analyst tool: logged training sessions (SERVER ONLY) ──
//
// The strength sessions of the connected workout sources, newest first, for the
// last N days (default 42) or for a window of the model's choosing. At most 40 come
// back; when more match, the result says how many, and how to reach the others,
// instead of cutting the list without a word.

import { loadRoutineContext } from '../../routine/service';
import { nameKey } from '../../routine/records';
import { resolveWindow } from '../capabilities/window';
import { scrubForModel } from '../scrub';
import type { AnalystTool } from './index';

export const MAX_TRAINING_SESSIONS = 40;
const DEFAULT_DAYS = 42;

export const getTrainingSessions: AnalystTool = {
  name: 'get_training_sessions',
  kind: 'read',
  description:
    'Logged training sessions from a connected workout source, newest first: date, title, and each exercise with its working sets (reps, load, duration, distance, RPE) and notes. The last N days (default 42), or between start and end. At most 40 come back; page says how many matched. Optionally filter by exercise name.',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'integer', minimum: 1, maximum: 365, description: 'How many days back (default 42).' },
      start: { type: 'string', description: 'First day, YYYY-MM-DD. Give with end.' },
      end: { type: 'string', description: 'Last day, YYYY-MM-DD. Give with start.' },
      exercise: { type: 'string', maxLength: 80, description: 'Only sessions with an exercise whose name contains this text.' },
    },
    additionalProperties: false,
  },
  async run(args, ctx) {
    const rc = await loadRoutineContext(ctx.deps);
    const fail = (error: string) => ({ isError: true, content: { error } });

    let from: string;
    let to = rc.today;
    let clipped: string | undefined;
    if (args.start !== undefined || args.end !== undefined) {
      if (args.days !== undefined) return fail('Give either days or start and end, not both.');
      const w = resolveWindow({ start: args.start, end: args.end }, { refKey: rc.today, defaultLastDays: DEFAULT_DAYS });
      if (!w.ok) return fail(w.problems.join(' '));
      from = w.window.start;
      to = w.window.end;
      clipped = w.window.clipped;
    } else {
      const days = (args.days as number | undefined) ?? DEFAULT_DAYS;
      from = new Date(Date.parse(`${rc.today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    }

    const needle = typeof args.exercise === 'string' ? nameKey(args.exercise) : null;
    const matched = rc.training.sessions
      .filter(s => rc.dayOf(s.startTime) >= from && rc.dayOf(s.startTime) <= to)
      .filter(s => !needle || s.exercises.some(e => nameKey(e.name).includes(needle)))
      .reverse();
    const sessions = matched.slice(0, MAX_TRAINING_SESSIONS).map(s => ({
      date: rc.dayOf(s.startTime),
      title: s.title,
      exercises: s.exercises
        .filter(e => !needle || nameKey(e.name).includes(needle))
        .map(e => ({
          name: e.name,
          templateId: e.sourceTemplateId,
          load: e.loadMeaning,
          sets: e.sets.filter(x => x.kind !== 'warmup').map(x => [x.reps !== undefined ? `${x.reps} reps` : null, x.weightKg ? `${x.weightKg} kg` : null, x.durationS !== undefined ? `${x.durationS} s` : null, x.distanceM !== undefined ? `${x.distanceM} m` : null, x.rpe !== undefined ? `RPE ${x.rpe}` : null, x.kind !== 'normal' ? x.kind : null].filter(Boolean).join(' ')),
          ...(e.notes ? { notes: e.notes } : {}),
        })),
    }));
    return {
      content: {
        origin: rc.training.origin,
        sources: rc.training.statuses.map(s => ({ source: s.displayName, configured: s.configured || s.origin === 'demo', error: s.lastError === null ? null : scrubForModel(s.lastError) })),
        window: `${from} → ${to}`,
        ...(clipped ? { clipped } : {}),
        sessions,
        ...(matched.length > sessions.length
          ? { page: { returned: sessions.length, total: matched.length, how: `${sessions.length} of ${matched.length} shown, newest first. Give start and end (or exercise) to see the others.` } }
          : {}),
      },
    };
  },
};
