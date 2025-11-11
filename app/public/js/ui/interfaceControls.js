import { initLoadingOverlay } from './loadingOverlay.js';

/**
 * Creates helpers for viewer toolbar, status banner and resize management.
 *
 * @param {object} deps
 * @param {object} deps.viewerApi - High-level façade around the viewer.
 * @param {(key: string, fallback?: string) => string} deps.translate
 * @param {Window} deps.windowRef
 * @param {HTMLElement} deps.viewerContainer
 * @param {HTMLElement|null} deps.viewerToolbar
 * @param {HTMLElement|null} deps.viewerToolbarToggle
 * @param {HTMLElement|null} deps.statusBanner
 * @param {HTMLElement|null} deps.loadingOverlay
 * @returns {{
 *   initialize: () => void,
 *   isToolbarCollapsed: () => boolean,
 *   updateToolbarToggle: () => void,
 *   setToolbarCollapsed: (collapsed: boolean) => void,
 *   syncToolbarForViewport: () => void,
 *   resizeViewer: () => void,
 *   renderStatus: () => void,
 *   setStatus: (key: string, type?: string) => void,
 *   setCustomStatus: (message: string, type?: string) => void,
 *   clearStatus: () => void,
 *   reapplyStatus: () => void,
 *   setProgressPercent: (percent: number) => void,
 *   resetProgressPercent: () => void,
 *   getLastStatus: () => { key: string|null, fallback?: string, message?: string, type: string }|null,
 * }}
 */
export function initInterfaceControls({
  viewerApi,
  translate,
  windowRef,
  viewerContainer,
  viewerToolbar,
  viewerToolbarToggle,
  statusBanner,
  loadingOverlay,
}) {
  let lastStatus = null;
  let lastProgressPercent = null;
  let loadingOverlayManager = null;

  // Initialize loading overlay if element is provided
  if (loadingOverlay) {
    loadingOverlayManager = initLoadingOverlay({
      overlayElement: loadingOverlay,
      translate,
    });
  }

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

  const renderStatus = () => {
    if (!statusBanner) return;
    if (!lastStatus) {
      statusBanner.className = 'viewer-status';
      statusBanner.textContent = '';
      return;
    }
    
    // Hide status banner when loading overlay is active
    if (lastStatus.type === 'loading' && loadingOverlayManager) {
      statusBanner.className = 'viewer-status';
      statusBanner.textContent = '';
      return;
    }
    
    const baseMessage = lastStatus.key
      ? translate(lastStatus.key, lastStatus.fallback)
      : lastStatus.message || '';
    const suffix = typeof lastProgressPercent === 'number'
      ? ` (${lastProgressPercent}%)`
      : '';
    statusBanner.className = `viewer-status ${lastStatus.type}`;
    statusBanner.textContent = `${baseMessage}${suffix}`;
  };

  const setStatus = (key, type = 'loading') => {
    lastProgressPercent = null;
    lastStatus = { key, fallback: key, message: null, type };
    renderStatus();
    
    // Show centered loading overlay for all loading states
    if (type === 'loading' && loadingOverlayManager) {
      loadingOverlayManager.show(0, key);
    } else if (type !== 'loading' && loadingOverlayManager) {
      loadingOverlayManager.hide();
    }
  };

  const setCustomStatus = (message, type = 'loading') => {
    lastProgressPercent = null;
    lastStatus = { key: null, message, type };
    renderStatus();
  };

  const clearStatus = () => {
    lastStatus = null;
    lastProgressPercent = null;
    renderStatus();
    
    // Hide loading overlay when status is cleared
    if (loadingOverlayManager) {
      loadingOverlayManager.hide();
    }
  };

  const reapplyStatus = () => {
    if (!lastStatus) return;
    renderStatus();
  };

  const setProgressPercent = (percent) => {
    lastProgressPercent = percent;
    renderStatus();
    
    // Update loading overlay progress
    if (loadingOverlayManager && lastStatus?.type === 'loading') {
      loadingOverlayManager.updateProgress(percent, lastStatus?.key);
    }
  };

  const resetProgressPercent = () => {
    lastProgressPercent = null;
  };

  if (!viewerApi) {
    throw new Error('initInterfaceControls requires a viewerApi instance');
  }

  const resizeViewer = () => {
    const { clientWidth, clientHeight } = viewerContainer;
    viewerApi.resizeViewport?.(clientWidth, clientHeight);
    syncToolbarForViewport();
  };

  const initialize = () => {
    updateToolbarToggle();
    syncToolbarForViewport();
  };

  const getLastStatus = () => lastStatus;

  return {
    initialize,
    isToolbarCollapsed,
    updateToolbarToggle,
    setToolbarCollapsed,
    syncToolbarForViewport,
    resizeViewer,
    renderStatus,
    setStatus,
    setCustomStatus,
    clearStatus,
    reapplyStatus,
    setProgressPercent,
    resetProgressPercent,
    getLastStatus,
  };
}
