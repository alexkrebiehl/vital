// ── Goals: which recorded metrics bear on what the person is working toward ──
//
// The briefing used to describe the week the same way every day, which in practice
// meant sleep and recovery. The owner writes his goals in Settings; the briefing
// should be about THOSE. This module reads the goals text and returns the metric
// ids that bear on them, so the context builder can put those metrics first and the
// prompt can say what the briefing is about.
//
// It is deliberately a small, readable keyword map rather than anything clever:
// the result is deterministic (the same text always yields the same metrics), it
// can be unit-tested, and a goal it does not recognise simply falls back to the
// normal all-round briefing instead of guessing. The goals text itself still
// reaches the model as DATA; this only decides which measurements are in front.

interface GoalTopic {
  /** Stems matched against the lower-cased goals text. */
  match: RegExp;
  /** Metric ids that bear on the topic, most relevant first. */
  metrics: string[];
}

const TOPICS: GoalTopic[] = [
  {
    match: /\b(weight|lose|losing|slim|lean(er)?|fat|body ?comp|waist|bmi|cutting|bulk(ing)?|gain(ing)?)\b/,
    metrics: ['weight_body_mass', 'body_fat_percentage', 'lean_body_mass', 'waist_circumference', 'body_mass_index'],
  },
  {
    match: /\b(run|running|runner|jog|jogging|cardio|endurance|marathon|10k|5k|fitness|vo2( ?max)?|aerobic|stamina)\b/,
    metrics: ['vo2max', 'resting_heart_rate', 'cardio_recovery', 'walking_heart_rate', 'distance_walking_running', 'apple_exercise_time'],
  },
  {
    match: /\b(step|steps|walk|walking|active|activity|move|moving|exercise|exercising|workout|workouts|stand|stairs|flights)\b/,
    metrics: ['step_count', 'apple_exercise_time', 'active_energy', 'apple_stand_hours', 'distance_walking_running', 'flights_climbed'],
  },
  {
    match: /\b(strength|muscle|muscles|lift|lifting|gym|hypertrophy|train|training)\b/,
    metrics: ['lean_body_mass', 'apple_exercise_time', 'physical_effort', 'active_energy', 'weight_body_mass'],
  },
  {
    match: /\b(heart|cardiac|blood pressure|hypertension|pulse|resting heart|rhr|bp)\b/,
    metrics: ['resting_heart_rate', 'blood_pressure', 'heart_rate_variability', 'walking_heart_rate', 'cardio_recovery'],
  },
  {
    match: /\b(stress|stressed|calm|anxiety|hrv|variability|burnout|relax|relaxed)\b/,
    metrics: ['heart_rate_variability', 'resting_heart_rate', 'respiratory_rate', 'breathing_disturbances'],
  },
  {
    match: /\b(eat|eating|diet|nutrition|calorie|calories|protein|carb|carbs|sugar|macro|macros|food|intake)\b/,
    metrics: ['dietary_energy', 'dietary_protein', 'dietary_carbs', 'dietary_fat_total', 'dietary_sugar'],
  },
  {
    match: /\b(water|hydrate|hydrated|hydration|drink|drinking|caffeine|coffee)\b/,
    metrics: ['dietary_water', 'dietary_caffeine'],
  },
  {
    match: /\b(outside|outdoor|outdoors|daylight|sun|sunlight)\b/,
    metrics: ['time_in_daylight', 'step_count'],
  },
  {
    match: /\b(oxygen|spo2|breath|breathing|respiratory|altitude)\b/,
    metrics: ['blood_oxygen_saturation', 'respiratory_rate', 'breathing_disturbances'],
  },
];

const SLEEP_GOAL = /\b(sleep|sleeping|sleeps|bedtime|insomnia|rested|recovery|recover|recovering|nap|naps)\b|\bget(ting)? (more )?rest\b/;

export interface GoalFocus {
  /** Metric ids that bear on the stated goals, deduplicated, most relevant first. */
  metricIds: string[];
  /** True when the goals are, at least in part, about sleep or recovery. */
  sleepIsAGoal: boolean;
  /** True when the goals text recognised at least one topic. */
  recognised: boolean;
}

/** Read the goals text and say which measurements bear on it. */
export function goalFocus(goals: string | null | undefined): GoalFocus {
  const text = (goals ?? '').toLowerCase().trim();
  if (!text) return { metricIds: [], sleepIsAGoal: false, recognised: false };
  const ids: string[] = [];
  let recognised = false;
  for (const topic of TOPICS) {
    if (!topic.match.test(text)) continue;
    recognised = true;
    for (const id of topic.metrics) if (!ids.includes(id)) ids.push(id);
  }
  const sleepIsAGoal = SLEEP_GOAL.test(text);
  if (sleepIsAGoal) recognised = true;
  return { metricIds: ids, sleepIsAGoal, recognised };
}
