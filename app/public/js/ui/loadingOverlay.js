/**
 * Manages a centered loading overlay with animated spinner and rotating tech phrases.
 *
 * @param {object} deps
 * @param {HTMLElement} deps.overlayElement - Container for the loading overlay
 * @param {(key: string, fallback?: string) => string} deps.translate
 * @returns {{
 *   show: (percent?: number) => void,
 *   hide: () => void,
 *   updateProgress: (percent: number) => void,
 * }}
 */
export function initLoadingOverlay({ overlayElement, translate }) {
  if (!overlayElement) {
    throw new Error('initLoadingOverlay requires an overlayElement');
  }

  const TECH_PHRASES = [
    'initializing quantum mesh specimen',
    'calibrating osteo-hypermesh resonator matrix',
    'aligning bone embedded neural protonic viewer',
    'folding the CORA-RDR tessellation warpfields',
    'syncing open-science gravitic vertex lattice',
    'stabilizing bone subspace UV coordinates',
    'priming taxonomic photonic normal-mapping cores',
    'stitching interdimensional faunal polygon seams',
    'charging volumetric skeletal cache',
    'indexing morphometrics and polymorphic topology threads',
    'resolving spectral texture entropy',
    'tuning meta-bone inverse kinematics',
    'decrypting FAIR metadata anisotropic lightmaps',
    'propagating quantitative zooarchaeology vertex signals',
    'normalizing planar curvature biodiversity flux',
    'compiling skeletal element holo-collider collision maps',
    'annealing microfacet bone density grid',
    'propagating nanoweave skeletal representation',
    'reconciling temporal taxonomic echo',
    'bootstrapping anatomical quantum occlusion nodes',
  ];

  let phraseInterval = null;
  let currentPercent = 0;
  let currentStatusKey = 'status.loadingGeometry';

  const spinnerElement = overlayElement.querySelector('.loading-overlay-spinner');
  const phraseElement = overlayElement.querySelector('.loading-overlay-phrase');
  const statusElement = overlayElement.querySelector('.loading-overlay-status');

  /**
   * Selects and displays a random tech phrase.
   */
  const updatePhrase = () => {
    if (!phraseElement) return;
    const randomIndex = Math.floor(Math.random() * TECH_PHRASES.length);
    phraseElement.textContent = TECH_PHRASES[randomIndex];
  };

  /**
   * Updates the progress percentage display.
   */
  const updateProgressDisplay = () => {
    if (!statusElement) return;
    const baseMessage = translate(currentStatusKey, 'Loading...');
    statusElement.textContent = `${baseMessage} (${currentPercent}%)`;
  };

  /**
   * Shows the loading overlay with optional initial progress and status key.
   * @param {number} percent - Initial progress percentage
   * @param {string} statusKey - Translation key for the status message
   */
  const show = (percent = 0, statusKey = 'status.loadingGeometry') => {
    currentPercent = percent;
    currentStatusKey = statusKey;
    overlayElement.classList.add('visible');
    updatePhrase();
    updateProgressDisplay();

    // Rotate phrases every 2 seconds
    if (phraseInterval) {
      clearInterval(phraseInterval);
    }
    phraseInterval = setInterval(updatePhrase, 2000);
  };

  /**
   * Hides the loading overlay and stops phrase rotation.
   */
  const hide = () => {
    overlayElement.classList.remove('visible');
    if (phraseInterval) {
      clearInterval(phraseInterval);
      phraseInterval = null;
    }
  };

  /**
   * Updates the progress percentage.
   * @param {number} percent - Progress percentage
   * @param {string} statusKey - Optional translation key to update the status message
   */
  const updateProgress = (percent, statusKey) => {
    currentPercent = Math.min(100, Math.max(0, Math.round(percent)));
    if (statusKey) {
      currentStatusKey = statusKey;
    }
    updateProgressDisplay();
  };

  return {
    show,
    hide,
    updateProgress,
  };
}
