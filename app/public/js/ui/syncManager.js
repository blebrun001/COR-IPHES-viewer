/**
 * Owns the desktop synchronization and specimen download dialog.
 *
 * This module intentionally receives all external dependencies as parameters so
 * the heavy DOM workflow can be tested without requiring a Tauri runtime.
 */
export function initSyncManager({
  dataClient,
  documentRef = document,
  windowRef = window,
  translate = (key, fallback = '') => fallback,
  resetInterfaceState,
} = {}) {
  const syncButton = documentRef.getElementById('syncButton');
  const dialog = documentRef.getElementById('syncDialog');
  const closeButton = documentRef.getElementById('closeSync');
  const refreshButton = documentRef.getElementById('syncRefreshButton');
  const downloadAllButton = documentRef.getElementById('syncDownloadAllButton');
  const pauseAllButton = documentRef.getElementById('syncPauseButton');
  const resumeAllButton = documentRef.getElementById('syncResumeButton');
  const cancelAllButton = documentRef.getElementById('syncCancelButton');
  const deleteButton = documentRef.getElementById('syncDeleteButton');
  const summaryNode = documentRef.getElementById('syncSummary');
  const globalProgressNode = documentRef.getElementById('syncGlobalProgress');
  const selectionNode = documentRef.getElementById('syncSelection');
  const storageNode = documentRef.getElementById('syncStorage');
  const searchInput = documentRef.getElementById('syncSearchInput');
  const taxonomyFilterSelect = documentRef.getElementById('syncTaxonomyFilter');
  const downloadFilterSelect = documentRef.getElementById('syncDownloadFilter');
  const sortSelect = documentRef.getElementById('syncSortSelect');

  if (!syncButton || !dialog || !dataClient?.usesPersistentCatalog) {
    if (syncButton) {
      syncButton.hidden = true;
    }
    return { refresh: async () => {} };
  }

  let lastPreview = null;
  let pollTimer = null;
  let backgroundPollTimer = null;
  let selectionEntries = [];
  let knownDownloadStates = new Map();
  let interfaceReloadPromise = null;
  let latestDownloadSpecimens = [];
  let isBusy = false;

  const t = (key, fallback = '') => translate(key, fallback);
  const activeDownloadStates = new Set(['queued', 'downloading', 'paused', 'partial', 'error']);
  const downloadedStates = new Set(['downloaded', 'update_available']);
  const taxonomyLevels = ['class', 'order', 'family', 'subfamily', 'genus', 'species'];
  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>'"]/g, (char) => {
      const entities = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      };
      return entities[char] || char;
    });

  const setBusy = (busy) => {
    isBusy = Boolean(busy);
    [
      refreshButton,
      downloadAllButton,
      pauseAllButton,
      resumeAllButton,
      cancelAllButton,
      deleteButton,
    ]
      .filter(Boolean)
      .forEach((button) => {
        button.disabled = Boolean(busy);
      });
    if (!busy) {
      updateBulkDownloadButton(selectionEntries);
    }
  };

  const setSummary = (message, type = 'info') => {
    if (!summaryNode) return;
    summaryNode.textContent = message;
    summaryNode.dataset.type = type;
  };

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const normalizeDatasetForSelection = (dataset) => ({
    value: dataset?.value || dataset?.persistentId || dataset?.persistent_id || dataset?.id || '',
    label: dataset?.label || dataset?.title || dataset?.identifier || dataset?.value || '',
    identifier: dataset?.identifier || '',
    specimenSummary: dataset?.specimenSummary || dataset?.specimen_summary || {},
    taxonomyPath: dataset?.taxonomyPath || dataset?.taxonomy_path || {},
    downloadState:
      dataset?.downloadState ||
      dataset?.download_state ||
      dataset?.downloadStats?.state ||
      dataset?.download_stats?.state ||
      dataset?.state ||
      'missing',
    downloadStats: dataset?.downloadStats || dataset?.download_stats || {},
    currentFiles: dataset?.currentFiles || dataset?.current_files || [],
    error: dataset?.error || '',
  });

  const normalizeText = (value) => String(value ?? '').trim();
  const normalizeSearchText = (value) => normalizeText(value).toLocaleLowerCase();

  const getTaxonomyValue = (dataset, level) => normalizeText(dataset?.taxonomyPath?.[level]);

  const getTaxonomySortKey = (dataset) =>
    taxonomyLevels.map((level) => getTaxonomyValue(dataset, level).toLocaleLowerCase()).join(' ');

  const compareText = (a, b) =>
    normalizeText(a).localeCompare(normalizeText(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });

  const getDownloadSortRank = (state) => {
    if (downloadedStates.has(state)) return 3;
    if (state === 'missing') return 0;
    if (activeDownloadStates.has(state)) return 1;
    return 2;
  };

  const applySelectionFilters = (entries) => {
    const searchQuery = normalizeSearchText(searchInput?.value || '');
    const taxonomyFilter = taxonomyFilterSelect?.value || '';
    const downloadFilter = downloadFilterSelect?.value || 'all';
    const sortMode = sortSelect?.value || 'alpha';

    let output = entries;
    if (searchQuery) {
      output = output.filter(({ dataset }) => {
        const taxonomyText = taxonomyLevels
          .map((level) => getTaxonomyValue(dataset, level))
          .filter(Boolean)
          .join(' ');
        const haystack = normalizeSearchText([
          dataset?.label,
          dataset?.identifier,
          dataset?.value,
          taxonomyText,
        ].filter(Boolean).join(' '));
        return haystack.includes(searchQuery);
      });
    }
    if (taxonomyFilter) {
      const [level, value] = taxonomyFilter.split('\t');
      output = output.filter(({ dataset }) => getTaxonomyValue(dataset, level) === value);
    }
    if (downloadFilter === 'downloaded') {
      output = output.filter(({ dataset }) => downloadedStates.has(dataset.downloadState || 'missing'));
    } else if (downloadFilter === 'not_downloaded') {
      output = output.filter(({ dataset }) => !downloadedStates.has(dataset.downloadState || 'missing'));
    } else if (downloadFilter === 'active') {
      output = output.filter(({ dataset }) => activeDownloadStates.has(dataset.downloadState || 'missing'));
    }

    return [...output].sort((left, right) => {
      const leftDataset = left.dataset;
      const rightDataset = right.dataset;
      if (sortMode === 'taxonomy') {
        const taxonomyCompare = compareText(getTaxonomySortKey(leftDataset), getTaxonomySortKey(rightDataset));
        if (taxonomyCompare) return taxonomyCompare;
      } else if (sortMode === 'download') {
        const rankCompare =
          getDownloadSortRank(leftDataset.downloadState || 'missing') -
          getDownloadSortRank(rightDataset.downloadState || 'missing');
        if (rankCompare) return rankCompare;
      }
      return compareText(leftDataset.label || leftDataset.value, rightDataset.label || rightDataset.value);
    });
  };

  const renderTaxonomyFilterOptions = (entries) => {
    if (!taxonomyFilterSelect) return;
    const previousValue = taxonomyFilterSelect.value || '';
    const options = new Map();
    entries.forEach(({ dataset }) => {
      taxonomyLevels.forEach((level) => {
        const value = getTaxonomyValue(dataset, level);
        if (!value) return;
        options.set(`${level}\t${value}`, `${t(`taxonomy.${level}`, level)} · ${value}`);
      });
    });
    const optionHtml = [
      `<option value="">${escapeHtml(t('sync.allTaxa', 'All taxa'))}</option>`,
      ...[...options.entries()]
        .sort((left, right) => compareText(left[1], right[1]))
        .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`),
    ].join('');
    taxonomyFilterSelect.innerHTML = optionHtml;
    taxonomyFilterSelect.value = options.has(previousValue) ? previousValue : '';
  };

  const buildSelectionFromPreview = (preview) => {
    const datasets = Array.isArray(preview?.datasets) ? preview.datasets : [];
    return datasets
      .map((dataset) => ({ dataset: normalizeDatasetForSelection(dataset) }))
      .filter(({ dataset }) => dataset.value);
  };

  const buildSelectionFromDownloadStatus = () =>
    latestDownloadSpecimens
      .map((specimen) => ({
        dataset: normalizeDatasetForSelection({
          value: specimen?.datasetId,
          label: specimen?.label,
          downloadState: specimen?.state,
          downloadStats: {
            ...(specimen?.counts || {}),
            state: specimen?.state,
            filesTotal: specimen?.filesTotal,
            filesDone: specimen?.filesDone,
            bytesTotal: specimen?.bytesTotal,
            bytesDownloaded: specimen?.bytesDownloaded,
          },
          currentFiles: specimen?.currentFiles || [],
          error: specimen?.error || '',
        }),
      }))
      .filter(({ dataset }) => dataset.value);

  const mergeSelectionEntries = (primaryEntries, fallbackEntries) => {
    if (!fallbackEntries.length) return primaryEntries;
    const entriesById = new Map();
    fallbackEntries.forEach((entry) => {
      entriesById.set(entry.dataset.value, entry);
    });
    primaryEntries.forEach((entry) => {
      const fallback = entriesById.get(entry.dataset.value);
      entriesById.set(entry.dataset.value, {
        dataset: {
          ...(fallback?.dataset || {}),
          ...entry.dataset,
          downloadState: fallback?.dataset?.downloadState || entry.dataset.downloadState,
          downloadStats: fallback?.dataset?.downloadStats || entry.dataset.downloadStats,
          currentFiles: fallback?.dataset?.currentFiles || entry.dataset.currentFiles || [],
          error: fallback?.dataset?.error || entry.dataset.error || '',
        },
      });
    });
    return [...entriesById.values()];
  };

  const loadLocalSelectionEntries = async () => {
    const datasets = await dataClient.listDatasets({ force: false, includeIncomplete: true });
    if (!Array.isArray(datasets) || !datasets.length) {
      return [];
    }

    return datasets
      .map((rawDataset) => ({ dataset: normalizeDatasetForSelection(rawDataset) }))
      .filter(({ dataset }) => dataset.value);
  };

  const loadRemoteSelectionEntries = async () => {
    if (!lastPreview) {
      lastPreview = await dataClient.syncPreview().catch(() => null);
    }
    return buildSelectionFromPreview(lastPreview);
  };

  const loadSelectionEntries = async () => {
    const localEntries = await loadLocalSelectionEntries();
    const statusEntries = buildSelectionFromDownloadStatus();
    if (localEntries.length) {
      return mergeSelectionEntries(localEntries, statusEntries);
    }
    if (statusEntries.length) {
      return statusEntries;
    }
    return loadRemoteSelectionEntries();
  };

  const hasActiveDownloadEntries = (entries) =>
    entries.some(({ dataset }) => {
      const state = dataset?.downloadState || 'missing';
      return state === 'queued' || state === 'downloading';
    });

  const isMissingDownloadState = (state) =>
    !downloadedStates.has(state || 'missing') && !activeDownloadStates.has(state || 'missing');

  const canPauseDownloadState = (state) => state === 'queued' || state === 'downloading';
  const canResumeDownloadState = (state) => state === 'paused' || state === 'partial' || state === 'error';
  const canCancelDownloadState = (state) =>
    state === 'queued' ||
    state === 'downloading' ||
    state === 'paused' ||
    state === 'partial' ||
    state === 'error';

  const getStateMessage = (state) => {
    if (state === 'update_available') {
      return t('sync.stateMessages.update_available', 'Available offline, update available');
    }
    if (downloadedStates.has(state)) {
      return t('sync.stateMessages.downloaded', 'Available offline');
    }
    if (state === 'queued') {
      return t('sync.stateMessages.queued', 'Waiting in queue');
    }
    if (state === 'downloading') {
      return t('sync.stateMessages.downloading', 'Downloading now');
    }
    if (state === 'paused' || state === 'partial') {
      return t('sync.stateMessages.paused', 'Download can be resumed');
    }
    if (state === 'error') {
      return t('sync.stateMessages.error', 'Needs attention');
    }
    return t('sync.stateMessages.missing', 'Not on this computer');
  };

  const getStateLabel = (state) => t(`sync.states.${state || 'missing'}`, state || 'missing');

  const getProgressInfo = (stats = {}) => {
    const totalBytes = Number(stats.bytesTotal || 0);
    const downloadedBytes = Number(stats.bytesDownloaded || 0);
    const filesTotal = Number(stats.filesTotal || 0);
    const filesDone = Number(stats.filesDone || 0);
    const percent = totalBytes
      ? Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)))
      : filesTotal
        ? Math.min(100, Math.max(0, Math.round((filesDone / filesTotal) * 100)))
        : 0;
    const fileMeta = filesTotal
      ? `${filesDone} / ${filesTotal} ${t('sync.files', 'files')}`
      : '';
    const bytesMeta = totalBytes
      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
      : '';
    const meta = [fileMeta, bytesMeta].filter(Boolean).join(' · ');
    const label = totalBytes
      ? `${percent}%`
      : filesTotal
        ? `${filesDone} / ${filesTotal}`
        : '0%';
    return {
      percent,
      label,
      meta,
      filesTotal,
      filesDone,
      totalBytes,
      downloadedBytes,
    };
  };

  const getSpecimenActions = (state) => {
    if (state === 'downloaded' || state === 'update_available') {
      return ['delete'];
    }
    if (state === 'queued' || state === 'downloading') {
      return ['pause', 'cancel'];
    }
    if (state === 'paused' || state === 'partial' || state === 'error') {
      return ['resume', 'cancel', 'delete'];
    }
    return ['enqueue'];
  };

  const actionLabels = {
    enqueue: () => t('sync.downloadSpecimen', 'Download'),
    pause: () => t('sync.pauseSpecimen', 'Pause'),
    resume: () => t('sync.resumeSpecimen', 'Resume'),
    cancel: () => t('sync.cancelSpecimen', 'Cancel'),
    delete: () => t('sync.deleteSpecimen', 'Delete'),
  };

  const renderActionButton = (action, datasetId) => {
    const primary = action === 'enqueue' || action === 'resume';
    const danger = action === 'delete';
    const classes = [
      'sync-mini-action',
      primary ? 'sync-mini-action--primary' : '',
      danger ? 'sync-mini-action--danger' : '',
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-sync-action="${escapeHtml(action)}" data-dataset-id="${escapeHtml(datasetId)}">${escapeHtml(actionLabels[action]?.() || action)}</button>`;
  };

  const renderCurrentFiles = (dataset) => {
    const files = Array.isArray(dataset.currentFiles) ? dataset.currentFiles : [];
    const rows = files
      .slice(0, 4)
      .map((file) => {
        const fileProgress = getProgressInfo({
          bytesTotal: file?.totalBytes,
          bytesDownloaded: file?.bytesDownloaded,
        });
        const name = file?.label || file?.path || t('sync.currentFileFallback', 'Current file');
        const status = file?.status ? t(`sync.fileStates.${file.status}`, file.status) : '';
        const detail = [status, fileProgress.meta || fileProgress.label].filter(Boolean).join(' · ');
        return `<li>
          <span class="sync-file__name">${escapeHtml(name)}</span>
          <span class="sync-file__meta">${escapeHtml(detail)}</span>
        </li>`;
      })
      .join('');
    const error = dataset.error
      ? `<p class="sync-specimen-error">${escapeHtml(dataset.error)}</p>`
      : '';
    if (!rows && !error) return '';
    return `<div class="sync-current-files">
      ${rows ? `<div class="sync-current-files__label">${escapeHtml(t('sync.currentFiles', 'Current files'))}</div><ul>${rows}</ul>` : ''}
      ${error}
    </div>`;
  };

  const renderSpecimenRow = (dataset) => {
    const state = dataset.downloadState || 'missing';
    const progress = getProgressInfo(dataset.downloadStats || {});
    const actions = getSpecimenActions(state)
      .map((action) => renderActionButton(action, dataset.value))
      .join('');
    const activeDetails = renderCurrentFiles(dataset);
    const stateMessage = getStateMessage(state);
    const stateLabel = getStateLabel(state);
    const meta = progress.meta || t('sync.noSizeEstimate', 'Size estimate unavailable');
    return `<article class="sync-specimen-row sync-specimen-row--${escapeHtml(state)}" role="listitem">
      <div class="sync-specimen-main">
        <div class="sync-specimen-name">
          <span class="sync-row__title">${escapeHtml(dataset.label || dataset.value)}</span>
          <span class="sync-row__meta">${escapeHtml(dataset.identifier || dataset.value)}</span>
        </div>
        <div class="sync-specimen-state">
          <span class="sync-badge sync-badge--${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>
          <span class="sync-row__meta">${escapeHtml(stateMessage)}</span>
        </div>
      </div>
      <div class="sync-specimen-progress">
        <div class="sync-progress" aria-label="${escapeHtml(t('sync.specimenProgress', 'Specimen download progress'))}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}">
          <span style="width:${progress.percent}%"></span>
        </div>
        <span class="sync-row__meta">${escapeHtml(progress.label)}</span>
      </div>
      <div class="sync-row__meta sync-specimen-meta">${escapeHtml(meta)}</div>
      <div class="sync-specimen-actions">${actions}</div>
      ${activeDetails}
    </article>`;
  };

  const renderOverview = (downloads = null, storage = null, network = null) => {
    if (globalProgressNode && downloads?.global) {
      const progress = getProgressInfo(downloads.global);
      const statusParts = [
        `${progress.label} ${t('sync.complete', 'complete')}`,
        progress.meta,
      ].filter(Boolean);
      globalProgressNode.innerHTML = `<div class="sync-overview-progress">
        <span>${escapeHtml(t('sync.globalProgress', 'Global progress'))}</span>
        <div class="sync-progress" aria-hidden="true"><span style="width:${progress.percent}%"></span></div>
        <strong>${escapeHtml(statusParts.join(' · '))}</strong>
      </div>`;
    }

    if (storageNode && storage) {
      storageNode.textContent = `${formatBytes(storage.bytes)} · ${storage.files || 0} ${t('sync.files', 'files')}`;
    }

    if (!summaryNode || !network) return;
    const onlineLabel = network?.online
      ? t('sync.online', 'Online')
      : t('sync.offlineReady', 'Offline, using local specimens');
    const queueLabel = downloads
      ? `${downloads.downloading || 0} ${t('sync.downloading', 'downloading')}, ${downloads.queued || 0} ${t('sync.queued', 'queued')}, ${downloads.paused || 0} ${t('sync.paused', 'paused')}, ${downloads.error || 0} ${t('sync.errors', 'errors')}`
      : '';
    setSummary(`${onlineLabel}${queueLabel ? ` · ${queueLabel}` : ''}`);
  };

  const updateBulkDownloadButton = (entries) => {
    if (isBusy) return;
    const states = entries.map(({ dataset }) => dataset?.downloadState || 'missing');
    const missingCount = states.filter((state) => isMissingDownloadState(state)).length;
    if (downloadAllButton) {
      downloadAllButton.disabled = missingCount === 0;
      downloadAllButton.textContent = missingCount > 0
        ? `${t('sync.downloadMissing', 'Download missing')} (${missingCount})`
        : t('sync.noMissingDownloads', 'All available offline');
    }
    if (pauseAllButton) {
      pauseAllButton.disabled = !states.some(canPauseDownloadState);
    }
    if (resumeAllButton) {
      resumeAllButton.disabled = !states.some(canResumeDownloadState);
    }
    if (cancelAllButton) {
      cancelAllButton.disabled = !states.some(canCancelDownloadState);
    }
  };

  const resetViewerSpecimenList = async () => {
    if (typeof resetInterfaceState !== 'function') {
      return;
    }
    if (!interfaceReloadPromise) {
      dataClient.resetCache?.();
      interfaceReloadPromise = Promise.resolve()
        .then(() => resetInterfaceState({ forceDatasetReload: true }))
        .finally(() => {
          interfaceReloadPromise = null;
        });
    }
    await interfaceReloadPromise;
  };

  const syncDownloadStateTransitions = async (entries, { notifyCompleted = false } = {}) => {
    let completedSinceLastRead = false;
    const nextStates = new Map();
    entries.forEach(({ dataset }) => {
      const datasetId = dataset?.value;
      if (!datasetId) return;
      const nextState = dataset?.downloadState || 'missing';
      const previousState = knownDownloadStates.get(datasetId);
      if (
        notifyCompleted &&
        previousState &&
        !downloadedStates.has(previousState) &&
        downloadedStates.has(nextState)
      ) {
        completedSinceLastRead = true;
      }
      nextStates.set(datasetId, nextState);
    });
    knownDownloadStates = nextStates;
    if (completedSinceLastRead) {
      await resetViewerSpecimenList();
    }
  };

  const stopBackgroundDownloadWatch = () => {
    if (!backgroundPollTimer) return;
    windowRef.clearInterval(backgroundPollTimer);
    backgroundPollTimer = null;
  };

  const pollDownloadCompletion = async () => {
    try {
      const entries = await loadLocalSelectionEntries();
      await syncDownloadStateTransitions(entries, { notifyCompleted: true });
      if (!hasActiveDownloadEntries(entries)) {
        stopBackgroundDownloadWatch();
      }
    } catch (error) {
      console.warn('Failed to refresh download completion state', error);
    }
  };

  const startBackgroundDownloadWatch = () => {
    if (backgroundPollTimer || typeof windowRef.setInterval !== 'function') {
      return;
    }
    backgroundPollTimer = windowRef.setInterval(pollDownloadCompletion, 2000);
  };

  const renderSelectionEntries = (entries) => {
    renderTaxonomyFilterOptions(entries);
    updateBulkDownloadButton(entries);
    const visibleEntries = applySelectionFilters(entries);
    if (!visibleEntries.length) {
      selectionNode.innerHTML = `<p class="sync-empty">${escapeHtml(t('sync.noFilteredSpecimens', 'No specimens match the selected filters.'))}</p>`;
      return;
    }
    const rows = visibleEntries
      .map(({ dataset }) => renderSpecimenRow(dataset))
      .join('');
    const downloadedCount = visibleEntries.filter(({ dataset }) => downloadedStates.has(dataset.downloadState || 'missing')).length;
    const activeCount = visibleEntries.filter(({ dataset }) => activeDownloadStates.has(dataset.downloadState || 'missing')).length;
    const missingCount = visibleEntries.length - downloadedCount - activeCount;
    const listSummary = `${visibleEntries.length} ${t('sync.specimens', 'specimens')} · ${downloadedCount} ${t('sync.availableOffline', 'available offline')} · ${missingCount} ${t('sync.toDownload', 'to download')}${activeCount ? ` · ${activeCount} ${t('sync.inProgress', 'in progress')}` : ''}`;
    selectionNode.innerHTML = `<div class="sync-list-summary">${escapeHtml(listSummary)}</div><div class="sync-specimen-list" role="list" aria-label="${escapeHtml(t('sync.specimenListAria', 'Specimens available for download'))}">${rows}</div>`;
  };

  const renderSelection = async ({ notifyCompleted = false } = {}) => {
    if (!selectionNode) return;
    try {
      selectionEntries = await loadSelectionEntries();
      await syncDownloadStateTransitions(selectionEntries, { notifyCompleted });

      if (!selectionEntries.length) {
        updateBulkDownloadButton([]);
        selectionNode.innerHTML = `<p class="sync-empty">${escapeHtml(t('sync.selectionPrompt', 'Apply a catalog synchronization to select specimens.'))}</p>`;
        return;
      }

      renderSelectionEntries(selectionEntries);
    } catch (error) {
      selectionNode.innerHTML = `<p class="sync-error">${escapeHtml(error.message || String(error))}</p>`;
    }
  };

  const syncCatalogToLocal = async ({ confirmReplacements = true } = {}) => {
    if (typeof dataClient.syncPreview !== 'function' || typeof dataClient.syncApply !== 'function') {
      return null;
    }
    lastPreview = await dataClient.syncPreview();
    const decisions = [];
    for (const change of lastPreview.changes || []) {
      if (!change.requiresConfirmation) continue;
      if (!confirmReplacements) continue;
      const accepted = windowRef.confirm(
        `${t('sync.replaceQuestion', 'Replace the downloaded local specimen with the Dataverse update?')}\n\n${change.label}`,
      );
      if (accepted) {
        decisions.push({
          datasetId: change.datasetId,
          action: 'replace',
        });
      }
    }
    const result = await dataClient.syncApply(decisions);
    dataClient.resetCache?.();
    return result;
  };

  const refreshStatus = async () => {
    try {
      const [network, downloads, storage] = await Promise.all([
        dataClient.refreshNetworkStatus?.() || Promise.resolve({ online: true }),
        dataClient.downloadStatus?.() || Promise.resolve(null),
        dataClient.storageUsage?.() || Promise.resolve(null),
      ]);
      latestDownloadSpecimens = Array.isArray(downloads?.specimens) ? downloads.specimens : [];
      renderOverview(downloads, storage, network);
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    }
  };

  const openDialog = async () => {
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    await refreshStatus();
    await syncCatalogToLocal({ confirmReplacements: false }).catch(() => null);
    await renderSelection();
    if (hasActiveDownloadEntries(selectionEntries)) {
      startBackgroundDownloadWatch();
    }
    pollTimer = windowRef.setInterval(async () => {
      await refreshStatus();
      await renderSelection({ notifyCompleted: true });
    }, 2000);
  };

  const closeDialog = () => {
    if (pollTimer) {
      windowRef.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  };

  const refreshCatalogList = async () => {
    setBusy(true);
    try {
      setSummary(t('sync.refreshingList', 'Refreshing specimen list...'));
      const result = await syncCatalogToLocal({ confirmReplacements: true });
      if (result) {
        setSummary(`${result.applied || 0} ${t('sync.applied', 'applied')} · ${result.skipped || 0} ${t('sync.skipped', 'skipped')}`);
        if (typeof resetInterfaceState === 'function') {
          await resetInterfaceState({ forceDatasetReload: true });
        }
      }
      dataClient.resetCache?.();
      await refreshStatus();
      await renderSelection();
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const enqueueAll = async () => {
    setBusy(true);
    try {
      const count = await dataClient.downloadEnqueue({ all: true });
      setSummary(`${count} ${t('sync.filesQueued', 'files queued')} · ${t('sync.downloadsStarted', 'downloads started')}`);
      await refreshStatus();
      await renderSelection({ notifyCompleted: true });
      startBackgroundDownloadWatch();
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pauseAll = async () => {
    setBusy(true);
    try {
      await dataClient.downloadPause({});
      await refreshAfterSpecimenAction();
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const resumeAll = async () => {
    setBusy(true);
    try {
      await dataClient.downloadResume({});
      await refreshAfterSpecimenAction();
      startBackgroundDownloadWatch();
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelAll = async () => {
    const accepted = windowRef.confirm(t('sync.cancelQuestion', 'Cancel all active downloads?'));
    if (!accepted) return;
    setBusy(true);
    try {
      await dataClient.downloadCancel({});
      await refreshAfterSpecimenAction();
      stopBackgroundDownloadWatch();
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const refreshAfterSpecimenAction = async ({ reset = false } = {}) => {
    dataClient.resetCache?.();
    await refreshStatus();
    if (reset && typeof resetInterfaceState === 'function') {
      await resetInterfaceState({ forceDatasetReload: true });
    }
    await renderSelection({ notifyCompleted: true });
  };

  const handleSpecimenAction = async (action, datasetId) => {
    if (!action || !datasetId) return;
    setBusy(true);
    try {
      if (action === 'enqueue') {
        const count = await dataClient.downloadEnqueue({ datasetIds: [datasetId] });
        setSummary(`${count} ${t('sync.filesQueued', 'files queued')}`);
        await refreshAfterSpecimenAction();
        startBackgroundDownloadWatch();
        return;
      }
      if (action === 'resume') {
        await dataClient.downloadResume({ datasetId });
        await refreshAfterSpecimenAction();
        startBackgroundDownloadWatch();
        return;
      }
      if (action === 'pause') {
        await dataClient.downloadPause({ datasetId });
        await refreshAfterSpecimenAction();
        return;
      }
      if (action === 'cancel') {
        await dataClient.downloadCancel({ datasetId });
        await refreshAfterSpecimenAction();
        return;
      }
      if (action === 'delete') {
        const accepted = windowRef.confirm(t('sync.deleteSpecimenQuestion', 'Delete this downloaded specimen?'));
        if (!accepted) return;
        await dataClient.storageDelete({ datasetId });
        await refreshAfterSpecimenAction({ reset: true });
      }
    } catch (error) {
      setSummary(error.message || String(error), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSpecimenActionClick = (event) => {
    const button = event.target?.closest?.('[data-sync-action]');
    if (!button) return;
    event.preventDefault?.();
    return handleSpecimenAction(button.dataset.syncAction, button.dataset.datasetId);
  };

  syncButton.addEventListener('click', openDialog);
  closeButton?.addEventListener('click', closeDialog);
  refreshButton?.addEventListener('click', refreshCatalogList);
  downloadAllButton?.addEventListener('click', enqueueAll);
  pauseAllButton?.addEventListener('click', pauseAll);
  resumeAllButton?.addEventListener('click', resumeAll);
  cancelAllButton?.addEventListener('click', cancelAll);
  selectionNode?.addEventListener('click', handleSpecimenActionClick);
  searchInput?.addEventListener('input', () => renderSelectionEntries(selectionEntries));
  taxonomyFilterSelect?.addEventListener('change', () => renderSelectionEntries(selectionEntries));
  downloadFilterSelect?.addEventListener('change', () => renderSelectionEntries(selectionEntries));
  sortSelect?.addEventListener('change', () => renderSelectionEntries(selectionEntries));
  deleteButton?.addEventListener('click', async () => {
    const accepted = windowRef.confirm(t('sync.deleteQuestion', 'Delete all downloaded local specimens?'));
    if (!accepted) return;
    await dataClient.storageDelete({});
    await refreshStatus();
    if (typeof resetInterfaceState === 'function') {
      await resetInterfaceState({ forceDatasetReload: true });
    }
    await renderSelection();
    stopBackgroundDownloadWatch();
  });

  return {
    refresh: refreshStatus,
  };
}
