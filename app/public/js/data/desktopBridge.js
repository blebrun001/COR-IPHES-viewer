/**
 * Thin boundary around Tauri's global JavaScript API.
 *
 * Keeping bridge access in one module lets browser-hosted tests fail cleanly
 * when native commands are unavailable, while desktop builds still use the same
 * data-client contract as the UI.
 */
const getTauriCore = () => {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.__TAURI__?.core || null;
};

export function createDesktopBridge() {
  const core = getTauriCore();

  const invoke = async (command, args = {}) => {
    const currentCore = getTauriCore();
    if (!currentCore?.invoke) {
      throw new Error('Tauri bridge is not available');
    }
    return currentCore.invoke(command, args);
  };

  const convertFileSrc = (path) => {
    const currentCore = getTauriCore();
    if (currentCore?.convertFileSrc) {
      return currentCore.convertFileSrc(path);
    }
    return path;
  };

  return Object.freeze({
    isAvailable: Boolean(core?.invoke),
    invoke,
    convertFileSrc,
  });
}
