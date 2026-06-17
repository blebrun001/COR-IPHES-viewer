import { LocalCatalogClient } from './localCatalogClient.js';

/**
 * Compatibility facade for the application data layer.
 *
 * The finalized desktop app is local-catalog-first: Dataverse access happens in
 * the Rust backend, and this class keeps the UI insulated from that native
 * detail while preserving the older data-client method names.
 */
export class HybridDataClient {
  constructor({ localClient = new LocalCatalogClient() } = {}) {
    this.localClient = localClient;
    this.usesPersistentCatalog = localClient.isAvailable;
    this.online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  }

  async refreshNetworkStatus() {
    if (!this.localClient.isAvailable) {
      this.online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      return { online: this.online };
    }
    try {
      const status = await this.localClient.networkStatus();
      this.online = Boolean(status?.online);
      return status;
    } catch (error) {
      this.online = false;
      if (typeof window !== 'undefined') {
        window.__COR_IPHES_ONLINE__ = false;
      }
      return { online: false };
    }
  }

  async listDatasets(options = {}) {
    await this.refreshNetworkStatus();
    if (this.localClient.isAvailable) {
      try {
        return await this.localClient.listDatasets(options);
      } catch (error) {
        console.warn('Local catalog list failed', error);
        return [];
      }
    }

    console.warn('COR-IPHES Esqueletos Off-linea requires the Tauri desktop bridge.');
    return [];
  }

  async ensureDatasetPrepared(persistentId) {
    if (this.localClient.isAvailable) {
      const entry = await this.localClient.ensureDatasetPrepared(persistentId);
      if (entry?.models?.length) {
        return entry;
      }
    }
    throw new Error('Dataset is not available in the local catalog');
  }

  async listDatasetModels(persistentId) {
    const entry = await this.ensureDatasetPrepared(persistentId);
    return entry?.models || [];
  }

  getDatasetMetadata(persistentId) {
    return this.localClient.getDatasetMetadata?.(persistentId) || null;
  }

  getCachedDatasetEntry(persistentId) {
    return this.localClient.getCachedDatasetEntry?.(persistentId) || null;
  }

  getCachedDatasetEntries() {
    return this.localClient.getCachedDatasetEntries?.() || new Map();
  }

  resetCache() {
    this.localClient.resetCache?.();
  }

  async createModelSource(persistentId, modelKey) {
    if (this.localClient.isAvailable) {
      return this.localClient.createModelSource(persistentId, modelKey);
    }
    throw new Error('The Tauri desktop bridge is required to load local models');
  }

  async syncPreview() {
    return this.localClient.syncPreview();
  }

  async syncApply(decisions = []) {
    return this.localClient.syncApply(decisions);
  }

  async downloadEnqueue(request) {
    return this.localClient.downloadEnqueue(request);
  }

  async downloadPause(args = {}) {
    return this.localClient.downloadPause(args);
  }

  async downloadResume(args = {}) {
    return this.localClient.downloadResume(args);
  }

  async downloadCancel(args = {}) {
    return this.localClient.downloadCancel(args);
  }

  async downloadStatus() {
    return this.localClient.downloadStatus();
  }

  async storageUsage() {
    return this.localClient.storageUsage();
  }

  async storageDelete(args = {}) {
    return this.localClient.storageDelete(args);
  }
}
