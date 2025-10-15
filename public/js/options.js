/**
 * Handles the “Options” dialog interactions (open/close).
 */
const optionsButton = document.getElementById('optionsButton');
const optionsDialog = document.getElementById('optionsDialog');
const closeOptions = document.getElementById('closeOptions');
const themeSelect = document.getElementById('themeSelect');
const rootElement = document.documentElement;

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

const THEME_STORAGE_KEY = 'ui.theme';
const SUPPORTED_THEMES = new Set(['dark', 'light']);
const DEFAULT_THEME = 'dark';
const THEME_ASSET_SELECTOR = '[data-theme-src-light][data-theme-src-dark]';

const normaliseTheme = (value) => (value && SUPPORTED_THEMES.has(value) ? value : DEFAULT_THEME);

const updateThemeAssets = (theme) => {
  if (typeof document === 'undefined') {
    return;
  }
  const elements = document.querySelectorAll(THEME_ASSET_SELECTOR);
  elements.forEach((element) => {
    const desiredSrc =
      theme === 'light'
        ? element.getAttribute('data-theme-src-light')
        : element.getAttribute('data-theme-src-dark');
    if (desiredSrc && element.getAttribute('src') !== desiredSrc) {
      element.setAttribute('src', desiredSrc);
    }
  });
};

const persistTheme = (theme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (error) {
    /* Ignore storage access issues */
  }
};

const applyTheme = (theme, { persist = false } = {}) => {
  const resolvedTheme = normaliseTheme(theme);
  rootElement.setAttribute('data-theme', resolvedTheme);
  if (themeSelect && themeSelect.value !== resolvedTheme) {
    themeSelect.value = resolvedTheme;
  }
  updateThemeAssets(resolvedTheme);
  if (persist) {
    persistTheme(resolvedTheme);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: resolvedTheme } }));
  }
};

const initialTheme = normaliseTheme(rootElement.getAttribute('data-theme'));
applyTheme(initialTheme);

if (themeSelect) {
  themeSelect.addEventListener('change', (event) => {
    applyTheme(event.target.value, { persist: true });
  });
}

window.addEventListener('storage', (event) => {
  if (event.key === THEME_STORAGE_KEY) {
    applyTheme(event.newValue);
  }
});
