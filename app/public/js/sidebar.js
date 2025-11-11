/**
 * Controls the responsive sidebar, including accessibility attributes,
 * overlay handling, and viewport resize reactions.
 */
const sidebar = document.getElementById('appSidebar');
const toggleSidebarButton = document.getElementById('toggleSidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const mediaQuery = window.matchMedia('(max-width: 1024px)');

const body = document.body;

/**
 * Mirrors the sidebar visibility state onto the relevant ARIA attributes.
 *
 * @param {boolean} expanded - Whether the sidebar is considered expanded.
 */
function setAriaExpanded(expanded) {
  if (toggleSidebarButton) {
    toggleSidebarButton.setAttribute('aria-expanded', String(expanded));
  }
  if (sidebar) {
    sidebar.setAttribute('aria-expanded', String(expanded));
  }
}

/**
 * Closes the sidebar on small screens and optionally returns focus to the toggle.
 *
 * @param {Object} [options]
 * @param {boolean} [options.focusToggle=true] - Whether focus should move back to the toggle.
 */
function closeSidebar({ focusToggle = true } = {}) {
  if (!sidebar || !toggleSidebarButton || !sidebarOverlay) {
    return;
  }
  sidebar.classList.remove('sidebar--open');
  sidebarOverlay.hidden = true;
  body.classList.remove('sidebar-open');
  setAriaExpanded(!mediaQuery.matches);
  if (focusToggle) {
    toggleSidebarButton.focus();
  }
}

/**
 * Opens the sidebar and ensures focus is moved inside the panel.
 */
function openSidebar() {
  if (!sidebar || !toggleSidebarButton || !sidebarOverlay) {
    return;
  }
  sidebar.classList.add('sidebar--open');
  sidebarOverlay.hidden = false;
  body.classList.add('sidebar-open');
  setAriaExpanded(true);
  sidebar.focus();
}

/**
 * Toggles the sidebar between open/closed states.
 */
function handleToggle() {
  if (!sidebar) return;
  if (sidebar.classList.contains('sidebar--open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

/**
 * Synchronises sidebar state with the current viewport width.
 * Ensures the sidebar is always expanded on desktop layouts.
 */
function syncSidebarToViewport() {
  if (!sidebar || !toggleSidebarButton || !sidebarOverlay) {
    return;
  }
  if (!mediaQuery.matches) {
    sidebar.classList.remove('sidebar--open');
    sidebarOverlay.hidden = true;
    body.classList.remove('sidebar-open');
    setAriaExpanded(true);
  } else {
    const expanded = sidebar.classList.contains('sidebar--open');
    setAriaExpanded(expanded);
    if (!expanded) {
      sidebarOverlay.hidden = true;
      body.classList.remove('sidebar-open');
    }
  }
}

if (sidebar && toggleSidebarButton && sidebarOverlay) {
  toggleSidebarButton.addEventListener('click', handleToggle);
  sidebarOverlay.addEventListener('click', () => closeSidebar());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.classList.contains('sidebar--open')) {
      closeSidebar();
    }
  });

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', syncSidebarToViewport);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(syncSidebarToViewport);
  }

  syncSidebarToViewport();
}
