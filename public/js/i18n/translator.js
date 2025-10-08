/**
 * Lightweight internationalisation service handling dictionary loading,
 * persistence and runtime translation for the viewer UI.
 */
const SUPPORTED_LANGUAGES = [
  { code: 'en', storageValue: 'en' },
  { code: 'es', storageValue: 'es' },
  { code: 'fr', storageValue: 'fr' },
  { code: 'ca', storageValue: 'ca' },
];

const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'appLanguage';
const TRANSLATION_ROOT = './public/i18n';

/**
 * Safely resolves a deep property by dot-separated path.
 *
 * @param {object} source - Object to traverse.
 * @param {string} key - Dot notation key (e.g. "viewer.buttons.capture").
 * @returns {any} Resolved value or undefined.
 */
function resolveKey(source, key) {
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

/**
 * Manages translation dictionaries and runtime language switching.
 */
export class I18nService {
  /**
   * @param {object} [options]
   * @param {string} [options.defaultLanguage] - Language used as fallback.
   * @param {Array<{code: string}>} [options.supportedLanguages] - Supported language codes.
   * @param {string} [options.storageKey] - LocalStorage key for persistence.
   * @param {string} [options.translationRoot] - Base path for JSON dictionaries.
   * @param {Window} [options.windowRef] - Window reference (supports testing).
   * @param {Function} [options.fetchRef] - Fetch implementation for loading dictionaries.
   */
  constructor({
    defaultLanguage = DEFAULT_LANGUAGE,
    supportedLanguages = SUPPORTED_LANGUAGES,
    storageKey = STORAGE_KEY,
    translationRoot = TRANSLATION_ROOT,
    windowRef = window,
    fetchRef = window.fetch.bind(window),
  } = {}) {
    this.defaultLanguage = defaultLanguage;
    this.supportedLanguages = supportedLanguages;
    this.storageKey = storageKey;
    this.translationRoot = translationRoot;
    this.windowRef = windowRef;
    this.fetchRef = fetchRef;

    this.currentLanguage = defaultLanguage;
    this.currentDictionary = {};
    this.defaultDictionary = {};
    this.dictionaries = new Map();
    this.listeners = new Set();
    this.initialized = false;
  }

  /**
   * Lists supported language codes in a minimal shape.
   *
   * @returns {Array<{code: string}>} Supported languages.
   */
  getSupportedLanguages() {
    return this.supportedLanguages.map(({ code }) => ({ code }));
  }

  /**
   * Normalises user-provided language codes against the supported list.
   *
   * @param {string} code - Language code to normalise.
   * @returns {string|null} Matching supported code or null.
   */
  normalizeLanguage(code) {
    if (!code || typeof code !== 'string') {
      return null;
    }
    const lowerCode = code.toLowerCase();
    const exactMatch = this.supportedLanguages.find(
      ({ code: candidate }) => candidate.toLowerCase() === lowerCode,
    );
    if (exactMatch) {
      return exactMatch.code;
    }
    const short = lowerCode.slice(0, 2);
    const shortMatch = this.supportedLanguages.find(
      ({ code: candidate }) => candidate.toLowerCase() === short,
    );
    return shortMatch ? shortMatch.code : null;
  }

  /**
   * Detects the preferred language using persisted storage or navigator hints.
   *
   * @returns {string} Preferred language code.
   */
  detectPreferredLanguage() {
    try {
      const stored = this.windowRef.localStorage.getItem(this.storageKey);
      const normalizedStored = this.normalizeLanguage(stored);
      if (normalizedStored) {
        return normalizedStored;
      }
    } catch (error) {
      console.warn('Unable to access language preference in storage', error);
    }

    const navigatorLanguages = Array.isArray(this.windowRef.navigator.languages)
      ? this.windowRef.navigator.languages
      : [this.windowRef.navigator.language];

    for (const candidate of navigatorLanguages) {
      const normalized = this.normalizeLanguage(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return this.defaultLanguage;
  }

  /**
   * Ensures the dictionary for a specific language is cached.
   *
   * @param {string} language - Language code to preload.
   * @returns {Promise<object>} Loaded dictionary object.
   */
  async ensureDictionary(language) {
    if (this.dictionaries.has(language)) {
      return this.dictionaries.get(language);
    }

    const url = `${this.translationRoot}/${language}.json`;
    const response = await this.fetchRef(url, { cache: 'no-cache' });
    if (!response.ok) {
      throw new Error(`Failed to load translations for "${language}"`);
    }
    const dictionary = await response.json();
    this.dictionaries.set(language, dictionary);
    if (language === this.defaultLanguage) {
      this.defaultDictionary = dictionary;
    }
    return dictionary;
  }

  /**
   * Initialises the service by loading the default dictionary and resolving language.
   *
   * @returns {Promise<void>} Resolves when the service is ready.
   */
  async init() {
    if (this.initialized) {
      return;
    }
    try {
      await this.ensureDictionary(this.defaultLanguage);
      await this.setLanguage(this.detectPreferredLanguage(), { silent: true });
    } catch (error) {
      console.error('Unable to initialize translations', error);
      this.currentLanguage = this.defaultLanguage;
      this.currentDictionary = this.defaultDictionary;
    } finally {
      this.initialized = true;
      this.notifyListeners();
    }
  }

  /**
   * Applies a new language and notifies subscribers.
   *
   * @param {string} language - Target language code.
   * @param {object} [options]
   * @param {boolean} [options.silent=false] - When true, skips notifications.
   * @returns {Promise<void>}
   */
  async setLanguage(language, { silent = false } = {}) {
    const targetLanguage = this.normalizeLanguage(language) || this.defaultLanguage;
    let dictionary;
    try {
      dictionary = await this.ensureDictionary(targetLanguage);
    } catch (error) {
      console.warn(`Falling back to default language "${this.defaultLanguage}"`, error);
      if (targetLanguage !== this.defaultLanguage) {
        dictionary = await this.ensureDictionary(this.defaultLanguage);
        this.currentLanguage = this.defaultLanguage;
      } else {
        throw error;
      }
    }

    this.currentLanguage = targetLanguage;
    this.currentDictionary = dictionary;

    try {
      this.windowRef.localStorage.setItem(this.storageKey, targetLanguage);
    } catch (error) {
      console.warn('Unable to persist language preference', error);
    }

    if (!silent) {
      this.notifyListeners();
    }
  }

  /**
   * Registers a listener fired when the language changes.
   *
   * @param {Function} listener - Callback receiving the new language code.
   * @returns {Function} Unsubscribe function.
   */
  onChange(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    return () => {};
  }

  /**
   * Notifies registered listeners, catching individual errors.
   */
  notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.currentLanguage);
      } catch (error) {
        console.error('Error in translation listener', error);
      }
    });
  }

  /**
   * Retrieves a translation by key, with fallback to defaults.
   *
   * @param {string} key - Translation key to resolve.
   * @param {object} [options]
   * @param {string|null} [options.defaultValue=null] - Default text when missing.
   * @returns {string} Translation string or fallback.
   */
  translate(key, { defaultValue = null } = {}) {
    if (!key) {
      return defaultValue ?? '';
    }

    const fromCurrent = resolveKey(this.currentDictionary, key);
    if (fromCurrent !== undefined && fromCurrent !== null) {
      return fromCurrent;
    }

    const fallback = resolveKey(this.defaultDictionary, key);
    if (fallback !== undefined && fallback !== null) {
      return fallback;
    }

    if (defaultValue !== null && defaultValue !== undefined) {
      return defaultValue;
    }
    return key;
  }

  /**
   * Applies translations to nodes containing data-i18n attributes.
   *
   * @param {Document|HTMLElement} [root=document] - Root to traverse.
   */
  applyTranslations(root = document) {
    const nodes = root.querySelectorAll('[data-i18n], [data-i18n-html], [data-i18n-attr]');
    nodes.forEach((node) => {
      if (node.hasAttribute('data-i18n')) {
        const key = node.getAttribute('data-i18n');
        const value = this.translate(key, { defaultValue: node.textContent.trim() });
        node.textContent = value;
      }
      if (node.hasAttribute('data-i18n-html')) {
        const key = node.getAttribute('data-i18n-html');
        const value = this.translate(key, { defaultValue: node.innerHTML });
        node.innerHTML = value;
      }
      if (node.hasAttribute('data-i18n-attr')) {
        const attributeSpec = node.getAttribute('data-i18n-attr');
        if (attributeSpec) {
          attributeSpec.split(',').forEach((entry) => {
            const [attr, key] = entry.split(':').map((segment) => segment.trim());
            if (attr && key) {
              const value = this.translate(key, { defaultValue: node.getAttribute(attr) });
              if (value !== undefined && value !== null) {
                node.setAttribute(attr, value);
              }
            }
          });
        }
      }
    });
  }
}

export const i18n = new I18nService();
