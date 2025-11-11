// Exposes memo-friendly accessors for reading pieces of the global viewer state.
import { getState } from './store.js';

// Allow selectors to accept optional snapshots or fall back to the live store.
const ensureState = (state) => {
  if (state && typeof state === 'object') {
    return state;
  }
  return getState();
};

export const selectActiveDatasetId = (state) => ensureState(state).activeDatasetId ?? null;

export const selectActiveDatasetIdForB = (state) =>
  ensureState(state).activeDatasetIdForB ?? null;

export const selectActiveModelKey = (state) => ensureState(state).activeModelKey ?? null;

export const selectAllDatasets = (state) => {
  const snapshot = ensureState(state);
  return Array.isArray(snapshot.allDatasets) ? snapshot.allDatasets : [];
};

export const selectComparisonMode = (state) => Boolean(ensureState(state).comparisonMode);

export const selectComparisonModelAId = (state) =>
  ensureState(state).comparisonModelAId ?? null;

export const selectComparisonModelBId = (state) =>
  ensureState(state).comparisonModelBId ?? null;

export const selectStateBeforeComparison = (state) =>
  ensureState(state).stateBeforeComparison ?? null;

export const selectCurrentMetadataDetail = (state) =>
  ensureState(state).currentMetadataDetail ?? null;

export const selectDatasetLoadStatus = (state) => ensureState(state).datasetLoadStatus || 'idle';

export const selectModelLoadStatus = (state) => ensureState(state).modelLoadStatus || 'idle';

export const selectHasActiveModel = (state) => {
  const snapshot = ensureState(state);
  return Boolean(snapshot.activeDatasetId && snapshot.activeModelKey);
};

export const selectViewerPreferences = (state) => {
  const snapshot = ensureState(state);
  return snapshot.viewerPreferences || {};
};

export const selectDatasetToken = (state) => {
  const value = ensureState(state).datasetToken;
  return Number(value) || 0;
};

export const selectModelToken = (state) => {
  const value = ensureState(state).modelToken;
  return Number(value) || 0;
};

const cloneMap = (value) => {
  if (value instanceof Map) {
    return new Map(value);
  }
  return new Map(value || []);
};

export const selectTaxonomySelectors = (state) =>
  cloneMap(ensureState(state).taxonomySelectors);

export const selectTaxonomyState = (state) => cloneMap(ensureState(state).taxonomyState);

export const selectTaxonomyLevels = (state) => {
  const levels = ensureState(state).taxonomyLevels;
  return Array.isArray(levels) ? levels.slice() : [];
};

export const selectTaxonomySupported = (state) =>
  Boolean(ensureState(state).taxonomySupported);

export const selectSearchIndex = (state) => {
  const snapshot = ensureState(state).searchIndex;
  if (!snapshot || typeof snapshot !== 'object') {
    return { specimens: [], elements: [] };
  }
  return {
    specimens: Array.isArray(snapshot.specimens) ? snapshot.specimens.slice() : [],
    elements: Array.isArray(snapshot.elements) ? snapshot.elements.slice() : [],
  };
};

export const selectSearchDebounceTimer = (state) =>
  ensureState(state).searchDebounceTimer ?? null;
