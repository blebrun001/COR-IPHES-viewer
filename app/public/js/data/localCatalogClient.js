import { createDesktopBridge } from './desktopBridge.js';

/**
 * Desktop catalog client used by the UI and viewer orchestration.
 *
 * It hydrates raw Tauri command payloads into lookup maps, resolves OBJ/MTL
 * references to local asset URLs, and owns the small in-memory cache that keeps
 * repeated selector/model operations cheap.
 */
const normalizeSlashes = (value) => String(value || '').replace(/\\/g, '/');

function normalizeDatasetPath(file) {
  const directory = normalizeSlashes(file?.directoryLabel || '').trim().replace(/^\/+|\/+$/g, '');
  const label = normalizeSlashes(file?.label || '').trim().replace(/^\/+|\/+$/g, '');
  return directory ? `${directory}/${label}` : label;
}

function resolveRelativePath(baseDir, relativePath) {
  if (!relativePath) return null;
  const trimmed = String(relativePath).trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  let rel = normalizeSlashes(trimmed);
  if (rel.startsWith('/')) rel = rel.slice(1);
  const stack = baseDir ? normalizeSlashes(baseDir).split('/').filter(Boolean) : [];
  rel.split('/').forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      stack.pop();
    } else {
      stack.push(segment);
    }
  });
  return stack.join('/');
}

function deriveHttpDirectory(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    segments.pop();
    parsed.pathname = `${segments.join('/')}/`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function hydrateEntry(raw) {
  if (!raw) return null;
  const fileMap = new Map();
  const fileMapLower = new Map();
  const fileNameMap = new Map();

  (raw.files || []).forEach((file) => {
    const path = file.path || normalizeDatasetPath(file);
    if (path) {
      fileMap.set(path, file);
      fileMapLower.set(path.toLowerCase(), file);
    }
    const label = normalizeSlashes(file.label || '').trim().toLowerCase();
    if (label) {
      if (!fileNameMap.has(label)) {
        fileNameMap.set(label, []);
      }
      fileNameMap.get(label).push(file);
    }
  });

  const modelMap = new Map();
  (raw.models || []).forEach((model) => {
    modelMap.set(String(model.key), model);
  });

  return {
    persistentId: raw.persistentId,
    title: raw.title,
    detail: raw.detail,
    files: raw.files || [],
    models: raw.models || [],
    fileMap,
    fileMapLower,
    fileNameMap,
    modelMap,
  };
}

/**
 * Looks up catalog files by normalized path, case-insensitive path, or filename.
 * The filename fallback is necessary because older OBJ/MTL references are not
 * always stored with a directory prefix in Dataverse metadata.
 */
function getFileByPath(entry, path, preferredDirectory = '') {
  if (!entry || !path) return null;
  let normalized = normalizeSlashes(path).trim().replace(/^\.\/+/, '');
  if (!normalized) return null;
  const direct = entry.fileMap.get(normalized);
  if (direct) return direct;
  const trimmed = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const alt = entry.fileMap.get(trimmed);
  if (alt) return alt;
  const lower = trimmed.toLowerCase();
  const lowerDirect = entry.fileMapLower.get(lower);
  if (lowerDirect) return lowerDirect;
  const filename = trimmed.split('/').pop()?.toLowerCase();
  const candidates = filename ? entry.fileNameMap.get(filename) || [] : [];
  if (!candidates.length) return null;
  const preferred = normalizeSlashes(preferredDirectory || '');
  return (
    candidates.find((file) => normalizeSlashes(file.directoryLabel || '') === preferred) ||
    candidates[0]
  );
}

export class LocalCatalogClient {
  constructor({ bridge = createDesktopBridge() } = {}) {
    this.bridge = bridge;
    this.usesPersistentCatalog = bridge.isAvailable;
    this.entryCache = new Map();
  }

  get isAvailable() {
    return this.bridge.isAvailable;
  }

  async networkStatus() {
    if (!this.isAvailable) {
      return { online: typeof navigator !== 'undefined' ? navigator.onLine : true };
    }
    const status = await this.bridge.invoke('network_status');
    if (typeof window !== 'undefined') {
      window.__COR_IPHES_ONLINE__ = Boolean(status?.online);
    }
    return status;
  }

  async listDatasets(options = {}) {
    if (!this.isAvailable) return [];
    const args = {};
    if (Object.prototype.hasOwnProperty.call(options || {}, 'includeIncomplete')) {
      args.includeIncomplete = Boolean(options.includeIncomplete);
    }
    return Object.keys(args).length
      ? this.bridge.invoke('catalog_list', args)
      : this.bridge.invoke('catalog_list');
  }

  async ensureDatasetPrepared(persistentId) {
    if (!this.isAvailable || !persistentId) return null;
    if (this.entryCache.has(persistentId)) {
      return this.entryCache.get(persistentId);
    }
    const raw = await this.bridge.invoke('catalog_entry_command', { persistentId });
    const entry = hydrateEntry(raw);
    if (entry) {
      this.entryCache.set(persistentId, entry);
    }
    return entry;
  }

  async listDatasetModels(persistentId) {
    const entry = await this.ensureDatasetPrepared(persistentId);
    return entry?.models || [];
  }

  getDatasetMetadata(persistentId) {
    return this.entryCache.get(persistentId)?.detail || null;
  }

  getCachedDatasetEntry(persistentId) {
    return this.entryCache.get(persistentId) || null;
  }

  getCachedDatasetEntries() {
    return this.entryCache;
  }

  resetCache() {
    this.entryCache.clear();
  }

  async resolveAssetUrl(fileId) {
    if (!fileId) return null;
    const resolved = await this.bridge.invoke('asset_resolve', { fileId: Number(fileId) });
    if (!resolved?.path) return null;
    return this.bridge.convertFileSrc(resolved.path);
  }

  async buildAssetUrlMap(entry) {
    const pairs = await Promise.all(
      (entry.files || []).map(async (file) => {
        const fileId = file?.dataFile?.id;
        const url = await this.resolveAssetUrl(fileId);
        return [String(fileId), url];
      }),
    );
    return new Map(pairs.filter(([, url]) => Boolean(url)));
  }

  async createModelSource(persistentId, modelKey) {
    const entry = await this.ensureDatasetPrepared(persistentId);
    const model = entry?.modelMap?.get(String(modelKey));
    if (!entry || !model) {
      throw new Error('Model not found in local catalog');
    }

    const assetUrls = await this.buildAssetUrlMap(entry);
    const objFileId = model.objEntry?.file?.dataFile?.id;
    const objUrl = assetUrls.get(String(objFileId));
    if (!objUrl) {
      throw new Error('Model is not downloaded in the local catalog');
    }

    const normalizeDir = (value) => normalizeSlashes(value || '');
    const objDirectory = normalizeDir(model.objEntry?.directory || model.directory || '');
    const defaultMtlDirectory = normalizeDir(
      model.mtlEntry?.directory || model.objEntry?.directory || model.directory || '',
    );
    const mtlFileId = model.mtlEntry?.file?.dataFile?.id;
    const defaultMaterialLibrary = assetUrls.get(String(mtlFileId))
      ? {
          url: assetUrls.get(String(mtlFileId)),
          textureBaseDir: defaultMtlDirectory,
        }
      : null;

    // Material libraries and textures are resolved through catalog file IDs so
    // the viewer never needs direct knowledge of app-local storage paths.
    const resolveLibrary = (reference, { objDirectory: contextDir } = {}) => {
      if (!reference) return null;
      if (/^https?:/i.test(reference)) {
        return {
          url: reference,
          textureBaseDir: deriveHttpDirectory(reference),
        };
      }
      const baseDir = normalizeDir(contextDir || objDirectory);
      const resolved = resolveRelativePath(baseDir, reference);
      const file = getFileByPath(entry, resolved, baseDir);
      const url = file ? assetUrls.get(String(file.dataFile?.id)) : null;
      if (!url) return null;
      return {
        url,
        textureBaseDir: normalizeDir(file.directoryLabel || file.directory || ''),
      };
    };

    const resolveTexturePath = (relativePath, { textureBaseDir } = {}) => {
      if (!relativePath) return null;
      if (/^https?:/i.test(relativePath)) {
        return { url: relativePath, cacheKey: `url:${relativePath}` };
      }
      const baseDir = normalizeDir(textureBaseDir || defaultMtlDirectory || objDirectory);
      const resolved = resolveRelativePath(baseDir, relativePath);
      const file = getFileByPath(entry, resolved, baseDir);
      const url = file ? assetUrls.get(String(file.dataFile?.id)) : null;
      if (!url) return null;
      return {
        url,
        cacheKey: `local:${persistentId}:file:${file.dataFile?.id}`,
      };
    };

    return {
      datasetId: persistentId,
      modelKey,
      displayName: model.displayName,
      objUrl,
      objDirectory,
      defaultMaterialLibrary,
      resolveMaterialLibrary(reference, options = {}) {
        return resolveLibrary(reference, options) || defaultMaterialLibrary;
      },
      resolveTexturePath,
      getPreferredTextureDirectory() {
        return defaultMtlDirectory || objDirectory;
      },
      getMetadataDetail() {
        return entry.detail;
      },
    };
  }

  async syncPreview() {
    return this.bridge.invoke('sync_preview');
  }

  async syncApply(decisions = []) {
    const result = await this.bridge.invoke('sync_apply', { decisions });
    this.resetCache();
    return result;
  }

  async downloadEnqueue(request) {
    const result = await this.bridge.invoke('download_enqueue', { request });
    this.resetCache();
    return result;
  }

  async downloadPause(args = {}) {
    return this.bridge.invoke('download_pause', args);
  }

  async downloadResume(args = {}) {
    return this.bridge.invoke('download_resume', args);
  }

  async downloadCancel(args = {}) {
    return this.bridge.invoke('download_cancel', args);
  }

  async downloadStatus() {
    return this.bridge.invoke('download_status');
  }

  async storageUsage() {
    return this.bridge.invoke('storage_usage');
  }

  async storageDelete(args = {}) {
    const payload = {};
    if (args?.datasetId) {
      payload.datasetId = args.datasetId;
    }
    const result = await this.bridge.invoke('storage_delete', payload);
    this.resetCache();
    return result;
  }
}
