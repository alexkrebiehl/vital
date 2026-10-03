// What a question is about, decided from its words alone (pure).

import { LAB_TOPIC_RE, looksLikeLabQuestion } from './labSnapshot';

/**
 * True when the question is about lab results rather than a wearable reading: it uses a
 * lab word ("labs", "blood work", "panel", "cholesterol"…) or names a registered analyte.
 * Used to decide what to keep when the context has to be cut to fit.
 */
export function isLabQuestion(question: string): boolean {
  // `looksLikeLabQuestion` keeps "how much protein am I eating?" a nutrition question.
  return LAB_TOPIC_RE.test(question) || looksLikeLabQuestion(question);
}
