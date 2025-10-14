/**
 * Dataverse data access layer. Fetches datasets, indexes available models and
 * resolves related resources (OBJ, MTL, textures) for the viewer.
 */
import { getDefaultFetch } from '../utils/defaultFetch.js';

const DEFAULT_API_ROOT = "https://dataverse.csuc.cat/api";
const DEFAULT_DATAVERSE_ID = "cor-iphes";
const DEFAULT_FETCH = getDefaultFetch();

/**
 * Normalises path separators to forward slashes.
 *
 * @param {string} value - Raw path string.
 * @returns {string} Path using forward slashes.
 */
function normalizeSlashes(value) {
  return (value || "").replace(/\\/g, "/");
}

/**
 * Cleans a directory label by normalising slashes and trimming whitespace.
 *
 * @param {string} value - Directory label from Dataverse.
 * @returns {string} Tidied directory label.
 */
function normalizeDirectoryLabel(value) {
  return normalizeSlashes(value).trim();
}

/**
 * Builds a stable dataset-relative path for a file entry.
 *
 * @param {object} file - Dataverse file descriptor.
 * @returns {string} Normalised path within the dataset.
 */
function normalizeDatasetPath(file) {
  const directory = normalizeDirectoryLabel(file.directoryLabel || "");
  const label = normalizeSlashes(file.label || "").trim();
  return directory ? `${directory}/${label}` : label;
}

/**
 * Extracts base name information from a file label for quick comparisons.
 *
 * @param {string} label - File label including extension.
 * @returns {object} Base name variants.
 */
function normalizeBase(label) {
  const safe = normalizeSlashes(label || "");
  const dot = safe.lastIndexOf('.');
  const base = dot >= 0 ? safe.slice(0, dot) : safe;
  const baseTrim = base.trim();
  return {
    base,
    baseTrim,
    baseLower: base.toLowerCase(),
    baseTrimLower: baseTrim.toLowerCase(),
  };
}

/**
 * Splits a directory label into cleaned segments.
 *
 * @param {string} directoryLabel - Directory label from Dataverse.
 * @returns {string[]} Array of directory segments.
 */
function normalizeDirectoryParts(directoryLabel) {
  const clean = normalizeDirectoryLabel(directoryLabel);
  if (!clean) return [];
  return clean
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Attempts to infer specimen laterality (left/right/bilateral) from common string tokens.
 *
 * @param {string[]} sources - Candidate strings describing the element.
 * @returns {'left'|'right'|'bilateral'|null} Inferred laterality code.
 */
function inferLateralityFromStrings(sources = []) {
  if (!sources.length) return null;

  const text = sources
    .filter(Boolean)
    .map((value) =>
      normalizeSlashes(String(value))
        .replace(/[_\-]+/g, ' ')
        .replace(/[()]/g, ' ')
        .toLowerCase()
    )
    .join(' ');

  if (!text) return null;

  const bilateralPattern = /\b(bilateral|both sides?|pair(?:ed)?|double)\b/i;
  if (bilateralPattern.test(text)) {
    return 'bilateral';
  }

  const leftPattern = /\b(left|sinist(?:er|ra)|izquierd[ao]?|esquer(?:ra|re)|gauche)\b/i;
  if (leftPattern.test(text)) {
    return 'left';
  }

  const rightPattern = /\b(right|dex(?:ter|tra|tre)|derech[ao]?|dreta|destra|droite)\b/i;
  if (rightPattern.test(text)) {
    return 'right';
  }

  return null;
}

/**
 * Resolves a relative path against a dataset directory, handling traversal.
 *
 * @param {string} baseDir - Base directory to resolve from.
 * @param {string} relativePath - Relative path or URL.
 * @returns {string|null} Resolved dataset path or absolute URL.
 */
function resolveRelativePath(baseDir, relativePath) {
  if (!relativePath) return null;
  const trimmed = relativePath.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  let rel = normalizeSlashes(trimmed);
  if (rel.startsWith('/')) {
    rel = rel.slice(1);
  }
  const stack = baseDir ? baseDir.split('/').filter(Boolean) : [];
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

/**
 * Deduces the HTTP directory URL hosting a given resource URL.
 *
 * @param {string} url - Absolute resource URL.
 * @returns {string} Directory URL ending with a slash.
 */
function deriveHttpDirectory(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    if (segments.length > 1) {
      segments.pop();
    }
    let pathname = segments.join('/');
    if (!pathname.endsWith('/')) {
      pathname = `${pathname}/`;
    }
    parsed.pathname = pathname;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

/**
 * Creates lookup maps for OBJ/MTL relationships within a dataset.
 *
 * @param {object[]} files - Dataverse file entries for a dataset version.
 * @returns {object} Model index lookup structures.
 */
function buildModelIndex(files) {
  const fileMap = new Map();
  const fileMapLower = new Map();
  const fileNameMap = new Map();
  const entryByFileId = new Map();
  const mtlByDirBase = new Map();
  const mtlByDirBaseTrim = new Map();
  const mtlByBase = new Map();
  const mtlByBaseTrim = new Map();
  const groups = new Map();

  // Helper to gather multiple candidates per key (e.g. MTL variants).
  const pushToMap = (map, key, value) => {
    if (!key) return;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(value);
  };

  // Normalises Dataverse file entries into lookup-friendly objects.
  const createEntry = (file, path, extOverride) => {
    const { base, baseTrim, baseLower, baseTrimLower } = normalizeBase(
      file.label
    );
    const directoryParts = normalizeDirectoryParts(file.directoryLabel);
    const extMatch = (file.label || '').match(/\.([^.]+)$/);
    const ext = extOverride || (extMatch ? extMatch[1].toLowerCase() : null);

    const entry = {
      file,
      ext,
      path,
      base,
      baseTrim,
      baseLower,
      baseTrimLower,
      directory: directoryParts.join('/'),
      directoryParts,
    };

    entryByFileId.set(file.dataFile.id, entry);
    return entry;
  };

  files.forEach((file) => {
    if (!file?.dataFile?.id) return;

    const path = normalizeDatasetPath(file);
    if (!path) return;

    fileMap.set(path, file);
    fileMapLower.set(path.toLowerCase(), file);

    const labelKey = normalizeSlashes(file.label || '').trim().toLowerCase();
    if (labelKey) {
      pushToMap(fileNameMap, labelKey, file);
    }

    const entry = createEntry(file, path);

    if (entry.ext !== 'obj' && entry.ext !== 'mtl') {
      return;
    }

    const directoryParts = entry.directoryParts;
    const topName = directoryParts.length
      ? directoryParts[0]
      : entry.baseTrim || entry.base || entry.file.label || '';
    const topKey = (topName || '').trim().toLowerCase();

    if (!groups.has(topKey)) {
      groups.set(topKey, {
        key: topKey,
        displayName: topName.trim() || topName || entry.baseTrim || entry.base,
        objEntry: null,
        objSpecificity: -1,
      });
    }

    const group = groups.get(topKey);

    if (entry.ext === 'obj') {
      const specificity = directoryParts.length * 10 + entry.baseTrim.length;
      if (specificity > group.objSpecificity) {
        group.objEntry = entry;
        group.objSpecificity = specificity;
      }
    } else if (entry.ext === 'mtl') {
      pushToMap(mtlByDirBase, `${entry.directory}||${entry.baseLower}`, entry);
      pushToMap(
        mtlByDirBaseTrim,
        `${entry.directory}||${entry.baseTrimLower}`,
        entry
      );
      pushToMap(mtlByBase, entry.baseLower, entry);
      pushToMap(mtlByBaseTrim, entry.baseTrimLower, entry);
    }
  });

  const pickMate = (list, preferredDirectory) => {
    if (!list || !list.length) return null;
    if (preferredDirectory) {
      const exact = list.find((item) => item.directory === preferredDirectory);
      if (exact) return exact;
    }
    return list[0];
  };

  const findMtlForObj = (entry) => {
    const dir = entry.directory;
    const baseLower = entry.baseLower;
    const baseTrimLower = entry.baseTrimLower;

    const expectedPath = entry.path.replace(/\.obj$/i, '.mtl');
    const directFile =
      fileMap.get(expectedPath) || fileMapLower.get(expectedPath.toLowerCase());
    if (directFile) {
      const mateEntry = entryByFileId.get(directFile.dataFile.id);
      if (mateEntry) return mateEntry;
    }

    return (
      pickMate(mtlByDirBase.get(`${dir}||${baseLower}`), dir) ||
      pickMate(mtlByDirBaseTrim.get(`${dir}||${baseTrimLower}`), dir) ||
      pickMate(mtlByBase.get(baseLower), dir) ||
      pickMate(mtlByBaseTrim.get(baseTrimLower), dir)
    );
  };

  const models = [];
  const modelMap = new Map();

  groups.forEach((group) => {
    const objEntry = group.objEntry;
    if (!objEntry) return;

    const mtlEntry = findMtlForObj(objEntry);
    const directoryLabel = objEntry.directory || mtlEntry?.directory || '';
    const displayName =
      group.displayName ||
      objEntry.baseTrim ||
      objEntry.file.label ||
      objEntry.path;

    const model = {
      key: String(objEntry.file.dataFile.id),
      displayName,
      objEntry,
      mtlEntry,
      directory: directoryLabel,
      laterality: inferLateralityFromStrings([
        displayName,
        directoryLabel,
        objEntry?.file?.label,
        objEntry?.path,
        objEntry?.file?.description
      ]),
    };

    models.push(model);
    modelMap.set(model.key, model);
  });

  models.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' })
  );

  return { models, modelMap, fileMap, fileMapLower, fileNameMap };
}

/**
 * Extracts the human-readable dataset title from a detail response.
 *
 * @param {object} detail - Dataverse dataset detail payload.
 * @returns {string|null} Dataset title or null when missing.
 */
function extractTitle(detail) {
  const fields = detail?.data?.latestVersion?.metadataBlocks?.citation?.fields || [];
  const titleField = fields.find((field) => field.typeName === 'title');
  if (!titleField) return null;
  if (typeof titleField.value === 'string') {
    return titleField.value;
  }
  if (Array.isArray(titleField.value)) {
    const first = titleField.value.find((item) =>
      typeof item === 'string' ? item : typeof item?.value === 'string'
    );
    if (typeof first === 'string') {
      return first;
    }
    if (first?.value) {
      return first.value;
    }
  }
  return null;
}

/**
 * Retrieves a Dataverse file entry by relative path, case insensitive.
 *
 * @param {object} entry - Dataset cache entry holding lookup maps.
 * @param {string} path - Path or filename to resolve.
 * @param {string} [preferredDirectory=''] - Directory to prioritise when duplicates exist.
 * @returns {object|null} Matching Dataverse file entry.
 */
function getFileByPath(entry, path, preferredDirectory = '') {
  if (!path) return null;
  let normalized = normalizeSlashes(path).trim();
  if (!normalized) return null;
  normalized = normalized.replace(/^\.\/+/, '');

  const direct = entry.fileMap.get(normalized);
  if (direct) return direct;
  const trimmed = normalized.startsWith('/') ? normalized.slice(1) : normalized;
  const alt = entry.fileMap.get(trimmed);
  if (alt) return alt;
  const lowerNormalized = normalized.toLowerCase();
  const lowerDirect = entry.fileMapLower.get(lowerNormalized);
  if (lowerDirect) return lowerDirect;
  const lowerTrimmed = trimmed.toLowerCase();
  const lowerAlt = entry.fileMapLower.get(lowerTrimmed);
  if (lowerAlt) return lowerAlt;

  const filename = normalized.split('/').pop();
  if (filename && entry.fileNameMap) {
    const filenameLower = filename.toLowerCase();
    const candidates = entry.fileNameMap.get(filenameLower) || [];
    if (candidates.length) {
      const normalizedPreferred = preferredDirectory
        ? normalizeSlashes(preferredDirectory)
        : '';
      if (normalizedPreferred) {
        const match = candidates.find(
          (file) => normalizeSlashes(file.directoryLabel || '') === normalizedPreferred
        );
        if (match) return match;
      }
      return candidates[0];
    }
  }
  return null;
}

/**
 * Client wrapping Dataverse API calls and indexing dataset contents.
 */
export class DataverseClient {
  /**
   * @param {object} [options]
   * @param {string} [options.apiRoot] - Base Dataverse API URL.
   * @param {string} [options.dataverseId] - Identifier of the Dataverse collection.
   * @param {Function} [options.fetchImpl] - Optional fetch implementation.
   */
  constructor({ apiRoot = DEFAULT_API_ROOT, dataverseId = DEFAULT_DATAVERSE_ID, fetchImpl } = {}) {
    this.apiRoot = apiRoot;
    this.dataverseId = dataverseId;
    const resolvedFetch = fetchImpl || DEFAULT_FETCH;
    if (typeof resolvedFetch !== 'function') {
      throw new Error('Fetch API is not available in this environment');
    }
    this.fetchImpl = resolvedFetch;
    this.datasetCache = new Map();
  }

  /**
   * Clears all cached dataset metadata and model indexes.
   */
  resetCache() {
    this.datasetCache.clear();
  }

  /**
   * Fetches JSON from the API and raises on HTTP errors.
   *
   * @param {string} url - Absolute API endpoint.
   * @returns {Promise<any>} Parsed JSON payload.
   */
  async fetchJson(url) {
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.json();
  }

  /**
   * Lists datasets available in the configured Dataverse collection.
   *
   * @param {object} [options]
   * @param {boolean} [options.force=false] - When true, bypasses the cache.
   * @returns {Promise<Array<{label: string, value: string, identifier: string}>>}
   */
  async listDatasets({ force = false } = {}) {
    if (force) {
      this.resetCache();
    }

    const contents = await this.fetchJson(
      `${this.apiRoot}/dataverses/${this.dataverseId}/contents`
    );
    const datasets = contents?.data?.filter((item) => item.type === 'dataset') || [];

    const datasetInfos = [];

    for (const item of datasets) {
      const persistentId = `${item.protocol}:${item.authority}/${item.identifier}`;
      const cacheEntry = this.datasetCache.get(persistentId) || {
        textureCache: new Map(),
      };
      cacheEntry.identifier = item.identifier;
      cacheEntry.persistentId = persistentId;

      try {
        const detail = await this.fetchJson(
          `${this.apiRoot}/datasets/:persistentId/?persistentId=${encodeURIComponent(
            persistentId
          )}`
        );
        const title = extractTitle(detail) || item.identifier;
        cacheEntry.title = title;
        cacheEntry.detail = detail;
        cacheEntry.files = detail?.data?.latestVersion?.files || [];
        cacheEntry.models = null;
        cacheEntry.modelMap = null;
        cacheEntry.fileMap = null;
        cacheEntry.fileMapLower = null;
        cacheEntry.fileNameMap = null;
      } catch (error) {
        cacheEntry.title = cacheEntry.title || item.identifier;
        console.warn(`Failed to fetch dataset details for ${persistentId}`, error);
      }

      this.datasetCache.set(persistentId, cacheEntry);
      datasetInfos.push({
        label: cacheEntry.title || item.identifier,
        value: persistentId,
        identifier: item.identifier,
      });
    }

    datasetInfos.sort((a, b) =>
      a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })
    );

    return datasetInfos;
  }

  /**
   * Ensures dataset metadata and model indexes are available in the cache.
   *
   * @param {string} persistentId - Persistent dataset identifier.
   * @returns {Promise<object>} Cache entry enriched with lookup maps.
   */
  async ensureDatasetPrepared(persistentId) {
    if (!persistentId) {
      throw new Error('A dataset persistentId is required');
    }

    let entry = this.datasetCache.get(persistentId);
    if (!entry) {
      const detail = await this.fetchJson(
        `${this.apiRoot}/datasets/:persistentId/?persistentId=${encodeURIComponent(
          persistentId
        )}`
      );
      entry = {
        title: extractTitle(detail) || persistentId,
        detail,
        files: detail?.data?.latestVersion?.files || [],
      };
      this.datasetCache.set(persistentId, entry);
    }

    if (!entry.fileMap || !entry.fileNameMap || !entry.modelMap) {
      const { models, modelMap, fileMap, fileMapLower, fileNameMap } = buildModelIndex(
        entry.files || []
      );
      entry.models = models;
      entry.modelMap = modelMap;
      entry.fileMap = fileMap;
      entry.fileMapLower = fileMapLower;
      entry.fileNameMap = fileNameMap;
    }

    return entry;
  }

  /**
   * Lists OBJ models available for a given dataset.
   *
   * @param {string} persistentId - Persistent dataset identifier.
   * @returns {Promise<object[]>} Array of model descriptors.
   */
  async listDatasetModels(persistentId) {
    const entry = await this.ensureDatasetPrepared(persistentId);
    return entry.models || [];
  }

  /**
   * Returns cached metadata details for a dataset.
   *
   * @param {string} persistentId - Persistent dataset identifier.
   * @returns {object|null} Dataverse detail payload or null.
   */
  getDatasetMetadata(persistentId) {
    const entry = this.datasetCache.get(persistentId);
    return entry ? entry.detail : null;
  }

  /**
   * Builds a model source descriptor describing how to load OBJ/MTL/textures.
   *
   * @param {string} persistentId - Persistent dataset identifier.
   * @param {string} modelKey - Key of the model to load.
   * @returns {Promise<object>} Source descriptor consumed by the viewer.
   */
  async createModelSource(persistentId, modelKey) {
    const entry = await this.ensureDatasetPrepared(persistentId);
    const model = entry.modelMap.get(modelKey);
    if (!model) {
      throw new Error('Model not found in dataset');
    }

    const normalizeDir = (value) => normalizeSlashes(value || '');

    const objDirectory = normalizeDir(model.objEntry?.directory || model.directory || '');
    const defaultMtlDirectory = normalizeDir(
      model.mtlEntry?.directory || model.objEntry?.directory || model.directory || ''
    );

    const objUrl = `${this.apiRoot}/access/datafile/${model.objEntry.file.dataFile.id}?format=original`;

    const defaultMaterialLibrary = model.mtlEntry
      ? {
          url: `${this.apiRoot}/access/datafile/${model.mtlEntry.file.dataFile.id}?format=original`,
          textureBaseDir: defaultMtlDirectory,
        }
      : null;

    const datasetId = persistentId;

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
      if (file) {
        return {
          url: `${this.apiRoot}/access/datafile/${file.dataFile.id}?format=original`,
          textureBaseDir: normalizeDir(file.directoryLabel || file.directory || ''),
        };
      }
      return null;
    };

    const resolveTexturePath = (relativePath, { textureBaseDir } = {}) => {
      if (!relativePath) return null;
      if (/^https?:/i.test(relativePath)) {
        return {
          url: relativePath,
          cacheKey: `url:${relativePath}`,
        };
      }
      const baseDirRaw = textureBaseDir || defaultMtlDirectory || objDirectory;
      if (/^https?:/i.test(baseDirRaw)) {
        try {
          const absolute = new URL(relativePath, baseDirRaw).toString();
          return {
            url: absolute,
            cacheKey: `url:${absolute}`,
          };
        } catch (error) {
          return null;
        }
      }
      const baseDir = normalizeDir(baseDirRaw);
      const resolved = resolveRelativePath(baseDir, relativePath);
      if (!resolved) return null;
      if (/^https?:/i.test(resolved)) {
        return {
          url: resolved,
          cacheKey: `url:${resolved}`,
        };
      }
      const file = getFileByPath(entry, resolved, baseDir);
      if (!file) return null;
      return {
        url: `${this.apiRoot}/access/datafile/${file.dataFile.id}?format=original`,
        cacheKey: `dataset:${datasetId}:file:${file.dataFile.id}`,
      };
    };

    return {
      datasetId,
      modelKey,
      displayName: model.displayName,
      objUrl,
      objDirectory,
      defaultMaterialLibrary,
      resolveMaterialLibrary(reference, options = {}) {
        const resolved = resolveLibrary(reference, options);
        if (resolved) return resolved;
        return defaultMaterialLibrary;
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
}
