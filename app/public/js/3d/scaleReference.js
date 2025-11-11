/**
 * Scale reference mixin wiring the measurement cube, comparison scaling, and overlay label for the 3D viewer.
 */
import * as THREE from 'three';

/**
 * Adds scale reference helpers to a Viewer3D prototype.
 *
 * @param {typeof import('./viewer3d.js').Viewer3D.prototype} viewerProto
 */
export function applyScaleReferenceMixin(viewerProto) {
  // ---------------------------------------------------------------------------
  // Setup & state management
  // ---------------------------------------------------------------------------

  /**
   * @private Initializes the reference cube actors and overlay bookkeeping.
   */
  viewerProto.setupScaleReference = function setupScaleReference() {
    // Initialize the reference cube sized to represent one centimetre.
    const size = 1; // 1 cm assuming meters as model units
    const group = new THREE.Group();
    group.name = 'ScaleReference';
    group.visible = false;

    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      metalness: 0.0,
      roughness: 0.2,
      transparent: false,
    });
    const cube = new THREE.Mesh(geometry, material);
    cube.castShadow = false;
    cube.receiveShadow = false;
    cube.userData.isScaleReference = true;
    cube.raycast = () => {};

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: false,
    });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
    edges.userData.isScaleReference = true;
    edges.raycast = () => {};

    group.add(cube);
    group.add(edges);

    this.scene.add(group);

    // Track scale reference state and associated resources.
    this.scaleReference = {
      enabled: false,
      size,
      group,
      cube,
      material,
      geometry,
      edgeMaterial,
      edges,
    };
    this.scaleReferenceLabel = {
      position: new THREE.Vector3(),
      el: null,
    };
  };

  // ---------------------------------------------------------------------------
  // Public API: scale reference enablement
  // ---------------------------------------------------------------------------
  /**
   * Reports whether the scale reference cube is currently enabled.
   */
  viewerProto.isScaleReferenceEnabled = function isScaleReferenceEnabled() {
    return Boolean(this.scaleReference?.enabled);
  };

  /**
   * Enables or disables the scale reference cube and synchronizes the scene.
   */
  viewerProto.setScaleReferenceEnabled = function setScaleReferenceEnabled(enabled) {
    if (!this.scaleReference) {
      this.setupScaleReference();
    }
    const ref = this.scaleReference;
    const next = Boolean(enabled);
    if (ref.enabled === next) {
      this.updateScaleReference();
      this.emit('scalereference', { enabled: ref.enabled });
      return ref.enabled;
    }
    ref.enabled = next;
    this.updateScaleReference();
    this.emit('scalereference', { enabled: ref.enabled });
    return ref.enabled;
  };

  // ---------------------------------------------------------------------------
  // Comparison scaling configuration
  // ---------------------------------------------------------------------------
  /**
   * Indicates whether comparison models are normalized to a shared scale.
   */
  viewerProto.isNormalizeComparisonScaleEnabled = function isNormalizeComparisonScaleEnabled() {
    return this.normalizeComparisonScale;
  };

  /**
   * Toggles normalization of comparison models and reapplies their layout.
   */
  viewerProto.setNormalizeComparisonScale = function setNormalizeComparisonScale(enabled) {
    const next = Boolean(enabled);
    if (this.normalizeComparisonScale === next) {
      this.emit('normalizationscale', { enabled: this.normalizeComparisonScale });
      if (this.comparisonModelA?.group && this.comparisonModelB?.group) {
        this._layoutComparisonModels();
        this.fitCameraToComparison();
      }
      return this.normalizeComparisonScale;
    }

    this.normalizeComparisonScale = next;

    if (this.comparisonModelA?.group) {
      if (!this.comparisonModelA.originalScale) {
        this.comparisonModelA.originalScale = this.comparisonModelA.group.scale.clone();
      }
      this._comparisonOriginalScales.A = this.comparisonModelA.originalScale.clone();
    }

    if (this.comparisonModelB?.group) {
      if (!this.comparisonModelB.originalScale) {
        this.comparisonModelB.originalScale = this.comparisonModelB.group.scale.clone();
      }
      this._comparisonOriginalScales.B = this.comparisonModelB.originalScale.clone();
    }

    if (this.comparisonModelA?.group || this.comparisonModelB?.group) {
      this._layoutComparisonModels();
      if (this.comparisonModelA?.group && this.comparisonModelB?.group) {
        this.fitCameraToComparison();
      }
    }

    this.emit('normalizationscale', { enabled: this.normalizeComparisonScale });
    return this.normalizeComparisonScale;
  };

  // ---------------------------------------------------------------------------
  // Comparison helpers
  // ---------------------------------------------------------------------------

  /**
   * @private Aligns comparison models while preserving their original scales.
   */
  viewerProto._layoutComparisonModels = function _layoutComparisonModels({ modelBOverride = null, originalScaleB = null } = {}) {
    const modelAEntry = this.comparisonModelA;
    const groupA = modelAEntry?.group || null;
    const groupB = modelBOverride || this.comparisonModelB?.group || null;

    if (!groupB) {
      return;
    }

    if (groupA && !this._comparisonOriginalScales.A) {
      const base = modelAEntry?.originalScale?.clone() || groupA.scale.clone();
      this._comparisonOriginalScales.A = base.clone();
      if (modelAEntry) {
        modelAEntry.originalScale = base.clone();
      }
    }

    if (originalScaleB) {
      this._comparisonOriginalScales.B = originalScaleB.clone();
    } else if (groupB && !this._comparisonOriginalScales.B) {
      const base = this.comparisonModelB?.originalScale?.clone() || groupB.scale.clone();
      this._comparisonOriginalScales.B = base.clone();
      if (this.comparisonModelB) {
        this.comparisonModelB.originalScale = base.clone();
      }
    }

    const baseScaleA =
      (groupA && this._comparisonOriginalScales.A?.clone()) || null;
    const baseScaleB =
      (this._comparisonOriginalScales.B && this._comparisonOriginalScales.B.clone()) ||
      groupB.scale.clone();

    if (groupA && baseScaleA) {
      groupA.scale.copy(baseScaleA);
    }
    if (baseScaleB) {
      groupB.scale.copy(baseScaleB);
    }

    let infoA = groupA ? this._computeComparisonModelInfo(groupA) : null;
    let infoB = this._computeComparisonModelInfo(groupB);

    if (groupA && this.normalizeComparisonScale) {
      const heightA = infoA.size.y;
      const heightB = infoB.size.y;
      if (heightA > 0 && heightB > 0) {
        if (heightA > heightB) {
          const factor = heightA / heightB;
          groupB.scale.multiplyScalar(factor);
        } else if (heightB > heightA) {
          const factor = heightB / heightA;
          groupA.scale.multiplyScalar(factor);
        }
      }
      infoA = this._computeComparisonModelInfo(groupA);
      infoB = this._computeComparisonModelInfo(groupB);
    }

    if (!groupA) {
      groupB.position.set(
        -infoB.centerLocal.x,
        -infoB.centerLocal.y,
        -infoB.centerLocal.z
      );
      groupB.updateMatrixWorld(true);
      this.updateScaleReference();
      return;
    }

    const largestWidth = Math.max(infoA.size.x, infoB.size.x);
    const gap = largestWidth * 0.2;
    const separation = infoA.size.x * 0.5 + infoB.size.x * 0.5 + gap;
    const offsetA = -separation * 0.5;
    const offsetB = separation * 0.5;
    const targetBase = (infoA.base + infoB.base) * 0.5;

    groupA.position.set(
      offsetA - infoA.centerLocal.x,
      targetBase - infoA.base,
      -infoA.centerLocal.z
    );
    groupB.position.set(
      offsetB - infoB.centerLocal.x,
      targetBase - infoB.base,
      -infoB.centerLocal.z
    );

    groupA.updateMatrixWorld(true);
    groupB.updateMatrixWorld(true);
    this.updateScaleReference();
  };

  /**
   * @private Extracts size and base metrics for a comparison group.
   */
  viewerProto._computeComparisonModelInfo = function _computeComparisonModelInfo(group) {
    if (!group) {
      return {
        box: new THREE.Box3(),
        size: new THREE.Vector3(),
        centerWorld: new THREE.Vector3(),
        centerLocal: new THREE.Vector3(),
        base: 0,
      };
    }
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const centerWorld = box.getCenter(new THREE.Vector3());
    const centerLocal = centerWorld.clone();
    group.worldToLocal(centerLocal);
    const base = centerLocal.y - size.y * 0.5;
    return {
      box,
      size,
      centerWorld,
      centerLocal,
      base,
    };
  };

  // ---------------------------------------------------------------------------
  // Active bounding box resolution
  // ---------------------------------------------------------------------------

  /**
   * @private Resolves the active bounding box according to the current mode.
   */
  viewerProto._getActiveBoundingBox = function _getActiveBoundingBox() {
    const expandBox = (source, targetBox) => {
      if (!source) {
        return false;
      }
      targetBox.expandByObject(source);
      return true;
    };

    const combined = new THREE.Box3();

    if (this.comparisonMode && this.comparisonModelA?.group && this.comparisonModelB?.group) {
      const touched =
        expandBox(this.comparisonModelA.group, combined) ||
        expandBox(this.comparisonModelB.group, combined);
      return touched && !combined.isEmpty() ? combined : null;
    }

    if (this.currentModelGroup) {
      const box = new THREE.Box3().setFromObject(this.currentModelGroup);
      return box.isEmpty() ? null : box;
    }

    if (this.comparisonModelA?.group) {
      const box = new THREE.Box3().setFromObject(this.comparisonModelA.group);
      if (!box.isEmpty()) {
        return box;
      }
    }

    if (this.comparisonModelB?.group) {
      const box = new THREE.Box3().setFromObject(this.comparisonModelB.group);
      if (!box.isEmpty()) {
        return box;
      }
    }

    return null;
  };

  // ---------------------------------------------------------------------------
  // Scale reference visuals & overlay
  // ---------------------------------------------------------------------------
  /**
   * Updates the cube placement and toggles the scale label visibility.
   */
  viewerProto.updateScaleReference = function updateScaleReference() {
    const ref = this.scaleReference;
    if (!ref || !ref.group) {
      return;
    }
    if (!ref.enabled) {
      ref.group.visible = false;
      this.hideScaleReferenceLabel();
      return;
    }
    const box = this._getActiveBoundingBox();
    if (!box || box.isEmpty()) {
      ref.group.visible = false;
      this.hideScaleReferenceLabel();
      return;
    }
    const sizeVec = box.getSize(new THREE.Vector3());
    const margin = Math.max(ref.size * 1.5, sizeVec.length() * 0.01);
    const anchor = new THREE.Vector3(
      box.min.x - margin,
      box.min.y,
      box.min.z - margin,
    );
    ref.group.position.set(
      anchor.x + ref.size * 0.5,
      anchor.y + ref.size * 0.5,
      anchor.z + ref.size * 0.5,
    );
    ref.group.visible = true;
    const labelPosition = ref.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, ref.size * 0.75, 0));
    if (!this.scaleReferenceLabel) {
      this.scaleReferenceLabel = {
        position: labelPosition.clone(),
        el: null,
      };
    } else {
      this.scaleReferenceLabel.position.copy(labelPosition);
    }
    this.ensureScaleReferenceLabel();
    if (this.scaleReferenceLabel?.el) {
      this.scaleReferenceLabel.el.classList.remove('hidden');
    }
  };

  /**
   * Ensures the measurement label exists within the overlay container.
   */
  viewerProto.ensureScaleReferenceLabel = function ensureScaleReferenceLabel() {
    if (!this.scaleReference || !this.scaleReference.enabled || !this.measureOverlay) {
      return;
    }
    if (!this.scaleReferenceLabel) {
      this.scaleReferenceLabel = {
        position: new THREE.Vector3(),
        el: null,
      };
    }
    if (this.scaleReferenceLabel.el) {
      return;
    }
    const label = document.createElement('div');
    label.className = 'measurement-label hidden';
    label.textContent = '1 cm';
    this.measureOverlay.appendChild(label);
    this.scaleReferenceLabel.el = label;
  };

  /**
   * Conceals the label without removing it from the DOM.
   */
  viewerProto.hideScaleReferenceLabel = function hideScaleReferenceLabel() {
    if (this.scaleReferenceLabel?.el) {
      this.scaleReferenceLabel.el.classList.add('hidden');
    }
  };

  /**
   * Removes the label element from the overlay and resets references.
   */
  viewerProto.removeScaleReferenceLabel = function removeScaleReferenceLabel() {
    if (this.scaleReferenceLabel?.el) {
      if (this.scaleReferenceLabel.el.parentElement) {
        this.scaleReferenceLabel.el.remove();
      }
      this.scaleReferenceLabel.el = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Disposal
  // ---------------------------------------------------------------------------
  /**
   * Releases geometry, materials, and overlay resources associated with the reference.
   */
  viewerProto.disposeScaleReference = function disposeScaleReference() {
    if (!this.scaleReference) {
      return;
    }
    const { group, geometry, material, edges, edgeMaterial } = this.scaleReference;
    if (group && group.parent) {
      group.parent.remove(group);
    }
    if (geometry) {
      geometry.dispose();
    }
    if (material) {
      material.dispose();
    }
    if (edges?.geometry) {
      edges.geometry.dispose();
    }
    if (edgeMaterial) {
      edgeMaterial.dispose();
    }
    this.scaleReference = null;
    this.removeScaleReferenceLabel();
    this.scaleReferenceLabel = null;
  };
}
