/**
 * Orchestrates the UI layer: dataset/model selectors, metadata rendering,
 * viewer controls, and localisation glue code.
 */
import { DataverseClient } from '../data/dataverseClient.js';
import { i18n } from '../i18n/translator.js';
import initControllers from './controllers.js';
import {
  initSearch,
  formatModelOptionLabel,
  formatSpecimenLabel,
  deriveUberonUrlFromModel,
} from './search.js';
import { initMetadata } from './metadata.js';
import { initMaterialControls } from './materialControls.js';
import { initInterfaceControls } from './interfaceControls.js';
import { initModelController } from './modelController.js';
import { createTooltipService } from './tooltips.js';
import {
  downloadDatasetForOffline,
  isDatasetOffline,
  isModelOffline,
  listOfflineDatasets,
  clearOfflineDownloads,
} from './offlineDownloads.js';
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
 * Helper wrapper to keep translation lookups concise with a fallback string.
 *
 * @param {string} key - I18n key to resolve.
 * @param {string} [fallback=''] - Text to use when no translation is found.
 * @returns {string} Resolved translation or fallback.
 */
const translate = (key, fallback = '') => i18n.translate(key, { defaultValue: fallback });

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
 * @param {DataverseClient} [options.dataClient] - Data client used to query Dataverse.
 * @param {Document} [options.documentRef=document] - Document reference (facilitates testing).
 * @param {Window} [options.windowRef=window] - Window reference (facilitates testing).
 * @returns {Promise<{destroy: () => void}>} Cleanup handle.
 */
export async function initInterface({
  viewerApi,
  dataClient = new DataverseClient(),
  documentRef = document,
  windowRef = window,
} = {}) {
  if (!viewerApi) {
    throw new Error('initInterface requires a viewerApi instance');
  }

  await i18n.init();
  const LANGUAGE_CODES = i18n.getSupportedLanguages().map(({ code }) => code);
  const languageOptionNodes = new Map();

  const datasetSelect = documentRef.getElementById('datasetSelect');
  const modelSelect = documentRef.getElementById('modelSelect');
  const reloadButton = documentRef.getElementById('reloadDatasets');
  const searchInput = documentRef.getElementById('searchInput');
  const searchResults = documentRef.getElementById('searchResults');
  const toggleTexturesButton = documentRef.getElementById('toggleTextures');
  const normalizeScaleButton = documentRef.getElementById('toggleNormalizeScale');
  const scaleReferenceButton = documentRef.getElementById('toggleScaleReference');
  const offlineDownloadButton = documentRef.getElementById('offlineDownloadButton');
  const offlineStatus = documentRef.getElementById('offlineStatus');
  const offlineDownloadsList = documentRef.getElementById('offlineDownloadsList');
  const offlineBadge = documentRef.getElementById('offlineBadge');
  const offlineDatasetList = documentRef.getElementById('offlineDatasetList');
  const offlineSelectAll = documentRef.getElementById('offlineSelectAll');
  const offlineClearAll = documentRef.getElementById('offlineClearAll');
  const offlineCancelButton = documentRef.getElementById('offlineCancelButton');
  const offlineClearDownloadsButton = documentRef.getElementById('offlineClearDownloads');
  let currentDownloadAbort = null;
  const offlineExpansionState = new Map();

  const buildModelItemsMarkup = ({ datasetId, models = [], offlineModels = new Set(), current }) => {
    if (!models.length) {
      return `<div class="offline-dialog__hint">${escapeHtml(
        translate('offline.noModels', 'No models found'),
      )}</div>`;
    }
    const selectAllLabel = escapeHtml(translate('offline.selectAllModels', 'Select all elements'));
    const items =
      `<label class="offline-checkbox offline-checkbox--all">
        <input
          class="offline-checkbox__input offline-checkbox__input--all"
          type="checkbox"
          data-dataset-id="${escapeHtml(datasetId)}"
          data-model-key="__all__"
        />
        <span class="offline-checkbox__label">${selectAllLabel}</span>
      </label>` +
      models
        .map((model) => {
          const isOffline = offlineModels.has(model.key);
          const shouldCheck = isOffline || (current && datasetId === current);
          const badge = isOffline
            ? `<span class="offline-checkbox__badge">${escapeHtml(
                translate('offline.savedShort', 'Saved'),
              )}</span>`
            : '';
          return `
            <label class="offline-checkbox offline-checkbox--model">
              <input
                class="offline-checkbox__input"
                type="checkbox"
                data-dataset-id="${escapeHtml(datasetId)}"
                data-model-key="${escapeHtml(model.key)}"
                ${shouldCheck ? 'checked' : ''}
              />
              <span class="offline-checkbox__label">${escapeHtml(
                model.displayName || model.key,
              )}</span>
              ${badge}
            </label>
          `;
        })
        .join('');
    return items;
  };

  const loadModelsForDataset = async (datasetId) => {
    let models = [];
    const downloads = listOfflineDatasets();
    const offlineEntry = downloads.find((entry) => entry.value === datasetId);
    if (offlineEntry?.models?.length) {
      models = offlineEntry.models.map((m) => ({
        key: m.key,
        displayName: m.label || m.key,
        offline: m.offline !== false,
      }));
    }
    if (!models.length && typeof dataClient?.getCachedDatasetEntry === 'function') {
      const cached = dataClient.getCachedDatasetEntry(datasetId);
      models = cached?.models || [];
    }
    if (!models.length && typeof dataClient?.ensureDatasetPrepared === 'function') {
      try {
        const entry = await dataClient.ensureDatasetPrepared(datasetId);
        models = entry?.models || [];
      } catch (error) {
        console.warn('Unable to load models for offline selector', datasetId, error);
      }
    }
    return models;
  };

  const getSpecimenLabel = (dataset) => {
    if (!dataset) return translate('offline.unknownSpecimen', 'Unknown specimen');
    return (
      dataset.label ||
      dataset.identifier ||
      dataset.value ||
      translate('offline.unknownSpecimen', 'Unknown specimen')
    );
  };
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
  const languageSelect = documentRef.getElementById('languageSelect');
  const viewerToolbar = documentRef.getElementById('viewerToolbar');
  const viewerToolbarToggle = documentRef.getElementById('viewerToolbarToggle');
  const exitFullscreenButton = documentRef.getElementById('exitFullscreen');
  const viewerArea = documentRef.querySelector('.viewer-area');
  const topBar = documentRef.querySelector('.top-bar');
  const sidebar = documentRef.getElementById('appSidebar');
  const toggleSidebarButton = documentRef.getElementById('toggleSidebar');
  const optionsButton = documentRef.getElementById('optionsButton');
  const aboutButton = documentRef.getElementById('aboutButton');
  const closeOptionsButton = documentRef.getElementById('closeOptions');
  const themeSelect = documentRef.getElementById('themeSelect');
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
    [reloadButton, 'sidebar.tooltips.reload', 'Reload page'],
    [resetInterfaceButton, 'sidebar.tooltips.reset', 'Reset interface state'],
    [gbifLink, 'sidebar.tooltips.gbif', 'Open GBIF entry'],
    [coraLink, 'sidebar.tooltips.cora', 'Open CORA-RDR entry'],
    [uberonLink, 'sidebar.tooltips.uberon', 'Open ontology entry'],
    [optionsButton, 'sidebar.tooltips.settings', 'Settings'],
    [aboutButton, 'sidebar.tooltips.about', 'About this project'],
    [viewerToolbarToggle, 'viewer.toolbar.tooltips.toggle', 'Show or hide secondary controls'],
    [screenshotButton, 'viewer.buttons.capture', 'Capture'],
    [resetViewButton, 'viewer.buttons.resetView', 'Reset view'],
    [closeOptionsButton, 'options.tooltips.close', 'Close options'],
    [languageSelect, 'options.tooltips.language', 'Change interface language'],
    [themeSelect, 'options.tooltips.theme', 'Change viewer theme'],
    [screenshotBgToggle, 'options.tooltips.screenshotBackground', 'Toggle screenshot background'],
    [anaglyphEyeSeparation, 'options.tooltips.anaglyph', 'Adjust anaglyph depth'],
    [reloadDatasetsButton, 'options.tooltips.reloadDatasets', 'Reload specimen list'],
  ].forEach(([element, key, fallback]) => setTooltip(element, key, fallback));

  const depsMetadata = {
    translate,
    i18n,
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

  const buildLanguageLabel = (code) => translate(`language.names.${code}`, code.toUpperCase());

  const refreshLanguageSelector = () => {
    if (!languageSelect) {
      return;
    }
    LANGUAGE_CODES.forEach((code) => {
      let option = languageOptionNodes.get(code);
      if (!option) {
        option = documentRef.createElement('option');
        option.value = code;
        languageOptionNodes.set(code, option);
        languageSelect.appendChild(option);
      }
      option.textContent = buildLanguageLabel(code);
    });
    const current = i18n.currentLanguage || i18n.defaultLanguage || 'en';
    languageSelect.value = LANGUAGE_CODES.includes(current) ? current : i18n.defaultLanguage;
  };

  const applyLanguageToDocument = () => {
    if (documentRef?.documentElement) {
      documentRef.documentElement.setAttribute('lang', i18n.currentLanguage || 'en');
    }
  };

  const refreshLanguageDependentUI = () => {
    applyLanguageToDocument();
    refreshLanguageSelector();
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
    i18n.applyTranslations(documentRef);
    tooltips.refresh();
    updateToolbarToggle();
    if (searchHandlers?.isTaxonomySupported()) {
      searchHandlers.refreshTaxonomyFromLevel(0);
    }
  };

  // ===== Offline downloads =====
  const setOfflineStatusText = (text) => {
    if (offlineStatus) {
      offlineStatus.textContent = text || '';
    }
  };

  const renderOfflineDownloads = () => {
    const downloads = listOfflineDatasets();
    if (offlineBadge) {
      offlineBadge.textContent = String(downloads.length || 0);
    }
    if (!offlineDownloadsList) {
      return downloads;
    }
    if (!downloads.length) {
      const emptyLabel = escapeHtml(
        translate('offline.empty', 'No specimens saved for offline use'),
      );
      offlineDownloadsList.innerHTML = `<span class="offline-download__pill">${emptyLabel}</span>`;
      return downloads;
    }
    const pills = downloads
      .map((item) => {
        const total = Array.isArray(item.models) ? item.models.length : 0;
        const savedCount = Array.isArray(item.models)
          ? item.models.filter((m) => m.offline !== false).length
          : 0;
        const partialLabel =
          total > 0 && savedCount > 0 && savedCount < total
            ? ` (${savedCount}/${total} ${escapeHtml(translate('offline.elements', 'elements'))})`
            : savedCount === total && total > 0
            ? ` (${escapeHtml(translate('offline.full', 'full'))})`
            : '';
        return `<span class="offline-download__pill" title="${escapeHtml(item.label)}">${escapeHtml(
          item.label,
        )}${partialLabel}</span>`;
      })
      .join('');
    offlineDownloadsList.innerHTML = pills;
    return downloads;
  };

  const renderOfflineSelector = async () => {
    if (!offlineDatasetList) {
      return;
    }
    const datasets = getAllDatasets && Array.isArray(getAllDatasets()) ? getAllDatasets() : [];
    if (!datasets.length) {
      const emptyLabel = escapeHtml(
        translate('offline.noneAvailable', 'No specimens available to download'),
      );
      offlineDatasetList.innerHTML = `<div class="offline-dialog__hint">${emptyLabel}</div>`;
      return;
    }

    const downloads = listOfflineDatasets();
    const offlineByDataset = new Map(downloads.map((entry) => [entry.value, entry.models || []]));
    const current = datasetSelect?.value;

    const blocks = await Promise.all(
      datasets.map(async (dataset) => {
        const offlineModelsEntry = offlineByDataset.get(dataset.value) || [];
        const offlineModels = new Set(
          offlineModelsEntry.filter((m) => m.offline !== false).map((m) => m.key),
        );

        let models = [];
        try {
          models = await loadModelsForDataset(dataset.value);
        } catch (error) {
          console.warn('Unable to load models for offline selector', dataset.value, error);
          models = [];
        }

        const savedCount = offlineModels.size;
        const totalCount = models.length || offlineModelsEntry.length;

        const baseLabel = getSpecimenLabel(dataset);
        const label = escapeHtml(formatSpecimenLabel(baseLabel, dataset.specimenSummary));
        const titleWithPartial =
          totalCount > 0 && savedCount > 0 && savedCount < totalCount
            ? `${label} (${escapeHtml(translate('offline.partial', 'partial'))})`
            : label;
        const meta =
          totalCount > 0
            ? `${totalCount} ${translate('offline.elements', 'elements')}`
            : translate('offline.noModelsShort', 'No elements');
        const savedBadge =
          savedCount > 0
            ? `<span class="offline-dataset__saved">${escapeHtml(
                savedCount === totalCount
                  ? translate('offline.full', 'full')
                  : `${translate('offline.savedShort', 'Saved')} ${savedCount}/${totalCount}`,
              )}</span>`
            : '';

        const modelsMarkup = buildModelItemsMarkup({
          datasetId: dataset.value,
          models,
          offlineModels,
          current,
        });

        return `
          <div class="offline-dataset" data-dataset-id="${escapeHtml(dataset.value)}">
            <div class="offline-dataset__summary">
              <div class="offline-dataset__title-group">
                <span class="offline-dataset__title">${titleWithPartial}</span>
                <span class="offline-dataset__meta">
                  <span class="offline-dataset__count">${escapeHtml(meta)}</span>
                  ${savedBadge}
                </span>
              </div>
            </div>
            <div class="offline-dataset__models" data-loaded="true">
              ${modelsMarkup}
            </div>
          </div>
        `;
      }),
    );

    offlineDatasetList.innerHTML = blocks.join('');
    updateOfflineButtonState();
  };

  const getSelectedOfflineSelection = () => {
    if (!offlineDatasetList) return [];
    const selections = new Map();
    offlineDatasetList
      .querySelectorAll('.offline-checkbox__input:checked')
      .forEach((input) => {
        const datasetId = input.dataset.datasetId;
        const modelKey = input.dataset.modelKey;
        if (!datasetId || !modelKey || modelKey === '__all__') return;
        if (!selections.has(datasetId)) {
          selections.set(datasetId, new Set());
        }
        selections.get(datasetId).add(modelKey);
      });
    return Array.from(selections.entries()).map(([datasetId, modelKeys]) => ({
      datasetId,
      modelKeys: Array.from(modelKeys),
    }));
  };

  const updateOfflineButtonState = () => {
    if (!offlineDownloadButton) {
      return;
    }
    const offline = windowRef?.navigator?.onLine === false;
    const selection = getSelectedOfflineSelection();
    const availableIds = new Set((getAllDatasets() || []).map((item) => item.value));
    const hasValidSelection = selection.length > 0 && selection.every(({ datasetId }) => availableIds.has(datasetId));
    const alreadyOffline =
      hasValidSelection &&
      selection.every(({ datasetId, modelKeys }) =>
        modelKeys.every((key) => isModelOffline(datasetId, key)),
      );
    offlineDownloadButton.disabled = !hasValidSelection || offline || alreadyOffline;

    let statusText = '';
    if (!hasValidSelection) {
      statusText = translate('offline.prompt', 'Select one or more specimens to save offline');
    } else if (alreadyOffline) {
      statusText = translate('offline.already', 'Already available offline');
    } else if (offline) {
      statusText = translate('offline.requiresOnline', 'Connect to download for offline use');
    } else {
      statusText = translate('offline.ready', 'Download selected specimens for offline use');
    }
    setOfflineStatusText(statusText);
  };

  const handleOfflineDownloadClick = async () => {
    if (!offlineDownloadButton) {
      return;
    }
    const selection = getSelectedOfflineSelection();
    if (!selection.length) {
      setOfflineStatusText(translate('offline.prompt', 'Select specimens to download'));
      return;
    }

    offlineDownloadButton.disabled = true;
    if (offlineCancelButton) {
      offlineCancelButton.disabled = false;
    }
    currentDownloadAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    setProgressPercent(0);
    setCustomStatus(translate('offline.downloading', 'Downloading for offline use...'), 'loading');
    setOfflineStatusText(translate('offline.downloading', 'Downloading for offline use...'));

    const targets = selection
      .map(({ datasetId, modelKeys }) => {
        const pendingModels = modelKeys.filter((key) => !isModelOffline(datasetId, key));
        return pendingModels.length ? { datasetId, modelKeys: pendingModels } : null;
      })
      .filter(Boolean);

    if (!targets.length) {
      setCustomStatus(translate('offline.already', 'Already available offline'), 'info');
      setOfflineStatusText(translate('offline.already', 'Already available offline'));
      offlineDownloadButton.disabled = false;
      return;
    }

    try {
      for (let index = 0; index < targets.length; index += 1) {
        const { datasetId, modelKeys } = targets[index];
        await downloadDatasetForOffline({
          dataClient,
          persistentId: datasetId,
          modelKeys,
          signal: currentDownloadAbort?.signal,
          onProgress: (ratio) => {
            const overall = (index + ratio) / targets.length;
            const percent = Math.round(Math.min(Math.max(overall * 100, 0), 100));
            setProgressPercent(percent);
            setOfflineStatusText(`${percent}%`);
          },
        });
      }
      renderOfflineDownloads();
      renderOfflineSelector();
      setCustomStatus(
        translate('offline.readyStatus', 'Saved selected elements for offline use'),
        'info',
      );
      setOfflineStatusText(
        translate('offline.readyStatus', 'Saved selected elements for offline use'),
      );
    } catch (error) {
      if (error?.name === 'AbortError') {
        setCustomStatus(translate('offline.cancelled', 'Download cancelled'), 'info');
        setOfflineStatusText(translate('offline.cancelled', 'Download cancelled'));
      } else {
        console.error('Offline download failed', error);
        setCustomStatus(
          translate('offline.error', 'Offline download failed. Please try again.'),
          'error',
        );
        setOfflineStatusText(translate('offline.error', 'Offline download failed.'));
      }
    } finally {
      resetProgressPercent();
      updateOfflineButtonState();
      if (offlineCancelButton) {
        offlineCancelButton.disabled = true;
      }
      currentDownloadAbort = null;
    }
  };

  const handleOfflineCancelClick = () => {
    if (currentDownloadAbort) {
      currentDownloadAbort.abort();
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
    i18n,
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
    i18n,
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
    i18n,
    windowRef,
    metadata,
    searchHandlers,
    datasetSelect,
    modelSelect,
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

    if (offlineDatasetList && persistentId) {
      Array.from(offlineDatasetList.querySelectorAll('.offline-checkbox__input')).forEach(
        (input) => {
          input.checked = input.value === persistentId;
        },
      );
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
    updateOfflineButtonState();
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
    if (offlineDatasetList) {
      offlineDatasetList.addEventListener('change', updateOfflineButtonState);
      offlineDatasetList.addEventListener('change', (event) => {
        const target = event.target;
        if (!target?.classList?.contains('offline-checkbox__input')) return;
        if (target.dataset.modelKey === '__all__') {
          const datasetId = target.dataset.datasetId;
          if (!datasetId) return;
          const container = target.closest('.offline-dataset');
          container
            ?.querySelectorAll(
              '.offline-checkbox__input[data-model-key]:not([data-model-key="__all__"])',
            )
            ?.forEach((input) => {
              input.checked = target.checked;
            });
          updateOfflineButtonState();
        }
      });
    }
    if (offlineSelectAll) {
      offlineSelectAll.addEventListener('click', () => {
        if (!offlineDatasetList) return;
        offlineDatasetList
          .querySelectorAll('.offline-checkbox__input[data-model-key]:not([data-model-key="__all__"])')
          .forEach((input) => (input.checked = true));
        updateOfflineButtonState();
      });
    }
    if (offlineClearAll) {
      offlineClearAll.addEventListener('click', () => {
        if (!offlineDatasetList) return;
        offlineDatasetList
          .querySelectorAll('.offline-checkbox__input[data-model-key]:not([data-model-key="__all__"])')
          .forEach((input) => (input.checked = false));
        updateOfflineButtonState();
      });
    }
    if (offlineCancelButton) {
      offlineCancelButton.addEventListener('click', handleOfflineCancelClick);
    }
    if (offlineClearDownloadsButton) {
      offlineClearDownloadsButton.addEventListener('click', async () => {
        setCustomStatus(translate('offline.clearing', 'Clearing offline downloads...'), 'loading');
        setOfflineStatusText(translate('offline.clearing', 'Clearing offline downloads...'));
        try {
          await clearOfflineDownloads();
          renderOfflineDownloads();
          await renderOfflineSelector();
          updateOfflineButtonState();
          setCustomStatus(translate('offline.cleared', 'Offline downloads cleared'), 'info');
          setOfflineStatusText(translate('offline.cleared', 'Offline downloads cleared'));
        } catch (error) {
          console.error('Failed to clear offline downloads', error);
          setCustomStatus(
            translate('offline.clearError', 'Failed to clear offline downloads'),
            'error',
          );
          setOfflineStatusText(translate('offline.clearError', 'Failed to clear offline downloads'));
        }
      });
    }
    if (offlineDownloadButton) {
      offlineDownloadButton.addEventListener('click', handleOfflineDownloadClick);
    }

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

    if (windowRef?.addEventListener) {
      windowRef.addEventListener('online', () => {
        updateOfflineButtonState();
        setOfflineStatusText('');
        modelController.initDatasets({ force: true }).then(() => {
          renderOfflineSelector().then(() => updateOfflineButtonState());
        });
      });
      windowRef.addEventListener('offline', () => {
        updateOfflineButtonState();
        modelController.initDatasets({ force: true }).then(() => {
          renderOfflineSelector().then(() => updateOfflineButtonState());
        });
      });
    }

    if (compareButton) {
      compareButton.addEventListener('click', handleCompareButtonClick);
    }

    if (toggleLabelsButton) {
      toggleLabelsButton.addEventListener('click', controllers.handleToggleLabelsButtonClick);
      tooltips.setTooltip(toggleLabelsButton, 'viewer.tooltips.toggleLabels', 'Toggle labels');
    }

    if (languageSelect) {
      languageSelect.addEventListener('change', controllers.handleLanguageSelectChange);
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

  const unsubscribe = i18n.onChange(() => {
    refreshLanguageDependentUI();
  });

  refreshLanguageDependentUI();
  renderOfflineDownloads();
  renderOfflineSelector().then(() => updateOfflineButtonState());
  modelController.initDatasets().then(() => {
    renderOfflineSelector().then(() => updateOfflineButtonState());
  });
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
      if (typeof unsubscribe === 'function') {
        unsubscribe();
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
