/**
 * Handles the Offline dialog interactions (open/close).
 */
const offlineButton = document.getElementById('offlineManagerButton');
const offlineDialog = document.getElementById('offlineDialog');
const closeOffline = document.getElementById('closeOfflineDialog');

const canUseDialog = offlineDialog && typeof offlineDialog.showModal === 'function';

if (offlineButton && canUseDialog) {
  offlineButton.addEventListener('click', () => {
    if (!offlineDialog.open) {
      offlineDialog.showModal();
    }
  });
}

if (closeOffline && offlineDialog) {
  closeOffline.addEventListener('click', () => {
    offlineDialog.close();
  });
}

if (offlineDialog) {
  offlineDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    offlineDialog.close();
  });
}
