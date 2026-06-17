/**
 * Orchestrates the UI layer: dataset/model selectors, metadata rendering,
 * viewer controls, and static English UI text.
 */
import { englishText } from '../text/english.js';
import initControllers from './controllers.js';
import { initSearch, formatModelOptionLabel, deriveUberonUrlFromModel } from './search.js';
import { initMetadata } from './metadata.js';
import { initMaterialControls } from './materialControls.js';
import { initInterfaceControls } from './interfaceControls.js';
import { initModelController } from './modelController.js';
import { initSyncManager } from './syncManager.js';
import { createTooltipService } from './tooltips.js';
import {
  setActiveDataset as dispatchSetActiveDataset,
  setActiveDatasetForB as dispatchSetActiveDatasetForB,
  setActiveModel as dispatchSetActiveModel,
  setAllDatasets as dispatchSetAllDatasets,
  setComparisonMode as dispatchSetComparisonMode,
  setComparisonModelA as dispatchSetComparisonModelA,
  setComparisonModelB as dispatchSetComparisonModelB,
  setCurrentMetadataDetail as dispatchSetCurrentMetadataDetail,
  resetDatasetToken as dispatchResetDatasetToken,
  resetModelToken as dispatchResetModelToken,
  incrementDatasetToken as dispatchIncrementDatasetToken,
  incrementModelToken as dispatchIncrementModelToken,
  setStateBeforeComparison as dispatchSetStateBeforeComparison,
  setTaxonomySelectors as dispatchSetTaxonomySelectors,
  setTaxonomyState as dispatchSetTaxonomyState,
  setTaxonomyLevels as dispatchSetTaxonomyLevels,
  setTaxonomySupported as dispatchSetTaxonomySupported,
  setSearchIndex as dispatchSetSearchIndex,
  setSearchDebounceTimer as dispatchSetSearchDebounceTimer,
  resetSearchDebounceTimer as dispatchResetSearchDebounceTimer,
} from '../state/actions.js';
import {
  selectActiveDatasetId,
  selectActiveDatasetIdForB,
  selectActiveModelKey,
  selectAllDatasets,
  selectComparisonMode,
  selectComparisonModelAId,
  selectComparisonModelBId,
  selectCurrentMetadataDetail,
  selectStateBeforeComparison,
  selectDatasetToken,
  selectModelToken,
  selectTaxonomySelectors,
  selectTaxonomyState,
  selectTaxonomyLevels,
  selectTaxonomySupported,
  selectSearchIndex,
  selectSearchDebounceTimer,
} from '../state/selectors.js';

let loadDatasetModelsDelegate = async () => {};
let loadDatasetModelsForComparisonDelegate = async () => {};
let loadModelDelegate = async () => {};
let loadComparisonModelBDelegate = async () => {};
let enterComparisonModeDelegate = async () => {};
let exitComparisonModeDelegate = async () => {};
let resetInterfaceStateDelegate = async () => {};

const searchStateAccessors = {
  getTaxonomySelectors: () => selectTaxonomySelectors(),
  setTaxonomySelectors: (value) => {
    dispatchSetTaxonomySelectors(value);
  },
  getTaxonomyState: () => selectTaxonomyState(),
  setTaxonomyState: (value) => {
    dispatchSetTaxonomyState(value);
  },
  getTaxonomyLevels: () => {
    return selectTaxonomyLevels();
  },
  setTaxonomyLevels: (value) => {
    dispatchSetTaxonomyLevels(value);
  },
  getTaxonomySupported: () => selectTaxonomySupported(),
  setTaxonomySupported: (value) => {
    dispatchSetTaxonomySupported(value);
  },
  getSearchIndex: () => {
    return selectSearchIndex();
  },
  setSearchIndex: (value) => {
    dispatchSetSearchIndex(value);
  },
  getSearchDebounceTimer: () => selectSearchDebounceTimer(),
  setSearchDebounceTimer: (value) => {
    if (value == null) {
      dispatchResetSearchDebounceTimer();
    } else {
      dispatchSetSearchDebounceTimer(value);
    }
  },
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>'"]/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[char] || char;
  });

/**
 * Helper wrapper to keep text lookups concise with a fallback string.
 *
 * @param {string} key - Text key to resolve.
 * @param {string} [fallback=''] - Text to use when no catalog entry is found.
 * @returns {string} Resolved English text or fallback.
 */
const translate = (key, fallback = '') => englishText.translate(key, { defaultValue: fallback });

const getAllDatasets = () => selectAllDatasets();
const setAllDatasets = (datasets) => {
  dispatchSetAllDatasets(datasets);
};

const getComparisonMode = () => selectComparisonMode();
const setComparisonMode = (value) => {
  dispatchSetComparisonMode(Boolean(value));
};

const getComparisonModelAId = () => selectComparisonModelAId();
const setComparisonModelAId = (value) => {
  dispatchSetComparisonModelA(value ?? null);
};

const getComparisonModelBId = () => selectComparisonModelBId();
const setComparisonModelBId = (value) => {
  dispatchSetComparisonModelB(value ?? null);
};

const getActiveDatasetId = () => selectActiveDatasetId();
const setActiveDatasetId = (value) => {
  const next = value ?? null;
  dispatchSetActiveDataset(next);
};

const getActiveDatasetIdForB = () => selectActiveDatasetIdForB();
const setActiveDatasetIdForB = (value) => {
  dispatchSetActiveDatasetForB(value ?? null);
};

const getStateBeforeComparison = () => selectStateBeforeComparison();
const setStateBeforeComparison = (value) => {
  dispatchSetStateBeforeComparison(value ?? null);
};

const getCurrentMetadataDetail = () => selectCurrentMetadataDetail();
const setCurrentMetadataDetail = (value) => {
  dispatchSetCurrentMetadataDetail(value ?? null);
};

const getActiveModelKey = () => selectActiveModelKey();
const setActiveModelKey = (value) => {
  dispatchSetActiveModel(value ?? null);
};

const incrementDatasetToken = () => {
  return dispatchIncrementDatasetToken();
};
const getDatasetToken = () => selectDatasetToken();

const incrementModelToken = () => {
  return dispatchIncrementModelToken();
};
const getModelToken = () => selectModelToken();

/**
 * Bootstraps the interactive UI: wires controls, translations, datasets, and viewer events.
 *
 * @param {object} options - Init options.
 * @param {object} options.viewerApi - High-level façade for the viewer.
 * @param {object} [options.dataClient] - Data client used to query Dataverse or the offline catalog.
 * @param {Document} [options.documentRef=document] - Document reference (facilitates testing).
 * @param {Window} [options.windowRef=window] - Window reference (facilitates testing).
 * @returns {Promise<{destroy: () => void}>} Cleanup handle.
 */
export async function initInterface({
  viewerApi,
  dataClient,
  documentRef = document,
  windowRef = window,
} = {}) {
  if (!viewerApi) {
    throw new Error('initInterface requires a viewerApi instance');
  }
  if (!dataClient) {
    throw new Error('initInterface requires a dataClient instance');
  }

  await englishText.init();

  const datasetSelect = documentRef.getElementById('datasetSelect');
  const modelSelect = documentRef.getElementById('modelSelect');
  const downloadSpecimenButton = documentRef.getElementById('downloadSpecimenButton');
  const reloadButton = documentRef.getElementById('reloadDatasets');
  const searchInput = documentRef.getElementById('searchInput');
  const searchResults = documentRef.getElementById('searchResults');
  const toggleTexturesButton = documentRef.getElementById('toggleTextures');
  const normalizeScaleButton = documentRef.getElementById('toggleNormalizeScale');
  const scaleReferenceButton = documentRef.getElementById('toggleScaleReference');
  const resetViewButton = documentRef.getElementById('resetView');
  const projectionModePerspectiveButton = documentRef.getElementById('projectionModePerspective');
  const projectionModeOrthographicButton = documentRef.getElementById('projectionModeOrthographic');
  const projectionModeButtons = [
    {
      button: projectionModePerspectiveButton,
      mode: 'perspective',
      labelKey: 'viewer.projection.perspective',
      fallback: 'Perspective',
    },
    {
      button: projectionModeOrthographicButton,
      mode: 'orthographic',
      labelKey: 'viewer.projection.orthographic',
      fallback: 'Orthographic',
    },
  ];
  const orbitModeUprightButton = documentRef.getElementById('orbitModeUpright');
  const orbitModeFreeButton = documentRef.getElementById('orbitModeFree');
  const orbitModeButtons = [
    {
      button: orbitModeUprightButton,
      mode: 'upright',
      labelKey: 'viewer.orbit.upright',
      fallback: 'Upright orbit',
    },
    {
      button: orbitModeFreeButton,
      mode: 'free',
      labelKey: 'viewer.orbit.free',
      fallback: 'Free orbit',
    },
  ];
  const statusBanner = documentRef.getElementById('status');
  const loadingOverlay = documentRef.getElementById('loadingOverlay');
  const metadataPanel = documentRef.getElementById('metadataPanel');
  const viewerContainer = documentRef.getElementById('viewer3D');
  const coraLink = documentRef.getElementById('coraLink');
  const gbifLink = documentRef.getElementById('gbifLink');
  const uberonLink = documentRef.getElementById('uberonLink');
  const wireframeButton = documentRef.getElementById('toggleWireframe');
  const clippingToggleButton = documentRef.getElementById('toggleClipping');
  const lightingButton = documentRef.getElementById('toggleLighting');
  const anaglyphButton = documentRef.getElementById('toggleAnaglyph');
  const screenshotButton = documentRef.getElementById('captureScreenshot');
  const fullscreenButton = documentRef.getElementById('toggleFullscreen');
  const measureToggleButton = documentRef.getElementById('toggleMeasure');
  const clearMeasurementsButton = documentRef.getElementById('clearMeasurements');
  const measurementOverlay = documentRef.getElementById('measurementOverlay');
  const compareButton = documentRef.getElementById('compareButton');
  const resetInterfaceButton = documentRef.getElementById('resetInterfaceButton');
  const toggleLabelsButton = documentRef.getElementById('toggleLabels');
  const labelOverlay = documentRef.getElementById('labelOverlay');
  const rotationGizmoButton = documentRef.getElementById('toggleRotationGizmo');
  const viewerToolbar = documentRef.getElementById('viewerToolbar');
  const viewerToolbarToggle = documentRef.getElementById('viewerToolbarToggle');
  const exitFullscreenButton = documentRef.getElementById('exitFullscreen');
  const viewerArea = documentRef.querySelector('.viewer-area');
  const topBar = documentRef.querySelector('.top-bar');
  const sidebar = documentRef.getElementById('appSidebar');
  const toggleSidebarButton = documentRef.getElementById('toggleSidebar');
  const optionsButton = documentRef.getElementById('optionsButton');
  const syncButton = documentRef.getElementById('syncButton');
  const closeOptionsButton = documentRef.getElementById('closeOptions');
  const screenshotBgToggle = documentRef.getElementById('screenshot-bg-toggle');
  const anaglyphEyeSeparation = documentRef.getElementById('anaglyphEyeSeparation');
  const reloadDatasetsButton = documentRef.getElementById('reloadDatasets');

  if (
    !datasetSelect ||
    !modelSelect ||
    !reloadButton ||
    !viewerContainer ||
    !searchInput ||
    !searchResults
  ) {
    throw new Error('Required UI elements are missing');
  }

  const tooltips = createTooltipService({ translate, documentRef, windowRef });
  const setTooltip = (element, key, fallback = '') => {
    if (!element) {
      return;
    }
    tooltips.setTooltip(element, { key, fallback });
  };
  tooltips.registerStaticTooltips(documentRef);
  [
    [toggleSidebarButton, 'header.tooltips.toggleSidebar', 'Toggle sidebar'],
    [datasetSelect, 'sidebar.tooltips.dataset', 'Select a specimen to load its models'],
    [modelSelect, 'sidebar.tooltips.model', 'Select an anatomical element'],
    [downloadSpecimenButton, 'sync.openDownloads', 'Download or inspect this specimen'],
    [reloadButton, 'sidebar.tooltips.reload', 'Reload page'],
    [resetInterfaceButton, 'sidebar.tooltips.reset', 'Reset interface state'],
    [gbifLink, 'sidebar.tooltips.gbif', 'Open GBIF entry'],
    [coraLink, 'sidebar.tooltips.cora', 'Open CORA-RDR entry'],
    [uberonLink, 'sidebar.tooltips.uberon', 'Open ontology entry'],
    [optionsButton, 'sidebar.tooltips.settings', 'Settings'],
    [syncButton, 'sidebar.tooltips.sync', 'Synchronize offline catalog'],
    [viewerToolbarToggle, 'viewer.toolbar.tooltips.toggle', 'Show or hide secondary controls'],
    [screenshotButton, 'viewer.buttons.capture', 'Capture'],
    [resetViewButton, 'viewer.buttons.resetView', 'Reset view'],
    [closeOptionsButton, 'options.tooltips.close', 'Close options'],
    [screenshotBgToggle, 'options.tooltips.screenshotBackground', 'Toggle screenshot background'],
    [anaglyphEyeSeparation, 'options.tooltips.anaglyph', 'Adjust anaglyph depth'],
    [reloadDatasetsButton, 'options.tooltips.reloadDatasets', 'Reload specimen list'],
  ].forEach(([element, key, fallback]) => setTooltip(element, key, fallback));

  const depsMetadata = {
    translate,
    metadataPanel,
    coraLink,
    gbifLink,
    uberonLink,
    deriveUberonUrlFromModel,
  };
  const metadata = initMetadata(depsMetadata);

  viewerContainer.innerHTML = '';
  viewerApi.mountIn?.(viewerContainer);
  if (measurementOverlay) {
    viewerApi.connectMeasurementOverlay?.(measurementOverlay);
  }
  if (labelOverlay) {
    viewerApi.connectLabelOverlay?.(labelOverlay);
  }

  const supportsClipping = Boolean(viewerApi?.isClippingAvailable?.());

  setComparisonMode(false);
  setComparisonModelAId(null);
  setComparisonModelBId(null);
  setAllDatasets([]);
  setActiveDatasetIdForB(null);
  setStateBeforeComparison(null);
  setActiveDatasetId(null);
  setActiveModelKey(null);
  dispatchResetDatasetToken();
  dispatchResetModelToken();
  setCurrentMetadataDetail(null);

  let isFullscreenActive = false;

  const materialControls = initMaterialControls({
    viewerApi,
    translate,
    supportsClipping,
    projectionModeButtons,
    orbitModeButtons,
    toggleTexturesButton,
    normalizeScaleButton,
    scaleReferenceButton,
    wireframeButton,
    lightingButton,
    anaglyphButton,
    measureToggleButton,
    clippingToggleButton,
    rotationGizmoButton,
    tooltipService: tooltips,
    getComparisonMode,
  });

  const {
    initialize: initializeMaterialControls,
    updateRotationGizmoButton,
    updateProjectionButtons,
    updateOrbitModeButtons,
    updateTextureToggleButton,
    updateNormalizeScaleButton,
    updateWireframeButton,
    updateScaleReferenceButton,
    updateLightingButton,
    updateAnaglyphButton,
    updateMeasureButton,
    updateClippingButton,
    syncClippingUI,
    disableClipping,
    disableAllClippingPlanes,
    enableSingleXClippingPlane,
    isXClippingActive,
    setRotationGizmoHasModel,
  } = materialControls;

  initializeMaterialControls();

  const interfaceControls = initInterfaceControls({
    viewerApi,
    translate,
    windowRef,
    viewerContainer,
    viewerToolbar,
    viewerToolbarToggle,
    statusBanner,
    loadingOverlay,
  });

  const {
    initialize: initializeInterfaceControls,
    isToolbarCollapsed,
    updateToolbarToggle,
    setToolbarCollapsed,
    syncToolbarForViewport,
    resizeViewer,
    renderStatus,
    setStatus,
    setCustomStatus,
    clearStatus,
    reapplyStatus,
    setProgressPercent,
    resetProgressPercent,
    getLastStatus,
  } = interfaceControls;

  initializeInterfaceControls();

  // Ensure the floating toolbar is horizontally centered over the 3D viewer area
  // even when a left sidebar is present or its state changes.
  const positionToolbar = () => {
    if (!viewerToolbar || !viewerArea) return;
    const rect = viewerArea.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    // Pin the toolbar to the visual center of the viewer area
    viewerToolbar.style.left = `${centerX}px`;
    // Constrain toolbar width to the viewer width (max 1100px)
    const maxWidth = 1100;
    const width = Math.min(rect.width, maxWidth);
    viewerToolbar.style.width = `${width}px`;
  };

  // Initial position after mount
  positionToolbar();

  const getFullscreenElement = () =>
    documentRef.fullscreenElement ||
    documentRef.webkitFullscreenElement ||
    documentRef.mozFullScreenElement ||
    documentRef.msFullscreenElement ||
    null;

  const updateFullscreenUI = (active) => {
    isFullscreenActive = Boolean(active);
    if (documentRef?.body) {
      documentRef.body.classList.toggle('is-fullscreen', isFullscreenActive);
    }
    if (sidebar) {
      sidebar.setAttribute('aria-hidden', isFullscreenActive ? 'true' : 'false');
    }
    if (topBar) {
      topBar.setAttribute('aria-hidden', isFullscreenActive ? 'true' : 'false');
    }
    if (fullscreenButton) {
      const key = isFullscreenActive
        ? 'viewer.buttons.exitFullscreen'
        : 'viewer.buttons.enterFullscreen';
      const fallback = isFullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen';
      const label = translate(key, fallback);
      fullscreenButton.setAttribute('aria-label', label);
      setTooltip(fullscreenButton, key, fallback);
      fullscreenButton.setAttribute('aria-pressed', isFullscreenActive ? 'true' : 'false');
      const iconSpan = fullscreenButton.querySelector('.viewer-toolbar__icon');
      if (iconSpan) {
        iconSpan.textContent = isFullscreenActive ? 'fullscreen_exit' : 'fullscreen';
      }
    }
    if (exitFullscreenButton) {
      exitFullscreenButton.hidden = !isFullscreenActive;
      exitFullscreenButton.setAttribute(
        'aria-label',
        translate('viewer.buttons.exitFullscreen', 'Exit fullscreen'),
      );
      setTooltip(exitFullscreenButton, 'viewer.buttons.exitFullscreen', 'Exit fullscreen');
    }
  };

  const requestFullscreenForViewer = async () => {
    if (!viewerArea) {
      updateFullscreenUI(true);
      resizeViewer();
      return;
    }
    const request =
      viewerArea.requestFullscreen ||
      viewerArea.webkitRequestFullscreen ||
      viewerArea.mozRequestFullScreen ||
      viewerArea.msRequestFullscreen;

    if (typeof request === 'function') {
      try {
        await request.call(viewerArea);
        return;
      } catch (error) {
        console.warn('Fullscreen request failed', error);
      }
    }
    updateFullscreenUI(true);
    resizeViewer();
    positionToolbar();
  };

  const exitFullscreenMode = async () => {
    const exit =
      documentRef.exitFullscreen ||
      documentRef.webkitExitFullscreen ||
      documentRef.mozCancelFullScreen ||
      documentRef.msExitFullscreen;

    if (typeof exit === 'function' && getFullscreenElement()) {
      try {
        await exit.call(documentRef);
        return;
      } catch (error) {
        console.warn('Fullscreen exit failed', error);
      }
    }
    updateFullscreenUI(false);
    resizeViewer();
    positionToolbar();
  };

  const handleFullscreenToggle = () => {
    if (isFullscreenActive && getFullscreenElement() === viewerArea) {
      exitFullscreenMode();
    } else if (isFullscreenActive) {
      updateFullscreenUI(false);
      resizeViewer();
    } else {
      requestFullscreenForViewer();
    }
  };

  const handleExitFullscreenClick = () => {
    exitFullscreenMode();
  };

  const handleDocumentFullscreenChange = () => {
    const active = getFullscreenElement() === viewerArea;
    updateFullscreenUI(active);
    resizeViewer();
    positionToolbar();
  };

  updateFullscreenUI(false);

  const applyDocumentLanguage = () => {
    if (documentRef?.documentElement) {
      documentRef.documentElement.setAttribute('lang', 'en');
    }
  };

  const refreshTextDependentUI = () => {
    applyDocumentLanguage();
    metadata.renderDatasetMetadata(getCurrentMetadataDetail());
    reapplyStatus();
    updateCompareButtonState();
    updateProjectionButtons();
    updateOrbitModeButtons();
    updateTextureToggleButton();
    updateNormalizeScaleButton();
    updateScaleReferenceButton();
    updateWireframeButton();
    updateLightingButton();
    updateAnaglyphButton();
    updateMeasureButton();
    syncClippingUI();
    updateFullscreenUI(isFullscreenActive);
    englishText.applyToDocument(documentRef);
    tooltips.refresh();
    updateToolbarToggle();
    if (searchHandlers?.isTaxonomySupported()) {
      searchHandlers.refreshTaxonomyFromLevel(0);
    }
  };

  // ===== Comparison Mode Functions =====

  const updateCompareButtonState = () => {
    if (!compareButton) {
      return;
    }

    const hasModelLoaded = getActiveDatasetId() && modelSelect.value;

    if (getComparisonMode()) {
      compareButton.textContent = translate('comparison.exitMode', 'Exit comparison mode');
      compareButton.disabled = false;
      setTooltip(compareButton, 'comparison.tooltips.exit', 'Exit comparison mode');
    } else {
      compareButton.textContent = translate('comparison.enterMode', 'Compare');
      compareButton.disabled = !hasModelLoaded;
      setTooltip(compareButton, 'comparison.tooltips.enter', 'Compare two models');
    }
  };

  const taxonomyContainer = documentRef.getElementById('taxonomySelectors');
  const taxonomyLevelsContainer = documentRef.getElementById('taxonomyLevels');
  const taxonomyGroup = documentRef.getElementById('taxonomyGroup');

  const modelUtilities = {
    loadDatasetModels: (...args) => loadDatasetModelsDelegate(...args),
    loadDatasetModelsForComparison: (...args) => loadDatasetModelsForComparisonDelegate(...args),
    loadModel: (...args) => loadModelDelegate(...args),
    loadComparisonModelB: (...args) => loadComparisonModelBDelegate(...args),
    enterComparisonMode: (...args) => enterComparisonModeDelegate(...args),
    exitComparisonMode: (...args) => exitComparisonModeDelegate(...args),
    resetInterfaceState: (...args) => resetInterfaceStateDelegate(...args),
  };

  const controllerDeps = {
    viewerApi,
    dataClient,
    translate,
    documentRef,
    windowRef,
    toggleLabelsButton,
    updateProjectionButtons,
    updateTextureToggleButton,
    updateScaleReferenceButton,
    updateNormalizeScaleButton,
    updateWireframeButton,
    updateOrbitModeButtons,
    updateLightingButton,
    updateAnaglyphButton,
    updateMeasureButton,
    disableClipping,
    enableSingleXClippingPlane,
    isXClippingActive,
    syncClippingUI,
    datasetSelect,
    modelSelect,
    modelUtilities,
    metadata,
    updateCompareButtonState,
    setStatus,
    setProgressPercent,
    renderStatus,
    setRotationGizmoHasModel,
    clearStatus,
    resetProgressPercent,
    supportsClipping,
    tooltipService: tooltips,
  };

  const controllers = initControllers(controllerDeps);

  const searchDeps = {
    translate,
    dataClient,
    datasetSelect,
    modelSelect,
    taxonomySelectContainer: taxonomyContainer,
    taxonomyLevelsContainer,
    taxonomyGroup,
    searchInput,
    searchResults,
    documentRef,
    windowRef,
    escapeHtml: escapeHtml,
    setStatus,
    getAllDatasets: () => getAllDatasets(),
    setActiveDatasetId: (value) => {
      setActiveDatasetId(value ?? null);
    },
    appStateAccessors: searchStateAccessors,
    tooltipService: tooltips,
  };

  const searchHandlers = initSearch(searchDeps);
  searchHandlers.resetTaxonomyState();

  const depsModel = {
    viewerApi,
    dataClient,
    translate,
    escapeHtml,
    windowRef,
    metadata,
    searchHandlers,
    datasetSelect,
    modelSelect,
    downloadSpecimenButton,
    reloadButton,
    compareButton,
    toggleLabelsButton,
    searchInput,
    measurementOverlay,
    labelOverlay,
    setStatus,
    clearStatus,
    setProgressPercent,
    resetProgressPercent,
    formatModelOptionLabel,
    updateCompareButtonState,
    updateProjectionButtons,
    updateOrbitModeButtons,
    updateTextureToggleButton,
    updateWireframeButton,
    updateLightingButton,
    updateAnaglyphButton,
    updateMeasureButton,
    updateNormalizeScaleButton,
    updateScaleReferenceButton,
    setCustomStatus,
    getLastStatus,
    getComparisonMode,
    setComparisonMode,
    getComparisonModelAId,
    setComparisonModelAId,
    getComparisonModelBId,
    setComparisonModelBId,
    getActiveDatasetId,
    setActiveDatasetId,
    getActiveDatasetIdForB,
    setActiveDatasetIdForB,
    getStateBeforeComparison,
    setStateBeforeComparison,
    getAllDatasets,
    setAllDatasets,
    setCurrentMetadataDetail,
    incrementDatasetToken,
    getDatasetToken,
    incrementModelToken,
    getModelToken,
    openDownloads: () => syncButton?.click?.(),
  };
  const modelController = initModelController(depsModel);
  loadDatasetModelsDelegate = (...args) => modelController.loadDatasetModels(...args);
  loadDatasetModelsForComparisonDelegate = (...args) =>
    modelController.loadDatasetModelsForComparison(...args);
  loadModelDelegate = (...args) => modelController.loadModel(...args);
  loadComparisonModelBDelegate = (...args) => modelController.loadComparisonModelB(...args);
  enterComparisonModeDelegate = (...args) => modelController.enterComparisonMode(...args);
  exitComparisonModeDelegate = (...args) => modelController.exitComparisonMode(...args);
  resetInterfaceStateDelegate = (...args) => modelController.resetInterfaceState(...args);
  modelUtilities.initDatasets = (...args) => modelController.initDatasets(...args);
  initSyncManager({
    dataClient,
    documentRef,
    windowRef,
    translate,
    resetInterfaceState: modelController.resetInterfaceState,
  });
  const clearDatasetsCache =
    typeof modelController.clearDatasetsCache === 'function'
      ? () => modelController.clearDatasetsCache()
      : () => {
          try {
            windowRef?.localStorage?.removeItem('dataverseCache');
          } catch (error) {
            console.warn('Failed to clear dataverse cache', error);
          }
        };

  const handleDelegatedTaxonomyLevelChange = (event) => {
    const target = event.target;
    if (!target || target.nodeName !== 'SELECT') {
      return;
    }
    if (!target.dataset || !target.dataset.levelKey) {
      return;
    }
    searchHandlers.handleTaxonomyLevelChange(event);
  };

  // === Event Handlers ===
  const handleViewerToolbarToggleClick = () => {
    if (windowRef.matchMedia('(min-width: 900px)').matches) {
      return;
    }
    const collapsed = isToolbarCollapsed();
    setToolbarCollapsed(!collapsed);
  };

  const handleDatasetSelectChange = (event) => {
    const persistentId = event.target.value;

    console.log('📋 Dataset changed to:', persistentId);

    if (persistentId && typeof searchHandlers?.syncTaxonomyWithDataset === 'function') {
      const dataset = getAllDatasets().find(
        (entry) => entry?.persistentId === persistentId || entry?.value === persistentId,
      );
      if (dataset) {
        searchHandlers.syncTaxonomyWithDataset(dataset);
      }
    }

    setActiveModelKey(null);

    if (searchInput) {
      searchInput.value = '';
    }
    searchHandlers?.resetSearchResults();

    if (getComparisonMode()) {
      setActiveDatasetIdForB(persistentId || null);
      setComparisonModelBId(null);
      modelSelect.value = '';
      console.log('📋 Loading models for comparison, dataset B:', persistentId);
      modelController.loadDatasetModelsForComparison(persistentId);
    } else {
      setActiveDatasetId(persistentId || null);
      setActiveModelKey(null);
      setComparisonModelAId(null);
      setComparisonModelBId(null);
      setStateBeforeComparison(null);
      modelSelect.value = '';
      console.log('📋 Loading models for normal mode, activeDatasetId:', getActiveDatasetId());
      modelController.loadDatasetModels(persistentId);
    }
    updateCompareButtonState();
  };

  const handleReloadButtonClick = () => {
    clearDatasetsCache();
    modelController.initDatasets({ force: true });
  };

  const handleResetInterfaceClick = async () => {
    if (!resetInterfaceButton) {
      return;
    }
    resetInterfaceButton.disabled = true;
    resetInterfaceButton.setAttribute('aria-busy', 'true');
    try {
      await modelUtilities.resetInterfaceState({ forceDatasetReload: true });
    } finally {
      resetInterfaceButton.disabled = false;
      resetInterfaceButton.removeAttribute('aria-busy');
    }
  };

  const handleCompareButtonClick = () => {
    if (getComparisonMode()) {
      modelUtilities.exitComparisonMode();
    } else {
      modelUtilities.enterComparisonMode();
    }
  };

  const handleViewerClippingEvent = () => {
    syncClippingUI();
  };

  const handleViewerModelRotationChange = (detail = {}) => {
    if (Object.prototype.hasOwnProperty.call(detail, 'hasModel')) {
      setRotationGizmoHasModel(Boolean(detail.hasModel));
      return;
    }
    updateRotationGizmoButton();
  };

  const handleViewerRotationGizmo = () => {
    updateRotationGizmoButton();
  };

  const handleViewerComparisonMode = () => {
    updateNormalizeScaleButton();
    updateScaleReferenceButton();
  };

  const handleViewerNormalizationScale = () => {
    updateNormalizeScaleButton();
  };

  const handleViewerScaleReference = () => {
    updateScaleReferenceButton();
  };

  const handleViewerComparisonLoadStart = () => {
    setStatus('status.loadingGeometry');
    setProgressPercent(0);
    renderStatus();
  };

  const handleViewerComparisonLoadProgress = ({ percent }) => {
    if (typeof percent === 'number' && !Number.isNaN(percent)) {
      setProgressPercent(Math.min(100, Math.max(Math.round(percent), 0)));
    }
  };

  const handleViewerComparisonLoadComplete = () => {
    clearStatus();
    updateScaleReferenceButton();
    setRotationGizmoHasModel(true);
  };

  const handleViewerComparisonLoadError = () => {
    resetProgressPercent();
    setStatus('status.modelLoadFailure', 'error');
    updateScaleReferenceButton();
  };

  const viewerEventUnsubscribes = [];

  const bindViewerEvent = (event, handler) => {
    const unsubscribe = viewerApi.addEventListener?.(event, handler);
    if (typeof unsubscribe === 'function') {
      viewerEventUnsubscribes.push(unsubscribe);
    }
  };

  const registerEventHandlers = () => {
    if (rotationGizmoButton) {
      rotationGizmoButton.addEventListener('click', controllers.handleRotationGizmoButtonClick);
    }

    if (viewerToolbarToggle) {
      viewerToolbarToggle.addEventListener('click', handleViewerToolbarToggleClick);
    }

    windowRef.addEventListener('resize', () => {
      resizeViewer();
      positionToolbar();
    });

    // Re-center the toolbar when the sidebar opens/closes on mobile
    if (toggleSidebarButton) {
      toggleSidebarButton.addEventListener('click', () => {
        // allow layout class changes to apply first
        setTimeout(positionToolbar, 0);
      });
    }
    if (sidebar) {
      sidebar.addEventListener('transitionend', (e) => {
        if (e.propertyName === 'transform' || e.propertyName === 'left') {
          positionToolbar();
        }
      });
    }

    datasetSelect.addEventListener('change', handleDatasetSelectChange);
    modelSelect.addEventListener('change', controllers.handleModelSelectChange);
    downloadSpecimenButton?.addEventListener(
      'click',
      modelController.handleDownloadSpecimenButtonClick,
    );

    if (searchInput && searchHandlers) {
      searchInput.addEventListener('input', searchHandlers.handleSearchInput);
      searchInput.addEventListener('focus', searchHandlers.handleSearchInputFocus);
      searchInput.addEventListener('keydown', searchHandlers.handleSearchKeyNavigation);
    }

    if (searchHandlers) {
      if (searchResults) {
        searchResults.addEventListener('keydown', searchHandlers.handleSearchKeyNavigation);
      }
      documentRef.addEventListener('click', searchHandlers.handleDocumentClick);
    }
    if (taxonomyLevelsContainer && searchHandlers?.handleTaxonomyLevelChange) {
      taxonomyLevelsContainer.addEventListener('change', handleDelegatedTaxonomyLevelChange);
    }
    reloadButton.addEventListener('click', handleReloadButtonClick);

    if (resetInterfaceButton) {
      resetInterfaceButton.addEventListener('click', handleResetInterfaceClick);
    }

    if (compareButton) {
      compareButton.addEventListener('click', handleCompareButtonClick);
    }

    if (toggleLabelsButton) {
      toggleLabelsButton.addEventListener('click', controllers.handleToggleLabelsButtonClick);
    }

    projectionModeButtons.forEach(({ button, mode }) => {
      if (!button) {
        return;
      }
      button.dataset.cameraMode = mode;
      button.addEventListener('click', controllers.handleProjectionModeButtonClick);
    });

    if (toggleTexturesButton) {
      toggleTexturesButton.addEventListener('click', controllers.handleToggleTexturesButtonClick);
    }

    if (scaleReferenceButton) {
      scaleReferenceButton.addEventListener('click', controllers.handleScaleReferenceButtonClick);
    }

    if (normalizeScaleButton) {
      normalizeScaleButton.addEventListener('click', controllers.handleNormalizeScaleButtonClick);
    }

    if (wireframeButton) {
      wireframeButton.addEventListener('click', controllers.handleWireframeButtonClick);
    }

    if (supportsClipping && clippingToggleButton) {
      clippingToggleButton.addEventListener('click', controllers.handleClippingToggleButtonClick);
    }

    if (resetViewButton) {
      resetViewButton.addEventListener('click', controllers.handleResetViewButtonClick);
    }

    if (lightingButton) {
      lightingButton.addEventListener('click', controllers.handleLightingButtonClick);
    }

    if (anaglyphButton) {
      anaglyphButton.addEventListener('click', controllers.handleAnaglyphButtonClick);
    }

    if (screenshotButton) {
      screenshotButton.addEventListener('click', controllers.handleScreenshotButtonClick);
    }

    if (fullscreenButton) {
      fullscreenButton.addEventListener('click', handleFullscreenToggle);
    }

    if (exitFullscreenButton) {
      exitFullscreenButton.addEventListener('click', handleExitFullscreenClick);
    }

    if (measureToggleButton) {
      measureToggleButton.addEventListener('click', controllers.handleMeasureToggleButtonClick);
    }

    if (clearMeasurementsButton) {
      clearMeasurementsButton.addEventListener('click', controllers.handleClearMeasurementsButtonClick);
    }

    orbitModeButtons.forEach(({ button, mode }) => {
      if (!button) {
        return;
      }
      button.dataset.orbitMode = mode;
      button.addEventListener('click', controllers.handleOrbitModeButtonClick);
    });

    if (supportsClipping) {
      bindViewerEvent('clippingchange', handleViewerClippingEvent);
      bindViewerEvent('clippingplanechange', handleViewerClippingEvent);
      bindViewerEvent('clippingfill', handleViewerClippingEvent);
      bindViewerEvent('clippingreset', handleViewerClippingEvent);
      bindViewerEvent('clippingbounds', handleViewerClippingEvent);
      bindViewerEvent('clippingactiveplane', handleViewerClippingEvent);
    }

    bindViewerEvent('modelrotationchange', handleViewerModelRotationChange);
    bindViewerEvent('rotationgizmo', handleViewerRotationGizmo);
    bindViewerEvent('loadstart', controllers.handleViewerLoadStart);
    bindViewerEvent('loadprogress', controllers.handleViewerLoadProgress);
    bindViewerEvent('loadend', controllers.handleViewerLoadEnd);
    bindViewerEvent('loaderror', controllers.handleViewerLoadError);
    bindViewerEvent('comparisonmode', handleViewerComparisonMode);
    bindViewerEvent('normalizationscale', handleViewerNormalizationScale);
    bindViewerEvent('scalereference', handleViewerScaleReference);

    bindViewerEvent('comparisonloadstart', handleViewerComparisonLoadStart);
    bindViewerEvent('comparisonloadprogress', handleViewerComparisonLoadProgress);
    bindViewerEvent('comparisonloadcomplete', handleViewerComparisonLoadComplete);
    bindViewerEvent('comparisonloaderror', handleViewerComparisonLoadError);

    documentRef.addEventListener('fullscreenchange', handleDocumentFullscreenChange);
    documentRef.addEventListener('webkitfullscreenchange', handleDocumentFullscreenChange);
    documentRef.addEventListener('mozfullscreenchange', handleDocumentFullscreenChange);
    documentRef.addEventListener('MSFullscreenChange', handleDocumentFullscreenChange);
  };

  refreshTextDependentUI();
  modelController.initDatasets();
  registerEventHandlers();
  updateRotationGizmoButton();
  updateProjectionButtons();
  updateOrbitModeButtons();
  resizeViewer();

  return {
    destroy() {
      windowRef.removeEventListener('resize', resizeViewer);
      documentRef.removeEventListener('fullscreenchange', handleDocumentFullscreenChange);
      documentRef.removeEventListener('webkitfullscreenchange', handleDocumentFullscreenChange);
      documentRef.removeEventListener('mozfullscreenchange', handleDocumentFullscreenChange);
      documentRef.removeEventListener('MSFullscreenChange', handleDocumentFullscreenChange);
      if (fullscreenButton) {
        fullscreenButton.removeEventListener('click', handleFullscreenToggle);
      }
      if (exitFullscreenButton) {
        exitFullscreenButton.removeEventListener('click', handleExitFullscreenClick);
      }
      viewerEventUnsubscribes.splice(0).forEach((unsubscribe) => {
        try {
          if (typeof unsubscribe === 'function') {
            unsubscribe();
          }
        } catch (error) {
          console.warn('Failed to unsubscribe viewer listener', error);
        }
      });
      tooltips.destroy?.();
      viewerApi.destroy?.();
    },
  };
}
