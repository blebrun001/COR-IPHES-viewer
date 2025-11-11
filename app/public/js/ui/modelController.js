// Coordinates dataset loading, comparison state, and viewer integration for selectors.
import {
  setActiveDataset as dispatchSetActiveDataset,
  setActiveDatasetForB as dispatchSetActiveDatasetForB,
  setAllDatasets as dispatchSetAllDatasets,
  setComparisonMode as dispatchSetComparisonMode,
  setComparisonModelA as dispatchSetComparisonModelA,
  setComparisonModelB as dispatchSetComparisonModelB,
  setCurrentMetadataDetail as dispatchSetCurrentMetadataDetail,
  setStateBeforeComparison as dispatchSetStateBeforeComparison,
  incrementDatasetToken as dispatchIncrementDatasetToken,
  incrementModelToken as dispatchIncrementModelToken,
} from '../state/actions.js';
import {
  selectActiveDatasetId,
  selectActiveDatasetIdForB,
  selectAllDatasets,
  selectComparisonMode,
  selectComparisonModelAId,
  selectComparisonModelBId,
  selectDatasetToken,
  selectModelToken,
  selectStateBeforeComparison,
} from '../state/selectors.js';

/**
 * Coordinates dataset caching, loading, and reset flows for the viewer UI.
 */

// ===== Cache =====
const CACHE_KEY = 'dataverseCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 2;

// ===== Internal State =====
let dataClientRef = null;
let windowRef = typeof window !== 'undefined' ? window : undefined;
let viewerApiRef = null;
let translateRef = (key, fallback = '') => fallback;
let escapeHtmlRef = (value) => String(value ?? '');
let setStatusRef = () => {};
let clearStatusRef = () => {};
let setProgressPercentRef = () => {};
let resetProgressPercentRef = () => {};
let datasetSelectRef = null;
let modelSelectRef = null;
let reloadButtonRef = null;
let compareButtonRef = null;
let toggleLabelsButtonRef = null;
let metadataRef = null;
let searchHandlersRef = null;
let searchInputRef = null;
let measurementOverlayRef = null;
let labelOverlayRef = null;
let setAllDatasetsRef = dispatchSetAllDatasets;
let setCurrentMetadataDetailRef = dispatchSetCurrentMetadataDetail;
let incrementDatasetTokenRef = dispatchIncrementDatasetToken;
let getDatasetTokenRef = () => selectDatasetToken();
let incrementModelTokenRef = dispatchIncrementModelToken;
let getModelTokenRef = () => selectModelToken();
let formatModelOptionLabelRef = null;
let getComparisonModeRef = () => selectComparisonMode();
let setComparisonModeRef = dispatchSetComparisonMode;
let getComparisonModelAIdRef = () => selectComparisonModelAId();
let setComparisonModelAIdRef = dispatchSetComparisonModelA;
let getComparisonModelBIdRef = () => selectComparisonModelBId();
let setComparisonModelBIdRef = dispatchSetComparisonModelB;
let getActiveDatasetIdRef = () => selectActiveDatasetId();
let setActiveDatasetIdRef = (value) => {
  dispatchSetActiveDataset(value);
};
let getActiveDatasetIdForBRef = () => selectActiveDatasetIdForB();
let setActiveDatasetIdForBRef = (value) => {
  dispatchSetActiveDatasetForB(value);
};
let getStateBeforeComparisonRef = () => selectStateBeforeComparison();
let setStateBeforeComparisonRef = (value) => {
  dispatchSetStateBeforeComparison(value);
};
let getAllDatasetsRef = () => selectAllDatasets();
let updateCompareButtonStateRef = () => {};
let updateProjectionButtonsRef = () => {};
let updateOrbitModeButtonsRef = () => {};
let updateTextureToggleButtonRef = () => {};
let updateWireframeButtonRef = () => {};
let updateLightingButtonRef = () => {};
let updateAnaglyphButtonRef = () => {};
let updateMeasureButtonRef = () => {};
let updateNormalizeScaleButtonRef = () => {};
let updateScaleReferenceButtonRef = () => {};
let setCustomStatusRef = () => {};
let getLastStatusRef = () => null;

const getTranslate = (key, fallback = '') =>
  typeof translateRef === 'function' ? translateRef(key, fallback) : fallback;

const getEscaped = (value) =>
  typeof escapeHtmlRef === 'function' ? escapeHtmlRef(value) : String(value ?? '');

const isCurrentToken = (token) =>
  typeof getDatasetTokenRef === 'function' ? token === getDatasetTokenRef() : true;

const isCurrentModelToken = (token) =>
  typeof getModelTokenRef === 'function' ? token === getModelTokenRef() : true;

const setAllDatasetsInternalSafe = (datasets) => {
  const next = Array.isArray(datasets) ? datasets : [];
  if (typeof setAllDatasetsRef === 'function') {
    setAllDatasetsRef(next);
  }
  return next;
};

const clearMetadataPanel = () => {
  if (metadataRef?.renderDatasetMetadata) {
    metadataRef.renderDatasetMetadata(null);
  }
  if (metadataRef?.updateExternalLinks) {
    metadataRef.updateExternalLinks(null);
  }
  if (typeof setCurrentMetadataDetailRef === 'function') {
    setCurrentMetadataDetailRef(null);
  }
};

// ===== Datasets =====
const loadDatasetsFromAPI = async ({ force = false, onProgress } = {}) => {
  if (!dataClientRef) {
    throw new Error('Data client not provided');
  }

  const datasets = await dataClientRef.listDatasets({ force, onProgress });
  const payload = {
    datasets,
    timestamp: Date.now(),
    version: CACHE_VERSION,
  };

  try {
    windowRef?.localStorage?.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Failed to store dataverse cache', error);
  }

  return datasets;
};

const loadDatasetsFromCache = () => {
  try {
    const raw = windowRef?.localStorage?.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.datasets || !cached.timestamp) return null;
    if (cached.version !== CACHE_VERSION) {
      return null;
    }
    if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
      return null;
    }
    return cached.datasets;
  } catch (error) {
    console.warn('Failed to read dataverse cache', error);
    return null;
  }
};

const clearDatasetsCache = () => {
  try {
    windowRef?.localStorage?.removeItem(CACHE_KEY);
  } catch (error) {
    console.warn('Failed to clear dataverse cache', error);
  }
};

const initDatasets = async ({ force = false } = {}) => {
  const currentToken =
    typeof incrementDatasetTokenRef === 'function' ? incrementDatasetTokenRef() : 0;

  setStatusRef('status.loadingDatasets');
  setProgressPercentRef(0);

  if (datasetSelectRef) {
    datasetSelectRef.disabled = true;
    const loadingDatasetsOption = getEscaped(
      getTranslate('selector.dataset.loading', 'Loading specimens...'),
    );
    datasetSelectRef.innerHTML = `<option value="">${loadingDatasetsOption}</option>`;
  }

  if (modelSelectRef) {
    modelSelectRef.disabled = true;
    const selectDatasetOption = getEscaped(
      getTranslate('selector.model.disabled', 'Select a specimen'),
    );
    modelSelectRef.innerHTML = `<option value="">${selectDatasetOption}</option>`;
  }

  if (reloadButtonRef) {
    reloadButtonRef.disabled = true;
  }

  searchHandlersRef?.resetTaxonomyState?.();
  setAllDatasetsInternalSafe([]);
  viewerApiRef?.clearScene?.({ preserveComparison: false });
  clearMetadataPanel();
  searchHandlersRef?.setTaxonomyVisibility?.(false);

  try {
    let datasets = null;
    if (!force) {
      datasets = loadDatasetsFromCache();
      if (datasets && isCurrentToken(currentToken)) {
        const normalizedDatasets = setAllDatasetsInternalSafe(datasets);
        searchHandlersRef?.initializeTaxonomySelectors?.(normalizedDatasets);
        searchHandlersRef?.refreshSpecimenOptions?.('status.datasetsLoadedFromCache');

        console.log('Datasets loaded from cache, building initial search index...');
        await searchHandlersRef?.buildSearchIndex?.();
        if (reloadButtonRef) {
          reloadButtonRef.disabled = false;
        }
        return;
      }
    }

    datasets = await loadDatasetsFromAPI({
      force: true,
      onProgress: (ratio) => {
        if (!isCurrentToken(currentToken)) {
          return;
        }
        if (typeof ratio === 'number' && !Number.isNaN(ratio)) {
          const percent = Math.min(100, Math.max(Math.round(ratio * 100), 0));
          setProgressPercentRef(percent);
        }
      },
    });

    if (!isCurrentToken(currentToken)) {
      return;
    }

    const normalizedDatasets = setAllDatasetsInternalSafe(datasets);
    searchHandlersRef?.initializeTaxonomySelectors?.(normalizedDatasets);
    searchHandlersRef?.refreshSpecimenOptions?.('status.datasetsLoadedFromAPI');

    console.log('Datasets loaded, building initial search index...');
    await searchHandlersRef?.buildSearchIndex?.();
  } catch (error) {
    console.error(error);
    if (isCurrentToken(currentToken)) {
      setStatusRef('status.datasetsLoadError', 'error');
    }
  } finally {
    if (!isCurrentToken(currentToken)) {
      return;
    }
    resetProgressPercentRef();
    if (reloadButtonRef) {
      reloadButtonRef.disabled = false;
    }
    updateCompareButtonStateRef?.();
  }
};

// ===== Modeles =====
const formatModelLabel = (model) => {
  if (typeof formatModelOptionLabelRef === 'function') {
    try {
      const label = formatModelOptionLabelRef(model);
      if (label) {
        return label;
      }
    } catch (error) {
      console.warn('Failed to format model option label', error);
    }
  }
  return model?.displayName || model?.label || model?.key || '';
};

const loadDatasetModelsForComparison = async (persistentId) => {
  if (!modelSelectRef) {
    return;
  }

  if (!persistentId) {
    setActiveDatasetIdForBRef?.(null);
    setComparisonModelBIdRef?.(null);
    const comparePrompt = getEscaped(
      getTranslate('selector.model.comparePrompt', 'Choose a model to compare...'),
    );
    modelSelectRef.innerHTML = `<option value="">${comparePrompt}</option>`;
    modelSelectRef.disabled = true;
    return;
  }

  try {
    setActiveDatasetIdForBRef?.(persistentId);
    modelSelectRef.disabled = true;
    const loadingModelsOption = getEscaped(
      getTranslate('selector.model.loading', 'Loading models...'),
    );
    modelSelectRef.innerHTML = `<option value="">${loadingModelsOption}</option>`;

    const entry = await dataClientRef.ensureDatasetPrepared(persistentId);
    const models = entry?.models ?? [];
    if (!models.length) {
      const noModelsOption = getEscaped(
        getTranslate('selector.model.none', 'No OBJ/MTL model found'),
      );
      modelSelectRef.innerHTML = `<option value="">${noModelsOption}</option>`;
      modelSelectRef.disabled = true;
      return;
    }

    const comparePrompt = getEscaped(
      getTranslate('selector.model.comparePrompt', 'Choose a model to compare...'),
    );
    const options =
      `<option value="">${comparePrompt}</option>` +
      models
        .map((model) => {
          const label = getEscaped(formatModelLabel(model));
          const value = getEscaped(model?.key ?? '');
          return `<option value="${value}">${label}</option>`;
        })
        .join('');

    modelSelectRef.innerHTML = options;
    modelSelectRef.disabled = false;
    modelSelectRef.value = '';
  } catch (error) {
    console.error('Failed to load models for comparison', error);
    const errorOption = getEscaped(getTranslate('selector.model.error', 'Loading error'));
    modelSelectRef.innerHTML = `<option value="">${errorOption}</option>`;
    modelSelectRef.disabled = true;
  }
};

const loadDatasetModels = async (persistentId) => {
  const currentToken =
    typeof incrementModelTokenRef === 'function' ? incrementModelTokenRef() : 0;

  if (!getComparisonModeRef()) {
    viewerApiRef?.clearScene?.({ preserveComparison: false });
  }

  if (!persistentId) {
    setActiveDatasetIdRef?.(null);
    setComparisonModelAIdRef?.(null);
    setComparisonModelBIdRef?.(null);
    if (modelSelectRef) {
      const selectDatasetOption = getEscaped(
        getTranslate('selector.model.disabled', 'Select a specimen'),
      );
      modelSelectRef.innerHTML = `<option value="">${selectDatasetOption}</option>`;
      modelSelectRef.disabled = true;
    }
    clearMetadataPanel();
    setStatusRef('status.selectDatasetAndModel', 'info');
    updateCompareButtonStateRef?.();
    return;
  }

  try {
    setActiveDatasetIdRef?.(persistentId);
    setComparisonModelAIdRef?.(null);
    setComparisonModelBIdRef?.(null);
    setStatusRef('status.loadingModelList');
    if (modelSelectRef) {
      modelSelectRef.disabled = true;
      const loadingModelsOption = getEscaped(
        getTranslate('selector.model.loading', 'Loading models...'),
      );
      modelSelectRef.innerHTML = `<option value="">${loadingModelsOption}</option>`;
    }

    const entry = await dataClientRef.ensureDatasetPrepared(persistentId);
    if (!isCurrentModelToken(currentToken)) {
      return;
    }

    const detail = entry?.detail ?? null;
    setCurrentMetadataDetailRef?.(detail);
    metadataRef?.renderDatasetMetadata?.(detail);
    metadataRef?.updateExternalLinks?.(detail);

    const models = entry?.models ?? [];
    if (!models.length) {
      if (modelSelectRef) {
        const noModelsOption = getEscaped(
          getTranslate('selector.model.none', 'No OBJ/MTL model found'),
        );
        modelSelectRef.innerHTML = `<option value="">${noModelsOption}</option>`;
        modelSelectRef.disabled = true;
      }
      setStatusRef('status.noModelsInDataset', 'info');
      return;
    }

    if (modelSelectRef) {
      const chooseModelOption = getEscaped(
        getTranslate('selector.model.placeholder', 'Choose a model...'),
      );
      const options =
        `<option value="">${chooseModelOption}</option>` +
        models
          .map((model) => {
            const label = getEscaped(formatModelLabel(model));
            const value = getEscaped(model?.key ?? '');
            return `<option value="${value}">${label}</option>`;
          })
          .join('');
      modelSelectRef.innerHTML = options;
      modelSelectRef.disabled = false;
    }
    setStatusRef('status.selectModel', 'info');
    await searchHandlersRef?.buildSearchIndex?.();
    updateCompareButtonStateRef?.();
  } catch (error) {
    console.error(error);
    if (isCurrentModelToken(currentToken) && modelSelectRef) {
      const loadErrorOption = getEscaped(
        getTranslate('selector.model.error', 'Load error'),
      );
      modelSelectRef.innerHTML = `<option value="">${loadErrorOption}</option>`;
      modelSelectRef.disabled = true;
    }
    if (isCurrentModelToken(currentToken)) {
      setStatusRef('status.datasetLoadFailure', 'error');
    }
    updateCompareButtonStateRef?.();
  }
};

const loadModel = async (persistentId, modelKey) => {
  const currentToken =
    typeof incrementModelTokenRef === 'function' ? incrementModelTokenRef() : 0;

  if (!persistentId || !modelKey) {
    setStatusRef('status.selectModel', 'info');
    return;
  }

  try {
    setStatusRef('status.loadingGeometry');
    const entry = await dataClientRef.ensureDatasetPrepared(persistentId);
    const modelInfo =
      entry?.modelMap && typeof entry.modelMap.get === 'function'
        ? entry.modelMap.get(modelKey)
        : null;
    const source = await dataClientRef.createModelSource(persistentId, modelKey);

    if (!isCurrentModelToken(currentToken)) {
      return;
    }

    if (typeof viewerApiRef?.displayPrimaryModel !== 'function') {
      throw new Error('viewerApi.displayPrimaryModel is not available');
    }
    await viewerApiRef.displayPrimaryModel(source);
    if (!isCurrentModelToken(currentToken)) {
      return;
    }

    clearStatusRef();
    let detail =
      typeof source?.getMetadataDetail === 'function'
        ? source.getMetadataDetail()
        : entry?.detail ??
          (typeof dataClientRef?.getDatasetMetadata === 'function'
            ? dataClientRef.getDatasetMetadata(persistentId)
            : null);

    setCurrentMetadataDetailRef?.(detail);
    setComparisonModelAIdRef?.({ datasetId: persistentId, modelKey });

    const allDatasets =
      typeof getAllDatasetsRef === 'function' ? getAllDatasetsRef() : [];
    const dataset = Array.isArray(allDatasets)
      ? allDatasets.find((d) => d.value === persistentId)
      : null;

    viewerApiRef?.setPrimaryModelMetadata?.({
      specimenName: dataset?.label || 'Unknown specimen',
      modelName: modelInfo?.displayName || source?.displayName || 'Unknown model',
    });

    const uberonContext = {
      objDirectory: source?.objDirectory,
      directory: modelInfo?.directory || modelInfo?.objEntry?.directory,
      displayName: modelInfo?.displayName || source?.displayName,
      objEntryDirectory: modelInfo?.objEntry?.directory,
      objEntryLabel: modelInfo?.objEntry?.file?.label,
      mtlDirectory: modelInfo?.mtlEntry?.directory,
      getPreferredTextureDirectory:
        typeof source?.getPreferredTextureDirectory === 'function'
          ? () => source.getPreferredTextureDirectory()
          : undefined,
    };

    metadataRef?.updateExternalLinks?.(detail, uberonContext);
  } catch (error) {
    console.error(error);
  }
};

// ===== Comparaison =====
const enterComparisonMode = async () => {
  if (getComparisonModeRef()) {
    return;
  }
  const activeDatasetId = typeof getActiveDatasetIdRef === 'function' ? getActiveDatasetIdRef() : null;
  const currentModelKey = modelSelectRef?.value ?? '';
  if (!activeDatasetId || !currentModelKey) {
    return;
  }

  console.log('=== Entering comparison mode ===');

  const snapshot = {
    datasetId: activeDatasetId,
    modelKey: currentModelKey,
    datasetSelectValue: datasetSelectRef?.value ?? '',
    modelSelectValue: currentModelKey,
    hasModel: Boolean(viewerApiRef?.hasActiveContent?.()),
  };
  setStateBeforeComparisonRef?.(snapshot);

  let activationSucceeded = true;
  if (typeof viewerApiRef?.enterComparisonSession === 'function') {
    activationSucceeded = viewerApiRef.enterComparisonSession({
      requirePrimaryModel: snapshot.hasModel,
    });
  } else {
    activationSucceeded = false;
  }

  if (!activationSucceeded) {
    console.warn('Viewer refused to enter comparison mode; aborting UI transition');
    setStateBeforeComparisonRef?.(null);
    return;
  }

  setComparisonModelAIdRef?.({ datasetId: activeDatasetId, modelKey: currentModelKey });
  setComparisonModelBIdRef?.(null);

  setComparisonModeRef(true);
  setActiveDatasetIdForBRef?.(activeDatasetId);

  updateNormalizeScaleButtonRef?.();

  if (toggleLabelsButtonRef) {
    toggleLabelsButtonRef.hidden = false;
    toggleLabelsButtonRef.setAttribute?.('aria-pressed', 'true');
  }

  if (datasetSelectRef) {
    datasetSelectRef.disabled = false;
  }

  updateCompareButtonStateRef?.();

  try {
    const entry = await dataClientRef.ensureDatasetPrepared(activeDatasetId);
    const models = entry?.models ?? [];
    if (modelSelectRef) {
      if (models.length > 0) {
        const comparePrompt = getEscaped(
          getTranslate('selector.model.comparePrompt', 'Choose a model to compare...'),
        );
        const options =
          `<option value="">${comparePrompt}</option>` +
          models
            .map((model) => {
              const label = getEscaped(formatModelLabel(model));
              const value = getEscaped(model?.key ?? '');
              return `<option value="${value}">${label}</option>`;
            })
            .join('');
        modelSelectRef.innerHTML = options;
        modelSelectRef.disabled = false;
        modelSelectRef.value = '';
      } else {
        console.warn('No models found for dataset:', activeDatasetId);
        const noModelsOption = getEscaped(
          getTranslate('selector.model.none', 'No models found'),
        );
        modelSelectRef.innerHTML = `<option value="">${noModelsOption}</option>`;
        modelSelectRef.disabled = true;
      }
    }
  } catch (error) {
    console.error('Failed to populate model selector for comparison', error);
    if (modelSelectRef) {
      const errorOption = getEscaped(getTranslate('selector.model.error', 'Loading error'));
      modelSelectRef.innerHTML = `<option value="">${errorOption}</option>`;
      modelSelectRef.disabled = true;
    }
  }
};

const resetInterfaceState = async ({ forceDatasetReload = false } = {}) => {
  console.log('=== Resetting interface state ===', { forceDatasetReload });

  searchHandlersRef?.cancelPendingSearch?.();

  setComparisonModeRef(false);
  setComparisonModelAIdRef?.(null);
  setComparisonModelBIdRef?.(null);
  setActiveDatasetIdForBRef?.(null);
  setActiveDatasetIdRef?.(null);
  setStateBeforeComparisonRef?.(null);

  if (forceDatasetReload) {
    clearDatasetsCache();
  }

  if (typeof viewerApiRef?.exitComparisonSession === 'function') {
    viewerApiRef.exitComparisonSession({ clearTarget: true });
  }
  viewerApiRef?.clearScene?.({ preserveComparison: false });
  viewerApiRef?.setProjectionMode?.('perspective', { refocus: false });
  viewerApiRef?.setOrbitMode?.('upright', { ensurePerspectiveForFree: false });
  viewerApiRef?.setTexturesVisibility?.(true);
  viewerApiRef?.setWireframeActive?.(false);
  viewerApiRef?.setLightsDimmed?.(false);
  viewerApiRef?.setAnaglyphEnabled?.(false);
  viewerApiRef?.setScaleReferenceVisible?.(false);
  viewerApiRef?.setRotationToolActive?.(false);
  viewerApiRef?.applyViewPreset?.('fit-active-content');
  viewerApiRef?.setMeasurementToolActive?.(false);
  viewerApiRef?.setLabelsVisible?.(false);
  if (typeof viewerApiRef?.setComparisonScaleNormalized === 'function') {
    viewerApiRef.setComparisonScaleNormalized(false);
  }

  viewerApiRef?.clearMeasurements?.();
  viewerApiRef?.clearLabels?.();

  updateProjectionButtonsRef?.();
  updateOrbitModeButtonsRef?.();
  updateTextureToggleButtonRef?.();
  updateWireframeButtonRef?.();
  updateLightingButtonRef?.();
  updateAnaglyphButtonRef?.();
  updateMeasureButtonRef?.();
  updateNormalizeScaleButtonRef?.();
  updateScaleReferenceButtonRef?.();

  if (toggleLabelsButtonRef) {
    toggleLabelsButtonRef.hidden = true;
    toggleLabelsButtonRef.setAttribute?.('aria-pressed', 'false');
  }

  if (compareButtonRef) {
    compareButtonRef.textContent = getTranslate('comparison.enterMode', 'Compare');
    compareButtonRef.disabled = true;
  }

  if (datasetSelectRef) {
    const loadingDatasetsOption = getEscaped(
      getTranslate('selector.dataset.loading', 'Loading specimens...'),
    );
    datasetSelectRef.innerHTML = `<option value="">${loadingDatasetsOption}</option>`;
    datasetSelectRef.value = '';
    datasetSelectRef.disabled = true;
  }

  if (modelSelectRef) {
    const selectDatasetOption = getEscaped(
      getTranslate('selector.model.disabled', 'Select a specimen'),
    );
    modelSelectRef.innerHTML = `<option value="">${selectDatasetOption}</option>`;
    modelSelectRef.value = '';
    modelSelectRef.disabled = true;
  }

  searchHandlersRef?.resetTaxonomyState?.();
  searchHandlersRef?.setTaxonomyCollapsed?.(true);
  searchHandlersRef?.setTaxonomyVisibility?.(false);
  searchHandlersRef?.resetSearchResults?.();
  searchHandlersRef?.clearSearchIndex?.();

  if (searchInputRef) {
    searchInputRef.value = '';
  }

  if (measurementOverlayRef) {
    measurementOverlayRef.innerHTML = '';
  }
  if (labelOverlayRef) {
    labelOverlayRef.innerHTML = '';
  }

  clearMetadataPanel();

  await initDatasets({ force: forceDatasetReload });
  setStatusRef('status.selectDatasetAndModel', 'info');
  updateCompareButtonStateRef?.();
  updateProjectionButtonsRef?.();
  updateOrbitModeButtonsRef?.();
  updateTextureToggleButtonRef?.();
  updateWireframeButtonRef?.();
  updateLightingButtonRef?.();
  updateAnaglyphButtonRef?.();
  updateMeasureButtonRef?.();
  updateNormalizeScaleButtonRef?.();
  updateScaleReferenceButtonRef?.();
};

const exitComparisonMode = async () => {
  if (!getComparisonModeRef()) {
    return;
  }
  console.log('=== RADICAL EXIT: Exiting comparison mode with complete reset ===');
  await resetInterfaceState({ forceDatasetReload: false });
};

const loadComparisonModelB = async (datasetId, modelKey) => {
  if (!getComparisonModeRef()) {
    return;
  }
  if (!datasetId || !modelKey) {
    return;
  }

  const modelA = typeof getComparisonModelAIdRef === 'function' ? getComparisonModelAIdRef() : null;
  if (
    modelA &&
    modelA.datasetId === datasetId &&
    modelA.modelKey === modelKey
  ) {
    const message = getTranslate(
      'comparison.sameModelError',
      'Please select a different model to compare',
    );
    setCustomStatusRef?.(message, 'error');
    const scheduler = windowRef?.setTimeout ?? ((fn, delay) => setTimeout(fn, delay));
    scheduler(() => {
      const previousStatus = typeof getLastStatusRef === 'function' ? getLastStatusRef() : null;
      if (previousStatus?.key) {
        setStatusRef(previousStatus.key, previousStatus.type);
      }
    }, 3000);
    return;
  }

  try {
    const entry = await dataClientRef.ensureDatasetPrepared(datasetId);
    const source = await dataClientRef.createModelSource(datasetId, modelKey);

    if (!source || !source.objUrl) {
      throw new Error(`Failed to create model source for ${datasetId}/${modelKey}`);
    }

    console.log('Loading comparison model B:', {
      datasetId,
      modelKey,
      objUrl: source.objUrl,
      objDirectory: source.objDirectory,
    });

    const modelInfo =
      entry?.modelMap && typeof entry.modelMap.get === 'function'
        ? entry.modelMap.get(modelKey)
        : null;
    const datasets =
      typeof getAllDatasetsRef === 'function' ? getAllDatasetsRef() : [];
    const dataset = Array.isArray(datasets)
      ? datasets.find((item) => item.value === datasetId)
      : null;

    const specimenName = dataset?.label || 'Unknown specimen';
    const modelName = modelInfo?.displayName || source?.displayName || 'Unknown model';
    if (typeof viewerApiRef?.displayComparisonTarget !== 'function') {
      throw new Error('viewerApi.displayComparisonTarget is not available');
    }
    await viewerApiRef.displayComparisonTarget(source, {
      specimenName,
      modelName,
    });

    const comparisonTargetLoaded =
      typeof viewerApiRef?.hasComparisonTarget === 'function'
        ? viewerApiRef.hasComparisonTarget()
        : false;

    if (comparisonTargetLoaded) {
      console.log('Model B successfully loaded and present in scene');
      setComparisonModelBIdRef?.({ datasetId, modelKey });
      clearStatusRef();
    } else {
      console.error('Model B not present in scene after load attempt');
      setCustomStatusRef?.(
        getTranslate('comparison.loadError', 'Failed to load comparison model'),
        'error',
      );
    }
  } catch (error) {
    console.error('Failed to load comparison model', error);
    const hasModel =
      typeof viewerApiRef?.hasComparisonTarget === 'function'
        ? viewerApiRef.hasComparisonTarget()
        : false;
    if (!hasModel) {
      setCustomStatusRef?.(
        getTranslate('comparison.loadError', 'Failed to load comparison model'),
        'error',
      );
    } else {
      console.warn(
        'Non-critical error during comparison model load, but model B is present:',
        error,
      );
      setComparisonModelBIdRef?.({ datasetId, modelKey });
      clearStatusRef();
    }
  }
};

// ===== Reset =====

/**
 * Initialises the model controller module.
 *
 * @param {object} deps - Dependency bag for the controller.
 * @returns {object} Public API for dataset/model management.
 */
export function initModelController(deps = {}) {
  dataClientRef = deps.dataClient ?? dataClientRef;
  windowRef = deps.windowRef ?? windowRef;
  viewerApiRef = deps.viewerApi ?? viewerApiRef;
  if (!viewerApiRef) {
    throw new Error('initModelController requires a viewerApi instance');
  }
  translateRef = typeof deps.translate === 'function' ? deps.translate : translateRef;
  escapeHtmlRef = typeof deps.escapeHtml === 'function' ? deps.escapeHtml : escapeHtmlRef;
  setStatusRef = typeof deps.setStatus === 'function' ? deps.setStatus : setStatusRef;
  clearStatusRef = typeof deps.clearStatus === 'function' ? deps.clearStatus : clearStatusRef;
  setProgressPercentRef =
    typeof deps.setProgressPercent === 'function' ? deps.setProgressPercent : setProgressPercentRef;
  resetProgressPercentRef =
    typeof deps.resetProgressPercent === 'function'
      ? deps.resetProgressPercent
      : resetProgressPercentRef;
  datasetSelectRef = deps.datasetSelect ?? datasetSelectRef;
  modelSelectRef = deps.modelSelect ?? modelSelectRef;
  reloadButtonRef = deps.reloadButton ?? reloadButtonRef;
  compareButtonRef = deps.compareButton ?? compareButtonRef;
  toggleLabelsButtonRef = deps.toggleLabelsButton ?? toggleLabelsButtonRef;
  searchInputRef = deps.searchInput ?? searchInputRef;
  measurementOverlayRef = deps.measurementOverlay ?? measurementOverlayRef;
  labelOverlayRef = deps.labelOverlay ?? labelOverlayRef;
  metadataRef = deps.metadata ?? metadataRef;
  searchHandlersRef = deps.searchHandlers ?? searchHandlersRef;
  setAllDatasetsRef =
    typeof deps.setAllDatasets === 'function' ? deps.setAllDatasets : setAllDatasetsRef;
  setCurrentMetadataDetailRef =
    typeof deps.setCurrentMetadataDetail === 'function'
      ? deps.setCurrentMetadataDetail
      : setCurrentMetadataDetailRef;
  incrementDatasetTokenRef =
    typeof deps.incrementDatasetToken === 'function'
      ? deps.incrementDatasetToken
      : incrementDatasetTokenRef;
  getDatasetTokenRef =
    typeof deps.getDatasetToken === 'function' ? deps.getDatasetToken : getDatasetTokenRef;
  incrementModelTokenRef =
    typeof deps.incrementModelToken === 'function'
      ? deps.incrementModelToken
      : incrementModelTokenRef;
  getModelTokenRef =
    typeof deps.getModelToken === 'function' ? deps.getModelToken : getModelTokenRef;
  formatModelOptionLabelRef =
    typeof deps.formatModelOptionLabel === 'function'
      ? deps.formatModelOptionLabel
      : formatModelOptionLabelRef;
  getComparisonModeRef =
    typeof deps.getComparisonMode === 'function' ? deps.getComparisonMode : getComparisonModeRef;
  setComparisonModeRef =
    typeof deps.setComparisonMode === 'function' ? deps.setComparisonMode : setComparisonModeRef;
  getComparisonModelAIdRef =
    typeof deps.getComparisonModelAId === 'function'
      ? deps.getComparisonModelAId
      : getComparisonModelAIdRef;
  setComparisonModelAIdRef =
    typeof deps.setComparisonModelAId === 'function'
      ? deps.setComparisonModelAId
      : setComparisonModelAIdRef;
  getComparisonModelBIdRef =
    typeof deps.getComparisonModelBId === 'function'
      ? deps.getComparisonModelBId
      : getComparisonModelBIdRef;
  setComparisonModelBIdRef =
    typeof deps.setComparisonModelBId === 'function'
      ? deps.setComparisonModelBId
      : setComparisonModelBIdRef;
  getActiveDatasetIdRef =
    typeof deps.getActiveDatasetId === 'function'
      ? deps.getActiveDatasetId
      : getActiveDatasetIdRef;
  setActiveDatasetIdRef =
    typeof deps.setActiveDatasetId === 'function'
      ? deps.setActiveDatasetId
      : setActiveDatasetIdRef;
  getActiveDatasetIdForBRef =
    typeof deps.getActiveDatasetIdForB === 'function'
      ? deps.getActiveDatasetIdForB
      : getActiveDatasetIdForBRef;
  setActiveDatasetIdForBRef =
    typeof deps.setActiveDatasetIdForB === 'function'
      ? deps.setActiveDatasetIdForB
      : setActiveDatasetIdForBRef;
  getStateBeforeComparisonRef =
    typeof deps.getStateBeforeComparison === 'function'
      ? deps.getStateBeforeComparison
      : getStateBeforeComparisonRef;
  setStateBeforeComparisonRef =
    typeof deps.setStateBeforeComparison === 'function'
      ? deps.setStateBeforeComparison
      : setStateBeforeComparisonRef;
  getAllDatasetsRef =
    typeof deps.getAllDatasets === 'function' ? deps.getAllDatasets : getAllDatasetsRef;
  updateCompareButtonStateRef =
    typeof deps.updateCompareButtonState === 'function'
      ? deps.updateCompareButtonState
      : updateCompareButtonStateRef;
  updateProjectionButtonsRef =
    typeof deps.updateProjectionButtons === 'function'
      ? deps.updateProjectionButtons
      : updateProjectionButtonsRef;
  updateOrbitModeButtonsRef =
    typeof deps.updateOrbitModeButtons === 'function'
      ? deps.updateOrbitModeButtons
      : updateOrbitModeButtonsRef;
  updateTextureToggleButtonRef =
    typeof deps.updateTextureToggleButton === 'function'
      ? deps.updateTextureToggleButton
      : updateTextureToggleButtonRef;
  updateWireframeButtonRef =
    typeof deps.updateWireframeButton === 'function'
      ? deps.updateWireframeButton
      : updateWireframeButtonRef;
  updateLightingButtonRef =
    typeof deps.updateLightingButton === 'function'
      ? deps.updateLightingButton
      : updateLightingButtonRef;
  updateAnaglyphButtonRef =
    typeof deps.updateAnaglyphButton === 'function'
      ? deps.updateAnaglyphButton
      : updateAnaglyphButtonRef;
  updateMeasureButtonRef =
    typeof deps.updateMeasureButton === 'function'
      ? deps.updateMeasureButton
      : updateMeasureButtonRef;
  updateNormalizeScaleButtonRef =
    typeof deps.updateNormalizeScaleButton === 'function'
      ? deps.updateNormalizeScaleButton
      : updateNormalizeScaleButtonRef;
  updateScaleReferenceButtonRef =
    typeof deps.updateScaleReferenceButton === 'function'
      ? deps.updateScaleReferenceButton
      : updateScaleReferenceButtonRef;
  setCustomStatusRef =
    typeof deps.setCustomStatus === 'function' ? deps.setCustomStatus : setCustomStatusRef;
  getLastStatusRef =
    typeof deps.getLastStatus === 'function' ? deps.getLastStatus : getLastStatusRef;

  return {
    initDatasets,
    clearDatasetsCache,
    loadDatasetsFromAPI,
    loadDatasetsFromCache,
    loadDatasetModels,
    loadDatasetModelsForComparison,
    loadModel,
    enterComparisonMode,
    exitComparisonMode,
    resetInterfaceState,
    loadComparisonModelB,
  };
}
