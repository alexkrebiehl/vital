'use client';

// ── Set or edit the body goal ───────────────────────────
//
// A target (body weight or body-fat %) and, optionally, the reader's own pace.
// The recommended pace and what each choice means — the calorie target and the
// projected arrival — are previewed live from the same engine the page uses,
// so the reader sees the consequence before saving.

import { useMemo, useState } from 'react';
import { Button, Dialog, SegmentedControl } from '@/components/ui/primitives';
import { useUnits } from '@/components/ui/UnitsProvider';
import { useProfile } from '@/components/profile/ProfileProvider';
import { useDatasetMeta } from '@/components/data/DatasetProvider';
import { inputsFromDataset } from '@/lib/body-goal/dataset';
import { bodyGoalReport } from '@/lib/body-goal/report';
import { PHASE_LABEL } from '@/lib/body-goal/phase';
import { MAX_PACE_KG_PER_WEEK, TARGET_BOUNDS, type BodyGoal, type BodyGoalInput, type BodyGoalKind } from '@/lib/body-goal/types';
import { formatDayKeyLong } from '@/lib/analytics/windows';
import { formatKg, formatPct, formatRange, formatRate, formatWeeks, inputToKg, kgToInput, weightUnit } from './format';

type PaceChoice = 'recommended' | 'gentle' | 'faster' | 'custom';

const INPUT =
  'bg-surface border border-border rounded-control px-3 py-2 text-sm text-text-primary outline-none focus:ring-2 focus:ring-accent min-h-[44px] tnum w-32';

export function GoalDialog({
  open,
  onClose,
  existing,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  existing: BodyGoal | null;
  onSave: (input: BodyGoalInput, startNew: boolean) => Promise<unknown>;
}) {
  if (!open) return null;
  return (
    <Dialog open onClose={onClose} title={existing ? 'Edit your goal' : 'Set a goal'}>
      <GoalForm existing={existing} onClose={onClose} onSave={onSave} />
    </Dialog>
  );
}

function GoalForm({
  existing,
  onClose,
  onSave,
}: {
  existing: BodyGoal | null;
  onClose: () => void;
  onSave: (input: BodyGoalInput, startNew: boolean) => Promise<unknown>;
}) {
  const { units } = useUnits();
  const { profile } = useProfile();
  const meta = useDatasetMeta();
  const inputs = useMemo(
    () => inputsFromDataset(units, profile.sex),
    // The dataset is module state; its identity changes with the meta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [units, profile.sex, meta.generatedAt, meta.referenceKey]
  );

  // Where the reader is now, to seed the target and describe the choice.
  const now = useMemo(() => {
    const probe = bodyGoalReport(
      { id: 'probe', kind: 'weight', target: 70, paceKgPerWeek: null, startedOn: inputs.today, endedOn: null, status: 'active', revision: 0, updatedAt: '' },
      inputs
    );
    return { weightKg: probe.weight.current?.value ?? null, bodyFat: probe.composition.bodyFat?.value ?? null };
  }, [inputs]);

  const [kind, setKind] = useState<BodyGoalKind>(existing?.kind ?? (now.bodyFat !== null ? 'body_fat' : 'weight'));
  const initialTarget = (k: BodyGoalKind): string => {
    if (existing && existing.kind === k) return String(k === 'weight' ? kgToInput(existing.target, units) : existing.target);
    if (k === 'weight') return now.weightKg !== null ? String(kgToInput(now.weightKg, units)) : '';
    return now.bodyFat !== null ? String(Math.round(now.bodyFat)) : '';
  };
  const [target, setTarget] = useState(() => initialTarget(kind));
  const [paceChoice, setPaceChoice] = useState<PaceChoice>(existing?.paceKgPerWeek ? 'custom' : 'recommended');
  const [customPace, setCustomPace] = useState(existing?.paceKgPerWeek ? String(kgToInput(Math.abs(existing.paceKgPerWeek), units)) : '');
  const [startNew, setStartNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unit = kind === 'weight' ? weightUnit(units) : '%';
  const targetNumber = Number(target);
  const targetCanonical = kind === 'weight' ? inputToKg(targetNumber, units) : targetNumber;
  const bounds = TARGET_BOUNDS[kind];
  const targetValid = target.trim() !== '' && Number.isFinite(targetNumber) && targetCanonical >= bounds.min && targetCanonical <= bounds.max;

  // The draft at the recommended pace first: it supplies the band the presets are cut from.
  const draft = useMemo(() => {
    if (!targetValid) return null;
    const goal: BodyGoal = {
      id: 'draft', kind, target: targetCanonical, paceKgPerWeek: null, startedOn: existing && !startNew ? existing.startedOn : inputs.today,
      endedOn: null, status: 'active', revision: 0, updatedAt: '',
    };
    return bodyGoalReport(goal, inputs);
  }, [targetValid, kind, targetCanonical, existing, startNew, inputs]);

  const band = draft?.band ?? null;
  const weightKg = draft?.weight.current?.value ?? null;
  const presetKg = (pct: number) => (weightKg !== null ? (pct * weightKg) / 100 : null);
  // A pace only means something while moving toward a target the data can place.
  const paceApplies = band !== null && draft?.phase.phase != null && draft.phase.phase !== 'maintain';
  let paceKg: number | null = null;
  let paceError: string | null = null;
  if (paceApplies && paceChoice === 'gentle') paceKg = presetKg(band.minPct);
  if (paceApplies && paceChoice === 'faster') paceKg = presetKg(band.maxPct);
  if (paceApplies && paceChoice === 'custom') {
    const typed = Number(customPace);
    if (customPace.trim() === '' || !Number.isFinite(typed) || typed <= 0) paceError = 'Enter a pace per week.';
    else if (inputToKg(typed, units) > MAX_PACE_KG_PER_WEEK) paceError = `At most ${formatKg(MAX_PACE_KG_PER_WEEK, units)} a week.`;
    else paceKg = inputToKg(typed, units);
  }

  // The preview at the chosen pace.
  const preview = useMemo(() => {
    if (!draft || paceKg === null) return draft;
    return bodyGoalReport({ ...draft.goal, paceKgPerWeek: paceKg }, inputs);
  }, [draft, paceKg, inputs]);

  const phase = preview?.phase.phase ?? null;
  const signedPace = paceKg !== null && phase ? (phase === 'cut' ? -paceKg : paceKg) : null;
  const kindChanged = existing !== null && existing.kind !== kind;

  async function submit() {
    if (!targetValid || paceError) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ kind, target: Math.round(targetCanonical * 100) / 100, paceKgPerWeek: signedPace }, existing === null || startNew || kindChanged);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The goal could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-5"
      onSubmit={e => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-text-secondary mb-2">Goal</legend>
        <SegmentedControl
          ariaLabel="Goal type"
          value={kind}
          onChange={v => {
            const k = v as BodyGoalKind;
            setKind(k);
            setTarget(initialTarget(k));
          }}
          options={[
            { value: 'body_fat', label: 'Body fat %' },
            { value: 'weight', label: 'Body weight' },
          ]}
        />
        <div className="flex items-center gap-2 pt-2">
          <label className="text-sm text-text-primary" htmlFor="goal-target">Target</label>
          <input
            id="goal-target"
            type="number"
            inputMode="decimal"
            step={kind === 'weight' ? 0.5 : 0.5}
            value={target}
            onChange={e => setTarget(e.target.value)}
            className={INPUT}
            aria-describedby="goal-target-note"
          />
          <span className="text-sm text-text-secondary">{unit}</span>
        </div>
        <p id="goal-target-note" className="text-[11px] text-text-secondary leading-relaxed">
          {kind === 'weight'
            ? now.weightKg !== null ? `Your seven-day average is ${formatKg(now.weightKg, units)}.` : 'There is no recent weigh-in yet.'
            : now.bodyFat !== null ? `Your recent body-fat reading averages ${formatPct(now.bodyFat)}.` : 'There is no recent body-fat reading; a body-fat goal needs one to measure progress.'}
          {target.trim() !== '' && !targetValid && ` Enter a target between ${kind === 'weight' ? `${kgToInput(bounds.min, units)} and ${kgToInput(bounds.max, units)} ${unit}` : `${bounds.min} and ${bounds.max} %`}.`}
          {preview?.phase.phase && ` That makes this ${preview.phase.phase === 'maintain' ? 'a maintenance goal — you are already there' : `a ${PHASE_LABEL[preview.phase.phase].toLowerCase()} phase`}.`}
        </p>
      </fieldset>

      {band && phase && phase !== 'maintain' && (
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-text-secondary mb-2">Pace</legend>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Recommended: {band.minPct}–{band.maxPct} % of body weight a week
            {weightKg !== null && ` (${formatKg(presetKg(band.minPct)!, units)}–${formatKg(presetKg(band.maxPct)!, units)})`}. {band.basis}
          </p>
          <SegmentedControl
            ariaLabel="Pace"
            value={paceChoice}
            onChange={v => setPaceChoice(v as PaceChoice)}
            options={[
              { value: 'recommended', label: 'Recommended' },
              { value: 'gentle', label: 'Slower end' },
              { value: 'faster', label: 'Faster end' },
              { value: 'custom', label: 'My own' },
            ]}
          />
          {paceChoice === 'custom' && (
            <div className="flex items-center gap-2 pt-1">
              <label className="text-sm text-text-primary" htmlFor="goal-pace">{phase === 'cut' ? 'Lose' : 'Gain'}</label>
              <input
                id="goal-pace"
                type="number"
                inputMode="decimal"
                step={0.05}
                min={0}
                value={customPace}
                onChange={e => setCustomPace(e.target.value)}
                className={INPUT}
              />
              <span className="text-sm text-text-secondary">{weightUnit(units)} a week</span>
            </div>
          )}
          {paceError && paceChoice === 'custom' && customPace.trim() !== '' && <p className="text-[11px] text-category-attention">{paceError}</p>}
        </fieldset>
      )}

      {preview?.pace && preview.phase.phase && (
        <div className="rounded-control bg-surface-muted p-3 text-sm space-y-1">
          <p className="text-text-primary">
            {preview.phase.phase === 'maintain' ? 'Hold steady' : formatRate(preview.pace.kgPerWeek, units)}
            {preview.targets?.calories ? ` · about ${formatRange(preview.targets.calories, 'kcal')} a day` : ''}
          </p>
          {preview.projection?.chosen && (
            <p className="text-[11px] text-text-secondary">
              Projected to arrive in {formatWeeks(preview.projection.chosen.weeks)}, around {formatDayKeyLong(preview.projection.chosen.arrival)}, if the pace holds.
            </p>
          )}
          {!preview.targets?.calories && (
            <p className="text-[11px] text-text-secondary">A calorie target appears once there are enough logged days and weigh-ins to estimate maintenance.</p>
          )}
          {preview.pace.pct > 1 && preview.phase.phase === 'cut' && (
            <p className="text-[11px] text-category-attention">Above about 1 % of body weight a week, more of what is lost tends to be muscle.</p>
          )}
        </div>
      )}

      {existing && !kindChanged && (
        <label className="flex items-start gap-2 text-sm text-text-primary">
          <input type="checkbox" className="h-4 w-4 mt-0.5" checked={startNew} onChange={e => setStartNew(e.target.checked)} />
          <span>
            Start a new goal from today
            <span className="block text-[11px] text-text-secondary">
              The current goal is kept in your history and progress is measured from today. Otherwise this goal is changed in place and progress is still measured from {formatDayKeyLong(existing.startedOn)}.
            </span>
          </span>
        </label>
      )}

      {error && <p className="text-sm text-category-attention" role="alert">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!targetValid || (paceChoice === 'custom' && paceError !== null) || saving}>
          {saving ? 'Saving…' : 'Save goal'}
        </Button>
      </div>
    </form>
  );
}
