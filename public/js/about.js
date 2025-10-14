/**
 * Handles the “About the project” dialog lifecycle for the landing page.
 * Ensures the dialog opens and closes using the native <dialog> API.
 */
const aboutButton = document.getElementById('aboutButton');
const aboutDialog = document.getElementById('aboutDialog');
const closeAbout = document.getElementById('closeAbout');

const ABOUT_LAST_SEEN_KEY = 'aboutDialog:lastSeenAt';
const ABOUT_INTERVAL_MS = 24 * 60 * 60 * 1000;

const safeStorage = (() => {
  try {
    const testKey = '__aboutDialogTest__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return localStorage;
  } catch (error) {
    return null;
  }
})();

const recordAboutSeen = () => {
  if (!safeStorage) {
    return;
  }
  safeStorage.setItem(ABOUT_LAST_SEEN_KEY, String(Date.now()));
};

const shouldAutoOpenAbout = () => {
  if (!safeStorage) {
    return true;
  }

  const lastSeenRaw = safeStorage.getItem(ABOUT_LAST_SEEN_KEY);
  const lastSeen = lastSeenRaw ? Number.parseInt(lastSeenRaw, 10) : NaN;

  if (!Number.isFinite(lastSeen)) {
    return true;
  }

  return Date.now() - lastSeen >= ABOUT_INTERVAL_MS;
};

const openAboutDialog = () => {
  if (!aboutDialog || typeof aboutDialog.showModal !== 'function') {
    return;
  }

  if (aboutDialog.open) {
    return;
  }

  aboutDialog.showModal();
  recordAboutSeen();
};

if (aboutButton && aboutDialog) {
  aboutButton.addEventListener('click', openAboutDialog);
}

if (closeAbout && aboutDialog) {
  closeAbout.addEventListener('click', () => {
    aboutDialog.close();
  });
}

if (aboutDialog && shouldAutoOpenAbout()) {
  requestAnimationFrame(openAboutDialog);
}
