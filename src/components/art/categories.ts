// Category → colour token + label. One table so every page, hero and chart
// agrees on which hue means which part of the body.
export type ArtCategory =
  | 'overview' | 'cardiovascular' | 'activity' | 'sleep' | 'body'
  | 'nutrition' | 'recovery' | 'respiratory' | 'lab' | 'medication' | 'insight' | 'neutral';

export const CATEGORY_VAR: Record<ArtCategory, string> = {
  overview: 'var(--color-accent)',
  cardiovascular: 'var(--color-category-cardiovascular)',
  activity: 'var(--color-category-activity)',
  sleep: 'var(--color-category-sleep)',
  body: 'var(--color-category-body)',
  nutrition: 'var(--color-category-nutrition)',
  recovery: 'var(--color-category-recovery)',
  respiratory: 'var(--color-category-respiratory)',
  lab: 'var(--color-category-respiratory)',
  medication: 'var(--color-category-recovery)',
  insight: 'var(--color-category-attention)',
  neutral: 'var(--color-accent)',
};
