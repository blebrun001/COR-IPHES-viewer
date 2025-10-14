/**
 * Orchestrates the UI layer: dataset/model selectors, metadata rendering,
 * viewer controls, and localisation glue code.
 */
import { DataverseClient } from '../data/dataverseClient.js';
import { i18n } from '../i18n/translator.js';

/**
 * Helper wrapper to keep translation lookups concise with a fallback string.
 *
 * @param {string} key - I18n key to resolve.
 * @param {string} [fallback=''] - Text to use when no translation is found.
 * @returns {string} Resolved translation or fallback.
 */
const translate = (key, fallback = '') => i18n.translate(key, { defaultValue: fallback });

/**
 * Escapes arbitrary text for safe HTML insertion.
 *
 * @param {unknown} value - Value to sanitise.
 * @returns {string} Escaped HTML string.
 */
function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => {
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

function formatSpecimenAttributes(summary) {
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

function formatSpecimenLabel(baseLabel, summary) {
  const label = baseLabel || '';
  const attributes = formatSpecimenAttributes(summary);
  if (!attributes) {
    return label;
  }
  return `${label} (${attributes})`;
}

/**
 * Converts metadata keys into reader-friendly labels.
 *
 * @param {string} label - Raw metadata key.
 * @returns {string} Human readable label.
 */
function humanizeLabel(label) {
  if (!label) {
    return '';
  }

  let clean = label;
  clean = clean.replace(/^dwc[_\-.]?/i, '');
  clean = clean.replace(/^dc[_\-.]?/i, '');
  clean = clean.replace(/^dcterms[_\-.]?/i, '');

  return clean
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, (char) => char.toUpperCase());
}

/**
 * Normalises different metadata value shapes into string arrays.
 *
 * @param {string} typeClass - Dataverse metadata field type.
 * @param {unknown} value - Raw value returned by the API.
 * @returns {string[]} Flattened string values.
 */
function extractTypedValue(typeClass, value) {
  if (value === null || value === undefined) {
    return [];
  }

  switch (typeClass) {
    case 'primitive':
    case 'string':
      return [String(value)];
    case 'controlledVocabulary':
      if (Array.isArray(value)) {
        return value.filter(Boolean).map((v) => String(v));
      }
      return value ? [String(value)] : [];
    case 'date':
      return [String(value)];
    case 'int':
    case 'number':
      return [String(value)];
    default:
      break;
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTypedValue(typeClass, item)).filter(Boolean);
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .flatMap((item) => extractTypedValue(typeClass, item))
      .filter(Boolean);
  }

  return value ? [String(value)] : [];
}

/**
 * Recursively extracts human-friendly values from Dataverse metadata nodes.
 *
 * @param {unknown} source - Arbitrary metadata representation.
 * @returns {string[]} Collected values as strings.
 */
function extractMetadataValues(source) {
  if (source === null || source === undefined) {
    return [];
  }

  if (source.typeClass && 'value' in source) {
    return extractTypedValue(source.typeClass, source.value);
  }

  if (Array.isArray(source)) {
    return source.flatMap((item) => extractMetadataValues(item)).filter(Boolean);
  }

  if (typeof source === 'object') {
    if ('value' in source) {
      return extractMetadataValues(source.value);
    }
    return Object.values(source)
      .flatMap((item) => extractMetadataValues(item))
      .filter(Boolean);
  }

  return [String(source)];
}

/**
 * Retrieves a single metadata field value while handling Dataverse data shapes.
 *
 * @param {Object} block - Metadata block object.
 * @param {string} fieldName - Field name or display name to look for.
 * @returns {string|null} Normalised string value when present.
 */
function extractFieldValue(block, fieldName) {
  if (!block || !block.fields) return null;
  const field = block.fields.find(f => 
    f.typeName === fieldName || 
    f.displayName === fieldName ||
    f.typeName?.toLowerCase() === fieldName.toLowerCase()
  );
  if (!field) return null;
  
  const value = field.value;
  if (!value) return null;
  
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0];
    if (typeof first === 'string') return first;
    if (typeof first === 'object' && first.value) return String(first.value);
  }
  if (typeof value === 'object' && value.value) return String(value.value);
  
  return null;
}

/**
 * Populates the external reference links based on dataset metadata and model hints.
 *
 * @param {object|null} detail - Dataverse dataset detail payload.
 * @param {HTMLAnchorElement} coraLink - Link pointing to CORA-RDR.
 * @param {HTMLAnchorElement} gbifLink - Link pointing to GBIF.
 * @param {HTMLAnchorElement|null} uberonLink - Link pointing to UBERON (optional).
 * @param {object|null} [modelInfo=null] - Selected model metadata used to infer UBERON codes.
 */
function updateExternalLinks(detail, coraLink, gbifLink, uberonLink, modelInfo = null) {
  if (!coraLink || !gbifLink) {
    return;
  }

  const hideAll = () => {
    coraLink.hidden = true;
    gbifLink.hidden = true;
    if (uberonLink) {
      uberonLink.hidden = true;
    }
  };

  if (!detail) {
    hideAll();
    return;
  }

  const metadataBlocks = detail?.data?.latestVersion?.metadataBlocks || {};
  const darwinBlock = getMetadataBlock(metadataBlocks, 'darwincore');

  const persistentUrl = detail?.data?.persistentUrl;
  if (persistentUrl) {
    coraLink.href = persistentUrl;
    coraLink.hidden = false;
  } else {
    coraLink.hidden = true;
  }

  const taxonId =
    extractFieldValue(darwinBlock, 'dwcTaxonID') ||
    extractFieldValue(darwinBlock, 'dwc:taxonID') ||
    extractFieldValue(darwinBlock, 'taxonID');

  if (taxonId) {
    const cleanUrl = taxonId.trim();
    gbifLink.href = cleanUrl.startsWith('http')
      ? cleanUrl
      : `https://www.gbif.org/species/${cleanUrl}`;
    gbifLink.hidden = false;
  } else {
    gbifLink.hidden = true;
  }

  if (uberonLink) {
    const uberonUrl = deriveUberonUrlFromModel(modelInfo);
    if (uberonUrl) {
      uberonLink.href = uberonUrl;
      uberonLink.hidden = false;
    } else {
      uberonLink.hidden = true;
    }
  }
}

/**
 * Attempts to derive an UBERON ontology URL from the model metadata.
 *
 * @param {object|null} modelInfo - Model descriptor created by the Dataverse client.
 * @returns {string|null} UBERON URL when a code can be extracted.
 */
function deriveUberonUrlFromModel(modelInfo) {
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
 * Extracts an UBERON code from filenames or directory names.
 *
 * @param {string} text - Raw text to inspect.
 * @returns {string|null} Zero-padded UBERON code.
 */
function extractUberonCode(text) {
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

  return null;
}


/**
 * Creates a normalised tree node from a Dataverse metadata field.
 *
 * @param {object} field - Dataverse metadata field.
 * @param {string} [parentPath=''] - Path of the parent node, used for breadcrumbs.
 * @returns {object|null} Normalised node or null when empty.
 */
function normalizeMetadataField(field, parentPath = '') {
  // Never mutate the original object to avoid side effects.
  const fieldCopy = { ...field };

  // Generate a readable label for the UI.
  const label = humanizeLabel(field.displayName || field.typeName);
  if (!label) return null; // Skip nodes without a usable label.

  const fieldPath = parentPath ? `${parentPath} › ${label}` : label;

  // Collect leaf values or build child nodes based on the field shape.
  let values = [];
  let children = [];

  if (field.typeClass && ['primitive', 'string', 'controlledVocabulary', 'date', 'int', 'number'].includes(field.typeClass)) {
    values = extractMetadataValues(field);
  } else if (field.value) {
    // Composite value or array of objects.
    if (Array.isArray(field.value)) {
      // Array of primitives: reduce to a single comma-separated line.
      if (field.value.length > 0 && typeof field.value[0] !== 'object') {
        values = [field.value.filter(v => v != null).join(', ')];
      } else {
        // Array of objects: recurse for each entry.
        field.value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            const itemLabel = `${translate('metadata.itemLabel', 'Item')} ${index + 1}`;
            const itemNode = normalizeMetadataObject(item, `${fieldPath} › ${itemLabel}`);
            if (itemNode) children.push(itemNode);
          }
        });
      }
    } else if (typeof field.value === 'object') {
      // Nested object: delegate to object normaliser.
      const childNode = normalizeMetadataObject(field.value, fieldPath);
      if (childNode) children.push(childNode);
    } else {
      // Primitive value.
      values = [String(field.value)];
    }
  }

  // Recursively traverse nested field collections, if present.
  if (field.fields && Array.isArray(field.fields)) {
    field.fields.forEach(subField => {
      const subNode = normalizeMetadataField(subField, fieldPath);
      if (subNode) children.push(subNode);
    });
  }

  // Skip empty nodes that would not render any content.
  if (values.length === 0 && children.length === 0) return null;

  return {
    label,
    path: fieldPath,
    values: values.length > 0 ? values : undefined,
    children: children.length > 0 ? children : undefined
  };
}

/**
 * Builds a normalised subtree from a generic metadata object.
 *
 * @param {object} obj - Arbitrary metadata structure.
 * @param {string} parentPath - Breadcrumb path of the parent node.
 * @returns {object|null} Normalised node or null when empty.
 */
function normalizeMetadataObject(obj, parentPath) {
  if (!obj || typeof obj !== 'object') return null;

  const children = [];

  // Iterate over plain object properties and serialise them.
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'fields' || key === 'typeClass' || key === 'typeName' || key === 'multiple' || key === 'displayName') {
      continue;
    }

    const label = humanizeLabel(key);
    if (!label) continue;

    const fieldPath = parentPath ? `${parentPath} › ${label}` : label;

    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] !== 'object') {
        // Array of primitives, render as a single node.
        children.push({
          label,
          path: fieldPath,
          values: [value.filter(v => v != null).join(', ')]
        });
      } else {
        // Array of objects, recurse on each entry.
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            const itemLabel = `${translate('metadata.itemLabel', 'Item')} ${index + 1}`;
            const itemNode = normalizeMetadataObject(item, `${fieldPath} › ${itemLabel}`);
            if (itemNode) children.push(itemNode);
          }
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      // Nested object, recurse into it.
      const childNode = normalizeMetadataObject(value, fieldPath);
      if (childNode) children.push(childNode);
    } else {
      // Primitive value rendered directly.
      children.push({
        label,
        path: fieldPath,
        values: [String(value)]
      });
    }
  }

  return children.length > 0 ? {
    label: parentPath.split(' › ').pop(),
    path: parentPath,
    children
  } : null;
}

/**
 * Converts raw Dataverse metadata into a normalised hierarchy ready for rendering.
 *
 * @param {object} data - Metadata block or object returned by the API.
 * @returns {object[]} Array of root nodes describing the metadata tree.
 */
function extractNormalizedFields(data) {
  if (!data || typeof data !== 'object') return [];

  const results = [];

  // Traverse declared fields first.
  if (data.fields && Array.isArray(data.fields)) {
    data.fields.forEach(field => {
      const node = normalizeMetadataField(field);
      if (node) results.push(node);
    });
  }

  // Recursively inspect generic objects for additional metadata shapes.
  for (const [key, value] of Object.entries(data)) {
    if (key === 'fields' || key === 'typeClass' || key === 'typeName' || key === 'multiple' || key === 'displayName') {
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      const label = humanizeLabel(key);
      if (label) {
        const node = normalizeMetadataObject(value, label);
        if (node) results.push(node);
      }
    }
  }

  return results;
}

/**
 * Removes technical artefacts from metadata values before rendering.
 *
 * @param {string} value - Raw metadata value.
 * @returns {string} Cleaned value without type boilerplate.
 */
function cleanValue(value) {
  if (!value || typeof value !== 'string') return value;

  // Strip noisy tokens coming from Dataverse serialization.
  let cleaned = value
    .replace(/\b(Value|ExpandedValue|Scheme|Type|Class)\s*[:=]?\s*/gi, '')
    .replace(/\b(primitive|controlledVocabulary|string|date|int|number)\s*[:=]?\s*/gi, '')
    .trim();

  return cleaned;
}

/**
 * Normalises a metadata value and wraps URLs with anchor tags.
 *
 * @param {unknown} value - Arbitrary value to format.
 * @returns {string} HTML-safe value ready for injection.
 */
function formatMetadataValue(value) {
  const cleaned = cleanValue(value);
  const text = cleaned === null || cleaned === undefined
    ? ''
    : typeof cleaned === 'string'
      ? cleaned.trim()
      : String(cleaned);

  if (!text) {
    return '';
  }

  if (/^https?:\/\//i.test(text)) {
    const safe = escapeHtml(text);
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  }

  return escapeHtml(text);
}

/**
 * Generates the HTML list markup for metadata nodes.
 *
 * @param {object[]} nodes - Metadata nodes at the same depth.
 * @param {number} [depth=0] - Current tree depth, used for styling.
 * @returns {string} HTML string representing the list.
 */
function buildMetadataList(nodes, depth = 0) {
  if (!nodes || nodes.length === 0) {
    return '';
  }

  const listClass = `metadata-list depth-${depth}`;
  return `
        <ul class="${listClass}">
${nodes.map((node) => buildMetadataEntry(node, depth)).join('\n')}
        </ul>`;
}

/**
 * Builds the markup for a single metadata entry, including nested children.
 *
 * @param {object} node - Normalised metadata node.
 * @param {number} depth - Current tree depth.
 * @returns {string} HTML fragment for the node.
 */
function buildMetadataEntry(node, depth) {
  const children = Array.isArray(node.children) ? node.children.filter(Boolean) : [];
  const sanitizeValues = (list) =>
    list
      .map((val) => (typeof val === 'string' ? val.trim() : val))
      .filter((val) => val !== null && val !== undefined && String(val).trim() !== '');

  const baseValues = Array.isArray(node.values) ? sanitizeValues(node.values) : [];

  const inlineValueChildren = [];
  const inlineItemValues = [];
  const inlineExpandedValues = [];
  const nestedChildren = [];
  children.forEach((child) => {
    if (!child) return;
    const rawLabel = typeof child.label === 'string' ? child.label.trim() : '';
    const label = rawLabel.toLowerCase();
    const normalizedLabel = rawLabel.replace(/\s+/g, '').toLowerCase();
    const childHasNested = Array.isArray(child.children) && child.children.length > 0;
    const childHasValues = Array.isArray(child.values) && child.values.length > 0;
    const childValues = childHasValues ? sanitizeValues(child.values || []) : [];

    if (label === 'value' && !childHasNested && childHasValues) {
      inlineValueChildren.push(child);
      return;
    }

    if (/^item\b/.test(label)) {
      if (childValues.length > 0) {
        inlineItemValues.push(...childValues);
      }
      if (childHasNested) {
        nestedChildren.push(...child.children.filter(Boolean));
      }
      return;
    }

    if (normalizedLabel === 'expandedvalue') {
      if (childValues.length > 0) {
        inlineExpandedValues.push(...childValues);
      }
      if (childHasNested) {
        nestedChildren.push(...child.children.filter(Boolean));
      }
      return;
    }

    nestedChildren.push(child);
  });

  const inlineValuesRaw = inlineValueChildren.flatMap((child) => child.values || []);
  const inlineValues = sanitizeValues(inlineValuesRaw);
  const combinedValues = [...baseValues, ...inlineValues, ...inlineItemValues, ...inlineExpandedValues];

  const hasChildren = nestedChildren.length > 0;
  const hasValues = combinedValues.length > 0;
  const valueClass = `metadata-value${hasValues ? '' : ' metadata-value--empty'}`;
  const labelClass = depth === 0 ? 'metadata-label metadata-label--root' : 'metadata-label';
  const valueContent = hasValues ? combinedValues.map(formatMetadataValue).join('; ') : '';
  const childMarkup = hasChildren ? `\n${buildMetadataList(nestedChildren, depth + 1)}\n        ` : '';
  const separatorMarkup = hasValues ? '<span class="metadata-separator">:</span>' : '';
  const valueMarkup = hasValues ? `<span class="${valueClass}">${valueContent}</span>` : '';

  return `          <li class="metadata-entry depth-${depth}">
            <div class="metadata-row">
              <span class="${labelClass}">${escapeHtml(node.label)}</span>
              ${separatorMarkup}${valueMarkup}
            </div>${childMarkup}
          </li>`;
}

/**
 * Assembles the complete metadata panel markup by grouping sections.
 *
 * @param {Array<{title: string, fields: object[]}>} sections - Metadata sections to display.
 * @returns {string} HTML markup for the metadata container.
 */
function buildMetadataGroups(sections) {
  if (!sections || sections.length === 0) {
    return '';
  }

  const groupMarkup = sections
    .map(({ title, fields }) => buildMetadataGroup(title, fields))
    .filter(Boolean)
    .join('\n');

  if (!groupMarkup) {
    return '';
  }

  return `
    <div class="metadata-container">
${groupMarkup}
    </div>`;
}

/**
 * Renders a single metadata section with its title and content.
 *
 * @param {string} title - Section heading.
 * @param {object[]} fields - Metadata nodes inside the section.
 * @returns {string} HTML fragment for the section.
 */
function buildMetadataGroup(title, fields) {
  const listMarkup = buildMetadataList(fields, 0);
  if (!listMarkup) {
    return '';
  }

  return `      <section class="metadata-group">
        <h3 class="metadata-group-title">${escapeHtml(title)}</h3>
${listMarkup}
      </section>`;
}

/**
 * Resolves a metadata block by key or block name, case-insensitive.
 *
 * @param {object} blocks - Collection of metadata blocks.
 * @param {string} targetName - Desired block key or display name.
 * @returns {object|null} Matching block object or null.
 */
function getMetadataBlock(blocks, targetName) {
  if (!blocks) {
    return null;
  }
  if (blocks[targetName]) {
    return blocks[targetName];
  }
  const lower = targetName.toLowerCase();
  return Object.values(blocks).find((block) => block?.name?.toLowerCase() === lower);
}

/**
 * Updates the metadata panel with content from the selected dataset.
 *
 * @param {HTMLElement|null} panel - Container that receives the markup.
 * @param {object|null} detail - Dataverse dataset detail payload.
 */
function renderDatasetMetadata(panel, detail) {
  if (!panel) return;

  if (!detail) {
    const message = escapeHtml(
      translate('metadata.emptySelection', 'Select a dataset to display metadata.'),
    );
    panel.innerHTML = `<p class="metadata-empty">${message}</p>`;
    return;
  }

  const metadataBlocks = detail?.data?.latestVersion?.metadataBlocks || {};

  const sections = [];
  for (const [blockKey, block] of Object.entries(metadataBlocks)) {
    if (!block || !block.fields) continue;
    const fields = extractNormalizedFields(block);
    if (!fields.length) continue;
    const title = block?.displayName || block?.name || humanizeLabel(blockKey);
    sections.push({ title, fields });
  }

  if (!sections.length) {
    const message = escapeHtml(
      translate('metadata.emptyData', 'No metadata available for this dataset.'),
    );
    panel.innerHTML = `<p class="metadata-empty">${message}</p>`;
    return;
  }

  panel.innerHTML = buildMetadataGroups(sections);
}

/**
 * Bootstraps the interactive UI: wires controls, translations, datasets, and viewer events.
 *
 * @param {object} options - Init options.
 * @param {import('../3d/viewer3d.js').Viewer3D} options.viewer - Viewer instance to control.
 * @param {DataverseClient} [options.dataClient] - Data client used to query Dataverse.
 * @param {Document} [options.documentRef=document] - Document reference (facilitates testing).
 * @param {Window} [options.windowRef=window] - Window reference (facilitates testing).
 * @returns {Promise<{destroy: () => void}>} Cleanup handle.
 */
export async function initInterface({
  viewer,
  dataClient = new DataverseClient(),
  documentRef = document,
  windowRef = window,
} = {}) {
  if (!viewer) {
    throw new Error('Viewer instance is required');
  }

  await i18n.init();
  const LANGUAGE_CODES = i18n.getSupportedLanguages().map(({ code }) => code);
  const languageOptionNodes = new Map();

  const datasetSelect = documentRef.getElementById('datasetSelect');
  const modelSelect = documentRef.getElementById('modelSelect');
  const reloadButton = documentRef.getElementById('reloadDatasets');
  const projectionSelect = documentRef.getElementById('projectionMode');
  const toggleTexturesButton = documentRef.getElementById('toggleTextures');
  const resetViewButton = documentRef.getElementById('resetView');
  const orbitModeSelect = documentRef.getElementById('orbitMode');
  const statusBanner = documentRef.getElementById('status');
  const metadataPanel = documentRef.getElementById('metadataPanel');
  const viewerContainer = documentRef.getElementById('viewer3D');
  const coraLink = documentRef.getElementById('coraLink');
  const gbifLink = documentRef.getElementById('gbifLink');
  const uberonLink = documentRef.getElementById('uberonLink');
  const wireframeButton = documentRef.getElementById('toggleWireframe');
  const lightingButton = documentRef.getElementById('toggleLighting');
  const screenshotButton = documentRef.getElementById('captureScreenshot');
  const measureToggleButton = documentRef.getElementById('toggleMeasure');
  const clearMeasurementsButton = documentRef.getElementById('clearMeasurements');
  const measurementOverlay = documentRef.getElementById('measurementOverlay');
  const languageSelect = documentRef.getElementById('languageSelect');
  const viewerToolbar = documentRef.getElementById('viewerToolbar');
  const viewerToolbarToggle = documentRef.getElementById('viewerToolbarToggle');

  if (!datasetSelect || !modelSelect || !reloadButton || !viewerContainer) {
    throw new Error('Required UI elements are missing');
  }

  viewerContainer.innerHTML = '';
  viewerContainer.appendChild(viewer.getCanvas());
  if (measurementOverlay) {
    viewer.attachMeasurementOverlay(measurementOverlay);
  }

  let lastStatus = null;
  const isToolbarCollapsed = () =>
    !viewerToolbar || viewerToolbar.getAttribute('data-collapsed') !== 'false';

  const updateToolbarToggle = () => {
    if (!viewerToolbarToggle) return;
    const collapsed = isToolbarCollapsed();
    viewerToolbarToggle.textContent = translate(
      collapsed ? 'viewer.toolbar.showMore' : 'viewer.toolbar.showLess',
      collapsed ? 'More controls' : 'Fewer controls',
    );
    viewerToolbarToggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  };

  const setToolbarCollapsed = (collapsed) => {
    if (!viewerToolbar) return;
    viewerToolbar.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
    updateToolbarToggle();
  };

  const syncToolbarForViewport = () => {
    if (!viewerToolbar) return;
    const isWide = windowRef.matchMedia('(min-width: 900px)').matches;
    if (isWide) {
      if (isToolbarCollapsed()) {
        viewerToolbar.setAttribute('data-collapsed', 'false');
      }
    } else if (viewerToolbar.getAttribute('data-collapsed') === 'false') {
      viewerToolbar.setAttribute('data-collapsed', 'true');
    }
    updateToolbarToggle();
  };

  if (viewerToolbarToggle) {
    viewerToolbarToggle.addEventListener('click', () => {
      if (windowRef.matchMedia('(min-width: 900px)').matches) {
        return;
      }
      const collapsed = isToolbarCollapsed();
      setToolbarCollapsed(!collapsed);
    });
  }

  const resizeViewer = () => {
    const { clientWidth, clientHeight } = viewerContainer;
    viewer.resize(clientWidth, clientHeight);
    syncToolbarForViewport();
  };
  windowRef.addEventListener('resize', resizeViewer);
  resizeViewer();

  const setStatus = (key, type = 'loading') => {
    if (!statusBanner) return;
    const message = translate(key, key);
    statusBanner.textContent = message;
    statusBanner.className = `viewer-status ${type}`;
    lastStatus = { key, type };
  };

  const setCustomStatus = (message, type = 'loading') => {
    if (!statusBanner) return;
    statusBanner.textContent = message;
    statusBanner.className = `viewer-status ${type}`;
    lastStatus = { key: null, message, type };
  };

  const clearStatus = () => {
    if (!statusBanner) return;
    statusBanner.className = 'viewer-status';
    statusBanner.textContent = '';
    lastStatus = null;
  };

  const reapplyStatus = () => {
    if (!lastStatus) return;
    if (lastStatus.key) {
      setStatus(lastStatus.key, lastStatus.type);
    } else if (lastStatus.message) {
      setCustomStatus(lastStatus.message, lastStatus.type);
    }
  };

  const updateProjectionSelect = () => {
    if (projectionSelect) {
      projectionSelect.value = viewer.getCameraMode();
    }
  };

  const updateOrbitModeSelect = () => {
    if (orbitModeSelect) {
      orbitModeSelect.value = viewer.getOrbitMode();
    }
  };

  const updateTextureToggleButton = () => {
    if (toggleTexturesButton) {
      const texturesEnabled = viewer.areTexturesEnabled();
      const key = texturesEnabled
        ? 'viewer.buttons.disableTextures'
        : 'viewer.buttons.enableTextures';
      toggleTexturesButton.textContent = translate(
        key,
        texturesEnabled ? 'Disable Textures' : 'Enable Textures',
      );
    }
  };

  const updateWireframeButton = () => {
    if (wireframeButton) {
      const wireframeEnabled = viewer.isWireframeEnabled();
      const key = wireframeEnabled
        ? 'viewer.buttons.disableWireframe'
        : 'viewer.buttons.enableWireframe';
      wireframeButton.textContent = translate(
        key,
        wireframeEnabled ? 'Disable Wireframe' : 'Enable Wireframe',
      );
    }
  };

  const updateLightingButton = () => {
    if (lightingButton) {
      const lightsDimmed = viewer.areLightsDimmed();
      const key = lightsDimmed
        ? 'viewer.buttons.restoreLights'
        : 'viewer.buttons.dimLights';
      lightingButton.textContent = translate(
        key,
        lightsDimmed ? 'Restore Lights' : 'Dim Lights',
      );
    }
  };

  const updateMeasureButton = () => {
    if (measureToggleButton) {
      const measurementEnabled = viewer.isMeasurementModeEnabled();
      const key = measurementEnabled
        ? 'viewer.buttons.exitMeasure'
        : 'viewer.buttons.measure';
      measureToggleButton.textContent = translate(
        key,
        measurementEnabled ? 'Exit Measure' : 'Measure',
      );
    }
  };

  const buildLanguageLabel = (code) => translate(`language.names.${code}`, code.toUpperCase());

  const refreshLanguageSelector = () => {
    if (!languageSelect) {
      return;
    }
    LANGUAGE_CODES.forEach((code) => {
      let option = languageOptionNodes.get(code);
      if (!option) {
        option = documentRef.createElement('option');
        option.value = code;
        languageOptionNodes.set(code, option);
        languageSelect.appendChild(option);
      }
      option.textContent = buildLanguageLabel(code);
    });
    const current = i18n.currentLanguage || i18n.defaultLanguage || 'en';
    languageSelect.value = LANGUAGE_CODES.includes(current) ? current : i18n.defaultLanguage;
  };

  const applyLanguageToDocument = () => {
    if (documentRef?.documentElement) {
      documentRef.documentElement.setAttribute('lang', i18n.currentLanguage || 'en');
    }
  };

  const refreshLanguageDependentUI = () => {
    applyLanguageToDocument();
    refreshLanguageSelector();
    renderDatasetMetadata(metadataPanel, currentMetadataDetail);
    reapplyStatus();
    updateProjectionSelect();
    updateOrbitModeSelect();
    updateTextureToggleButton();
    updateWireframeButton();
    updateLightingButton();
    updateMeasureButton();
    i18n.applyTranslations(documentRef);
    updateToolbarToggle();
  };

  let activeDatasetId = null;
  let datasetToken = 0;
  let modelToken = 0;
  let currentMetadataDetail = null;

  const CACHE_KEY = 'dataverseCache';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  const loadDatasetsFromAPI = async ({ force = false } = {}) => {
    const datasets = await dataClient.listDatasets({ force });
    const payload = {
      datasets,
      timestamp: Date.now(),
    };
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Failed to store dataverse cache', error);
    }
    return datasets;
  };

  const loadDatasetsFromCache = () => {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || !cached.datasets || !cached.timestamp) return null;
      if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        return null;
      }
      return cached.datasets;
    } catch (error) {
      console.warn('Failed to read dataverse cache', error);
      return null;
    }
  };

  const populateDatasetSelect = (datasets, statusKey) => {
    const placeholder = escapeHtml(
      translate('selector.dataset.placeholder', 'Choose a dataset...'),
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
    datasetSelect.disabled = false;
    datasetSelect.value = '';
    const modelPlaceholder = escapeHtml(
      translate('selector.model.disabled', 'Select a dataset'),
    );
    modelSelect.innerHTML = `<option value="">${modelPlaceholder}</option>`;
    modelSelect.disabled = true;
    activeDatasetId = null;
    if (statusKey) {
      setStatus(statusKey, 'info');
    }
  };

  const initDatasets = async ({ force = false } = {}) => {
    datasetToken += 1;
    const currentToken = datasetToken;

    setStatus('status.loadingDatasets');
    datasetSelect.disabled = true;
    modelSelect.disabled = true;
    reloadButton.disabled = true;
    const loadingDatasetsOption = escapeHtml(
      translate('selector.dataset.loading', 'Loading datasets...'),
    );
    datasetSelect.innerHTML = `<option value="">${loadingDatasetsOption}</option>`;
    const selectDatasetOption = escapeHtml(
      translate('selector.model.disabled', 'Select a dataset'),
    );
    modelSelect.innerHTML = `<option value="">${selectDatasetOption}</option>`;
    viewer.clear();
    renderDatasetMetadata(metadataPanel, null);
    currentMetadataDetail = null;
    updateExternalLinks(null, coraLink, gbifLink, uberonLink);

    try {
      let datasets = null;
      if (!force) {
        datasets = loadDatasetsFromCache();
        if (datasets && currentToken === datasetToken) {
          populateDatasetSelect(datasets, 'status.datasetsLoadedFromCache');
          reloadButton.disabled = false;
          return;
        }
      }

      datasets = await loadDatasetsFromAPI({ force: true });
      if (currentToken !== datasetToken) {
        return;
      }
      populateDatasetSelect(datasets, 'status.datasetsLoadedFromAPI');
    } catch (error) {
      console.error(error);
      if (currentToken === datasetToken) {
        setStatus('status.datasetsLoadError', 'error');
      }
    } finally {
      if (currentToken === datasetToken) {
        reloadButton.disabled = false;
      }
    }
  };

  const loadDatasetModels = async (persistentId) => {
    modelToken += 1;
    const currentModelToken = modelToken;

    viewer.clear();
    if (!persistentId) {
      const selectDatasetOption = escapeHtml(
        translate('selector.model.disabled', 'Select a dataset'),
      );
      modelSelect.innerHTML = `<option value="">${selectDatasetOption}</option>`;
      modelSelect.disabled = true;
      renderDatasetMetadata(metadataPanel, null);
      currentMetadataDetail = null;
      updateExternalLinks(null, coraLink, gbifLink, uberonLink);
      setStatus('status.selectDatasetAndModel', 'info');
      return;
    }
    try {
      setStatus('status.loadingDataset');
      modelSelect.disabled = true;
      const loadingModelsOption = escapeHtml(
        translate('selector.model.loading', 'Loading models...'),
      );
      modelSelect.innerHTML = `<option value="">${loadingModelsOption}</option>`;

      const entry = await dataClient.ensureDatasetPrepared(persistentId);
      if (currentModelToken !== modelToken) {
        return;
      }
      currentMetadataDetail = entry.detail;
      renderDatasetMetadata(metadataPanel, currentMetadataDetail);
      updateExternalLinks(currentMetadataDetail, coraLink, gbifLink, uberonLink);

      if (!entry.models?.length) {
        const noModelsOption = escapeHtml(
          translate('selector.model.none', 'No OBJ/MTL model found'),
        );
        modelSelect.innerHTML = `<option value="">${noModelsOption}</option>`;
        modelSelect.disabled = true;
        setStatus('status.noModelsInDataset', 'info');
        return;
      }

      const chooseModelOption = escapeHtml(
        translate('selector.model.placeholder', 'Choose a model...'),
      );
      const options =
        `<option value="">${chooseModelOption}</option>` +
        entry.models
          .map(
            (model) =>
              `<option value="${escapeHtml(model.key)}">${escapeHtml(model.displayName)}</option>`,
          )
          .join('');

      modelSelect.innerHTML = options;
      modelSelect.disabled = false;
      setStatus('status.selectModel', 'info');
    } catch (error) {
      console.error(error);
      if (currentModelToken === modelToken) {
        const loadErrorOption = escapeHtml(
          translate('selector.model.error', 'Load error'),
        );
        modelSelect.innerHTML = `<option value="">${loadErrorOption}</option>`;
        modelSelect.disabled = true;
        setStatus('status.datasetLoadFailure', 'error');
      }
    }
  };

  const loadModel = async (persistentId, modelKey) => {
    modelToken += 1;
    const currentModelToken = modelToken;

    if (!persistentId || !modelKey) {
      setStatus('status.selectModel', 'info');
      return;
    }

    try {
      setStatus('status.loadingGeometry');
      const entry = await dataClient.ensureDatasetPrepared(persistentId);
      const modelInfo = entry.modelMap ? entry.modelMap.get(modelKey) : null;
      const source = await dataClient.createModelSource(persistentId, modelKey);
      if (currentModelToken !== modelToken) {
        return;
      }
      await viewer.loadModel(source);
      if (currentModelToken === modelToken) {
        clearStatus();
        const detail =
          typeof source.getMetadataDetail === 'function'
            ? source.getMetadataDetail()
            : entry.detail || dataClient.getDatasetMetadata(persistentId);
        currentMetadataDetail = detail;
        const uberonContext = {
          objDirectory: source.objDirectory,
          directory: modelInfo?.directory || modelInfo?.objEntry?.directory,
          displayName: modelInfo?.displayName || source.displayName,
          objEntryDirectory: modelInfo?.objEntry?.directory,
          objEntryLabel: modelInfo?.objEntry?.file?.label,
          mtlDirectory: modelInfo?.mtlEntry?.directory,
          getPreferredTextureDirectory:
            typeof source.getPreferredTextureDirectory === 'function'
              ? () => source.getPreferredTextureDirectory()
              : undefined,
        };
        updateExternalLinks(detail, coraLink, gbifLink, uberonLink, uberonContext);
      }
    } catch (error) {
      console.error(error);
    }
  };

  datasetSelect.addEventListener('change', (event) => {
    const persistentId = event.target.value;
    modelSelect.value = '';
    loadDatasetModels(persistentId);
  });

  modelSelect.addEventListener('change', (event) => {
    const modelKey = event.target.value;
    if (!modelKey) {
      viewer.clear();
      setStatus('status.selectModel', 'info');
      const persistentId = datasetSelect.value;
      currentMetadataDetail = dataClient.getDatasetMetadata(persistentId) || currentMetadataDetail;
      updateExternalLinks(currentMetadataDetail, coraLink, gbifLink, uberonLink, null);
      return;
    }
    const persistentId = datasetSelect.value;
    loadModel(persistentId, modelKey);
  });

  reloadButton.addEventListener('click', () => {
    try {
      window.localStorage.removeItem(CACHE_KEY);
    } catch (error) {
      console.warn('Failed to clear dataverse cache', error);
    }
    initDatasets({ force: true });
  });

  if (languageSelect) {
    languageSelect.addEventListener('change', async (event) => {
      const selected = event.target.value;
      if (!selected || selected === i18n.currentLanguage) {
        return;
      }
      try {
        await i18n.setLanguage(selected);
      } catch (error) {
        console.error('Unable to switch language', error);
      }
    });
  }

  if (projectionSelect) {
    projectionSelect.addEventListener('change', (event) => {
      viewer.setCameraMode(event.target.value);
      updateProjectionSelect();
    });
  }

  if (toggleTexturesButton) {
    toggleTexturesButton.addEventListener('click', () => {
      viewer.setTexturesEnabled(!viewer.areTexturesEnabled());
      updateTextureToggleButton();
    });
  }

  if (wireframeButton) {
    wireframeButton.addEventListener('click', () => {
      viewer.setWireframeEnabled(!viewer.isWireframeEnabled());
      updateWireframeButton();
    });
  }

  if (resetViewButton) {
    resetViewButton.addEventListener('click', () => {
      viewer.resetView();
    });
  }

  if (lightingButton) {
    lightingButton.addEventListener('click', () => {
      viewer.setLightsDimmed(!viewer.areLightsDimmed());
      updateLightingButton();
    });
  }

  if (screenshotButton) {
    screenshotButton.addEventListener('click', () => {
      try {
        const dataUrl = viewer.captureScreenshot();
        if (!dataUrl) {
          setStatus('status.screenshotFailed', 'error');
          return;
        }
        const link = documentRef.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.href = dataUrl;
        link.download = `viewer-capture-${timestamp}.png`;
        documentRef.body.appendChild(link);
        link.click();
        link.remove();
      } catch (error) {
        console.error(error);
        setStatus('status.screenshotFailed', 'error');
      }
    });
  }

  if (measureToggleButton) {
    measureToggleButton.addEventListener('click', () => {
      viewer.setMeasurementModeEnabled(!viewer.isMeasurementModeEnabled());
      updateMeasureButton();
    });
  }

  if (clearMeasurementsButton) {
    clearMeasurementsButton.addEventListener('click', () => {
      viewer.clearMeasurements();
      updateMeasureButton();
    });
  }

  if (orbitModeSelect) {
    orbitModeSelect.addEventListener('change', (event) => {
      viewer.setOrbitMode(event.target.value);
      updateOrbitModeSelect();
    });
  }

  viewer.on('loadstart', () => {
    setStatus('status.loadingGeometry');
  });
  viewer.on('loadend', () => {
    clearStatus();
  });
  viewer.on('loaderror', () => {
    setStatus('status.modelLoadFailure', 'error');
  });

  const unsubscribe = i18n.onChange(() => {
    refreshLanguageDependentUI();
  });

  refreshLanguageDependentUI();
  initDatasets();

  return {
    destroy() {
      windowRef.removeEventListener('resize', resizeViewer);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    },
  };
}
