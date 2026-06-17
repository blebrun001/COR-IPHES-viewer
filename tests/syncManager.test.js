import assert from 'node:assert/strict';
import test from 'node:test';
import { initSyncManager } from '../app/public/js/ui/syncManager.js';

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type).push(listener);
  }

  async click() {
    await this.dispatch('click');
  }

  async dispatch(type) {
    const listeners = this.listeners.get('click') || [];
    const typedListeners = type === 'click' ? listeners : this.listeners.get(type) || [];
    for (const listener of typedListeners) {
      await listener({
        target: this,
        preventDefault() {},
      });
    }
  }

  showModal() {
    this.open = true;
  }

  close() {
    this.open = false;
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  removeAttribute(name) {
    delete this[name];
  }
}

function createDocument() {
  const elements = new Map();
  [
    'syncButton',
    'syncDialog',
    'closeSync',
    'syncPreviewButton',
    'syncApplyButton',
    'syncRefreshButton',
    'syncDownloadAllButton',
    'syncPauseButton',
    'syncResumeButton',
    'syncCancelButton',
    'syncDeleteButton',
    'syncSummary',
    'syncGlobalProgress',
    'syncChanges',
    'syncDownloads',
    'syncSelection',
    'syncStorage',
    'syncSearchInput',
    'syncTaxonomyFilter',
    'syncDownloadFilter',
    'syncSortSelect',
  ].forEach((id) => elements.set(id, new FakeElement(id)));

  return {
    elements,
    getElementById(id) {
      return elements.get(id) || null;
    },
    querySelectorAll(selector) {
      if (selector === '.sync-model-checkbox:checked') {
        return [];
      }
      return [];
    },
  };
}

test('sync manager downloads specimens from row actions without checkboxes', async () => {
  const documentRef = createDocument();
  let enqueueRequest = null;
  let listDatasetsOptions = null;
  const dataClient = {
    usesPersistentCatalog: true,
    async refreshNetworkStatus() {
      return { online: true };
    },
    async downloadStatus() {
      return {
        queued: 0,
        downloading: 0,
        error: 0,
        global: { state: 'missing', filesTotal: 2, filesDone: 0 },
        specimens: [],
        files: [],
      };
    },
    async storageUsage() {
      return { bytes: 0, files: 0 };
    },
    async listDatasets(options) {
      listDatasetsOptions = options;
      return [
        {
          value: 'doi:10.34810/data2',
          label: 'Zebra specimen',
          identifier: 'data2',
          taxonomyPath: { order: 'Perissodactyla', family: 'Equidae' },
          downloadState: 'downloaded',
          downloadStats: { state: 'downloaded', filesTotal: 2, filesDone: 2 },
        },
        {
          value: 'doi:10.34810/data1',
          label: 'Specimen A',
          identifier: 'data1',
          taxonomyPath: { order: 'Primates', family: 'Cercopithecidae' },
          downloadState: 'missing',
          downloadStats: { state: 'missing', filesTotal: 2, filesDone: 0 },
        },
      ];
    },
    async downloadEnqueue(request) {
      enqueueRequest = request;
      return 2;
    },
  };
  const windowRef = {
    setInterval() {
      return 1;
    },
    clearInterval() {},
    confirm() {
      return true;
    },
  };

  initSyncManager({
    dataClient,
    documentRef,
    windowRef,
    translate: (key, fallback) => fallback,
  });

  await documentRef.elements.get('syncButton').click();

  const selectionHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.match(selectionHtml, /Specimen A/);
  assert.match(selectionHtml, /Zebra specimen/);
  assert.match(selectionHtml, /sync-specimen-list/);
  assert.doesNotMatch(selectionHtml, /sync-dataset-checkbox/);
  assert.doesNotMatch(selectionHtml, /sync-model-checkbox/);
  assert.match(selectionHtml, /data-sync-action="enqueue"/);
  assert.ok(selectionHtml.indexOf('Specimen A') < selectionHtml.indexOf('Zebra specimen'));
  assert.match(documentRef.elements.get('syncTaxonomyFilter').innerHTML, /Primates/);
  assert.equal(listDatasetsOptions.includeIncomplete, true);

  documentRef.elements.get('syncDownloadFilter').value = 'downloaded';
  await documentRef.elements.get('syncDownloadFilter').dispatch('change');
  const filteredHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.doesNotMatch(filteredHtml, /Specimen A/);
  assert.match(filteredHtml, /Zebra specimen/);

  documentRef.elements.get('syncDownloadFilter').value = 'all';
  await documentRef.elements.get('syncDownloadFilter').dispatch('change');
  documentRef.elements.get('syncSearchInput').value = 'primates';
  await documentRef.elements.get('syncSearchInput').dispatch('input');
  const searchByTaxonomyHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.match(searchByTaxonomyHtml, /Specimen A/);
  assert.doesNotMatch(searchByTaxonomyHtml, /Zebra specimen/);

  documentRef.elements.get('syncSearchInput').value = 'zebra';
  await documentRef.elements.get('syncSearchInput').dispatch('input');
  const searchByNameHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.doesNotMatch(searchByNameHtml, /Specimen A/);
  assert.match(searchByNameHtml, /Zebra specimen/);

  documentRef.elements.get('syncSearchInput').value = '';
  await documentRef.elements.get('syncSearchInput').dispatch('input');
  await documentRef.elements.get('syncDownloadFilter').dispatch('change');
  await documentRef.elements.get('syncSelection').listeners.get('click')[0]({
    target: {
      closest(selector) {
        assert.equal(selector, '[data-sync-action]');
        return {
          dataset: {
            syncAction: 'enqueue',
            datasetId: 'doi:10.34810/data1',
          },
        };
      },
    },
    preventDefault() {},
  });

  assert.deepEqual(enqueueRequest, {
    datasetIds: ['doi:10.34810/data1'],
  });
});

test('sync manager imports the full specimen list when opened with a partial local catalog', async () => {
  const documentRef = createDocument();
  let synced = false;
  const dataClient = {
    usesPersistentCatalog: true,
    async refreshNetworkStatus() {
      return { online: true };
    },
    async downloadStatus() {
      return { queued: 0, downloading: 0, error: 0, specimens: [] };
    },
    async storageUsage() {
      return { bytes: 0, files: 0 };
    },
    async syncPreview() {
      return {
        datasetsScanned: 2,
        changes: [{ changeType: 'added', datasetId: 'doi:10.34810/full', label: 'Full specimen' }],
        datasets: [
          { persistentId: 'doi:10.34810/seed', identifier: 'seed', title: 'Seed specimen' },
          { persistentId: 'doi:10.34810/full', identifier: 'full', title: 'Full specimen' },
        ],
      };
    },
    async syncApply() {
      synced = true;
      return { applied: 1, skipped: 0, changes: [] };
    },
    async listDatasets() {
      return synced
        ? [
            {
              value: 'doi:10.34810/full',
              label: 'Full specimen',
              identifier: 'full',
              downloadState: 'missing',
              downloadStats: { state: 'missing', filesTotal: 3, filesDone: 0 },
            },
            {
              value: 'doi:10.34810/seed',
              label: 'Seed specimen',
              identifier: 'seed',
              downloadState: 'missing',
              downloadStats: { state: 'missing', filesTotal: 1, filesDone: 0 },
            },
          ]
        : [
            {
              value: 'doi:10.34810/seed',
              label: 'Seed specimen',
              identifier: 'seed',
              downloadState: 'missing',
              downloadStats: { state: 'missing', filesTotal: 1, filesDone: 0 },
            },
          ];
    },
  };

  initSyncManager({
    dataClient,
    documentRef,
    windowRef: {
      setInterval() {
        return 1;
      },
      clearInterval() {},
      confirm() {
        throw new Error('Opening the manager should not prompt for replacements');
      },
    },
    translate: (key, fallback) => fallback,
  });

  await documentRef.elements.get('syncButton').click();

  const selectionHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.match(selectionHtml, /Seed specimen/);
  assert.match(selectionHtml, /Full specimen/);
});

test('sync manager falls back to download status specimens when catalog list is empty', async () => {
  const documentRef = createDocument();
  const dataClient = {
    usesPersistentCatalog: true,
    async refreshNetworkStatus() {
      return { online: true };
    },
    async downloadStatus() {
      return {
        queued: 1,
        downloading: 0,
        error: 0,
        specimens: [
          {
            datasetId: 'doi:10.34810/status-only',
            label: 'Queued specimen',
            state: 'queued',
            filesTotal: 3,
            filesDone: 1,
            bytesTotal: 300,
            bytesDownloaded: 100,
          },
        ],
      };
    },
    async storageUsage() {
      return { bytes: 100, files: 1 };
    },
    async listDatasets(options) {
      assert.equal(options.includeIncomplete, true);
      return [];
    },
    async syncPreview() {
      throw new Error('Remote catalog unavailable');
    },
  };

  initSyncManager({
    dataClient,
    documentRef,
    windowRef: {
      setInterval() {
        return 1;
      },
      clearInterval() {},
      confirm() {
        return true;
      },
    },
    translate: (key, fallback) => fallback,
  });

  await documentRef.elements.get('syncButton').click();

  const selectionHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.match(selectionHtml, /Queued specimen/);
  assert.match(selectionHtml, /queued/);
  assert.match(selectionHtml, /1 \/ 3 files/);
});

test('sync manager exposes pause and active file details for running specimen downloads', async () => {
  const documentRef = createDocument();
  let pauseRequest = null;
  let resumeRequest = null;
  let cancelRequest = null;
  let downloadState = 'downloading';
  const dataClient = {
    usesPersistentCatalog: true,
    async refreshNetworkStatus() {
      return { online: false };
    },
    async downloadStatus() {
      return {
        queued: 0,
        downloading: downloadState === 'downloading' ? 1 : 0,
        paused: downloadState === 'paused' ? 1 : 0,
        error: 0,
        global: {
          state: 'downloading',
          filesTotal: 4,
          filesDone: 1,
          bytesTotal: 1024,
          bytesDownloaded: 256,
        },
        specimens: [
          {
            datasetId: 'doi:10.34810/running',
            label: 'Running specimen',
            state: downloadState,
            filesTotal: 4,
            filesDone: 1,
            bytesTotal: 1024,
            bytesDownloaded: 256,
            currentFiles: [
              {
                label: 'cranium.obj',
                status: 'downloading',
                bytesDownloaded: 128,
                totalBytes: 512,
              },
            ],
          },
        ],
      };
    },
    async storageUsage() {
      return { bytes: 256, files: 1 };
    },
    async listDatasets(options) {
      assert.equal(options.includeIncomplete, true);
      return [
        {
          value: 'doi:10.34810/running',
          label: 'Running specimen',
          identifier: 'running',
          downloadState,
          downloadStats: {
            state: downloadState,
            filesTotal: 4,
            filesDone: 1,
            bytesTotal: 1024,
            bytesDownloaded: 256,
          },
        },
      ];
    },
    async downloadPause(request) {
      pauseRequest = request;
      downloadState = 'paused';
    },
    async downloadResume(request) {
      resumeRequest = request;
      downloadState = 'downloading';
    },
    async downloadCancel(request) {
      cancelRequest = request;
      downloadState = 'missing';
    },
  };

  initSyncManager({
    dataClient,
    documentRef,
    windowRef: {
      setInterval() {
        return 1;
      },
      clearInterval() {},
      confirm() {
        return true;
      },
    },
    translate: (key, fallback) => fallback,
  });

  await documentRef.elements.get('syncButton').click();

  const selectionHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.match(selectionHtml, /Running specimen/);
  assert.match(selectionHtml, /data-sync-action="pause"/);
  assert.match(selectionHtml, /cranium\.obj/);
  assert.match(selectionHtml, /Current files/);
  assert.match(documentRef.elements.get('syncSummary').textContent, /Offline, using local specimens/);
  assert.match(documentRef.elements.get('syncGlobalProgress').innerHTML, /25%/);
  assert.equal(documentRef.elements.get('syncPauseButton').disabled, false);
  assert.equal(documentRef.elements.get('syncResumeButton').disabled, true);
  assert.equal(documentRef.elements.get('syncCancelButton').disabled, false);

  await documentRef.elements.get('syncSelection').listeners.get('click')[0]({
    target: {
      closest(selector) {
        assert.equal(selector, '[data-sync-action]');
        return {
          dataset: {
            syncAction: 'pause',
            datasetId: 'doi:10.34810/running',
          },
        };
      },
    },
    preventDefault() {},
  });

  assert.deepEqual(pauseRequest, {
    datasetId: 'doi:10.34810/running',
  });

  await documentRef.elements.get('syncResumeButton').click();
  assert.deepEqual(resumeRequest, {});

  await documentRef.elements.get('syncPauseButton').click();
  assert.deepEqual(pauseRequest, {});
  assert.equal(documentRef.elements.get('syncPauseButton').disabled, true);
  assert.equal(documentRef.elements.get('syncResumeButton').disabled, false);

  await documentRef.elements.get('syncCancelButton').click();
  assert.deepEqual(cancelRequest, {});
});

test('sync manager shows resumable actions and specimen errors for interrupted downloads', async () => {
  const documentRef = createDocument();
  let resumeRequest = null;
  const dataClient = {
    usesPersistentCatalog: true,
    async refreshNetworkStatus() {
      return { online: true };
    },
    async downloadStatus() {
      return {
        queued: 0,
        downloading: 0,
        paused: 1,
        error: 1,
        global: { state: 'partial', filesTotal: 6, filesDone: 2 },
        specimens: [
          {
            datasetId: 'doi:10.34810/paused',
            label: 'Paused specimen',
            state: 'paused',
            filesTotal: 3,
            filesDone: 1,
          },
          {
            datasetId: 'doi:10.34810/error',
            label: 'Error specimen',
            state: 'error',
            filesTotal: 3,
            filesDone: 1,
            error: 'Network request failed',
          },
        ],
      };
    },
    async storageUsage() {
      return { bytes: 0, files: 0 };
    },
    async listDatasets() {
      return [];
    },
    async syncPreview() {
      throw new Error('Remote catalog unavailable');
    },
    async downloadResume(request) {
      resumeRequest = request;
    },
  };

  initSyncManager({
    dataClient,
    documentRef,
    windowRef: {
      setInterval() {
        return 1;
      },
      clearInterval() {},
      confirm() {
        return true;
      },
    },
    translate: (key, fallback) => fallback,
  });

  await documentRef.elements.get('syncButton').click();

  const selectionHtml = documentRef.elements.get('syncSelection').innerHTML;
  assert.match(selectionHtml, /Paused specimen/);
  assert.match(selectionHtml, /Error specimen/);
  assert.match(selectionHtml, /data-sync-action="resume"/);
  assert.match(selectionHtml, /Network request failed/);
  assert.doesNotMatch(selectionHtml, /sync-model-checkbox/);

  await documentRef.elements.get('syncSelection').listeners.get('click')[0]({
    target: {
      closest(selector) {
        assert.equal(selector, '[data-sync-action]');
        return {
          dataset: {
            syncAction: 'resume',
            datasetId: 'doi:10.34810/paused',
          },
        };
      },
    },
    preventDefault() {},
  });

  assert.deepEqual(resumeRequest, {
    datasetId: 'doi:10.34810/paused',
  });
});

test('sync manager reloads the main specimen list when a specimen finishes downloading', async () => {
  const documentRef = createDocument();
  const intervalCallbacks = [];
  let downloadState = 'missing';
  let resetCalls = 0;
  const dataClient = {
    usesPersistentCatalog: true,
    resetCache() {},
    async refreshNetworkStatus() {
      return { online: true };
    },
    async downloadStatus() {
      return { queued: downloadState === 'queued' ? 1 : 0, downloading: 0, error: 0, specimens: [] };
    },
    async storageUsage() {
      return { bytes: 0, files: 0 };
    },
    async listDatasets() {
      return [
        {
          value: 'doi:10.34810/data1',
          label: 'Specimen A',
          identifier: 'data1',
          downloadState,
          downloadStats: { state: downloadState, filesTotal: 2, filesDone: downloadState === 'downloaded' ? 2 : 0 },
        },
      ];
    },
    async downloadEnqueue() {
      downloadState = 'queued';
      return 2;
    },
  };

  initSyncManager({
    dataClient,
    documentRef,
    windowRef: {
      setInterval(callback) {
        intervalCallbacks.push(callback);
        return intervalCallbacks.length;
      },
      clearInterval() {},
      confirm() {
        return true;
      },
    },
    translate: (key, fallback) => fallback,
    async resetInterfaceState(options) {
      resetCalls += 1;
      assert.deepEqual(options, { forceDatasetReload: true });
    },
  });

  await documentRef.elements.get('syncButton').click();
  await documentRef.elements.get('syncSelection').listeners.get('click')[0]({
    target: {
      closest(selector) {
        assert.equal(selector, '[data-sync-action]');
        return {
          dataset: {
            syncAction: 'enqueue',
            datasetId: 'doi:10.34810/data1',
          },
        };
      },
    },
    preventDefault() {},
  });

  assert.equal(resetCalls, 0);
  downloadState = 'downloaded';
  await intervalCallbacks.at(-1)();

  assert.equal(resetCalls, 1);
  await intervalCallbacks[0]();
  assert.match(documentRef.elements.get('syncSelection').innerHTML, /downloaded/);
});
