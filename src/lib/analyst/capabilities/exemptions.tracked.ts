// ── Tracked exemptions: known gaps, each closed by a named gate ─
//
// design §1.3 is the inventory; §14 names the gates. A gate that closes a gap
// deletes its entries here and adds the key to a capability's `mirrors`.

import type { Exemption } from './exemptions';

const t = (kind: Exemption['kind'], key: string, reason: string): Exemption => ({ kind, key, reason, tracked: true });

export const TRACKED_EXEMPTIONS: readonly Exemption[] = [
  t('route', 'GET /api/activity-coverage', 'AN-D4: activity coverage has no tool yet (activity.coverage, via get_app_data).'),
  t('route', 'GET /api/activity-maps', 'AN-D4: saved map areas have no tool yet (activity.maps, via get_app_data).'),
  t('route', 'GET /api/briefing', 'AN-D4: the day\'s briefing has no tool yet (app.briefing, via get_app_data).'),
  t('route', 'GET /api/dashboard/cards', 'AN-D4: dashboard cards have no tool yet (app.dashboard, via get_app_data).'),
  t('route', 'GET /api/pipeline/quality', 'AN-D4: data-quality findings have no tool yet (app.data_quality, via get_app_data).'),
  t('route', 'GET /api/pipeline/status', 'AN-D4: pipeline and source status has no tool yet (app.pipeline, via get_app_data).'),
  t('route', 'GET /api/preferences', 'AN-D4: display preferences have no tool yet (app.preferences, via get_app_data).'),
  t('route', 'GET /api/profile', 'AN-D4: the profile notes the owner wrote have no tool yet (app.profile, via get_app_data).'),
  t('route', 'GET /api/routine/workouts/[templateId]', 'AN-D4: workout template detail has no tool yet (training.workout_template, via get_app_data).'),

  t('page', '/activity', 'AN-D4: activity coverage has no tool yet (activity.coverage, via get_app_data).'),
  t('page', '/activity/maps', 'AN-D4: saved map areas have no tool yet (activity.maps, via get_app_data).'),
  t('page', '/dashboard', 'AN-D4: dashboard cards have no tool yet (app.dashboard, via get_app_data).'),
  t('page', '/workouts/routine/workouts/[templateId]', 'AN-D4: workout template detail has no tool yet (training.workout_template, via get_app_data).')
];