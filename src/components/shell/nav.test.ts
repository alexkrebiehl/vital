import { describe, expect, it } from 'vitest';
import { DETAIL_ROUTES, NAV_SECTIONS, flattenNav, resolveTrail } from './nav';

const labels = (pathname: string) => resolveTrail(pathname).crumbs.map(c => c.label);

describe('resolveTrail', () => {
  it('gives a top-level page a single crumb, so no breadcrumb is shown', () => {
    expect(labels('/')).toEqual(['Overview']);
    expect(labels('/trends')).toEqual(['Trends']);
  });

  it("treats a section's landing page as the section, lighting its Overview page", () => {
    const trail = resolveTrail('/workouts');
    expect(trail.crumbs.map(c => c.label)).toEqual(['Workouts']);
    expect(trail.section?.id).toBe('workouts');
    expect(trail.page?.id).toBe('overview');
  });

  it('places the workouts pages under Workouts', () => {
    expect(labels('/workouts/all')).toEqual(['Workouts', 'History']);
    expect(labels('/workouts/recovery')).toEqual(['Workouts', 'Recovery']);
    expect(labels('/workouts/routine')).toEqual(['Workouts', 'Plan']);
    expect(resolveTrail('/workouts/all').page?.id).toBe('history');
  });

  it('places the activity maps under Activity, and the landing page as its Overview', () => {
    expect(labels('/activity/maps')).toEqual(['Activity', 'Maps']);
    expect(resolveTrail('/activity/maps').page?.id).toBe('maps');
    expect(labels('/activity')).toEqual(['Activity']);
    expect(resolveTrail('/activity').page?.id).toBe('overview');
  });

  it('places Nutrition under Body, and the Body landing page as its Overview', () => {
    expect(labels('/body/nutrition')).toEqual(['Body', 'Nutrition']);
    expect(resolveTrail('/body/nutrition').page?.id).toBe('nutrition');
    expect(labels('/body')).toEqual(['Body']);
    expect(resolveTrail('/body').page?.id).toBe('overview');
    expect(NAV_SECTIONS.some(s => s.id === 'nutrition')).toBe(false);
  });

  it('files a nutrition metric under Body › Nutrition and a body metric under Body', () => {
    const protein = resolveTrail('/metric/dietary_protein');
    expect(protein.section?.id).toBe('body');
    expect(protein.page?.id).toBe('nutrition');
    expect(protein.crumbs.map(c => c.label)).toEqual(['Body', 'Nutrition', 'Protein']);
    expect(labels('/metric/weight_body_mass')).toEqual(['Body', 'Weight']);
  });

  it('puts a progression path under the Plan, which stays the active page', () => {
    const trail = resolveTrail('/workouts/routine/pull-up');
    expect(trail.crumbs).toEqual([
      { label: 'Workouts', href: '/workouts' },
      { label: 'Plan', href: '/workouts/routine' },
      { label: 'Progression path', href: '/workouts/routine/pull-up' },
    ]);
    expect(trail.page?.id).toBe('plan');
  });

  it('reads a workout template as a workout, not as a path called "workouts"', () => {
    expect(labels('/workouts/routine/workouts/a')).toEqual(['Workouts', 'Plan', 'Workout']);
  });

  it("files a metric under its category's section, labelled by its name", () => {
    const trail = resolveTrail('/metric/sleep_analysis');
    expect(trail.section?.id).toBe('health');
    expect(trail.page?.id).toBe('sleep');
    expect(trail.crumbs.map(c => c.label)).toEqual(['Health', 'Sleep', 'Sleep']);
  });

  it('files an unknown metric under Overview, labelled by its id', () => {
    expect(labels('/metric/not_a_metric')).toEqual(['Overview', 'not_a_metric']);
  });

  it('labels a lab analyte by its registered name (alias keys too), and an unknown one by its key', () => {
    expect(labels('/lab/ldl_c')).toEqual(['Health', 'Lab', 'LDL cholesterol']);
    expect(labels('/lab/glucose~urine').slice(0, 2)).toEqual(['Health', 'Lab']);
    expect(labels('/lab/ldl')).toEqual(['Health', 'Lab', 'LDL cholesterol']);
    expect(labels('/lab/not_an_analyte')).toEqual(['Health', 'Lab', 'not_an_analyte']);
  });

  it('folds Lab, Medications and Sleep under Health, each lighting its own page', () => {
    for (const [path, page, label] of [
      ['/health', 'overview', 'Health'],
      ['/lab', 'lab', 'Lab'],
      ['/medications', 'medications', 'Medications'],
      ['/sleep', 'sleep', 'Sleep'],
    ] as const) {
      const trail = resolveTrail(path);
      expect(trail.section?.id).toBe('health');
      expect(trail.page?.id).toBe(page);
      expect(trail.crumbs.at(-1)?.label).toBe(label);
    }
    expect(labels('/sleep')).toEqual(['Health', 'Sleep']);
  });

  it('no longer lists those three as top-level rows, and keeps Body as its own section', () => {
    const ids = NAV_SECTIONS.map(s => s.id);
    for (const id of ['lab', 'medications', 'sleep']) expect(ids).not.toContain(id);
    expect(ids).toContain('body');
    expect(resolveTrail('/body/nutrition').section?.id).toBe('body');
  });

  it('matches on whole segments only', () => {
    expect(resolveTrail('/labs').section).toBeNull();
    expect(resolveTrail('/workoutsx').section).toBeNull();
  });

  it('ignores a trailing slash, a query and a hash', () => {
    expect(labels('/workouts/all/')).toEqual(['Workouts', 'History']);
    expect(resolveTrail('/settings?tab=data').section?.id).toBe('settings');
  });

  it('decodes a dynamic segment for its label', () => {
    expect(labels('/metric/not%20a%20metric').at(-1)).toBe('not a metric');
  });
});

describe('the registry', () => {
  it('names every destination once', () => {
    const hrefs = flattenNav().map(d => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const ids = NAV_SECTIONS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps every page inside its section's path, except Health's, which gathers its own", () => {
    for (const section of NAV_SECTIONS.filter(s => s.id !== 'health')) {
      for (const page of section.children ?? []) {
        expect(page.href === section.href || page.href.startsWith(`${section.href}/`)).toBe(true);
      }
    }
  });

  it('gives the pages inside a section distinct ids', () => {
    for (const section of NAV_SECTIONS) {
      const ids = (section.children ?? []).map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every detail route a parent that exists', () => {
    for (const route of DETAIL_ROUTES) {
      const sample = '/' + route.segments.map(s => (s.startsWith(':') ? 'x' : s)).join('/');
      expect(resolveTrail(sample).crumbs.at(-1)?.href).toBe(sample);
    }
  });
});
