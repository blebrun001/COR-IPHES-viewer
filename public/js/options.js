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
