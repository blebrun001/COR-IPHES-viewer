/**
 * Static English UI text catalog.
 *
 * Specimen names, anatomical element names, and taxonomy values come from the
 * catalog data and are intentionally not translated or normalized here.
 */
const ENGLISH_TEXT = Object.freeze({
  header: {
    toggleSidebar: 'Toggle sidebar',
    title: 'COR-IPHES Esqueletos Off-linea',
    subtitle: 'Portable 3D Model Viewer',
    tooltips: {
      toggleSidebar: 'Show or hide the sidebar panel',
    },
    logos: {
      iphesAlt: 'IPHES-CERCA logo',
    },
  },
  sidebar: {
    selectionHeading: 'Selection',
    taxonomyHeading: 'Taxonomy',
    datasetLabel: 'Specimen',
    datasetLoadingOption: 'Loading specimens...',
    modelLabel: 'Anatomical element',
    modelDisabledOption: 'Select a specimen',
    actionsLabel: 'Actions',
    reloadButton: 'Reload specimen list',
    metadataHeading: 'Specimen metadata',
    moreInfoHeading: 'More infos',
    links: {
      gbif: 'Species (GBIF)',
      cora: 'Species (CORA-RDR)',
      uberon: 'Anatomical element (OLS UBERON)',
      sync: 'Synchronize offline catalog',
      options: 'Open settings',
      reset: 'Reset interface',
    },
    tooltips: {
      dataset: 'Choose a specimen to load its models',
      model: 'Pick an anatomical element to view',
      settings: 'Settings',
      reload: 'Reload page',
      reset: 'Reset the interface and reload data',
      sync: 'Synchronize catalog and downloads',
      gbif: 'Open the GBIF page for this species',
      cora: 'Open the CORA-RDR record for this species',
      uberon: 'Open the ontology page for this element',
    },
  },
  search: {
    label: 'Search',
    placeholder: 'Search specimens or anatomical elements...',
    noResults: 'No matches found',
    tooltips: {
      input: 'Type to search specimens, anatomical elements, or taxonomy',
    },
  },
  viewer: {
    projection: {
      label: 'Projection',
      perspective: 'Perspective',
      orthographic: 'Orthographic',
    },
    orbit: {
      label: 'Orbit',
      upright: 'Upright',
      free: 'Free',
    },
    rotation: {
      enableGizmo: 'Enable rotation gizmo',
      disableGizmo: 'Disable rotation gizmo',
      gizmoTooltip: 'Rotation gizmo',
    },
    buttons: {
      disableTextures: 'Disable Textures',
      enableTextures: 'Enable Textures',
      disableWireframe: 'Disable Wireframe',
      enableWireframe: 'Enable Wireframe',
      restoreLights: 'Restore Lights',
      dimLights: 'Dim Lights',
      exitMeasure: 'Exit Measure',
      measure: 'Measure',
      clearMeasurements: 'Clear Measurements',
      capture: 'Capture',
      resetView: 'Reset View',
      enterFullscreen: 'Enter fullscreen',
      exitFullscreen: 'Exit fullscreen',
      enableClipping: 'Enable section view',
      disableClipping: 'Disable section view',
      clippingTooltip: 'Section view',
      disableLabels: 'Disable Labels',
      enableLabels: 'Enable Labels',
      enableNormalizeComparisonScale: 'Normalize comparison scale',
      disableNormalizeComparisonScale: 'Disable comparison scale normalisation',
      normalizeComparisonScaleTooltip: 'Normalize scales',
      enableScaleReference: 'Display Scale',
      disableScaleReference: 'Hide Scale',
      scaleReferenceTooltip: 'Reference cube',
      enableAnaglyph: 'Enable anaglyph view',
      disableAnaglyph: 'Disable anaglyph view',
    },
    toolbar: {
      showMore: 'More controls',
      showLess: 'Fewer controls',
      tooltips: {
        toggle: 'Show or hide secondary controls',
      },
    },
  },
  metadata: {
    itemLabel: 'Item',
    emptySelection: 'Select a specimen to display metadata.',
    emptyData: 'No metadata available for this specimen.',
  },
  selector: {
    dataset: {
      placeholder: 'Select a specimen...',
      loading: 'Loading specimens...',
      none: 'No offline specimens available yet',
    },
    model: {
      disabled: 'Select a specimen',
      loading: 'Loading models...',
      none: 'No OBJ/MTL model found',
      placeholder: 'Choose a model...',
      error: 'Load error',
      comparePrompt: 'Choose a model to compare...',
      downloadRequired: 'Download specimen to view models',
    },
  },
  comparison: {
    enterMode: 'Compare',
    exitMode: 'Exit comparison mode',
    modelA: 'Model A',
    modelB: 'Model B',
    sameModelError: 'Please select a different model to compare',
    loadError: 'Failed to load comparison model',
    tooltips: {
      enter: 'Load a second model alongside the current one',
      exit: 'Return to single model view',
    },
  },
  status: {
    loadingDatasets: 'Loading specimens...',
    datasetsLoadedFromCache: 'Data loaded from cache',
    datasetsLoadedFromAPI: 'Loaded from API',
    datasetsLoadedFromCatalog: 'Loaded from the local catalog',
    syncCatalogRequired: 'Open Offline downloads to update the catalog and download complete specimens.',
    datasetsLoadError: 'Failed to load specimen list.',
    selectDatasetAndModel: 'Select a specimen and a model.',
    noSpecimensMatchTaxonomy: 'No offline specimens match the current filters.',
    loadingDataset: 'Loading specimen...',
    loadingModelList: 'Loading model list...',
    noModelsInDataset: 'No OBJ/MTL model for this specimen.',
    selectModel: 'Select a 3D model to load.',
    specimenDownloadRequired: 'Download this specimen before viewing its models.',
    specimenDownloadEnqueueFailure: 'Unable to start specimen download.',
    datasetLoadFailure: 'Failed to load specimen.',
    loadingGeometry: 'Loading 3D model...',
    screenshotFailed: 'Unable to capture screenshot.',
    modelLoadFailure: 'Failed to load the 3D model.',
    screenshotSaved: 'Screenshot saved',
  },
  taxonomy: {
    select: 'Select',
    unknown: 'Unknown',
    kingdom: 'Kingdom',
    phylum: 'Phylum',
    class: 'Class',
    order: 'Order',
    family: 'Family',
    subfamily: 'Subfamily',
    genus: 'Genus',
    species: 'Species',
    tooltips: {
      class: 'Filter results by class',
      order: 'Filter results by order',
      family: 'Filter results by family',
      subfamily: 'Filter results by subfamily',
      genus: 'Filter results by genus',
      species: 'Filter results by species',
    },
  },
  clipping: {
    title: 'Section view',
    description: 'Use sliders or drag the plane handles in the scene to reveal cross-sections.',
    instruction: 'Drag the active plane handle or adjust the sliders to slice the model.',
    plane: {
      x: 'X plane',
      y: 'Y plane',
      z: 'Z plane',
    },
    actions: {
      enable: 'Enable',
      control: 'Take control',
      controlling: 'Controlling',
      invert: 'Invert',
      reset: 'Reset section',
      close: 'Close clipping controls',
    },
    inactive: 'Enable at least one plane to slice the model.',
  },
  options: {
    title: 'Options',
    closeAria: 'Close options dialog',
    tooltips: {
      close: 'Close the options dialog',
      screenshotBackground: 'Keep the background visible when capturing screenshots',
      anaglyph: 'Adjust the depth effect for anaglyph mode',
      reloadDatasets: 'Force reload of the specimen list',
    },
  },
  sync: {
    title: 'Offline downloads',
    subtitle: 'Download complete specimens so they remain usable without a network connection.',
    closeAria: 'Close downloads dialog',
    catalogHeading: 'Catalog',
    downloadHeading: 'Specimens',
    downloadHint: 'Each download includes the complete specimen. Individual bones and files are managed automatically.',
    activityHeading: 'Activity',
    storageHeading: 'Local storage',
    storageHint: 'Downloaded specimens stay available without a network connection.',
    refreshList: 'Update list',
    preview: 'Preview',
    apply: 'Apply',
    downloadAll: 'Download missing',
    downloadMissing: 'Download missing',
    noMissingDownloads: 'All available offline',
    pause: 'Pause all',
    resume: 'Resume all',
    cancel: 'Cancel all',
    deleteAll: 'Delete all',
    previewPrompt: 'Run a preview to inspect catalog changes.',
    noChanges: 'No catalog changes detected.',
    requiresConfirmation: 'Confirmation',
    noDownloads: 'No active downloads.',
    selectionPrompt: 'No specimens available in the local catalog yet.',
    noFilteredSpecimens: 'No specimens match the selected filters.',
    searchSpecimens: 'Search',
    searchPlaceholder: 'Search specimens...',
    taxonomyFilter: 'Taxonomy',
    allTaxa: 'All taxa',
    downloadFilter: 'Download state',
    allStates: 'All states',
    downloadedOnly: 'Downloaded',
    notDownloadedOnly: 'Not downloaded',
    activeOnly: 'Active',
    sortBy: 'Sort by',
    sortAlpha: 'Alphabetical',
    sortTaxonomy: 'Taxonomy',
    sortDownload: 'Download state',
    online: 'Online',
    offline: 'Offline',
    offlineReady: 'Offline, using local specimens',
    downloading: 'downloading',
    queued: 'queued',
    paused: 'paused',
    errors: 'errors',
    files: 'files',
    previewing: 'Scanning Dataverse catalog...',
    refreshingList: 'Refreshing specimen list...',
    specimens: 'specimens',
    changes: 'changes',
    replaceQuestion: 'Replace the downloaded local specimen with the Dataverse update?',
    applied: 'applied',
    skipped: 'skipped',
    filesQueued: 'files queued',
    downloadsStarted: 'downloads started',
    specimenListAria: 'Specimens available for download',
    deleteQuestion: 'Delete all downloaded local specimens from this computer?',
    cancelQuestion: 'Cancel all active downloads?',
    downloadSpecimen: 'Download',
    pauseSpecimen: 'Pause',
    resumeSpecimen: 'Resume',
    cancelSpecimen: 'Cancel',
    deleteSpecimen: 'Delete',
    deleteSpecimenQuestion: 'Delete this specimen from offline storage on this computer?',
    openDownloads: 'Open downloads',
    globalProgress: 'Global progress',
    complete: 'complete',
    currentFiles: 'Files in progress',
    currentFileFallback: 'Current file',
    noSizeEstimate: 'Size estimate unavailable',
    specimenProgress: 'Specimen download progress',
    availableOffline: 'available offline',
    toDownload: 'to download',
    inProgress: 'in progress',
    stateMessages: {
      missing: 'Not stored on this computer yet',
      queued: 'Waiting for its turn',
      partial: 'Interrupted, ready to resume',
      paused: 'Paused, ready to resume',
      downloading: 'Saving the complete specimen',
      downloaded: 'Ready without internet',
      error: 'Needs attention before it can finish',
      update_available: 'Ready offline, newer catalog data available',
    },
    states: {
      missing: 'Not downloaded',
      queued: 'Queued',
      partial: 'Interrupted',
      paused: 'Paused',
      downloading: 'Downloading',
      downloaded: 'Available offline',
      error: 'Needs attention',
      update_available: 'Update available',
    },
    fileStates: {
      queued: 'Queued',
      downloading: 'Downloading',
      paused: 'Paused',
      error: 'Error',
    },
  },
  option: {
    screenshotBackground: 'Background visible in screenshots',
    anaglyphSeparation: 'Anaglyph depth',
  },
});

export function resolveTextKey(source, key) {
  if (!source || !key) {
    return undefined;
  }
  return key.split('.').reduce((accumulator, segment) => {
    if (accumulator && Object.prototype.hasOwnProperty.call(accumulator, segment)) {
      return accumulator[segment];
    }
    return undefined;
  }, source);
}

export class EnglishTextCatalog {
  constructor({ dictionary = ENGLISH_TEXT } = {}) {
    this.dictionary = dictionary;
    this.currentLanguage = 'en';
    this.defaultLanguage = 'en';
  }

  async init() {}

  translate(key, { defaultValue = null } = {}) {
    const value = resolveTextKey(this.dictionary, key);
    if (value !== undefined && value !== null) {
      return String(value);
    }
    if (defaultValue !== null && defaultValue !== undefined) {
      return defaultValue;
    }
    return key || '';
  }

  applyToDocument(root = document) {
    const nodes = root.querySelectorAll('[data-text], [data-text-html], [data-text-attr]');
    nodes.forEach((node) => {
      if (node.hasAttribute('data-text')) {
        const key = node.getAttribute('data-text');
        node.textContent = this.translate(key, { defaultValue: node.textContent.trim() });
      }
      if (node.hasAttribute('data-text-html')) {
        const key = node.getAttribute('data-text-html');
        node.innerHTML = this.translate(key, { defaultValue: node.innerHTML });
      }
      if (node.hasAttribute('data-text-attr')) {
        const attributeSpec = node.getAttribute('data-text-attr');
        if (!attributeSpec) {
          return;
        }
        attributeSpec.split(',').forEach((entry) => {
          const [attr, key] = entry.split(':').map((segment) => segment.trim());
          if (!attr || !key) {
            return;
          }
          const value = this.translate(key, { defaultValue: node.getAttribute(attr) });
          if (value !== undefined && value !== null) {
            node.setAttribute(attr, value);
          }
        });
      }
    });
  }
}

export const englishText = new EnglishTextCatalog();
