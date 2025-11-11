/**
 * Creates handlers for viewer material controls (orbit/projection modes, clipping, etc.).
 *
 * @param {object} deps
 * @param {object} deps.viewerApi - High-level façade for view/camera/render operations.
 * @param {(key: string, fallback?: string) => string} deps.translate
 * @param {boolean} deps.supportsClipping
 * @param {Array<{button: HTMLElement|null, mode: string, labelKey: string, fallback: string}>} deps.projectionModeButtons
 * @param {Array<{button: HTMLElement|null, mode: string, labelKey: string, fallback: string}>} deps.orbitModeButtons
 * @param {HTMLElement|null} deps.toggleTexturesButton
 * @param {HTMLElement|null} deps.normalizeScaleButton
 * @param {HTMLElement|null} deps.scaleReferenceButton
 * @param {HTMLElement|null} deps.wireframeButton
 * @param {HTMLElement|null} deps.lightingButton
 * @param {HTMLElement|null} deps.anaglyphButton
 * @param {HTMLElement|null} deps.measureToggleButton
 * @param {HTMLElement|null} deps.clippingToggleButton
 * @param {HTMLElement|null} deps.rotationGizmoButton
 * @param {() => boolean} [deps.getComparisonMode]
 * @returns {{
 *   initialize: () => void,
 *   updateRotationGizmoButton: () => void,
 *   updateProjectionButtons: () => void,
 *   updateOrbitModeButtons: () => void,
 *   updateTextureToggleButton: () => void,
 *   updateNormalizeScaleButton: () => void,
 *   updateWireframeButton: () => void,
 *   updateScaleReferenceButton: () => void,
 *   updateLightingButton: () => void,
 *   updateAnaglyphButton: () => void,
 *   updateMeasureButton: () => void,
 *   updateClippingButton: () => void,
 *   syncClippingUI: () => void,
 *   disableClipping: () => void,
 *   disableAllClippingPlanes: () => void,
 *   enableSingleXClippingPlane: () => void,
 *   isXClippingActive: () => boolean,
 *   setRotationGizmoHasModel: (hasModel: boolean) => void,
 * }}
 */
export function initMaterialControls({
  viewerApi,
  translate,
  supportsClipping,
  projectionModeButtons,
  orbitModeButtons,
  toggleTexturesButton,
  normalizeScaleButton,
  scaleReferenceButton,
  wireframeButton,
  lightingButton,
  anaglyphButton,
  measureToggleButton,
  clippingToggleButton,
  rotationGizmoButton,
  getComparisonMode,
}) {
  if (!viewerApi) {
    throw new Error('initMaterialControls requires a viewerApi instance');
  }
  const renderingFacade = viewerApi;
  let rotationGizmoHasModel =
    typeof renderingFacade.hasActiveContent === 'function'
      ? renderingFacade.hasActiveContent()
      : false;

  const isXClippingActive = () => {
    if (!supportsClipping) return false;
    const state = typeof renderingFacade.getClippingState === 'function'
      ? renderingFacade.getClippingState()
      : null;
    return Boolean(state?.enabled && state?.planes?.x?.enabled);
  };

  const disableAllClippingPlanes = () => {
    if (!supportsClipping) return;
    renderingFacade?.disableClipping?.();
  };

  const enableSingleXClippingPlane = () => {
    if (!supportsClipping) return;
    renderingFacade?.enableClippingForAxis?.('x');
  };

  const disableClipping = () => {
    if (!supportsClipping) return;
    renderingFacade?.disableClipping?.();
  };

  const updateRotationGizmoButton = () => {
    if (!rotationGizmoButton) return;
    const enabled =
      typeof renderingFacade.isRotationToolActive === 'function'
        ? renderingFacade.isRotationToolActive()
        : false;
    const labelKey = enabled
      ? 'viewer.rotation.disableGizmo'
      : 'viewer.rotation.enableGizmo';
    const fallback = enabled ? 'Disable rotation gizmo' : 'Enable rotation gizmo';
    rotationGizmoButton.setAttribute('aria-label', translate(labelKey, fallback));
    rotationGizmoButton.setAttribute(
      'data-tooltip',
      translate('viewer.rotation.gizmoTooltip', 'Rotation gizmo'),
    );
    rotationGizmoButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    rotationGizmoButton.disabled = !rotationGizmoHasModel;
  };

  const updateProjectionButtons = () => {
    const currentMode = typeof renderingFacade.getProjectionMode === 'function'
      ? renderingFacade.getProjectionMode()
      : 'perspective';
    projectionModeButtons.forEach(({ button, mode, labelKey, fallback }) => {
      if (!button) {
        return;
      }
      const isActive = currentMode === mode;
      const label = translate(labelKey, fallback);
      button.setAttribute('aria-label', label);
      button.setAttribute('data-tooltip', label);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const updateOrbitModeButtons = () => {
    const currentMode = typeof renderingFacade.getOrbitMode === 'function'
      ? renderingFacade.getOrbitMode()
      : 'upright';
    orbitModeButtons.forEach(({ button, mode, labelKey, fallback }) => {
      if (!button) {
        return;
      }
      const isActive = currentMode === mode;
      const label = translate(labelKey, fallback);
      button.setAttribute('aria-label', label);
      button.setAttribute('data-tooltip', label);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  };

  const updateTextureToggleButton = () => {
    if (toggleTexturesButton) {
      const texturesEnabled = typeof renderingFacade.areTexturesVisible === 'function'
        ? renderingFacade.areTexturesVisible()
        : true;
      const key = texturesEnabled
        ? 'viewer.buttons.disableTextures'
        : 'viewer.buttons.enableTextures';
      const label = translate(
        key,
        texturesEnabled ? 'Disable Textures' : 'Enable Textures',
      );
      toggleTexturesButton.setAttribute('aria-label', label);
      toggleTexturesButton.setAttribute('data-tooltip', label);
    }
  };

  const updateNormalizeScaleButton = () => {
    if (!normalizeScaleButton) {
      return;
    }
    const comparisonActive =
      (typeof renderingFacade.isComparisonModeActive === 'function'
        ? renderingFacade.isComparisonModeActive()
        : undefined) ?? Boolean(getComparisonMode?.());

    const normalizationEnabled =
      comparisonActive &&
      (typeof renderingFacade.isComparisonScaleNormalized === 'function'
        ? renderingFacade.isComparisonScaleNormalized()
        : false);

    const labelKey = normalizationEnabled
      ? 'viewer.buttons.disableNormalizeComparisonScale'
      : 'viewer.buttons.enableNormalizeComparisonScale';
    const labelFallback = normalizationEnabled
      ? 'Disable comparison scale normalisation'
      : 'Normalise comparison scale';
    const label = translate(labelKey, labelFallback);
    const tooltip = translate(
      'viewer.buttons.normalizeComparisonScaleTooltip',
      'Normalize scales',
    );

    normalizeScaleButton.setAttribute(
      'aria-pressed',
      normalizationEnabled ? 'true' : 'false',
    );
    normalizeScaleButton.setAttribute('aria-label', label);
    normalizeScaleButton.setAttribute('data-tooltip', tooltip);
    normalizeScaleButton.hidden = !comparisonActive;
    normalizeScaleButton.disabled = !comparisonActive;
  };

  const updateWireframeButton = () => {
    if (wireframeButton) {
      const wireframeEnabled = typeof renderingFacade.isWireframeActive === 'function'
        ? renderingFacade.isWireframeActive()
        : false;
      const key = wireframeEnabled
        ? 'viewer.buttons.disableWireframe'
        : 'viewer.buttons.enableWireframe';
      const label = translate(
        key,
        wireframeEnabled ? 'Disable Wireframe' : 'Enable Wireframe',
      );
      wireframeButton.setAttribute('aria-label', label);
      wireframeButton.setAttribute('data-tooltip', label);
    }
  };

  const updateScaleReferenceButton = () => {
    if (!scaleReferenceButton) {
      return;
    }
    const enabled =
      typeof renderingFacade.isScaleReferenceVisible === 'function'
        ? renderingFacade.isScaleReferenceVisible()
        : false;
    const hasSceneContent = typeof renderingFacade.hasActiveContent === 'function'
      ? renderingFacade.hasActiveContent()
      : false;
    const labelKey = enabled
      ? 'viewer.buttons.disableScaleReference'
      : 'viewer.buttons.enableScaleReference';
    const labelFallback = enabled ? 'Hide Scale' : 'Display Scale';
    const tooltip = translate(
      'viewer.buttons.scaleReferenceTooltip',
      'Display a 1 cm reference cube',
    );
    scaleReferenceButton.setAttribute('aria-label', translate(labelKey, labelFallback));
    scaleReferenceButton.setAttribute('data-tooltip', tooltip);
    scaleReferenceButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    scaleReferenceButton.disabled = !hasSceneContent;
  };

  const updateLightingButton = () => {
    if (lightingButton) {
      const lightsDimmed = typeof renderingFacade.areLightsDimmed === 'function'
        ? renderingFacade.areLightsDimmed()
        : false;
      const key = lightsDimmed
        ? 'viewer.buttons.restoreLights'
        : 'viewer.buttons.dimLights';
      const label = translate(
        key,
        lightsDimmed ? 'Restore Lights' : 'Dim Lights',
      );
      lightingButton.setAttribute('aria-label', label);
      lightingButton.setAttribute('data-tooltip', label);
    }
  };

  const updateAnaglyphButton = () => {
    if (anaglyphButton) {
      const anaglyphEnabled = typeof renderingFacade.isAnaglyphEnabled === 'function'
        ? renderingFacade.isAnaglyphEnabled()
        : false;
      const key = anaglyphEnabled
        ? 'viewer.buttons.disableAnaglyph'
        : 'viewer.buttons.enableAnaglyph';
      const fallback = anaglyphEnabled
        ? 'Disable anaglyph view'
        : 'Enable anaglyph view';
      const label = translate(key, fallback);
      anaglyphButton.setAttribute('aria-label', label);
      anaglyphButton.setAttribute('data-tooltip', label);
      anaglyphButton.setAttribute('aria-pressed', anaglyphEnabled ? 'true' : 'false');
    }
  };

  const updateMeasureButton = () => {
    if (measureToggleButton) {
      const measurementEnabled = typeof renderingFacade.isMeasurementToolActive === 'function'
        ? renderingFacade.isMeasurementToolActive()
        : false;
      const key = measurementEnabled
        ? 'viewer.buttons.exitMeasure'
        : 'viewer.buttons.measure';
      const label = translate(
        key,
        measurementEnabled ? 'Exit Measure' : 'Measure',
      );
      measureToggleButton.setAttribute('aria-label', label);
      measureToggleButton.setAttribute('data-tooltip', label);
    }
  };

  const updateClippingButton = () => {
    if (!clippingToggleButton) {
      return;
    }
    if (!supportsClipping) {
      clippingToggleButton.hidden = true;
      return;
    }
    const enabled = isXClippingActive();
    clippingToggleButton.hidden = false;
    const labelKey = enabled
      ? 'viewer.buttons.disableClipping'
      : 'viewer.buttons.enableClipping';
    const labelFallback = enabled ? 'Disable section view' : 'Enable section view';
    clippingToggleButton.setAttribute(
      'aria-label',
      translate(labelKey, labelFallback),
    );
    clippingToggleButton.setAttribute(
      'data-tooltip',
      translate('viewer.buttons.clippingTooltip', 'Section view'),
    );
    clippingToggleButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    clippingToggleButton.setAttribute('aria-expanded', enabled ? 'true' : 'false');
  };

  const syncClippingUI = () => {
    updateClippingButton();
    if (!supportsClipping) {
      return;
    }
    const hasSceneContent = typeof renderingFacade?.hasActiveContent === 'function'
      ? renderingFacade.hasActiveContent()
      : false;
    if (!hasSceneContent) {
      if (clippingToggleButton) {
        clippingToggleButton.disabled = true;
        clippingToggleButton.setAttribute('aria-disabled', 'true');
      }
      disableClipping();
      return;
    }
    if (clippingToggleButton) {
      clippingToggleButton.disabled = false;
      clippingToggleButton.removeAttribute('aria-disabled');
    }
  };

  const initialize = () => {
    if (!supportsClipping && clippingToggleButton) {
      clippingToggleButton.hidden = true;
    }
    updateRotationGizmoButton();
  };

  const setRotationGizmoHasModel = (hasModel) => {
    rotationGizmoHasModel = hasModel;
    updateRotationGizmoButton();
  };

  return {
    initialize,
    updateRotationGizmoButton,
    updateProjectionButtons,
    updateOrbitModeButtons,
    updateTextureToggleButton,
    updateNormalizeScaleButton,
    updateWireframeButton,
    updateScaleReferenceButton,
    updateLightingButton,
    updateAnaglyphButton,
    updateMeasureButton,
    updateClippingButton,
    syncClippingUI,
    disableClipping,
    disableAllClippingPlanes,
    enableSingleXClippingPlane,
    isXClippingActive,
    setRotationGizmoHasModel,
  };
}
