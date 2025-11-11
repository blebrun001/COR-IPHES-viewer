/**
 * Redirects users of the 3D viewer back to the landing page.
 */
const aboutButton = document.getElementById('aboutButton');

if (aboutButton) {
  aboutButton.addEventListener('click', () => {
    window.location.href = '../index.html';
  });
}
