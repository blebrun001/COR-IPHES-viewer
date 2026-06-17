import assert from 'node:assert/strict';
import test from 'node:test';
import { initModelController } from '../app/public/js/ui/modelController.js';

function createSelectElement() {
  return {
    disabled: false,
    innerHTML: '',
    value: '',
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[char] || char;
  });
}

test('model controller lists only offline-ready specimens in the main viewer', async () => {
  const datasetSelect = createSelectElement();
  const modelSelect = createSelectElement();
  const downloadSpecimenButton = {
    hidden: true,
    disabled: false,
    textContent: '',
    dataset: {},
  };
  const reloadButton = { disabled: false };
  const statuses = [];
  let datasetToken = 0;
  let modelToken = 0;
  let allDatasets = [];
  let activeDatasetId = null;
  let renderedMetadata = null;
  let listDatasetsOptions = null;
  const localViewerDatasets = [
    {
      label: 'Equus ferus przewalskii 374',
      value: 'doi:10.34810/data1785',
      taxonomyPath: { species: 'Equus ferus przewalskii' },
      downloadState: 'downloaded',
    },
  ];
  const entries = new Map([
    [
      'doi:10.34810/data1961',
      {
        detail: { title: 'Capra pyrenaica 387' },
        models: [
          {
            key: '231125',
            displayName: 'atlas',
            downloadState: 'missing',
          },
          {
            key: '231261',
            displayName: 'axis',
            downloadState: 'downloaded',
          },
        ],
      },
    ],
    [
      'doi:10.34810/data1785',
      {
        detail: { title: 'Equus ferus przewalskii 374' },
        models: [
          {
            key: '231261',
            displayName: 'axis',
            downloadState: 'downloaded',
          },
        ],
      },
    ],
  ]);

  const controller = initModelController({
    dataClient: {
      usesPersistentCatalog: true,
      async listDatasets(options) {
        listDatasetsOptions = options;
        return localViewerDatasets;
      },
      async ensureDatasetPrepared(persistentId) {
        return entries.get(persistentId);
      },
    },
    viewerApi: {
      clearScene() {},
    },
    translate(key, fallback) {
      const text = {
        'selector.dataset.loading': 'Loading specimens...',
        'selector.dataset.placeholder': 'Select a specimen...',
        'selector.model.disabled': 'Select a specimen',
        'selector.model.loading': 'Loading models...',
        'selector.model.placeholder': 'Choose a model...',
        'selector.model.downloadRequired': 'Download specimen to view models',
        'status.specimenDownloadRequired': 'Download this specimen before viewing its models.',
        'sync.downloadSpecimen': 'Download specimen',
        'sync.openDownloads': 'Open downloads',
        'sync.states.missing': 'not downloaded',
        'sync.states.downloaded': 'downloaded',
      };
      return text[key] || fallback;
    },
    escapeHtml,
    windowRef: {
      localStorage: {
        getItem() {
          return null;
        },
        setItem() {},
        removeItem() {},
      },
      __COR_IPHES_ONLINE__: true,
    },
    datasetSelect,
    modelSelect,
    downloadSpecimenButton,
    reloadButton,
    metadata: {
      renderDatasetMetadata(detail) {
        renderedMetadata = detail;
      },
      updateExternalLinks() {},
    },
    searchHandlers: {
      resetTaxonomyState() {},
      setTaxonomyVisibility() {},
      initializeTaxonomySelectors() {},
      async buildSearchIndex() {},
      refreshSpecimenOptions(statusKey) {
        datasetSelect.disabled = false;
        datasetSelect.innerHTML =
          '<option value="">Select a specimen...</option>' +
          allDatasets
            .map((dataset) => `<option value="${escapeHtml(dataset.value)}">${escapeHtml(dataset.label)}</option>`)
            .join('');
        statuses.push(statusKey);
      },
    },
    setStatus(key, type = 'info') {
      statuses.push(`${key}:${type}`);
    },
    setProgressPercent() {},
    resetProgressPercent() {},
    setAllDatasets(value) {
      allDatasets = value;
    },
    getAllDatasets() {
      return allDatasets;
    },
    setActiveDatasetId(value) {
      activeDatasetId = value;
    },
    getComparisonMode() {
      return false;
    },
    updateCompareButtonState() {},
    updateProjectionButtons() {},
    updateOrbitModeButtons() {},
    updateTextureToggleButton() {},
    updateWireframeButton() {},
    updateLightingButton() {},
    updateAnaglyphButton() {},
    updateMeasureButton() {},
    updateNormalizeScaleButton() {},
    updateScaleReferenceButton() {},
    incrementDatasetToken() {
      datasetToken += 1;
      return datasetToken;
    },
    getDatasetToken() {
      return datasetToken;
    },
    incrementModelToken() {
      modelToken += 1;
      return modelToken;
    },
    getModelToken() {
      return modelToken;
    },
  });

  const originalLog = console.log;
  console.log = () => {};
  try {
    await controller.initDatasets({ force: true });
  } finally {
    console.log = originalLog;
  }

  assert.equal(listDatasetsOptions.includeIncomplete, false);
  assert.doesNotMatch(datasetSelect.innerHTML, /Capra pyrenaica 387/);
  assert.match(datasetSelect.innerHTML, /Equus ferus przewalskii 374/);
  assert.equal(datasetSelect.disabled, false);
  assert.ok(statuses.includes('status.datasetsLoadedFromCatalog'));

  await controller.loadDatasetModels('doi:10.34810/data1785');

  assert.equal(activeDatasetId, 'doi:10.34810/data1785');
  assert.deepEqual(renderedMetadata, { title: 'Equus ferus przewalskii 374' });
  assert.equal(modelSelect.disabled, false);
  assert.match(modelSelect.innerHTML, /axis/);
  assert.doesNotMatch(modelSelect.innerHTML, /downloaded/);
  assert.equal(downloadSpecimenButton.hidden, true);
});

test('model controller empty offline viewer points users to offline downloads', async () => {
  const datasetSelect = createSelectElement();
  const modelSelect = createSelectElement();
  const downloadSpecimenButton = {
    hidden: true,
    disabled: false,
    textContent: '',
    dataset: {},
  };
  const statuses = [];
  let listDatasetsOptions = null;
  let allDatasets = [];
  let datasetToken = 0;
  let modelToken = 0;
  let openDownloadsCount = 0;

  const controller = initModelController({
    dataClient: {
      usesPersistentCatalog: true,
      async listDatasets(options) {
        listDatasetsOptions = options;
        return [];
      },
    },
    viewerApi: {
      clearScene() {},
    },
    translate(key, fallback) {
      return {
        'selector.dataset.loading': 'Loading specimens...',
        'selector.dataset.placeholder': 'Select a specimen...',
        'selector.dataset.none': 'No offline specimens available yet',
        'selector.model.disabled': 'Select a specimen',
        'status.syncCatalogRequired': 'Open Offline downloads to update the catalog and download complete specimens.',
      }[key] || fallback;
    },
    escapeHtml,
    windowRef: {
      localStorage: {
        getItem() {
          return null;
        },
        setItem() {},
        removeItem() {},
      },
    },
    datasetSelect,
    modelSelect,
    downloadSpecimenButton,
    metadata: {
      renderDatasetMetadata() {},
      updateExternalLinks() {},
    },
    searchHandlers: {
      resetTaxonomyState() {},
      setTaxonomyVisibility() {},
      initializeTaxonomySelectors() {},
      async buildSearchIndex() {},
      refreshSpecimenOptions(statusKey) {
        datasetSelect.disabled = true;
        datasetSelect.innerHTML =
          '<option value="">Select a specimen...</option>' +
          '<option value="" disabled>No offline specimens available yet</option>';
        statuses.push(statusKey);
      },
    },
    setStatus(key, type = 'info') {
      statuses.push(`${key}:${type}`);
    },
    setProgressPercent() {},
    resetProgressPercent() {},
    setAllDatasets(value) {
      allDatasets = value;
    },
    getAllDatasets() {
      return allDatasets;
    },
    getComparisonMode() {
      return false;
    },
    getActiveDatasetId() {
      return null;
    },
    updateCompareButtonState() {},
    incrementDatasetToken() {
      datasetToken += 1;
      return datasetToken;
    },
    getDatasetToken() {
      return datasetToken;
    },
    incrementModelToken() {
      modelToken += 1;
      return modelToken;
    },
    getModelToken() {
      return modelToken;
    },
    openDownloads() {
      openDownloadsCount += 1;
    },
  });

  const originalLog = console.log;
  console.log = () => {};
  try {
    await controller.initDatasets({ force: true });
  } finally {
    console.log = originalLog;
  }

  assert.equal(listDatasetsOptions.includeIncomplete, false);
  assert.match(datasetSelect.innerHTML, /No offline specimens available yet/);
  assert.ok(statuses.includes('status.syncCatalogRequired'));
  assert.equal(downloadSpecimenButton.hidden, false);
  assert.equal(downloadSpecimenButton.dataset.datasetId, '');
  assert.equal(downloadSpecimenButton.textContent, 'Open downloads');

  await controller.handleDownloadSpecimenButtonClick();

  assert.equal(openDownloadsCount, 1);
});

test('model controller inline download button starts a visible missing specimen download defensively', async () => {
  const datasetSelect = createSelectElement();
  const modelSelect = createSelectElement();
  const downloadSpecimenButton = {
    hidden: false,
    disabled: false,
    textContent: 'Download specimen',
    dataset: { datasetId: 'doi:10.34810/missing' },
  };
  let allDatasets = [
    {
      value: 'doi:10.34810/missing',
      label: 'Missing specimen',
      downloadState: 'missing',
    },
  ];
  let enqueueRequest = null;
  let openDownloadsCount = 0;
  let initListCalls = 0;
  let datasetToken = 0;
  let modelToken = 0;

  const controller = initModelController({
    dataClient: {
      usesPersistentCatalog: true,
      async listDatasets() {
        initListCalls += 1;
        return allDatasets;
      },
      async downloadEnqueue(request) {
        enqueueRequest = request;
        allDatasets = [
          {
            value: 'doi:10.34810/missing',
            label: 'Missing specimen',
            downloadState: 'queued',
          },
        ];
        return 2;
      },
      resetCache() {},
    },
    viewerApi: {
      clearScene() {},
    },
    translate(key, fallback) {
      return {
        'selector.dataset.loading': 'Loading specimens...',
        'selector.dataset.placeholder': 'Select a specimen...',
        'selector.model.disabled': 'Select a specimen',
        'status.datasetsLoadedFromCatalog': 'Loaded from catalog',
        'sync.openDownloads': 'Open downloads',
        'sync.downloadSpecimen': 'Download specimen',
      }[key] || fallback;
    },
    escapeHtml,
    windowRef: {
      localStorage: {
        getItem() {
          return null;
        },
        setItem() {},
        removeItem() {},
      },
    },
    datasetSelect,
    modelSelect,
    downloadSpecimenButton,
    metadata: {
      renderDatasetMetadata() {},
      updateExternalLinks() {},
    },
    searchHandlers: {
      resetTaxonomyState() {},
      setTaxonomyVisibility() {},
      initializeTaxonomySelectors() {},
      async buildSearchIndex() {},
      refreshSpecimenOptions() {},
    },
    setStatus() {},
    setProgressPercent() {},
    resetProgressPercent() {},
    setAllDatasets(value) {
      allDatasets = value;
    },
    getAllDatasets() {
      return allDatasets;
    },
    getActiveDatasetId() {
      return 'doi:10.34810/missing';
    },
    getComparisonMode() {
      return false;
    },
    updateCompareButtonState() {},
    updateProjectionButtons() {},
    updateOrbitModeButtons() {},
    updateTextureToggleButton() {},
    updateWireframeButton() {},
    updateLightingButton() {},
    updateAnaglyphButton() {},
    updateMeasureButton() {},
    updateNormalizeScaleButton() {},
    updateScaleReferenceButton() {},
    incrementDatasetToken() {
      datasetToken += 1;
      return datasetToken;
    },
    getDatasetToken() {
      return datasetToken;
    },
    incrementModelToken() {
      modelToken += 1;
      return modelToken;
    },
    getModelToken() {
      return modelToken;
    },
    openDownloads() {
      openDownloadsCount += 1;
    },
  });

  const originalLog = console.log;
  console.log = () => {};
  try {
    await controller.handleDownloadSpecimenButtonClick();
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(enqueueRequest, {
    datasetIds: ['doi:10.34810/missing'],
  });
  assert.equal(openDownloadsCount, 1);
  assert.equal(downloadSpecimenButton.disabled, false);
  assert.equal(downloadSpecimenButton.textContent, 'Open downloads');
  assert.ok(initListCalls >= 1);
});

test('model controller inline download button opens manager for active or error states', async () => {
  const datasetSelect = createSelectElement();
  const modelSelect = createSelectElement();
  const downloadSpecimenButton = {
    hidden: false,
    disabled: false,
    textContent: 'Open downloads',
    dataset: { datasetId: 'doi:10.34810/error' },
  };
  const allDatasets = [
    {
      value: 'doi:10.34810/error',
      label: 'Error specimen',
      downloadState: 'error',
    },
  ];
  let enqueueCalled = false;
  let openDownloadsCount = 0;

  const controller = initModelController({
    dataClient: {
      usesPersistentCatalog: true,
      async downloadEnqueue() {
        enqueueCalled = true;
      },
    },
    viewerApi: {
      clearScene() {},
    },
    translate(key, fallback) {
      return {
        'sync.openDownloads': 'Open downloads',
        'sync.downloadSpecimen': 'Download specimen',
      }[key] || fallback;
    },
    escapeHtml,
    windowRef: {},
    datasetSelect,
    modelSelect,
    downloadSpecimenButton,
    getAllDatasets() {
      return allDatasets;
    },
    getActiveDatasetId() {
      return 'doi:10.34810/error';
    },
    openDownloads() {
      openDownloadsCount += 1;
    },
  });

  await controller.handleDownloadSpecimenButtonClick();

  assert.equal(enqueueCalled, false);
  assert.equal(openDownloadsCount, 1);
});
