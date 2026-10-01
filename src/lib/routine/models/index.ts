// ── Progression-model registry ──────────────────────────
//
// Adding a discipline means one file in this folder, one entry here and one in
// PROGRESSION_MODEL_IDS / MODEL_PARAM_SPECS — no change to the plan schema.

import type { ProgressionModelId } from '../types';
import { loadModel } from './load';
import { maintainModel } from './maintain';
import { percentageModel } from './percentage';
import type { ProgressionModel } from './types';
import { variationModel } from './variation';
import { volumeModel } from './volume';

export const PROGRESSION_MODELS: Record<ProgressionModelId, ProgressionModel> = {
  variation: variationModel,
  load: loadModel,
  percentage: percentageModel,
  volume: volumeModel,
  maintain: maintainModel,
};

export type { Light, ModelEvaluation, ProgressRow, Readiness } from './types';
