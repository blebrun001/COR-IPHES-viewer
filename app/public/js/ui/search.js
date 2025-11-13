// Handles taxonomy selection logic and search helpers for the UI panel.
import {
  setTaxonomySelectors as dispatchSetTaxonomySelectors,
  setTaxonomyState as dispatchSetTaxonomyState,
  setTaxonomyLevels as dispatchSetTaxonomyLevels,
  setTaxonomySupported as dispatchSetTaxonomySupported,
  setSearchIndex as dispatchSetSearchIndex,
  clearSearchIndex as dispatchClearSearchIndex,
  setSearchDebounceTimer as dispatchSetSearchDebounceTimer,
  resetSearchDebounceTimer as dispatchResetSearchDebounceTimer,
  resetTaxonomyState as dispatchResetTaxonomyState,
} from '../state/actions.js';
import {
  selectTaxonomySelectors,
  selectTaxonomyState,
  selectTaxonomyLevels,
  selectTaxonomySupported,
  selectSearchIndex,
  selectSearchDebounceTimer,
} from '../state/selectors.js';

/**
 * Builds a readable list of specimen attributes (sex, life stage, etc.).
 *
 * @param {object|null} summary - Specimen summary metadata.
 * @returns {string} Concatenated attribute label.
 */
export function formatSpecimenAttributes(summary) {
  if (!summary || typeof summary !== 'object') {
    return '';
  }
  const seen = new Set();
  const tokens = [];
  const pushValue = (value) => {
    if (!value) return;
    const key = String(value).toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    tokens.push(String(value));
  };
  pushValue(summary.sex);
  pushValue(summary.lifeStage);
  pushValue(summary.ageClass);
  return tokens.join(' · ');
}

/**
 * Builds the human-facing label for a specimen, appending attributes when available.
 *
 * @param {string} baseLabel - Base label (typically dataset title).
 * @param {object|null} summary - Specimen summary metadata.
 * @returns {string} Final label.
 */
export function formatSpecimenLabel(baseLabel, summary) {
  const label = baseLabel || '';
  const attributes = formatSpecimenAttributes(summary);
  if (!attributes) {
    return label;
  }
  return `${label} (${attributes})`;
}

/**
 * Constructs the display label for anatomical search results.
 *
 * @param {string} elementLabel - Anatomical element label.
 * @param {string} specimenLabel - Specimen label.
 * @param {object|null} summary - Specimen summary metadata.
 * @returns {string} Combined label.
 */
export function formatAnatomicalSearchLabel(elementLabel, specimenLabel, summary) {
  const base = elementLabel || '';
  const specimenPart = formatSpecimenLabel(specimenLabel || '', summary);
  if (!specimenPart) {
    return base;
  }
  return `${base} (${specimenPart})`;
}

/**
 * Extracts an UBERON code from free-form text.
 *
 * @param {string} text - Raw text to inspect.
 * @returns {string|null} Zero-padded UBERON code.
 */
export function extractUberonCode(text) {
  if (!text) return null;
  const normalized = String(text).trim();
  if (!normalized) return null;

  const explicit = normalized.match(/uberon[:_ -]?\s*([0-9]+)/i);
  if (explicit) {
    const digits = explicit[1].replace(/\D/g, '');
    if (digits) {
      return digits.padStart(7, '0');
    }
  }

  const leading = normalized.match(/^([0-9]{5,})\b/);
  if (leading) {
    const digits = leading[1].replace(/\D/g, '');
    if (digits) {
      return digits.padStart(7, '0');
    }
  }

  const embedded = normalized.match(/(?:^|[_\s-])([0-9]{5,})(?=[_\s-]|$)/);
  if (embedded) {
    const digits = embedded[1].replace(/\D/g, '');
    if (digits) {
      return digits.padStart(7, '0');
    }
  }

  const trailing = normalized.match(/\b([0-9]{5,})$/);
  if (trailing) {
    const digits = trailing[1].replace(/\D/g, '');
    if (digits) {
      return digits.padStart(7, '0');
    }
  }

  const bracketed = normalized.match(/\(([0-9]{5,})\)/);
  if (bracketed) {
    const digits = bracketed[1].replace(/\D/g, '');
    if (digits) {
      return digits.padStart(7, '0');
    }
  }

  return null;
}

/**
 * Tries to derive an UBERON ontology URL from a model's metadata.
 *
 * @param {object|null} modelInfo - Model descriptor.
 * @returns {string|null} UBERON URL when found.
 */
export function deriveUberonUrlFromModel(modelInfo) {
  if (!modelInfo) {
    return null;
  }

  const collectCandidates = (value) => {
    if (!value || typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    const segments = trimmed.split(/[\\/]/).map((segment) => segment.trim()).filter(Boolean);
    return [trimmed, ...segments];
  };

  const propertyNames = [
    'objDirectory',
    'directory',
    'displayName',
    'objEntryDirectory',
    'objEntryLabel',
    'mtlDirectory',
    'modelDirectory',
  ];

  const candidates = [];

  for (const name of propertyNames) {
    if (name in modelInfo) {
      candidates.push(...collectCandidates(modelInfo[name]));
    }
  }

  if (Array.isArray(modelInfo.additionalDirectories)) {
    modelInfo.additionalDirectories.forEach((value) => {
      candidates.push(...collectCandidates(value));
    });
  }

  if (typeof modelInfo.getPreferredTextureDirectory === 'function') {
    candidates.push(...collectCandidates(modelInfo.getPreferredTextureDirectory()));
  }

  for (const candidate of candidates) {
    const code = extractUberonCode(candidate);
    if (code) {
      return `http://purl.obolibrary.org/obo/UBERON_${code}`;
    }
  }

  return null;
}

/**
 * Resolves the UBERON code associated with a model, when available.
 *
 * @param {object|null} modelInfo - Model descriptor.
 * @returns {string|null} UBERON code.
 */
export function resolveUberonCodeFromModel(modelInfo) {
  const url = deriveUberonUrlFromModel(modelInfo);
  if (!url) {
    return null;
  }
  const match = url.match(/UBERON_(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Builds the option label for a model, appending UBERON code if detected.
 *
 * @param {object|null} modelInfo - Model descriptor.
 * @returns {string} Human readable label.
 */
export function formatModelOptionLabel(modelInfo) {
  const baseLabel = modelInfo?.displayName || '';
  if (!baseLabel) {
    return baseLabel;
  }

  const code = resolveUberonCodeFromModel(modelInfo);
  if (!code) {
    return baseLabel;
  }

  const escapedCode = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const variants = [
    `uberon[:_\\-\\s]*${escapedCode}`,
    `UBERON[_\\-\\s]*${escapedCode}`,
    `\\b${escapedCode}\\b`,
  ];

  let cleaned = baseLabel;
  variants.forEach((fragment) => {
    cleaned = cleaned.replace(
      new RegExp(`\\s*[\\(\\[\\-_]*\\s*${fragment}\\s*[\\)\\]\\-_]*\\s*`, 'ig'),
      ' ',
    );
  });

  cleaned = cleaned.replace(/[_]+/g, ' ');
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) {
    cleaned = baseLabel;
  }

  return `${cleaned} (UBERON:${code})`;
}

/**
 * Coordinates taxonomy filters and search interactions for the interface.
 *
 * @param {object} deps - Injected dependencies collected by the interface layer.
 * @returns {object} Collection of handlers and helpers consumed by the UI.
 */
export function initSearch(deps = {}) {
  const {
    translate,
    dataClient,
    datasetSelect,
    modelSelect,
    taxonomySelectContainer,
    taxonomyLevelsContainer,
    taxonomyGroup,
    searchInput,
    searchResults,
    documentRef,
    windowRef = window,
    escapeHtml,
    setStatus,
    getAllDatasets,
    setActiveDatasetId,
    i18n,
    appStateAccessors,
  } = deps;

  const TAXONOMY_LEVEL_DEFS = [
    { key: 'class', fallback: 'Class' },
    { key: 'order', fallback: 'Order' },
    { key: 'family', fallback: 'Family' },
    { key: 'subfamily', fallback: 'Subfamily' },
    { key: 'genus', fallback: 'Genus' },
    { key: 'species', fallback: 'Species' },
  ];
  const UNKNOWN_TAXON_VALUE = '__unknown__';

  const ensureMap = (value) => (value instanceof Map ? value : new Map(value || []));
  const getDatasets = () => {
    const datasets = typeof getAllDatasets === 'function' ? getAllDatasets() : [];
    return Array.isArray(datasets) ? datasets : [];
  };

  if (searchInput && searchResults?.id) {
    searchInput.setAttribute('role', 'combobox');
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.setAttribute('aria-controls', searchResults.id);
    searchInput.setAttribute('aria-expanded', 'false');
  }
  if (searchResults) {
    searchResults.setAttribute('role', 'listbox');
    searchResults.setAttribute('aria-hidden', 'true');
  }

  if (appStateAccessors) {
    appStateAccessors.getTaxonomySelectors = () => selectTaxonomySelectors();
    appStateAccessors.setTaxonomySelectors = (value) => {
      dispatchSetTaxonomySelectors(ensureMap(value));
    };
    appStateAccessors.getTaxonomyState = () => selectTaxonomyState();
    appStateAccessors.setTaxonomyState = (value) => {
      dispatchSetTaxonomyState(ensureMap(value));
    };
    appStateAccessors.getTaxonomyLevels = () => selectTaxonomyLevels();
    appStateAccessors.setTaxonomyLevels = (value) => {
      dispatchSetTaxonomyLevels(Array.isArray(value) ? value.slice() : []);
    };
    appStateAccessors.getTaxonomySupported = () => selectTaxonomySupported();
    appStateAccessors.setTaxonomySupported = (value) => {
      dispatchSetTaxonomySupported(Boolean(value));
    };
    appStateAccessors.getSearchIndex = () => selectSearchIndex();
    appStateAccessors.setSearchIndex = (value) => {
      const next = {
        specimens: Array.isArray(value?.specimens) ? value.specimens.slice() : [],
        elements: Array.isArray(value?.elements) ? value.elements.slice() : [],
      };
      dispatchSetSearchIndex(next);
    };
    appStateAccessors.getSearchDebounceTimer = () => selectSearchDebounceTimer();
    appStateAccessors.setSearchDebounceTimer = (value) => {
      const currentTimer = selectSearchDebounceTimer();
      if (currentTimer) {
        windowRef.clearTimeout(currentTimer);
      }
      if (value == null) {
        dispatchResetSearchDebounceTimer();
      } else {
        dispatchSetSearchDebounceTimer(value);
      }
    };
  }

  const cancelPendingSearch = () => {
    const timer = selectSearchDebounceTimer();
    if (timer) {
      windowRef.clearTimeout(timer);
      dispatchResetSearchDebounceTimer();
    }
  };

  let activeResultIndex = -1;
  let resultIdCounter = 0;
  let suppressSpecimenOptionsRefresh = false;

  const runWithoutSpecimenRefresh = (fn) => {
    suppressSpecimenOptionsRefresh = true;
    try {
      fn();
    } finally {
      suppressSpecimenOptionsRefresh = false;
    }
  };

  const getResultButtons = () => {
    if (!searchResults) {
      return [];
    }
    return Array.from(searchResults.querySelectorAll('.search-result-item'));
  };

  const clearActiveResult = () => {
    activeResultIndex = -1;
    getResultButtons().forEach((button) => {
      button.classList.remove('is-active');
      button.setAttribute('aria-selected', 'false');
    });
    if (searchInput) {
      searchInput.removeAttribute('aria-activedescendant');
    }
  };

  const setPopupVisibility = (visible) => {
    if (!searchResults) {
      return;
    }
    if (visible) {
      searchResults.hidden = false;
      searchResults.removeAttribute('hidden');
      searchResults.removeAttribute('aria-hidden');
      if (searchInput) {
        searchInput.setAttribute('aria-expanded', 'true');
      }
    } else {
      searchResults.hidden = true;
      searchResults.setAttribute('hidden', '');
      searchResults.setAttribute('aria-hidden', 'true');
      if (searchInput) {
        searchInput.setAttribute('aria-expanded', 'false');
        searchInput.removeAttribute('aria-activedescendant');
      }
    }
  };

  const getActiveElement = () => {
    if (documentRef && documentRef.activeElement) {
      return documentRef.activeElement;
    }
    if (typeof document !== 'undefined') {
      return document.activeElement;
    }
    return null;
  };

  const isSearchInteractionFocused = () => {
    const activeElement = getActiveElement();
    if (!activeElement) {
      return false;
    }
    if (searchInput && activeElement === searchInput) {
      return true;
    }
    if (searchResults && searchResults.contains(activeElement)) {
      return true;
    }
    return false;
  };

  const isSearchEventTarget = (target) => {
    if (!target) {
      return false;
    }
    if (searchInput && (target === searchInput || searchInput.contains?.(target))) {
      return true;
    }
    if (searchResults && searchResults.contains(target)) {
      return true;
    }
    return false;
  };

  const setActiveResult = (nextIndex) => {
    const buttons = getResultButtons();
    if (!buttons.length) {
      clearActiveResult();
      return null;
    }

    const clampedIndex = Math.max(0, Math.min(nextIndex, buttons.length - 1));
    buttons.forEach((button, idx) => {
      if (idx === clampedIndex) {
        button.classList.add('is-active');
        button.setAttribute('aria-selected', 'true');
        if (typeof button.scrollIntoView === 'function') {
          button.scrollIntoView({ block: 'nearest' });
        }
        if (searchInput) {
          const id = button.id;
          if (id) {
            searchInput.setAttribute('aria-activedescendant', id);
          } else {
            searchInput.removeAttribute('aria-activedescendant');
          }
        }
      } else {
        button.classList.remove('is-active');
        button.setAttribute('aria-selected', 'false');
      }
    });
    activeResultIndex = clampedIndex;
    return buttons[clampedIndex];
  };

  const handleSearchKeyNavigation = (event) => {
    if (!isSearchInteractionFocused() && !isSearchEventTarget(event.target)) {
      return;
    }

    if (!searchResults || searchResults.hidden) {
      return;
    }

    const buttons = getResultButtons();
    if (!buttons.length) {
      return;
    }

    const key = event.key;
    const isArrowDown = key === 'ArrowDown' || key === 'Down';
    const isArrowUp = key === 'ArrowUp' || key === 'Up';

    if (isArrowDown || isArrowUp) {
      event.preventDefault();
      const direction = isArrowDown ? 1 : -1;
      const nextIndex =
        activeResultIndex === -1
          ? direction === 1
            ? 0
            : buttons.length - 1
          : activeResultIndex + direction;
      setActiveResult(nextIndex);
      return;
    }

    if ((key === 'Enter' || key === 'Return') && activeResultIndex >= 0 && buttons[activeResultIndex]) {
      event.preventDefault();
      buttons[activeResultIndex].click();
    }
  };

  const clearSearchIndex = () => {
    dispatchClearSearchIndex();
  };

  const buildSearchIndex = async () => {
    clearSearchIndex();

    const datasets = getDatasets();
    console.log('=== Building search index ===');
    console.log('allDatasets.length:', datasets.length);

    const datasetCache = dataClient?.getCachedDatasetEntries?.();
    console.log('Total entries in cache:', datasetCache ? datasetCache.size : 0);
    if (datasetCache) {
      console.log('Cache keys:', Array.from(datasetCache.keys()));
    }

    const preparePromises = datasets.map(async (dataset) => {
      try {
        await dataClient.ensureDatasetPrepared(dataset.value);
      } catch (error) {
        console.warn('Failed to prepare dataset for search index:', dataset.label, error);
      }
    });
    await Promise.all(preparePromises);
    console.log('All datasets prepared for indexing');

    const nextIndex = {
      specimens: [],
      elements: [],
    };

    datasets.forEach((dataset) => {
      console.log('\n--- Processing dataset:', dataset.label, '(', dataset.value, ')');

      nextIndex.specimens.push({
        id: dataset.value,
        label: dataset.label,
        summary: dataset.specimenSummary || null,
      });

      const cachedEntry = dataClient?.getCachedDatasetEntry?.(dataset.value);
      if (!cachedEntry) {
        console.log('  ❌ NOT in cache');
        return;
      }

      console.log('  ✅ Found in cache');
      console.log('  - models:', cachedEntry.models ? cachedEntry.models.length : 'null');
      console.log(
        '  - modelMap:',
        cachedEntry.modelMap ? `Map with ${cachedEntry.modelMap.size} entries` : 'null',
      );

      if (cachedEntry.models && cachedEntry.models.length > 0) {
        console.log('  - First model:', cachedEntry.models[0]);
      }

      if (!cachedEntry.modelMap || cachedEntry.modelMap.size === 0) {
        console.log('  ⚠️ No modelMap or empty');
        return;
      }

      let elementCount = 0;
      cachedEntry.modelMap.forEach((modelInfo, key) => {
        const label = formatModelOptionLabel(modelInfo);
        const baseLabel = modelInfo?.displayName || '';
        const displayLabel = formatAnatomicalSearchLabel(
          baseLabel,
          dataset.label,
          dataset.specimenSummary,
        );

        nextIndex.elements.push({
          datasetId: dataset.value,
          modelKey: key,
          label,
          display: displayLabel,
          summary: dataset.specimenSummary || null,
        });
        elementCount += 1;
      });

      console.log('  ✅ Added', elementCount, 'anatomical elements');
    });

    dispatchSetSearchIndex(nextIndex);

    console.log('\n=== Search index built ===');
    console.log('Specimens:', nextIndex.specimens.length);
    console.log('Elements:', nextIndex.elements.length);
    console.log('===========================\n');
  };

  const normalizeSearchTerm = (text) => {
    if (!text || typeof text !== 'string') {
      return '';
    }
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  };

  const performSearch = (query) => {
    const normalized = normalizeSearchTerm(query);
    if (!normalized) {
      return { specimens: [], elements: [] };
    }

    const indexSnapshot = selectSearchIndex();

    console.log('\n🔍 Search query:', query, '(normalized:', `${normalized})`);
    console.log('📊 Search index size:', {
      specimens: indexSnapshot.specimens.length,
      elements: indexSnapshot.elements.length,
    });

    const matchingSpecimens = indexSnapshot.specimens.filter((specimen) => {
      const labelNorm = normalizeSearchTerm(specimen.label);
      return labelNorm.includes(normalized);
    });

    const matchingElements = indexSnapshot.elements.filter((element) => {
      const labelNorm = normalizeSearchTerm(element.label);
      const displayNorm = normalizeSearchTerm(element.display);
      return labelNorm.includes(normalized) || displayNorm.includes(normalized);
    });

    console.log('✅ Results found:', {
      specimens: matchingSpecimens.length,
      elements: matchingElements.length,
    });
    if (matchingElements.length > 0) {
      console.log(
        'First 3 matching elements:',
        matchingElements.slice(0, 3).map((element) => element.display),
      );
    }

    return {
      specimens: matchingSpecimens.slice(0, 20),
      elements: matchingElements.slice(0, 20),
    };
  };

  const resetSearchResults = () => {
    if (!searchResults) {
      return;
    }
    searchResults.innerHTML = '';
    setPopupVisibility(false);
    clearActiveResult();
    resultIdCounter = 0;
  };

  const handleSearchResultClick = (event) => {
    const button = event.currentTarget;
    const type = button.dataset.type;

    if (type === 'specimen') {
      const datasetId = button.dataset.id;
      if (datasetId && datasetSelect) {
        datasetSelect.value = datasetId;
        datasetSelect.dispatchEvent(new Event('change'));
        if (searchInput) {
          searchInput.value = '';
        }
        resetSearchResults();
      }
      return;
    }

    if (type !== 'element') {
      return;
    }

    const datasetId = button.dataset.datasetId;
    const modelKey = button.dataset.modelKey;
    if (!datasetId || !modelKey || !datasetSelect || !modelSelect) {
      return;
    }

    console.log('🔍 Search result clicked - dataset:', datasetId, 'model:', modelKey);

    if (searchInput) {
      searchInput.value = '';
    }
    resetSearchResults();

    const needsDatasetChange = datasetSelect.value !== datasetId;
    if (needsDatasetChange) {
      console.log('🔍 Changing dataset from', datasetSelect.value, 'to', datasetId);

      const observer = new MutationObserver(() => {
        if (modelSelect.options.length > 1 && !modelSelect.disabled) {
          console.log('🔍 modelSelect populated, selecting model:', modelKey);
          observer.disconnect();
          windowRef.setTimeout(() => {
            modelSelect.value = modelKey;
            if (modelSelect.value === modelKey) {
              modelSelect.dispatchEvent(new Event('change'));
            } else {
              console.error('❌ Model not found in select:', modelKey);
            }
          }, 50);
        }
      });

      observer.observe(modelSelect, { childList: true, subtree: true });

      datasetSelect.value = datasetId;
      datasetSelect.dispatchEvent(new Event('change'));

      windowRef.setTimeout(() => observer.disconnect(), 5000);
      return;
    }

    console.log('🔍 Same dataset, selecting model:', modelKey);
    modelSelect.value = modelKey;
    modelSelect.dispatchEvent(new Event('change'));
  };

  const renderSearchResults = (results) => {
    if (!searchResults) {
      return;
    }

    const hasResults = results.specimens.length > 0 || results.elements.length > 0;
    resultIdCounter = 0;
    if (!hasResults) {
      const noResultsMessage = escapeHtml(
        translate ? translate('search.noResults', 'No matches found') : 'No matches found',
      );
      searchResults.innerHTML = `<div class="search-no-results">${noResultsMessage}</div>`;
      setPopupVisibility(true);
      return;
    }

    let html = '';

    if (results.specimens.length > 0) {
      html += '<div class="search-results-section">';
      results.specimens.forEach((specimen) => {
        const displayLabel = formatSpecimenLabel(specimen.label, specimen.summary);
        const buttonId = `search-result-${resultIdCounter += 1}`;
        html += `<button type="button" id="${buttonId}" class="search-result-item" role="option" aria-selected="false" data-type="specimen" data-id="${escapeHtml(
          specimen.id,
        )}">`;
        html += `<span class="search-result-label"><span>${escapeHtml(displayLabel)}</span></span>`;
        html += '</button>';
      });
      html += '</div>';
    }

    if (results.elements.length > 0) {
      html += '<div class="search-results-section">';
      results.elements.forEach((element) => {
        const buttonId = `search-result-${resultIdCounter += 1}`;
        html += `<button type="button" id="${buttonId}" class="search-result-item" role="option" aria-selected="false" data-type="element" data-dataset-id="${escapeHtml(
          element.datasetId,
        )}" data-model-key="${escapeHtml(element.modelKey)}">`;
        html += `<span class="search-result-label"><span>${escapeHtml(element.display)}</span></span>`;
        html += '</button>';
      });
      html += '</div>';
    }

    searchResults.innerHTML = html;
    setPopupVisibility(true);
    clearActiveResult();

    searchResults.querySelectorAll('.search-result-item').forEach((button) => {
      button.addEventListener('click', handleSearchResultClick);
    });

    searchResults.querySelectorAll('.search-result-label span').forEach((span) => {
      const parent = span.parentElement;
      if (!parent) {
        span.classList.remove('scrolling');
        span.style.removeProperty('--scroll-distance');
        return;
      }
      const parentWidth = parent.offsetWidth;
      const textWidth = span.scrollWidth;
      const diff = textWidth - parentWidth;

      if (diff > 0) {
        const durationSeconds = Math.min(4, Math.max(1.4, diff / 140 + 1));
        span.style.setProperty('--scroll-distance', `-${diff}px`);
        span.style.setProperty('--scroll-duration', `${durationSeconds}s`);
        span.classList.add('scrolling');
      } else {
        span.classList.remove('scrolling');
        span.style.removeProperty('--scroll-distance');
        span.style.removeProperty('--scroll-duration');
      }
    });
  };

  const handleSearchInput = () => {
    cancelPendingSearch();
    const query = searchInput ? searchInput.value.trim() : '';

    if (!query) {
      resetSearchResults();
      return;
    }

    if (datasetSelect && datasetSelect.value) {
      datasetSelect.value = '';
      if (typeof setActiveDatasetId === 'function') {
        setActiveDatasetId(null);
      }
    }

    if (modelSelect) {
      modelSelect.value = '';
    }

    const taxonomySupported = selectTaxonomySupported();
    if (taxonomySupported) {
      const selectorsMap = selectTaxonomySelectors();
      if (selectorsMap.size > 0) {
        selectorsMap.forEach((selector) => {
          if (selector.value) {
            selector.value = '';
          }
        });
        const clearedState = new Map(selectTaxonomyState());
        selectorsMap.forEach((_, key) => {
          clearedState.set(key, null);
        });
        dispatchSetTaxonomyState(clearedState);
        refreshSpecimenOptions();
      }
    }

    const existingTimer = selectSearchDebounceTimer();
    if (existingTimer) {
      windowRef.clearTimeout(existingTimer);
    }

    const timerId = windowRef.setTimeout(() => {
      const results = performSearch(query);
      renderSearchResults(results);
    }, 150);
    dispatchSetSearchDebounceTimer(timerId);
  };

  const handleSearchInputFocus = () => {
    if (searchInput && searchInput.value.trim()) {
      handleSearchInput();
    }
  };

  const handleDocumentClick = (event) => {
    if (!searchResults || searchResults.hidden) {
      return;
    }
    if (
      searchInput &&
      !searchInput.contains(event.target) &&
      !searchResults.contains(event.target)
    ) {
      resetSearchResults();
    }
  };

  const normalizeTaxonomyValue = (value) => {
    if (!value) {
      return '';
    }
    return String(value)
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const getTaxonomyLabel = (levelKey, fallback) =>
    translate ? translate(`taxonomy.${levelKey}`, fallback) : fallback;

  const getUnknownLabel = () => (translate ? translate('taxonomy.unknown', 'Unknown') : 'Unknown');

  const getTaxonomySelectLabel = (levelKey, fallback) => {
    const selectPrefix = translate ? translate('taxonomy.select', 'Select') : 'Select';
    const levelLabel = getTaxonomyLabel(levelKey, fallback);
    return `${selectPrefix} ${levelLabel}`;
  };

  const setTaxonomyCollapsed = (collapsed) => {
    // Fonction conservée pour compatibilité mais ne fait plus rien
    // Le taxonomy selector n'est plus repliable
  };

  const setTaxonomyVisibility = (visible) => {
    const supported = selectTaxonomySupported();
    if (taxonomyGroup) {
      taxonomyGroup.hidden = !visible;
    }
    if (taxonomyLevelsContainer) {
      taxonomyLevelsContainer.hidden = !visible || !supported;
    }
    if (taxonomySelectContainer) {
      taxonomySelectContainer.hidden = !visible;
    }
  };

  const getDatasetsMatchingLevels = (levelIndex) => {
    if (!selectTaxonomySupported() || levelIndex <= 0) {
      return getDatasets();
    }
    const datasets = getDatasets();
    const applicableLevels = selectTaxonomyLevels().slice(0, levelIndex);
    const stateSnapshot = selectTaxonomyState();
    return datasets.filter((dataset) =>
      applicableLevels.every((level) => {
        const selected = stateSnapshot.get(level.key);
        if (!selected) return true;
        const datasetValue =
          normalizeTaxonomyValue(dataset.taxonomyPath?.[level.key]) || UNKNOWN_TAXON_VALUE;
        return datasetValue === selected;
      }),
    );
  };

  const populateTaxonomyLevel = (levelIndex, stateMap, selectorsMap, levels) => {
    const level = levels[levelIndex];
    const select = selectorsMap.get(level.key);
    if (!select) {
      return false;
    }

    const datasets = getDatasetsMatchingLevels(levelIndex);
    const valueMap = new Map();

    datasets.forEach((dataset) => {
      const rawValue = dataset.taxonomyPath?.[level.key];
      const normalized = normalizeTaxonomyValue(rawValue) || UNKNOWN_TAXON_VALUE;
      if (!valueMap.has(normalized)) {
        valueMap.set(normalized, rawValue || getUnknownLabel());
      }
    });

    const entries = Array.from(valueMap.entries());
    entries.sort((a, b) => {
      if (a[0] === UNKNOWN_TAXON_VALUE) return 1;
      if (b[0] === UNKNOWN_TAXON_VALUE) return -1;
      const locale = i18n?.currentLanguage || 'en';
      return a[1].localeCompare(b[1], locale, { sensitivity: 'base' });
    });

    const placeholder = getTaxonomySelectLabel(level.key, level.fallback);
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
    entries.forEach(([normalized, label]) => {
      const option = documentRef?.createElement
        ? documentRef.createElement('option')
        : document.createElement('option');
      option.value = normalized === UNKNOWN_TAXON_VALUE ? '' : normalized;
      option.textContent = label || getUnknownLabel();
      if (normalized === UNKNOWN_TAXON_VALUE) {
        option.dataset.isUnknown = 'true';
      }
      select.appendChild(option);
    });

    const previous = stateMap.get(level.key);
    const stillValid = previous && valueMap.has(previous) ? previous : null;

    let nextValue = stillValid;
    if (!nextValue && entries.length === 1) {
      nextValue = entries[0][0];
    }

    stateMap.set(level.key, nextValue);
    select.value = nextValue || '';
    const label = select.previousElementSibling;
    if (label) {
      label.textContent = getTaxonomyLabel(level.key, level.fallback);
    }
    return nextValue !== previous;
  };

  const refreshTaxonomyFromLevel = (startIndex = 0) => {
    if (!selectTaxonomySupported()) {
      return;
    }
    const levels = selectTaxonomyLevels();
    const selectorsMap = selectTaxonomySelectors();
    const stateMap = new Map(selectTaxonomyState());

    for (let index = startIndex; index < levels.length; index += 1) {
      const changed = populateTaxonomyLevel(index, stateMap, selectorsMap, levels);
      if (changed) {
        for (let downstream = index + 1; downstream < levels.length; downstream += 1) {
          stateMap.set(levels[downstream].key, null);
        }
      }
    }
    dispatchSetTaxonomyState(stateMap);
    if (!suppressSpecimenOptionsRefresh) {
      refreshSpecimenOptions();
    }
  };

  const filterDatasetsByTaxonomy = () => {
    const levels = selectTaxonomyLevels();
    if (!selectTaxonomySupported() || !levels.length) {
      return getDatasets();
    }
    const stateSnapshot = selectTaxonomyState();
    return getDatasets().filter((dataset) =>
      levels.every((level) => {
        const selected = stateSnapshot.get(level.key);
        if (!selected) return true;
        const datasetValue =
          normalizeTaxonomyValue(dataset.taxonomyPath?.[level.key]) || UNKNOWN_TAXON_VALUE;
        return datasetValue === selected;
      }),
    );
  };

  const updateSpecimenSelect = (datasets, statusKey) => {
    if (!datasetSelect) {
      return;
    }

    const placeholder = escapeHtml(
      translate ? translate('selector.dataset.placeholder', 'Select a specimen...') : 'Select a specimen...',
    );
    const unavailableLabel = escapeHtml(
      translate ? translate('selector.dataset.none', 'No specimens available') : 'No specimens available',
    );

    const options =
      `<option value="">${placeholder}</option>` +
      datasets
        .map(
          (info) =>
            `<option value="${escapeHtml(info.value)}">${escapeHtml(
              formatSpecimenLabel(info.label, info.specimenSummary),
            )}</option>`,
        )
        .join('');

    datasetSelect.innerHTML = options;

    if (!datasets.length) {
      datasetSelect.innerHTML += `<option value="" disabled>${unavailableLabel}</option>`;
    }

    datasetSelect.disabled = datasets.length === 0;
    datasetSelect.value = '';

    if (statusKey && typeof setStatus === 'function') {
      setStatus(statusKey, 'info');
    }
  };

  const refreshSpecimenOptions = (statusKey) => {
    const datasets = filterDatasetsByTaxonomy();
    updateSpecimenSelect(datasets, statusKey);
    if (!statusKey && typeof setStatus === 'function') {
      if (datasets.length > 0) {
        setStatus('status.selectDatasetAndModel', 'info');
      } else {
        setStatus('status.noSpecimensMatchTaxonomy', 'info');
      }
    }
  };

  const syncTaxonomyWithDataset = (dataset) => {
    if (!dataset || !selectTaxonomySupported()) {
      return;
    }

    const levels = selectTaxonomyLevels();
    if (!levels.length) {
      return;
    }

    const selectorsMap = selectTaxonomySelectors();
    if (!selectorsMap.size) {
      return;
    }

    const taxonomyPath = dataset.taxonomyPath || {};
    const nextState = new Map(selectTaxonomyState());
    levels.forEach((level) => {
      const normalizedValue = normalizeTaxonomyValue(taxonomyPath[level.key]) || null;
      nextState.set(level.key, normalizedValue);
    });

    runWithoutSpecimenRefresh(() => {
      dispatchSetTaxonomyState(nextState);
      refreshTaxonomyFromLevel(0);
    });

    const confirmedState = selectTaxonomyState();
    levels.forEach((level) => {
      const select = selectorsMap.get(level.key);
      if (!select) {
        return;
      }
      const value = confirmedState.get(level.key) || '';
      if (select.value !== value) {
        select.value = value;
      }
    });
  };

  function handleTaxonomyLevelChange(event) {
    const selectElement = event.target;
    const levelKey = selectElement.dataset.levelKey;
    const levelIndex = Number.parseInt(selectElement.dataset.levelIndex, 10) || 0;
    const newValue = selectElement.value || null;

    const levels = selectTaxonomyLevels();
    const nextState = new Map(selectTaxonomyState());
    nextState.set(levelKey, newValue);
    for (let downstream = levelIndex + 1; downstream < levels.length; downstream += 1) {
      nextState.set(levels[downstream].key, null);
    }
    dispatchSetTaxonomyState(nextState);
    refreshTaxonomyFromLevel(levelIndex + 1);
  }

  const initializeTaxonomySelectors = (datasets) => {
    const nextSelectors = new Map();
    const nextState = new Map();
    const supported =
      Array.isArray(datasets) &&
      datasets.some((dataset) => dataset.taxonomyPath && Object.keys(dataset.taxonomyPath).length);
    const levels = TAXONOMY_LEVEL_DEFS.filter((level) =>
      datasets.some((dataset) => dataset.taxonomyPath?.[level.key]),
    );

    if (!supported || !levels.length) {
      dispatchSetTaxonomySelectors(nextSelectors);
      dispatchSetTaxonomyState(nextState);
      dispatchSetTaxonomyLevels([]);
      dispatchSetTaxonomySupported(false);
      if (taxonomyLevelsContainer) {
        taxonomyLevelsContainer.innerHTML = '';
      }
      setTaxonomyVisibility(false);
      return;
    }

    if (taxonomyLevelsContainer) {
      taxonomyLevelsContainer.innerHTML = '';
      levels.forEach((level, index) => {
        const wrapper = documentRef?.createElement
          ? documentRef.createElement('div')
          : document.createElement('div');
        wrapper.className = 'taxonomy-selectors__item';

        const label = documentRef?.createElement
          ? documentRef.createElement('label')
          : document.createElement('label');
        const selectId = `taxonomy-${level.key}`;
        label.setAttribute('for', selectId);
        label.dataset.i18n = `taxonomy.${level.key}`;
        label.textContent = getTaxonomyLabel(level.key, level.fallback);

        const select = documentRef?.createElement
          ? documentRef.createElement('select')
          : document.createElement('select');
        select.id = selectId;
        select.dataset.levelKey = level.key;
        select.dataset.levelIndex = String(index);

        wrapper.appendChild(label);
        wrapper.appendChild(select);
        taxonomyLevelsContainer.appendChild(wrapper);

        nextSelectors.set(level.key, select);
        nextState.set(level.key, null);
      });
    }

    dispatchSetTaxonomySelectors(nextSelectors);
    dispatchSetTaxonomyState(nextState);
    dispatchSetTaxonomyLevels(levels);
    dispatchSetTaxonomySupported(true);
    setTaxonomyVisibility(true);
    refreshTaxonomyFromLevel(0);
  };

  const resetTaxonomyState = () => {
    dispatchResetTaxonomyState();
    if (taxonomyLevelsContainer) {
      taxonomyLevelsContainer.innerHTML = '';
    }
    setTaxonomyVisibility(false);
  };

  return {
    clearSearchIndex,
    buildSearchIndex,
    handleSearchInput,
    handleSearchInputFocus,
    handleSearchKeyNavigation,
    handleDocumentClick,
    handleTaxonomyLevelChange,
    initializeTaxonomySelectors,
    refreshTaxonomyFromLevel,
    refreshSpecimenOptions,
    setTaxonomyCollapsed,
    setTaxonomyVisibility,
    isTaxonomySupported: () => selectTaxonomySupported(),
    resetTaxonomyState,
    cancelPendingSearch,
    resetSearchResults,
    syncTaxonomyWithDataset,
  };
}
