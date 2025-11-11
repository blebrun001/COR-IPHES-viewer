/**
 * Minimal façade for the Three.js viewer, exposing intention-centric methods
 * that the UI layer can rely on while the underlying implementation evolves.
 */
import { Viewer3D } from './viewer3d.js';

/**
 * Public contract exposed to the UI layer. Each method expresses a business intention
 * rather than a low-level Three.js concern:
 *
 * • DOM integration: `mountIn`, `connectMeasurementOverlay`, `connectLabelOverlay`, `resizeViewport`, `destroy`.
 * • Primary model lifecycle: `displayPrimaryModel`, `clearScene`, `setPrimaryModelMetadata`, `focusActiveContent`, `applyViewPreset`.
 * • Comparison workflows: `enterComparisonSession`, `exitComparisonSession`, `displayComparisonTarget`, `hasComparisonTarget`, `clearComparisonTarget`, `getComparisonState`, `setComparisonScaleNormalized`, `toggleComparisonScaleNormalization`.
 * • Camera & rendering toggles: `getProjectionMode`, `setProjectionMode`, `getOrbitMode`, `setOrbitMode`, `areTexturesVisible`, `setTexturesVisibility`, `isScaleReferenceVisible`, `setScaleReferenceVisible`, `isWireframeActive`, `setWireframeActive`, `areLightsDimmed`, `setLightsDimmed`, `isAnaglyphEnabled`, `setAnaglyphEnabled`, `getAnaglyphEyeSeparation`, `getAnaglyphEyeSeparationRange`, `setAnaglyphEyeSeparation`, `isRotationToolActive`, `setRotationToolActive`.
 * • Measurement & annotations: `isMeasurementToolActive`, `setMeasurementToolActive`, `toggleMeasurementTool`, `clearMeasurements`, `areLabelsVisible`, `setLabelsVisible`, `toggleLabelsVisibility`, `clearLabels`.
 * • Clipping orchestration: `isClippingAvailable`, `getClippingState`, `isClippingActive`, `enableClippingForAxis`, `disableClipping`, `resetClippingState`, `setClippingAxis`.
 * • Output helpers: `isScreenshotBackgroundTransparent`, `setScreenshotBackgroundTransparent`, `captureScreenshot`.
 * • Event bridge: `addEventListener`, `removeEventListener`.
 */

/**
 * Declarative description of the façade's responsibility scope. Each family
 * will progressively receive higher level orchestration as the migration
 * advances.
 */
const ACTION_FAMILIES = Object.freeze([
  {
    id: 'modelLifecycle',
    description: 'Loading, presenting, and clearing primary 3D models.',
  },
  {
    id: 'comparison',
    description: 'Coordinating dual model comparison sessions.',
  },
  {
    id: 'viewsAndCamera',
    description: 'Applying camera presets, orbit modes, and focus behaviours.',
  },
  {
    id: 'renderingPipeline',
    description: 'Toggles impacting lighting, materials, and post-processing.',
  },
  {
    id: 'clipping',
    description: 'Managing clipping planes and sectioning helpers.',
  },
  {
    id: 'specialisedInteractions',
    description: 'Measurement tools, labels, annotations, and custom overlays.',
  },
]);

const DEFAULT_ANAGLYPH_RANGE = Object.freeze({ min: 0.01, max: 0.2 });

/**
 * Creates the façade instance that encapsulates Viewer3D creation and exposes
 * the explicit contract consumed by the UI layer.
 *
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Custom fetch implementation.
 * @returns {object} Intent-oriented API used by the UI.
 */
export function createViewerApi(options = {}) {
  const viewer = new Viewer3D(options);

  const getCanvas = () => {
    const canvas = viewer.getCanvas();
    if (!canvas) {
      throw new Error('Viewer canvas is not available yet');
    }
    return canvas;
  };

  const attachCanvasTo = (container) => {
    if (!container) {
      throw new Error('A container element is required to mount the viewer');
    }
    const canvas = getCanvas();
    if (canvas.parentElement !== container) {
      container.appendChild(canvas);
    }
    return canvas;
  };

  const hasActiveContent = () => {
    if (typeof viewer.hasModel === 'function' && viewer.hasModel()) {
      return true;
    }
    if (viewer.currentModelGroup) {
      return true;
    }
    if (viewer.comparisonModelA?.group || viewer.comparisonModelB?.group) {
      return true;
    }
    return false;
  };

  const focusIfNeeded = (shouldFocus) => {
    if (shouldFocus) {
      viewer.resetView();
    }
  };

  const ensureOrbitForProjection = (mode) => {
    if (
      mode === 'orthographic' &&
      typeof viewer.getOrbitMode === 'function' &&
      typeof viewer.setOrbitMode === 'function' &&
      viewer.getOrbitMode() === 'free'
    ) {
      viewer.setOrbitMode('upright');
    }
  };

  const projectionModeAccess = () =>
    typeof viewer.getCameraMode === 'function' ? viewer.getCameraMode() : 'perspective';

  const orbitModeAccess = () =>
    typeof viewer.getOrbitMode === 'function' ? viewer.getOrbitMode() : 'upright';

  const texturesEnabledAccess = () =>
    typeof viewer.areTexturesEnabled === 'function' ? viewer.areTexturesEnabled() : true;

  const scaleReferenceAccess = () => {
    if (typeof viewer.isScaleReferenceEnabled === 'function') {
      return viewer.isScaleReferenceEnabled();
    }
    return Boolean(viewer.scaleReference?.enabled);
  };

  const wireframeAccess = () =>
    typeof viewer.isWireframeEnabled === 'function' ? viewer.isWireframeEnabled() : false;

  const lightsDimmedAccess = () =>
    typeof viewer.areLightsDimmed === 'function' ? viewer.areLightsDimmed() : false;

  const anaglyphAccess = () =>
    typeof viewer.isAnaglyphEnabled === 'function' ? viewer.isAnaglyphEnabled() : false;

  const rotationToolAccess = () =>
    typeof viewer.isRotationGizmoEnabled === 'function' ? viewer.isRotationGizmoEnabled() : false;

  const measurementModeAccess = () =>
    typeof viewer.isMeasurementModeEnabled === 'function' ? viewer.isMeasurementModeEnabled() : false;

  const labelsVisibilityAccess = () =>
    typeof viewer.areModelLabelsEnabled === 'function' ? viewer.areModelLabelsEnabled() : false;

  const screenshotTransparencyAccess = () =>
    Boolean(viewer.screenshotTransparentBackground);

  const comparisonStateAccess = () => {
    const active =
      typeof viewer.isComparisonModeEnabled === 'function' ? viewer.isComparisonModeEnabled() : false;
    const hasReference = Boolean(viewer.comparisonModelA?.group || viewer.currentModelGroup);
    const hasTarget =
      typeof viewer.hasComparisonModelB === 'function' ? viewer.hasComparisonModelB() : false;
    const normalizeEnabled =
      typeof viewer.isNormalizeComparisonScaleEnabled === 'function'
        ? viewer.isNormalizeComparisonScaleEnabled()
        : Boolean(viewer.normalizeComparisonScale);
    return {
      active,
      hasReference,
      hasTarget,
      normalizeEnabled,
    };
  };

  const comparisonModeAccess = () => comparisonStateAccess().active;

  const clippingAxes = ['x', 'y', 'z'];

  const supportsClippingAccess = () =>
    typeof viewer.getClippingState === 'function' &&
    typeof viewer.setClippingEnabled === 'function' &&
    typeof viewer.setActiveClippingAxis === 'function' &&
    typeof viewer.setClippingPlaneEnabled === 'function';

  const defaultClippingState = {
    enabled: false,
    activeAxis: 'x',
    fillEnabled: false,
    fillColor: '#000000',
    fillOpacity: 0,
    planes: {},
  };

  const clippingStateAccess = () => {
    if (!supportsClippingAccess()) {
      return defaultClippingState;
    }
    try {
      return viewer.getClippingState();
    } catch (error) {
      console.warn('Failed to retrieve clipping state', error);
      return defaultClippingState;
    }
  };

  const normalizeAxis = (axis) => {
    if (typeof axis !== 'string') {
      return clippingStateAccess().activeAxis || 'x';
    }
    const normalised = axis.toLowerCase();
    return clippingAxes.includes(normalised) ? normalised : clippingStateAccess().activeAxis || 'x';
  };

  const disableAllClippingPlanes = () => {
    clippingAxes.forEach((axis) => {
      if (typeof viewer.setClippingPlaneEnabled === 'function') {
        try {
          viewer.setClippingPlaneEnabled(axis, false);
        } catch (error) {
          console.warn(`Failed to disable clipping plane "${axis}"`, error);
        }
      }
    });
  };

  return Object.freeze({
    /**
     * Mounts the WebGL canvas into the provided container element.
     *
     * @param {HTMLElement} container - Host element for the viewer canvas.
     * @returns {HTMLCanvasElement} The mounted canvas.
     */
    mountIn(container) {
      return attachCanvasTo(container);
    },

    /**
     * Loads and displays a primary model in the viewer.
     *
     * @param {object} source - Descriptor produced by the data layer.
     * @returns {Promise<void>}
     */
    async displayPrimaryModel(source) {
      await viewer.loadModel(source);
    },

    /**
     * Presents a secondary model within an active comparison session.
     *
     * @param {object} source - Descriptor for the comparison model.
     * @param {object} [metadata] - Optional metadata payload associated with the model.
     * @returns {Promise<void>}
     */
    async displayComparisonTarget(source, metadata) {
      if (!source || !source.objUrl) {
        throw new Error('displayComparisonTarget requires a model source with an objUrl');
      }
      if (!comparisonModeAccess()) {
        this.enterComparisonSession({ requirePrimaryModel: false });
      }
      await viewer.loadComparisonModel(source, metadata);
    },

    /**
     * Repositions the scene to focus on the active content.
     */
    focusActiveContent() {
      viewer.resetView();
    },

    /**
     * Applies a named view preset. Currently supports fitting the active content.
     *
     * @param {'fit-active-content'} preset - Identifier of the preset to apply.
     */
    applyViewPreset(preset) {
      if (preset === 'fit-active-content') {
        viewer.resetView();
        return true;
      }
      console.warn(`Unknown view preset "${preset}" requested; defaulting to focusActiveContent().`);
      viewer.resetView();
      return false;
    },

    /**
     * Retrieves the current camera projection mode.
     *
     * @returns {'perspective'|'orthographic'}
     */
    getProjectionMode() {
      return projectionModeAccess();
    },

    /**
     * Applies a camera projection mode and ensures orbit/camera coherence.
     *
     * @param {'perspective'|'orthographic'} mode - Desired mode.
     * @param {{ refocus?: boolean }} [options]
     * @returns {'perspective'|'orthographic'} Applied mode.
     */
    setProjectionMode(mode, { refocus = true } = {}) {
      if (typeof viewer.setCameraMode !== 'function') {
        return projectionModeAccess();
      }
      const previous = projectionModeAccess();
      const applied = viewer.setCameraMode(mode);
      ensureOrbitForProjection(applied);
      if (applied !== previous) {
        focusIfNeeded(refocus);
      }
      return applied;
    },

    /**
     * Retrieves the current orbit behaviour.
     *
     * @returns {'free'|'upright'}
     */
    getOrbitMode() {
      return orbitModeAccess();
    },

    /**
     * Switches the orbit behaviour, optionally adjusting projection for consistency.
     *
     * @param {'free'|'upright'} mode - Target mode.
     * @param {{ ensurePerspectiveForFree?: boolean, refocus?: boolean }} [options]
     * @returns {'free'|'upright'} Applied mode.
     */
    setOrbitMode(mode, { ensurePerspectiveForFree = true, refocus = false } = {}) {
      if (typeof viewer.setOrbitMode !== 'function') {
        return orbitModeAccess();
      }
      const previous = orbitModeAccess();
      const applied = viewer.setOrbitMode(mode);
      if (
        ensurePerspectiveForFree &&
        applied === 'free' &&
        typeof viewer.setCameraMode === 'function' &&
        projectionModeAccess() !== 'perspective'
      ) {
        viewer.setCameraMode('perspective');
      }
      if (applied !== previous) {
        focusIfNeeded(refocus);
      }
      return applied;
    },

    /**
     * Indicates whether textures are currently visible.
     *
     * @returns {boolean}
     */
    areTexturesVisible() {
      return texturesEnabledAccess();
    },

    /**
     * Sets the texture visibility and refreshes the scene.
     *
     * @param {boolean} visible - Desired visibility.
     * @returns {boolean} Applied state.
     */
    setTexturesVisibility(visible) {
      if (typeof viewer.setTexturesEnabled !== 'function') {
        return texturesEnabledAccess();
      }
      return viewer.setTexturesEnabled(Boolean(visible));
    },

    /**
     * Toggles textures on or off.
     *
     * @returns {boolean} Resulting state.
     */
    toggleTextures() {
      return this.setTexturesVisibility(!this.areTexturesVisible());
    },

    /**
     * Indicates whether the scale reference helper is visible.
     *
     * @returns {boolean}
     */
    isScaleReferenceVisible() {
      return scaleReferenceAccess();
    },

    /**
     * Controls the visibility of the scale reference helper.
     *
     * @param {boolean} visible - Desired visibility.
     * @returns {boolean} Applied state.
     */
    setScaleReferenceVisible(visible) {
      if (typeof viewer.setScaleReferenceEnabled !== 'function') {
        return scaleReferenceAccess();
      }
      return viewer.setScaleReferenceEnabled(Boolean(visible));
    },

    /**
     * Indicates if wireframe rendering is active.
     *
     * @returns {boolean}
     */
    isWireframeActive() {
      return wireframeAccess();
    },

    /**
     * Enables or disables wireframe rendering.
     *
     * @param {boolean} active - Desired state.
     * @returns {boolean} Applied state.
     */
    setWireframeActive(active) {
      if (typeof viewer.setWireframeEnabled !== 'function') {
        return wireframeAccess();
      }
      return viewer.setWireframeEnabled(Boolean(active));
    },

    /**
     * Toggles wireframe rendering.
     *
     * @returns {boolean} Resulting state.
     */
    toggleWireframe() {
      return this.setWireframeActive(!this.isWireframeActive());
    },

    /**
     * Indicates if the lighting rig is dimmed.
     *
     * @returns {boolean}
     */
    areLightsDimmed() {
      return lightsDimmedAccess();
    },

    /**
     * Adjusts the lighting rig and ensures compatibility with stereoscopic modes.
     *
     * @param {boolean} dimmed - Desired dim state.
     * @param {{ disableAnaglyphIfDimmed?: boolean }} [options]
     * @returns {boolean} Applied state.
     */
    setLightsDimmed(dimmed, { disableAnaglyphIfDimmed = true } = {}) {
      if (typeof viewer.setLightsDimmed !== 'function') {
        return lightsDimmedAccess();
      }
      const applied = viewer.setLightsDimmed(Boolean(dimmed));
      if (applied && disableAnaglyphIfDimmed && anaglyphAccess() && typeof viewer.setAnaglyphEnabled === 'function') {
        viewer.setAnaglyphEnabled(false);
      }
      return applied;
    },

    /**
     * Toggles the dimmed lighting state.
     *
     * @returns {boolean} Resulting state.
     */
    toggleLightsDimmed() {
      return this.setLightsDimmed(!this.areLightsDimmed());
    },

    /**
     * Indicates whether anaglyph rendering is enabled.
     *
     * @returns {boolean}
     */
    isAnaglyphEnabled() {
      return anaglyphAccess();
    },

    /**
     * Controls anaglyph rendering, ensuring lighting remains suitable.
     *
     * @param {boolean} enabled - Desired state.
     * @param {{ undimLights?: boolean }} [options]
     * @returns {boolean} Applied state.
     */
    setAnaglyphEnabled(enabled, { undimLights = true } = {}) {
      if (typeof viewer.setAnaglyphEnabled !== 'function') {
        return anaglyphAccess();
      }
      const applied = viewer.setAnaglyphEnabled(Boolean(enabled));
      if (applied && undimLights && typeof viewer.areLightsDimmed === 'function' && viewer.areLightsDimmed()) {
        this.setLightsDimmed(false, { disableAnaglyphIfDimmed: false });
      }
      return applied;
    },

    /**
     * Toggles the anaglyph effect.
     *
     * @returns {boolean} Resulting state.
     */
    toggleAnaglyph() {
      return this.setAnaglyphEnabled(!this.isAnaglyphEnabled());
    },

    /**
     * Retrieves the current anaglyph eye separation value.
     *
     * @returns {number}
     */
    getAnaglyphEyeSeparation() {
      if (typeof viewer.getAnaglyphEyeSeparation === 'function') {
        return viewer.getAnaglyphEyeSeparation();
      }
      return viewer.anaglyphEyeSeparation ?? 0;
    },

    /**
     * Provides the valid range for anaglyph eye separation adjustments.
     *
     * @returns {{ min: number, max: number }}
     */
    getAnaglyphEyeSeparationRange() {
      if (typeof viewer.getAnaglyphEyeSeparationRange === 'function') {
        return viewer.getAnaglyphEyeSeparationRange();
      }
      return { ...DEFAULT_ANAGLYPH_RANGE };
    },

    /**
     * Applies a new anaglyph eye separation value.
     *
     * @param {number} value - Desired separation distance.
     * @returns {number} Applied value.
     */
    setAnaglyphEyeSeparation(value) {
      if (typeof viewer.setAnaglyphEyeSeparation !== 'function') {
        return this.getAnaglyphEyeSeparation();
      }
      return viewer.setAnaglyphEyeSeparation(value);
    },

    /**
     * Indicates whether the rotation tool is active.
     *
     * @returns {boolean}
     */
    isRotationToolActive() {
      return rotationToolAccess();
    },

    /**
     * Enables or disables the rotation gizmo overlay.
     *
     * @param {boolean} active - Desired state.
     * @returns {boolean} Applied state.
     */
    setRotationToolActive(active) {
      if (typeof viewer.setRotationGizmoEnabled !== 'function') {
        return rotationToolAccess();
      }
      return viewer.setRotationGizmoEnabled(Boolean(active));
    },

    /**
     * Toggles the rotation gizmo overlay.
     *
     * @returns {boolean} Resulting state.
     */
    toggleRotationTool() {
      return this.setRotationToolActive(!this.isRotationToolActive());
    },

    /**
     * Reports whether any content is currently visible in the scene.
     *
     * @returns {boolean}
     */
    hasActiveContent() {
      return hasActiveContent();
    },

    /**
     * Clears the current scene contents and resets internal state.
     *
     * @param {{ preserveComparison?: boolean }} [options]
     */
    clearScene({ preserveComparison = false } = {}) {
      if (!preserveComparison && typeof viewer.clearComparisonModelB === 'function') {
        viewer.clearComparisonModelB();
      }
      if (typeof viewer.clear === 'function') {
        viewer.clear();
      }
    },

    /**
     * Updates metadata associated with the primary model, used for UI/tooling.
     *
     * @param {{ specimenName?: string, modelName?: string }} [metadata]
     */
    setPrimaryModelMetadata(metadata = null) {
      if (metadata == null) {
        viewer.currentModelMetadata = null;
        return;
      }
      const { specimenName = null, modelName = null } = metadata;
      viewer.currentModelMetadata = {
        specimenName,
        modelName,
      };
    },

    /**
     * Returns an aggregated snapshot of the comparison state.
     *
     * @returns {{active: boolean, hasReference: boolean, hasTarget: boolean, normalizeEnabled: boolean}}
     */
    getComparisonState() {
      return comparisonStateAccess();
    },

    /**
     * Indicates whether comparison mode is currently active.
     *
     * @returns {boolean}
     */
    isComparisonModeActive() {
      return comparisonModeAccess();
    },

    /**
     * Activates comparison mode, optionally requiring a primary model beforehand.
     *
     * @param {{ requirePrimaryModel?: boolean }} [options]
     * @returns {boolean} Applied state.
     */
    enterComparisonSession({ requirePrimaryModel = false } = {}) {
      if (requirePrimaryModel && !hasActiveContent()) {
        console.warn('Cannot enter comparison mode without a primary model in the scene');
        return false;
      }
      if (typeof viewer.setComparisonModeEnabled !== 'function') {
        return comparisonModeAccess();
      }
      const applied = viewer.setComparisonModeEnabled(true);
      return applied;
    },

    /**
     * Deactivates comparison mode and clears secondary models.
     *
     * @param {{ clearTarget?: boolean }} [options]
     * @returns {boolean} Applied state.
     */
    exitComparisonSession({ clearTarget = true } = {}) {
      if (clearTarget) {
        this.clearComparisonTarget();
      }
      if (typeof viewer.setComparisonModeEnabled !== 'function') {
        return comparisonModeAccess();
      }
      const applied = viewer.setComparisonModeEnabled(false);
      return applied;
    },

    /**
     * Indicates if a comparison target model (model B) is present.
     *
     * @returns {boolean}
     */
    hasComparisonTarget() {
      const state = comparisonStateAccess();
      return state.hasTarget;
    },

    /**
     * Removes the active comparison target model if present.
     */
    clearComparisonTarget() {
      if (typeof viewer.clearComparisonModelB === 'function') {
        viewer.clearComparisonModelB();
      }
    },

    /**
     * Returns whether scale normalisation is active during comparison.
     *
     * @returns {boolean}
     */
    isComparisonScaleNormalized() {
      return comparisonStateAccess().normalizeEnabled;
    },

    /**
     * Sets comparison scale normalisation.
     *
     * @param {boolean} enabled - Desired state.
     * @returns {boolean} Applied state.
     */
    setComparisonScaleNormalized(enabled) {
      if (typeof viewer.setNormalizeComparisonScale !== 'function') {
        return this.isComparisonScaleNormalized();
      }
      return viewer.setNormalizeComparisonScale(Boolean(enabled));
    },

    /**
     * Toggles comparison scale normalisation and returns the resulting state.
     *
     * @returns {boolean}
     */
    toggleComparisonScaleNormalization() {
      return this.setComparisonScaleNormalized(!this.isComparisonScaleNormalized());
    },

    /**
     * Indicates whether the measurement tool is active.
     *
     * @returns {boolean}
     */
    isMeasurementToolActive() {
      return measurementModeAccess();
    },

    /**
     * Enables or disables the measurement tool.
     *
     * @param {boolean} active - Desired state.
     * @returns {boolean} Applied state.
     */
    setMeasurementToolActive(active) {
      if (typeof viewer.setMeasurementModeEnabled !== 'function') {
        return measurementModeAccess();
      }
      const applied = viewer.setMeasurementModeEnabled(Boolean(active));
      return typeof applied === 'boolean' ? applied : measurementModeAccess();
    },

    /**
     * Toggles the measurement tool and returns the resulting state.
     *
     * @returns {boolean}
     */
    toggleMeasurementTool() {
      return this.setMeasurementToolActive(!this.isMeasurementToolActive());
    },

    /**
     * Clears all measurements currently drawn in the viewer.
     */
    clearMeasurements() {
      if (typeof viewer.clearMeasurements === 'function') {
        viewer.clearMeasurements();
      }
    },

    /**
     * Indicates whether model labels are visible.
     *
     * @returns {boolean}
     */
    areLabelsVisible() {
      return labelsVisibilityAccess();
    },

    /**
     * Shows or hides model labels.
     *
     * @param {boolean} visible - Desired visibility.
     * @returns {boolean} Resulting visibility.
     */
    setLabelsVisible(visible) {
      if (typeof viewer.setModelLabelsEnabled !== 'function') {
        return labelsVisibilityAccess();
      }
      const applied = viewer.setModelLabelsEnabled(Boolean(visible));
      return typeof applied === 'boolean' ? applied : labelsVisibilityAccess();
    },

    /**
     * Toggles model labels visibility.
     *
     * @returns {boolean} Resulting visibility.
     */
    toggleLabelsVisibility() {
      return this.setLabelsVisible(!this.areLabelsVisible());
    },

    /**
     * Removes any labels attached to the current models.
     */
    clearLabels() {
      if (typeof viewer.clearModelLabels === 'function') {
        viewer.clearModelLabels();
      }
    },

    /**
     * Indicates whether the screenshot background is currently transparent.
     *
     * @returns {boolean}
     */
    isScreenshotBackgroundTransparent() {
      return screenshotTransparencyAccess();
    },

    /**
     * Toggles the screenshot background transparency.
     *
     * @param {boolean} transparent - Desired transparency state.
     * @returns {boolean} Resulting transparency.
     */
    setScreenshotBackgroundTransparent(transparent) {
      if (typeof viewer.setScreenshotBackgroundTransparent === 'function') {
        viewer.setScreenshotBackgroundTransparent(Boolean(transparent));
      } else {
        viewer.screenshotTransparentBackground = Boolean(transparent);
      }
      return this.isScreenshotBackgroundTransparent();
    },

    /**
     * Indicates whether clipping capabilities are available.
     *
     * @returns {boolean}
     */
    isClippingAvailable() {
      return supportsClippingAccess();
    },

    /**
     * Retrieves the current clipping state snapshot.
     *
     * @returns {ReturnType<import('./viewer3d.js')['Viewer3D']['getClippingState']>}
     */
    getClippingState() {
      return clippingStateAccess();
    },

    /**
     * Reports whether clipping is currently active.
     *
     * @returns {boolean}
     */
    isClippingActive() {
      const state = clippingStateAccess();
      return Boolean(state.enabled);
    },

    /**
     * Enables clipping for a specific axis, disabling the others by default.
     *
     * @param {string} [axis='x'] - Axis identifier ('x'|'y'|'z').
     * @param {{ disableOtherAxes?: boolean }} [options]
     * @returns {ReturnType<typeof clippingStateAccess>}
     */
    enableClippingForAxis(axis = 'x', { disableOtherAxes = true } = {}) {
      if (!supportsClippingAccess()) {
        return clippingStateAccess();
      }
      const resolvedAxis = normalizeAxis(axis);
      if (disableOtherAxes) {
        disableAllClippingPlanes();
      }
      if (typeof viewer.setActiveClippingAxis === 'function') {
        viewer.setActiveClippingAxis(resolvedAxis);
      }
      if (typeof viewer.setClippingPlaneEnabled === 'function') {
        viewer.setClippingPlaneEnabled(resolvedAxis, true);
      }
      viewer.setClippingEnabled?.(true);
      return clippingStateAccess();
    },

    /**
     * Disables clipping and turns off every plane.
     *
     * @returns {ReturnType<typeof clippingStateAccess>}
     */
    disableClipping() {
      if (!supportsClippingAccess()) {
        return clippingStateAccess();
      }
      disableAllClippingPlanes();
      viewer.setClippingEnabled?.(false);
      return clippingStateAccess();
    },

    /**
     * Resets the clipping planes to their default offsets and optionally disables clipping.
     *
     * @param {{ silent?: boolean, disableAfterReset?: boolean }} [options]
     * @returns {ReturnType<typeof clippingStateAccess>}
     */
    resetClippingState({ silent = true, disableAfterReset = true } = {}) {
      if (!supportsClippingAccess()) {
        return clippingStateAccess();
      }
      if (typeof viewer.resetClippingPlanes === 'function') {
        viewer.resetClippingPlanes(Boolean(silent));
      }
      if (disableAfterReset) {
        this.disableClipping();
      }
      return clippingStateAccess();
    },

    /**
     * Sets the active clipping axis without altering enablement.
     *
     * @param {string} axis - Axis identifier.
     * @returns {ReturnType<typeof clippingStateAccess>}
     */
    setClippingAxis(axis) {
      if (!supportsClippingAccess()) {
        return clippingStateAccess();
      }
      const resolvedAxis = normalizeAxis(axis);
      if (typeof viewer.setActiveClippingAxis === 'function') {
        viewer.setActiveClippingAxis(resolvedAxis);
      }
      return clippingStateAccess();
    },

    /**
     * Captures a screenshot of the current viewer frame.
     *
     * @returns {Promise<string>} Data URL of the captured image.
     */
    async captureScreenshot() {
      if (typeof viewer.captureScreenshot !== 'function') {
        throw new Error('Screenshot capture is not supported in this environment');
      }
      return viewer.captureScreenshot();
    },

    /**
     * Registers an event listener on the underlying viewer and returns an unsubscribe handle.
     *
     * @param {string} event - Event name.
     * @param {Function} handler - Listener callback.
     * @returns {() => void} Cleanup function.
     */
    addEventListener(event, handler) {
      if (!event || typeof handler !== 'function') {
        throw new TypeError('addEventListener requires an event name and handler');
      }
      if (typeof viewer.on === 'function') {
        viewer.on(event, handler);
      }
      return () => {
        if (typeof viewer.off === 'function') {
          viewer.off(event, handler);
        }
      };
    },

    /**
     * Removes a previously registered event listener.
     *
     * @param {string} event - Event name.
     * @param {Function} handler - Handler reference.
     */
    removeEventListener(event, handler) {
      if (typeof viewer.off === 'function') {
        viewer.off(event, handler);
      }
    },

    /**
     * Adjusts the rendering viewport to match the provided dimensions.
     *
     * @param {number} width - Target width in pixels.
     * @param {number} height - Target height in pixels.
     */
    resizeViewport(width, height) {
      viewer.resize(width, height);
    },

    /**
     * Connects the measurement overlay DOM element to the underlying viewer.
     *
     * @param {HTMLElement} element - Container for measurement UI.
     */
    connectMeasurementOverlay(element) {
      if (!element) {
        throw new Error('A measurement overlay element is required');
      }
      viewer.attachMeasurementOverlay(element);
    },

    /**
     * Connects the label overlay DOM element to the underlying viewer.
     *
     * @param {HTMLElement} element - Container for label UI.
     */
    connectLabelOverlay(element) {
      if (!element) {
        throw new Error('A label overlay element is required');
      }
      viewer.attachLabelOverlay(element);
    },

    /**
     * Provides the high-level action families covered by the façade.
     *
     * @returns {Array<{id: string, description: string}>}
     */
    getActionFamilies() {
      return ACTION_FAMILIES;
    },

    /**
     * Returns the raw canvas element controlled by the viewer.
     *
     * @returns {HTMLCanvasElement}
     */
    getCanvasElement() {
      return getCanvas();
    },

    /**
     * Cleans up resources held by the viewer instance.
     */
    destroy() {
      viewer.destroy();
    },
  });
}

export { ACTION_FAMILIES as viewerActionFamilies };
