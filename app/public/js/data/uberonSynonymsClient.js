/**
 * Lightweight client to fetch and cache UBERON term synonyms locally.
 * Keeps a 24h TTL cache in localStorage to avoid repeated API calls.
 */
import { getDefaultFetch } from '../utils/defaultFetch.js';

const DEFAULT_API_ROOT = 'https://www.ebi.ac.uk/ols4/api/ontologies/uberon/terms';
const CACHE_KEY = 'uberonSynonymCache';
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FETCH = getDefaultFetch();

const normalizeUberonCode = (value) => {
  if (value == null) {
    return null;
  }
  const digits = String(value).match(/\d+/g)?.join('');
  if (!digits) {
    return null;
  }
  return digits.padStart(7, '0');
};

const cleanString = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
};

const dedupeStrings = (values = []) => {
  const result = [];
  const seen = new Set();
  values.forEach((value) => {
    const cleaned = cleanString(value);
    if (!cleaned) {
      return;
    }
    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(cleaned);
  });
  return result;
};

const areEntriesEqual = (a, b) => {
  if (!a || !b) return false;
  if (normalizeUberonCode(a.code) !== normalizeUberonCode(b.code)) {
    return false;
  }
  const labelA = cleanString(a.label) || '';
  const labelB = cleanString(b.label) || '';
  if (labelA !== labelB) {
    return false;
  }
  const synA = dedupeStrings(a.synonyms || []);
  const synB = dedupeStrings(b.synonyms || []);
  if (synA.length !== synB.length) {
    return false;
  }
  const setB = new Set(synB.map((value) => value.toLowerCase()));
  return synA.every((value) => setB.has(value.toLowerCase()));
};

export class UberonSynonymsClient {
  constructor({ apiRoot = DEFAULT_API_ROOT, fetchImpl } = {}) {
    this.apiRoot = apiRoot;
    const resolvedFetch = fetchImpl || DEFAULT_FETCH;
    if (typeof resolvedFetch !== 'function') {
      throw new Error('Fetch API is not available in this environment');
    }
    this.fetchImpl = resolvedFetch;
    this.cache = new Map();
    this.cacheTimestamp = 0;
    this.cacheLoaded = false;
    this.inflight = new Map();
  }

  normalizeCode(code) {
    return normalizeUberonCode(code);
  }

  getStorage() {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
    return null;
  }

  ensureCacheLoaded() {
    if (this.cacheLoaded) {
      return;
    }
    this.cacheLoaded = true;
    try {
      const storage = this.getStorage();
      const raw = storage?.getItem(CACHE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== CACHE_VERSION || !parsed.entries) {
        return;
      }
      this.cacheTimestamp = Number(parsed.timestamp) || 0;
      Object.entries(parsed.entries).forEach(([code, entry]) => {
        const normalizedCode = normalizeUberonCode(code);
        if (!normalizedCode) {
          return;
        }
        const normalizedEntry = {
          code: normalizedCode,
          label: cleanString(entry.label) || null,
          synonyms: dedupeStrings(entry.synonyms || []),
          fetchedAt: Number(entry.fetchedAt || entry.timestamp) || 0,
        };
        if (normalizedEntry.fetchedAt) {
          this.cache.set(normalizedCode, normalizedEntry);
        }
      });
    } catch (error) {
      console.warn('Failed to read UBERON synonym cache', error);
    }
  }

  persistCache() {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }
    const entries = {};
    this.cache.forEach((entry, code) => {
      entries[code] = {
        code,
        label: entry.label || null,
        synonyms: Array.isArray(entry.synonyms) ? entry.synonyms : [],
        fetchedAt: Number(entry.fetchedAt) || Date.now(),
      };
    });
    const payload = {
      version: CACHE_VERSION,
      timestamp: this.cacheTimestamp || Date.now(),
      entries,
    };
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to persist UBERON synonym cache', error);
    }
  }

  clearCache() {
    this.cache.clear();
    this.cacheTimestamp = 0;
    try {
      this.getStorage()?.removeItem(CACHE_KEY);
    } catch (error) {
      console.warn('Failed to clear UBERON synonym cache', error);
    }
  }

  isEntryFresh(entry) {
    if (!entry || !entry.fetchedAt) {
      return false;
    }
    return Date.now() - entry.fetchedAt < CACHE_TTL_MS;
  }

  isCacheExpired() {
    if (!this.cacheTimestamp) {
      return true;
    }
    return Date.now() - this.cacheTimestamp > CACHE_TTL_MS;
  }

  getEntryFromCache(code) {
    this.ensureCacheLoaded();
    const normalized = normalizeUberonCode(code);
    if (!normalized) {
      return null;
    }
    return this.cache.get(normalized) || null;
  }

  getEntriesFromCache(codes = []) {
    this.ensureCacheLoaded();
    const result = new Map();
    codes
      .map((code) => normalizeUberonCode(code))
      .filter(Boolean)
      .forEach((code) => {
        const entry = this.cache.get(code);
        if (entry) {
          result.set(code, entry);
        }
      });
    return result;
  }

  async refreshEntries(codes, { force = false } = {}) {
    this.ensureCacheLoaded();
    const normalizedCodes = Array.from(
      new Set((codes || []).map((code) => normalizeUberonCode(code)).filter(Boolean)),
    );
    if (!normalizedCodes.length) {
      return { updated: false, entries: new Map() };
    }

    const results = new Map();
    const refreshAll = force || this.isCacheExpired();
    let hasUpdates = false;
    let cacheTouched = false;

    await Promise.all(
      normalizedCodes.map(async (code) => {
        const cached = this.cache.get(code) || null;
        const needsFetch = refreshAll || !this.isEntryFresh(cached);
        if (!needsFetch && cached) {
          results.set(code, cached);
          return;
        }
        const entry = await this.fetchSynonymEntry(code, cached);
        if (entry) {
          results.set(code, entry);
          if (!cached || !areEntriesEqual(entry, cached)) {
            hasUpdates = true;
          }
          if (needsFetch && entry.fetchedAt) {
            cacheTouched = true;
          }
        }
      }),
    );

    if (hasUpdates || cacheTouched) {
      this.persistCache();
    }

    return { updated: hasUpdates, entries: results };
  }

  async fetchSynonymEntry(code, fallback = null) {
    const normalized = normalizeUberonCode(code);
    if (!normalized) {
      return fallback || null;
    }
    if (this.inflight.has(normalized)) {
      return this.inflight.get(normalized);
    }

    const promise = (async () => {
      try {
        const payload = await this.fetchJsonForCode(normalized);
        const entry = this.parseSynonymPayload(payload, normalized);
        if (entry) {
          this.cache.set(normalized, entry);
          this.cacheTimestamp = entry.fetchedAt || Date.now();
          return entry;
        }
        if (!fallback) {
          const placeholder = {
            code: normalized,
            label: null,
            synonyms: [],
            fetchedAt: Date.now(),
          };
          this.cache.set(normalized, placeholder);
          this.cacheTimestamp = placeholder.fetchedAt;
          return placeholder;
        }
      } catch (error) {
        console.warn('Failed to fetch UBERON synonyms for code', normalized, error);
      }
      return fallback || null;
    })();

    this.inflight.set(normalized, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(normalized);
    }
  }

  async fetchJsonForCode(code) {
    const url = `${this.apiRoot}?obo_id=UBERON:${code}`;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`UBERON request failed (${response.status}) for ${url}`);
    }
    return response.json();
  }

  pickBestTerm(terms, code) {
    if (!Array.isArray(terms) || !terms.length) {
      return null;
    }
    if (!code) {
      return terms[0];
    }
    const matched = terms.find((term) => {
      const candidates = [term.short_form, term.obo_id, term.iri];
      return candidates.some((value) => normalizeUberonCode(value) === code);
    });
    return matched || terms[0];
  }

  parseSynonymPayload(payload, code) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const terms = payload?._embedded?.terms;
    if (!Array.isArray(terms) || !terms.length) {
      return null;
    }
    const normalizedCode = normalizeUberonCode(code);
    const term = this.pickBestTerm(terms, normalizedCode);
    if (!term) {
      return null;
    }
    const label = cleanString(term.label) || null;
    const synonyms = dedupeStrings([
      ...(Array.isArray(term.synonyms) ? term.synonyms : []),
      ...(Array.isArray(term.obo_synonym) ? term.obo_synonym.map((item) => item?.name) : []),
    ]);

    return {
      code: normalizedCode,
      label,
      synonyms,
      fetchedAt: Date.now(),
    };
  }
}
