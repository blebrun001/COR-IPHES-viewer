// Builds event handlers that bridge UI controls with viewer behaviors and state.
import {
  setActiveModel as dispatchSetActiveModel,
  setCurrentMetadataDetail as dispatchSetCurrentMetadataDetail,
} from '../state/actions.js';
import {
  selectActiveDatasetId,
  selectActiveDatasetIdForB,
  selectComparisonMode,
  selectCurrentMetadataDetail,
} from '../state/selectors.js';

/**
 * Exposes controller factories for UI interactions.
 *
 * @param {object} deps - Collection of shared dependencies.
 * @returns {object} Controller helpers.
 */
export default function initControllers(deps = {}) {
  if (!deps || typeof deps !== 'object') {
    throw new TypeError('initControllers expects a dependency object');
  }

  const {
    viewerApi,
    translate,
    i18n,
    dataClient,
    updateProjectionButtons,
    updateTextureToggleButton,
    updateScaleReferenceButton,
    updateNormalizeScaleButton,
    updateWireframeButton,
    updateOrbitModeButtons,
    updateLightingButton,
    updateAnaglyphButton,
    updateMeasureButton,
    disableClipping,
    enableSingleXClippingPlane,
    isXClippingActive,
    syncClippingUI,
    toggleLabelsButton,
    datasetSelect,
    modelSelect,
    modelUtilities,
    metadata,
    updateCompareButtonState,
    setStatus,
    setProgressPercent,
    renderStatus,
    setRotationGizmoHasModel,
    clearStatus,
    resetProgressPercent,
    supportsClipping,
    documentRef,
  } = deps;

  if (!viewerApi) {
    throw new Error('initControllers requires a viewerApi instance');
  }
  const ensure = (fn, name) => {
    if (typeof fn !== 'function') {
      throw new Error(`initControllers requires ${name}()`);
    }
  };
  ensure(updateProjectionButtons, 'updateProjectionButtons');
  ensure(updateTextureToggleButton, 'updateTextureToggleButton');
  ensure(updateScaleReferenceButton, 'updateScaleReferenceButton');
  ensure(updateNormalizeScaleButton, 'updateNormalizeScaleButton');
  ensure(updateWireframeButton, 'updateWireframeButton');
  ensure(updateOrbitModeButtons, 'updateOrbitModeButtons');
  ensure(updateLightingButton, 'updateLightingButton');
  ensure(updateAnaglyphButton, 'updateAnaglyphButton');
  ensure(updateMeasureButton, 'updateMeasureButton');
  ensure(disableClipping, 'disableClipping');
  ensure(enableSingleXClippingPlane, 'enableSingleXClippingPlane');
  ensure(isXClippingActive, 'isXClippingActive');
  ensure(syncClippingUI, 'syncClippingUI');
  ensure(translate, 'translate');
  if (!i18n || typeof i18n.setLanguage !== 'function') {
    throw new Error('initControllers requires an i18n instance with setLanguage()');
  }
  if (!metadata || typeof metadata.updateExternalLinks !== 'function') {
    throw new Error('initControllers requires metadata.updateExternalLinks()');
  }
  ensure(updateCompareButtonState, 'updateCompareButtonState');
  ensure(setStatus, 'setStatus');
  ensure(setProgressPercent, 'setProgressPercent');
  ensure(renderStatus, 'renderStatus');
  ensure(setRotationGizmoHasModel, 'setRotationGizmoHasModel');
  ensure(clearStatus, 'clearStatus');
  ensure(resetProgressPercent, 'resetProgressPercent');
  if (!modelUtilities || typeof modelUtilities.loadModel !== 'function') {
    throw new Error('initControllers requires modelUtilities.loadModel()');
  }

  const getDatasetMetadata = (persistentId) => {
    if (dataClient && typeof dataClient.getDatasetMetadata === 'function') {
      return dataClient.getDatasetMetadata(persistentId);
    }
    return null;
  };

  const controllers = {
    handleProjectionModeButtonClick(event) {
      const mode = event?.currentTarget?.dataset?.cameraMode;
      if (!mode) {
        return;
      }
      if (typeof viewerApi.getProjectionMode === 'function' && viewerApi.getProjectionMode() === mode) {
        return;
      }
      viewerApi.setProjectionMode?.(mode, { refocus: true });
      updateProjectionButtons();
    },

    handleToggleTexturesButtonClick() {
      viewerApi.toggleTextures?.();
      updateTextureToggleButton();
    },

    handleScaleReferenceButtonClick() {
      const next = !(viewerApi.isScaleReferenceVisible?.() ?? false);
      viewerApi.setScaleReferenceVisible?.(next);
      updateScaleReferenceButton();
    },

    handleNormalizeScaleButtonClick() {
      const comparisonActive =
        typeof viewerApi.isComparisonModeActive === 'function'
          ? viewerApi.isComparisonModeActive()
          : false;
      if (!comparisonActive) {
        return;
      }
      viewerApi.toggleComparisonScaleNormalization?.();
      updateNormalizeScaleButton();
    },

    handleWireframeButtonClick() {
      viewerApi.toggleWireframe?.();
      updateWireframeButton();
    },

    handleClippingToggleButtonClick() {
      if (isXClippingActive()) {
        disableClipping();
      } else {
        enableSingleXClippingPlane();
      }
      syncClippingUI();
    },

    handleResetViewButtonClick() {
      if (typeof viewerApi.applyViewPreset === 'function') {
        viewerApi.applyViewPreset('fit-active-content');
      } else {
        viewerApi.focusActiveContent?.();
      }
    },

    handleLightingButtonClick() {
      viewerApi.toggleLightsDimmed?.();
      updateLightingButton();
    },

    handleAnaglyphButtonClick() {
      viewerApi.toggleAnaglyph?.();
      updateAnaglyphButton();
    },

    handleMeasureToggleButtonClick() {
      viewerApi.toggleMeasurementTool?.();
      updateMeasureButton();
    },

    handleClearMeasurementsButtonClick() {
      viewerApi.clearMeasurements?.();
      updateMeasureButton();
    },

    handleOrbitModeButtonClick(event) {
      const mode = event?.currentTarget?.dataset?.orbitMode;
      if (!mode) {
        return;
      }
      viewerApi.setOrbitMode?.(mode, { ensurePerspectiveForFree: true });
      updateOrbitModeButtons();
    },

    handleRotationGizmoButtonClick() {
      const next = !(viewerApi.isRotationToolActive?.() ?? false);
      viewerApi.setRotationToolActive?.(next);
      updateRotationGizmoButton();
    },

    handleToggleLabelsButtonClick() {
      const button = toggleLabelsButton;
      if (!button) {
        return;
      }
      const currentState = viewerApi.areLabelsVisible?.() ?? false;
      const newState = viewerApi.toggleLabelsVisibility?.() ?? !currentState;
      button.setAttribute('aria-pressed', newState ? 'true' : 'false');
      const labelKey = newState ? 'viewer.buttons.disableLabels' : 'viewer.buttons.enableLabels';
      const fallback = newState ? 'Disable Labels' : 'Enable Labels';
      const label = translate(labelKey, fallback);
      button.setAttribute('aria-label', label);
      button.setAttribute('data-tooltip', label);
    },

    async handleLanguageSelectChange(event) {
      const selected = event?.target?.value;
      if (!selected || selected === i18n.currentLanguage) {
        return;
      }
      try {
        await i18n.setLanguage(selected);
      } catch (error) {
        console.error('Unable to switch language', error);
      }
    },

    handleModelSelectChange(event) {
      const modelKey = event?.target?.value;
      if (!modelKey) {
        dispatchSetActiveModel(null);
        if (!selectComparisonMode()) {
          viewerApi.clearScene?.({ preserveComparison: false });
          setStatus('status.selectModel', 'info');
          const persistentId = datasetSelect?.value ?? '';
          const detail = getDatasetMetadata(persistentId) || selectCurrentMetadataDetail() || null;
          dispatchSetCurrentMetadataDetail(detail);
          metadata.updateExternalLinks(detail, null);
        }
        updateCompareButtonState();
        return;
      }

      if (selectComparisonMode()) {
        const datasetIdForB = selectActiveDatasetIdForB() || selectActiveDatasetId();
        if (typeof modelUtilities.loadComparisonModelB === 'function') {
          modelUtilities.loadComparisonModelB(datasetIdForB, modelKey);
        }
      } else {
        const persistentId = datasetSelect?.value;
        if (typeof modelUtilities.loadModel === 'function') {
          modelUtilities.loadModel(persistentId, modelKey);
        }
      }

      dispatchSetActiveModel(modelKey ?? null);
      updateCompareButtonState();
    },

    async handleScreenshotButtonClick() {
      try {
        const dataUrl = await viewerApi.captureScreenshot?.();
        if (!dataUrl) {
          setStatus('status.screenshotFailed', 'error');
          return;
        }

        const link = documentRef.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.href = dataUrl;
        link.download = `viewer-capture-${timestamp}.png`;
        documentRef.body.appendChild(link);
        link.click();
        link.remove();

        setStatus('status.screenshotSaved', 'info');
      } catch (error) {
        console.error(error);
        setStatus('status.screenshotFailed', 'error');
      }
    },

    handleViewerLoadStart() {
      setStatus('status.loadingGeometry');
      setProgressPercent(0);
      renderStatus();
      setRotationGizmoHasModel(false);
      if (supportsClipping) {
        viewerApi.resetClippingState?.({ silent: true, disableAfterReset: true });
        syncClippingUI();
      }
    },

    handleViewerLoadProgress({ percent }) {
      if (typeof percent === 'number' && !Number.isNaN(percent)) {
        setProgressPercent(Math.min(100, Math.max(Math.round(percent), 0)));
      }
    },

    handleViewerLoadEnd() {
      clearStatus();
      updateScaleReferenceButton();
      setRotationGizmoHasModel(true);
    },

    handleViewerLoadError() {
      resetProgressPercent();
      setStatus('status.modelLoadFailure', 'error');
      updateScaleReferenceButton();
      setRotationGizmoHasModel(false);
    },
  };

  return controllers;
}
