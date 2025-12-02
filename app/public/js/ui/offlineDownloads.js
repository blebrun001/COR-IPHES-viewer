const MANIFEST_KEY = 'offlineDatasets.v1';
export const OFFLINE_DATA_CACHE = 'esqueletos-offline-datasets-v1';

const readManifest = () => {
  try {
    const raw = window.localStorage.getItem(MANIFEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.datasets)) {
      return parsed.datasets;
    }
  } catch (error) {
    console.warn('Unable to read offline manifest', error);
  }
  return [];
};

const writeManifest = (datasets) => {
  try {
    const payload = { datasets };
    window.localStorage.setItem(MANIFEST_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn('Unable to persist offline manifest', error);
  }
};

export const listOfflineDatasets = () => {
  const datasets = readManifest();
  return Array.isArray(datasets)
    ? [...datasets].sort((a, b) =>
        (a.label || '').localeCompare(b.label || '', 'en', { sensitivity: 'base' }),
      )
    : [];
};

export const getOfflineModelsForDataset = (persistentId) => {
  if (!persistentId) return [];
  const entry = listOfflineDatasets().find((item) => item.value === persistentId);
  return entry && Array.isArray(entry.models)
    ? entry.models.filter((m) => m.offline !== false)
    : [];
};

export const isModelOffline = (persistentId, modelKey) =>
  getOfflineModelsForDataset(persistentId).some((m) => m.key === modelKey);

export const isDatasetOffline = (persistentId) => getOfflineModelsForDataset(persistentId).length > 0;

export const clearOfflineDownloads = async () => {
  try {
    window.localStorage.removeItem(MANIFEST_KEY);
  } catch (error) {
    console.warn('Failed to clear offline manifest', error);
  }
  if (typeof caches !== 'undefined') {
    try {
      await caches.delete(OFFLINE_DATA_CACHE);
    } catch (error) {
      console.warn('Failed to clear offline cache', error);
    }
  }
};

export async function downloadDatasetForOffline({
  dataClient,
  persistentId,
  modelKeys,
  onProgress,
  signal,
} = {}) {
  if (!dataClient) {
    throw new Error('dataClient is required to download datasets');
  }
  if (!persistentId) {
    throw new Error('persistentId is required to download datasets');
  }
  if (typeof caches === 'undefined') {
    throw new Error('Offline caching is not supported in this browser');
  }
  const cache = await caches.open(OFFLINE_DATA_CACHE);

  const entry = await dataClient.ensureDatasetPrepared(persistentId);
  const files = Array.isArray(entry?.files) ? entry.files : [];
  if (!files.length || !entry.models?.length) {
    throw new Error('No models found in this dataset');
  }

  const allModels = Array.isArray(entry.models) ? entry.models : [];
  const selectedModels =
    Array.isArray(modelKeys) && modelKeys.length
      ? allModels.filter((model) => modelKeys.includes(model.key))
      : allModels;

  if (!selectedModels.length) {
    throw new Error('No models selected for offline download');
  }

  const metadataUrl = `${dataClient.apiRoot}/datasets/:persistentId/?persistentId=${encodeURIComponent(
    persistentId
  )}`;
  const requests = new Set([metadataUrl]);
  const fileIds = new Set();

  // Cache every file in the dataset so the specimen can be used fully offline.
  files.forEach((file) => {
    const id = file?.dataFile?.id;
    if (id) {
      fileIds.add(id);
    }
  });

  fileIds.forEach((id) => {
    requests.add(`${dataClient.apiRoot}/access/datafile/${id}?format=original`);
  });

  let completed = 0;
  const total = requests.size;

  const notify = (ratio, context = {}) => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(ratio, context);
      } catch (error) {
        console.warn('Offline download progress callback failed', error);
      }
    }
  };

  for (const url of requests) {
    if (signal?.aborted) {
      throw new DOMException('Offline download aborted', 'AbortError');
    }
    const cached = await cache.match(url);
    if (!cached) {
      const response = await fetch(url, { signal });
      if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
      }
      await cache.put(url, response.clone());
    }
    completed += 1;
    notify(completed / total, { url });
  }

  const manifest = readManifest();
  const existingEntry = Array.isArray(manifest)
    ? manifest.find((item) => item.value === persistentId)
    : null;
  const previousOffline = existingEntry && Array.isArray(existingEntry.models) ? existingEntry.models : [];

  const manifestEntry = {
    value: persistentId,
    persistentId,
    label: entry.title || persistentId,
    identifier: entry.identifier || persistentId,
    specimenSummary: entry.specimenSummary || null,
    taxonomyPath: entry.taxonomyPath || null,
    models: allModels.map((model) => {
      const wasOffline = previousOffline.some((m) => m.key === model.key && m.offline);
      const nowOffline = selectedModels.some((m) => m.key === model.key);
      return {
        key: model.key,
        label: model.displayName || model.key,
        offline: wasOffline || nowOffline,
      };
    }),
    downloadedAt: Date.now(),
  };

  const filtered = Array.isArray(manifest)
    ? manifest.filter((item) => item.value !== persistentId)
    : [];
  filtered.push(manifestEntry);
  writeManifest(filtered);

  return manifestEntry;
}
