/**
 * Handles the “About the project” dialog lifecycle for the landing page.
 * Ensures the dialog opens and closes using the native <dialog> API.
 */
const aboutButton = document.getElementById('aboutButton');
const aboutDialog = document.getElementById('aboutDialog');
const closeAbout = document.getElementById('closeAbout');

if (aboutButton && aboutDialog) {
  aboutButton.addEventListener('click', () => {
    if (typeof aboutDialog.showModal === 'function') {
      aboutDialog.showModal();
    }
  });
}

if (closeAbout && aboutDialog) {
  closeAbout.addEventListener('click', () => {
    aboutDialog.close();
  });
}
