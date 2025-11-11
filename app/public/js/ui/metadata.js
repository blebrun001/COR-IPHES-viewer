/**
 * Metadata module responsible for extracting, normalising, and rendering dataset details.
 */

// ===== Internal State =====
let translateRef = (key, fallback = '') => fallback;
let i18nRef = null;
let metadataPanelRef = null;
let coraLinkRef = null;
let gbifLinkRef = null;
let uberonLinkRef = null;
let deriveUberonUrlFromModelRef = null;

// ===== Helpers =====
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

// ===== Extractors =====
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

function extractFieldValue(block, fieldName) {
  if (!block || !block.fields) return null;
  const field = block.fields.find((f) =>
    f.typeName === fieldName ||
    f.displayName === fieldName ||
    f.typeName?.toLowerCase() === fieldName.toLowerCase()
  );
  if (!field) return null;

  const { value } = field;
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

function normalizeMetadataObject(obj, parentPath) {
  if (!obj || typeof obj !== 'object') return null;

  const children = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key === 'fields' || key === 'typeClass' || key === 'typeName' || key === 'multiple' || key === 'displayName') {
      continue;
    }

    const label = humanizeLabel(key);
    if (!label) continue;

    const fieldPath = parentPath ? `${parentPath} › ${label}` : label;

    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] !== 'object') {
        children.push({
          label,
          path: fieldPath,
          values: [value.filter((v) => v != null).join(', ')],
        });
      } else {
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            const itemLabel = `${translateRef('metadata.itemLabel', 'Item')} ${index + 1}`;
            const itemNode = normalizeMetadataObject(item, `${fieldPath} › ${itemLabel}`);
            if (itemNode) children.push(itemNode);
          }
        });
      }
    } else if (typeof value === 'object' && value !== null) {
      const childNode = normalizeMetadataObject(value, fieldPath);
      if (childNode) children.push(childNode);
    } else {
      children.push({
        label,
        path: fieldPath,
        values: [String(value)],
      });
    }
  }

  return children.length > 0
    ? {
        label: parentPath.split(' › ').pop(),
        path: parentPath,
        children,
      }
    : null;
}

function normalizeMetadataField(field, parentPath = '') {
  const fieldCopy = { ...field };

  const label = humanizeLabel(fieldCopy.displayName || fieldCopy.typeName);
  if (!label) return null;

  const fieldPath = parentPath ? `${parentPath} › ${label}` : label;

  let values = [];
  let children = [];

  if (fieldCopy.typeClass && ['primitive', 'string', 'controlledVocabulary', 'date', 'int', 'number'].includes(fieldCopy.typeClass)) {
    values = extractMetadataValues(fieldCopy);
  } else if (fieldCopy.value) {
    if (Array.isArray(fieldCopy.value)) {
      if (fieldCopy.value.length > 0 && typeof fieldCopy.value[0] !== 'object') {
        values = [fieldCopy.value.filter((v) => v != null).join(', ')];
      } else {
        fieldCopy.value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            const itemLabel = `${translateRef('metadata.itemLabel', 'Item')} ${index + 1}`;
            const itemNode = normalizeMetadataObject(item, `${fieldPath} › ${itemLabel}`);
            if (itemNode) children.push(itemNode);
          }
        });
      }
    } else if (typeof fieldCopy.value === 'object') {
      const childNode = normalizeMetadataObject(fieldCopy.value, fieldPath);
      if (childNode) children.push(childNode);
    } else {
      values = [String(fieldCopy.value)];
    }
  }

  if (fieldCopy.fields && Array.isArray(fieldCopy.fields)) {
    fieldCopy.fields.forEach((subField) => {
      const subNode = normalizeMetadataField(subField, fieldPath);
      if (subNode) children.push(subNode);
    });
  }

  if (values.length === 0 && children.length === 0) return null;

  return {
    label,
    path: fieldPath,
    values: values.length > 0 ? values : undefined,
    children: children.length > 0 ? children : undefined,
  };
}

function extractNormalizedFields(data) {
  if (!data || typeof data !== 'object') return [];

  const results = [];

  if (data.fields && Array.isArray(data.fields)) {
    data.fields.forEach((field) => {
      const node = normalizeMetadataField(field);
      if (node) results.push(node);
    });
  }

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

function cleanValue(value) {
  if (!value || typeof value !== 'string') return value;

  return value
    .replace(/\b(Value|ExpandedValue|Scheme|Type|Class)\s*[:=]?\s*/gi, '')
    .replace(/\b(primitive|controlledVocabulary|string|date|int|number)\s*[:=]?\s*/gi, '')
    .trim();
}

function formatMetadataValue(value) {
  const cleaned = cleanValue(value);
  const text =
    cleaned === null || cleaned === undefined
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

// ===== Renderers =====
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

function renderDatasetMetadataInternal(detail) {
  if (!metadataPanelRef) return;
  const panel = metadataPanelRef;

  if (!detail) {
    const message = escapeHtml(
      translateRef('metadata.emptySelection', 'Select a specimen to display metadata.'),
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
      translateRef('metadata.emptyData', 'No metadata available for this specimen.'),
    );
    panel.innerHTML = `<p class="metadata-empty">${message}</p>`;
    return;
  }

  panel.innerHTML = buildMetadataGroups(sections);
}

function updateExternalLinksInternal(detail, modelInfo = null) {
  const coraLink = coraLinkRef;
  const gbifLink = gbifLinkRef;
  const uberonLink = uberonLinkRef;

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
    const derivationFn = deriveUberonUrlFromModelRef;
    const uberonUrl = typeof derivationFn === 'function' ? derivationFn(modelInfo) : null;
    if (uberonUrl) {
      uberonLink.href = uberonUrl;
      uberonLink.hidden = false;
    } else {
      uberonLink.hidden = true;
    }
  }
}

// ===== Exports =====
// TODO: expose additional helpers if required.

/**
 * Initialises the metadata module with UI and translation dependencies.
 *
 * @param {object} deps - Dependency bag for the metadata module.
 * @param {(key: string, fallback?: string) => string} deps.translate - Translate helper.
 * @param {import('../i18n/translator.js').i18n} deps.i18n - I18n instance for language updates.
 * @param {HTMLElement|null} deps.metadataPanel - Metadata panel container.
 * @param {HTMLAnchorElement|null} deps.coraLink - CORA-RDR link element.
 * @param {HTMLAnchorElement|null} deps.gbifLink - GBIF link element.
 * @param {HTMLAnchorElement|null} deps.uberonLink - UBERON link element.
 * @param {(modelInfo: object|null) => string|null} [deps.deriveUberonUrlFromModel] - Helper for generating UBERON URLs.
 */
export function initMetadata(deps = {}) {
  translateRef = typeof deps.translate === 'function' ? deps.translate : translateRef;
  i18nRef = deps.i18n ?? i18nRef;
  metadataPanelRef = deps.metadataPanel ?? metadataPanelRef;
  coraLinkRef = deps.coraLink ?? coraLinkRef;
  gbifLinkRef = deps.gbifLink ?? gbifLinkRef;
  uberonLinkRef = deps.uberonLink ?? uberonLinkRef;
  deriveUberonUrlFromModelRef =
    typeof deps.deriveUberonUrlFromModel === 'function'
      ? deps.deriveUberonUrlFromModel
      : deriveUberonUrlFromModelRef;

  return {
    renderDatasetMetadata(detail, modelInfo) {
      renderDatasetMetadataInternal(detail, modelInfo);
    },
    updateExternalLinks(detail, modelInfo) {
      updateExternalLinksInternal(detail, modelInfo);
    },
  };
}
