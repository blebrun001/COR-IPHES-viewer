// Defines state mutation helpers for the viewer's global store.
import { getState, updateState } from './store.js';

// Normalizes incoming values to trimmed strings or null.
const sanitizeNullableString = (value) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return value == null ? null : String(value);
};

// Safely extract dataset/model identifiers for comparison tracking.
const sanitizeComparisonModelReference = (value) => {
  if (!value) {
    return null;
  }
  const normalized = {};
  if (value.datasetId != null) {
    normalized.datasetId = sanitizeNullableString(value.datasetId);
  }
  if (value.modelKey != null) {
    normalized.modelKey = sanitizeNullableString(value.modelKey);
  }
  return normalized;
};

export function setAllDatasets(datasets) {
  const next = Array.isArray(datasets) ? datasets : [];
  updateState({ allDatasets: next });
  return next;
}

export function setActiveDataset(datasetId, options = {}) {
  const { resetActiveModel = true } = options;
  const nextDatasetId = sanitizeNullableString(datasetId);
  const { activeDatasetId: currentDatasetId } = getState();
  const partial = {
    activeDatasetId: nextDatasetId,
  };
  if (resetActiveModel && currentDatasetId !== nextDatasetId) {
    partial.activeModelKey = null;
  }
  updateState(partial);
  return nextDatasetId;
}

export function setActiveDatasetForB(datasetId) {
  const next = sanitizeNullableString(datasetId);
  updateState({ activeDatasetIdForB: next });
  return next;
}

export function setActiveModel(modelKey) {
  const next = sanitizeNullableString(modelKey);
  updateState({ activeModelKey: next });
  return next;
}

export function setComparisonMode(enabled) {
  const next = Boolean(enabled);
  updateState({ comparisonMode: next });
  return next;
}

export function enterComparisonMode(payload = {}) {
  const { stateBeforeComparison = null } = payload;
  updateState({
    comparisonMode: true,
    stateBeforeComparison: stateBeforeComparison ?? null,
  });
  return true;
}

export function exitComparisonMode() {
  updateState({
    comparisonMode: false,
    activeDatasetIdForB: null,
    comparisonModelBId: null,
    stateBeforeComparison: null,
  });
  return false;
}

export function setComparisonModelA(reference) {
  const normalized = sanitizeComparisonModelReference(reference);
  updateState({ comparisonModelAId: normalized });
  return normalized;
}

export function setComparisonModelB(reference) {
  const normalized = sanitizeComparisonModelReference(reference);
  updateState({ comparisonModelBId: normalized });
  return normalized;
}

export function setStateBeforeComparison(snapshot) {
  updateState({ stateBeforeComparison: snapshot ?? null });
  return snapshot ?? null;
}

export function setCurrentMetadataDetail(detail) {
  updateState({ currentMetadataDetail: detail ?? null });
  return detail ?? null;
}

export function setDatasetToken(value) {
  const next = Number.isFinite(value) ? value : 0;
  updateState({ datasetToken: next });
  return next;
}

export function resetDatasetToken() {
  return setDatasetToken(0);
}

export function incrementDatasetToken() {
  const { datasetToken } = getState();
  const next = (Number(datasetToken) || 0) + 1;
  updateState({ datasetToken: next });
  return next;
}

export function setModelToken(value) {
  const next = Number.isFinite(value) ? value : 0;
  updateState({ modelToken: next });
  return next;
}

export function resetModelToken() {
  return setModelToken(0);
}

export function incrementModelToken() {
  const { modelToken } = getState();
  const next = (Number(modelToken) || 0) + 1;
  updateState({ modelToken: next });
  return next;
}

export function setDatasetLoadStatus(status) {
  const allowed = new Set(['idle', 'loading', 'ready', 'error']);
  const next = allowed.has(status) ? status : 'idle';
  updateState({ datasetLoadStatus: next });
  return next;
}

export function setModelLoadStatus(status) {
  const allowed = new Set(['idle', 'loading', 'ready', 'error']);
  const next = allowed.has(status) ? status : 'idle';
  updateState({ modelLoadStatus: next });
  return next;
}

const toMap = (value) => (value instanceof Map ? new Map(value) : new Map(value || []));

export function setTaxonomySelectors(value) {
  const next = toMap(value);
  updateState({ taxonomySelectors: next });
  return next;
}

export function setTaxonomyState(value) {
  const next = toMap(value);
  updateState({ taxonomyState: next });
  return next;
}

export function setTaxonomyLevels(levels) {
  const next = Array.isArray(levels) ? levels.slice() : [];
  updateState({ taxonomyLevels: next });
  return next;
}

export function setTaxonomySupported(flag) {
  const next = Boolean(flag);
  updateState({ taxonomySupported: next });
  return next;
}

const normalizeSearchIndex = (value) => {
  if (!value || typeof value !== 'object') {
    return {
      specimens: [],
      elements: [],
    };
  }
  return {
    specimens: Array.isArray(value.specimens) ? value.specimens.slice() : [],
    elements: Array.isArray(value.elements) ? value.elements.slice() : [],
  };
};

export function setSearchIndex(value) {
  const next = normalizeSearchIndex(value);
  updateState({ searchIndex: next });
  return next;
}

export function clearSearchIndex() {
  return setSearchIndex({ specimens: [], elements: [] });
}

export function setSearchDebounceTimer(timer) {
  const next = timer ?? null;
  updateState({ searchDebounceTimer: next });
  return next;
}

export function resetSearchDebounceTimer() {
  return setSearchDebounceTimer(null);
}

export function resetTaxonomyState() {
  const emptyMap = new Map();
  updateState({
    taxonomySelectors: emptyMap,
    taxonomyState: new Map(),
    taxonomyLevels: [],
    taxonomySupported: false,
  });
  return {
    taxonomySelectors: emptyMap,
    taxonomyState: new Map(),
    taxonomyLevels: [],
    taxonomySupported: false,
  };
}
