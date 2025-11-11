/**
 * Resolves a fetch implementation in both browser and worker-like environments.
 *
 * @returns {typeof fetch | null} Bound fetch function or null when unavailable.
 */
export function getDefaultFetch() {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    return window.fetch.bind(window);
  }
  if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  return null;
}
