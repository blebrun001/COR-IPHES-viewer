/**
 * Handles the “Options” dialog interactions (open/close).
 */
const optionsButton = document.getElementById('optionsButton');
const optionsDialog = document.getElementById('optionsDialog');
const closeOptions = document.getElementById('closeOptions');

const canUseDialog = optionsDialog && typeof optionsDialog.showModal === 'function';

if (optionsButton && canUseDialog) {
  optionsButton.addEventListener('click', () => {
    if (!optionsDialog.open) {
      optionsDialog.showModal();
    }
  });
}

if (closeOptions && optionsDialog) {
  closeOptions.addEventListener('click', () => {
    optionsDialog.close();
  });
}

if (optionsDialog) {
  optionsDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    optionsDialog.close();
  });
}

const getViewerApi = () => (typeof window !== 'undefined' ? window.viewerApi : null);

const screenshotBgToggle = document.getElementById('screenshot-bg-toggle');
if (screenshotBgToggle) {
  const viewerApi = getViewerApi();
  if (viewerApi && typeof viewerApi.isScreenshotBackgroundTransparent === 'function') {
    screenshotBgToggle.checked = !viewerApi.isScreenshotBackgroundTransparent();
  } else {
    screenshotBgToggle.disabled = true;
  }
  screenshotBgToggle.addEventListener('change', (event) => {
    const api = getViewerApi();
    if (api && typeof api.setScreenshotBackgroundTransparent === 'function') {
      api.setScreenshotBackgroundTransparent(!event.target.checked);
    } else {
      event.target.checked = true;
    }
  });
}

const anaglyphRangeInput = document.getElementById('anaglyphEyeSeparation');
const anaglyphRangeValue = document.getElementById('anaglyphEyeSeparationValue');
const ANAGLYPH_STORAGE_KEY = 'viewer.anaglyphEyeSeparation';

const formatEyeSeparation = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '–';
  }
  return parsed.toFixed(3);
};

const syncAnaglyphUI = (value) => {
  if (!anaglyphRangeInput || !anaglyphRangeValue) {
    return;
  }
  anaglyphRangeInput.value = String(value);
  anaglyphRangeValue.textContent = formatEyeSeparation(value);
};

const applyStoredAnaglyphSeparation = () => {
  const viewerApi = getViewerApi();
  if (!viewerApi || typeof viewerApi.setAnaglyphEyeSeparation !== 'function') {
    if (anaglyphRangeInput) {
      anaglyphRangeInput.disabled = true;
    }
    if (anaglyphRangeValue) {
      anaglyphRangeValue.textContent = '–';
    }
    return;
  }

  const limits =
    typeof viewerApi.getAnaglyphEyeSeparationRange === 'function'
      ? viewerApi.getAnaglyphEyeSeparationRange()
      : { min: 0.01, max: 0.2 };

  if (anaglyphRangeInput) {
    anaglyphRangeInput.min = String(limits.min);
    anaglyphRangeInput.max = String(limits.max);
  }

  let initial = typeof viewerApi.getAnaglyphEyeSeparation === 'function'
    ? viewerApi.getAnaglyphEyeSeparation()
    : limits.min;
  try {
    const stored = window.localStorage.getItem(ANAGLYPH_STORAGE_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (Number.isFinite(parsed)) {
        initial = viewerApi.setAnaglyphEyeSeparation(parsed);
      }
    }
  } catch (error) {
    /* Ignore storage access issues */
  }

  syncAnaglyphUI(initial);

  if (anaglyphRangeInput) {
    anaglyphRangeInput.disabled = false;
    anaglyphRangeInput.addEventListener('input', (event) => {
      const nextValue = Number(event.target.value);
      const applied = viewerApi.setAnaglyphEyeSeparation(nextValue);
      syncAnaglyphUI(applied);
      try {
        window.localStorage.setItem(ANAGLYPH_STORAGE_KEY, String(applied));
      } catch (error) {
        /* Ignore storage access issues */
      }
    });
  }
};

applyStoredAnaglyphSeparation();

window.addEventListener('storage', (event) => {
  if (event.key === ANAGLYPH_STORAGE_KEY) {
    const viewerApi = getViewerApi();
    if (viewerApi && typeof viewerApi.setAnaglyphEyeSeparation === 'function') {
      const parsed = Number(event.newValue);
      if (Number.isFinite(parsed)) {
        const applied = viewerApi.setAnaglyphEyeSeparation(parsed);
        syncAnaglyphUI(applied);
      }
    }
  }
});
