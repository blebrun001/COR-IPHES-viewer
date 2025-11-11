/**
 * Centralised application store with a shallow subscribe/update API.
 * The state shape is defined explicitly here to make downstream usage predictable.
 */
const listeners = new Set();

export function createEmptySearchIndex() {
  return {
    specimens: [],
    elements: [],
  };
}

export const createInitialState = () => ({
  // Selection state
  activeDatasetId: null,
  activeDatasetIdForB: null,
  activeModelKey: null,
  comparisonMode: false,
  comparisonModelAId: null,
  comparisonModelBId: null,
  stateBeforeComparison: null,

  // Dataset/model metadata
  allDatasets: [],
  currentMetadataDetail: null,
  datasetToken: 0,
  modelToken: 0,

  // Search / taxonomy
  taxonomySelectors: new Map(),
  taxonomyState: new Map(),
  taxonomyLevels: [],
  taxonomySupported: false,
  searchIndex: createEmptySearchIndex(),
  searchDebounceTimer: null,

  // Viewer/UI preferences (prepared for future migrations)
  viewerPreferences: {
    projectionMode: 'perspective',
    orbitMode: 'upright',
    texturesEnabled: true,
    normalizeScaleEnabled: true,
    wireframeEnabled: false,
    lightingEnabled: true,
    anaglyphEnabled: false,
    labelsVisible: true,
    clipping: {
      enabled: false,
      axis: 'x',
    },
  },

  // Async workflow hints
  datasetLoadStatus: 'idle', // idle | loading | ready | error
  modelLoadStatus: 'idle', // idle | loading | ready | error
});

let state = createInitialState();

/**
 * Returns a frozen snapshot of the full state.
 */
export function getInitialStateSnapshot() {
  const snapshot = createInitialState();
  return Object.freeze(snapshot);
}

/**
 * Returns a shallow copy of the current state snapshot.
 */
export function getState() {
  return { ...state };
}

/**
 * Performs a shallow merge of the provided partial state into the store.
 * Triggers subscribed listeners when at least one key changes.
 */
export function updateState(partialState = {}) {
  if (partialState === null || typeof partialState !== 'object') {
    throw new TypeError('updateState expects a plain object');
  }

  let hasChanged = false;

  Object.keys(partialState).forEach((key) => {
    const value = partialState[key];
    if (state[key] !== value) {
      state[key] = value;
      hasChanged = true;
    }
  });

  if (!hasChanged) {
    return state;
  }

  const snapshot = getState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      // Listener errors should not break the update cycle.
      console.error('[store] Listener failed', error);
    }
  });

  return snapshot;
}

/**
 * Resets the store back to its initial shape.
 */
export function resetState() {
  state = createInitialState();
  const snapshot = getState();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.error('[store] Listener failed during reset', error);
    }
  });
  return snapshot;
}

/**
 * Registers a listener invoked with the latest state after each update.
 * Returns an unsubscribe function to remove the listener.
 */
export function subscribe(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('subscribe expects a function');
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
