// Controls the rotation gizmo workflow used to adjust model orientation.
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export function applyRotationMixin(viewerProto) {
  const previousSyncTransformControlsCamera = viewerProto.syncTransformControlsCamera;
  viewerProto.syncTransformControlsCamera = function syncTransformControlsCamera() {
    if (typeof previousSyncTransformControlsCamera === 'function') {
      previousSyncTransformControlsCamera.call(this);
    }
    if (this.rotation?.gizmo) {
      this.rotation.gizmo.camera = this.camera;
      this.rotation.gizmo.updateMatrixWorld();
    }
  };

  // Initialize the transform controls responsible for freeform rotation.
  viewerProto.setupRotationGizmo = function () {
    const gizmo = new TransformControls(this.camera, this.renderer.domElement);
    gizmo.enabled = false;
    gizmo.visible = false;
    gizmo.setMode('rotate');
    gizmo.space = 'local';
    gizmo.addEventListener('dragging-changed', (event) => {
      if (this.controls) {
        this.controls.enabled = !event.value;
      }
    });
    const handleRotationChange = () => {
      if (!this.rotation?.enabled || this.rotation.suppressUpdate) {
        return;
      }
      this.updateModelRotationFromGroup();
    };
    gizmo.addEventListener('change', handleRotationChange);
    gizmo.addEventListener('objectChange', handleRotationChange);
    this.rotation.gizmo = gizmo;
    this.rotation.overlayScene = new THREE.Scene();
    this.rotation.overlayScene.add(gizmo);

    gizmo.traverse((child) => {
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          material.depthTest = false;
          material.depthWrite = false;
          material.transparent = true;
        });
      }
      child.renderOrder = 999;
    });
    this.syncTransformControlsCamera();
    this.updateRotationGizmoState();
  };

  // Update gizmo enablement to match the current model state.
  viewerProto.updateRotationGizmoState = function () {
    const gizmo = this.rotation?.gizmo;
    if (!gizmo) {
      return;
    }
    const shouldEnable = Boolean(this.rotation.enabled && this.currentModelGroup);
    const wasVisible = gizmo.visible;
    this.rotation.suppressUpdate = true;
    if (shouldEnable) {
      gizmo.attach(this.currentModelGroup);
      gizmo.enabled = true;
      gizmo.visible = true;
      if (this.rotation.overlayScene) {
        this.rotation.overlayScene.updateMatrixWorld(true);
      }
    } else {
      gizmo.enabled = false;
      gizmo.visible = false;
      gizmo.detach();
    }
    this.rotation.suppressUpdate = false;
    if (wasVisible !== gizmo.visible) {
      this.emit('rotationgizmo', { enabled: gizmo.visible });
    }
    this.syncTransformControlsCamera();
  };

  // Public API for reading and mutating the stored model rotation.
  viewerProto.resetModelRotation = function () {
    return this.setModelRotation({ x: 0, y: 0, z: 0 });
  };

  viewerProto.getModelRotation = function () {
    return {
      x: this.modelRotationDegrees.x,
      y: this.modelRotationDegrees.y,
      z: this.modelRotationDegrees.z,
    };
  };

  viewerProto.setModelRotation = function (rotation = {}) {
    if (!rotation || typeof rotation !== 'object') {
      return this.getModelRotation();
    }
    const next = { ...this.modelRotationDegrees };
    let changed = false;
    ['x', 'y', 'z'].forEach((axis) => {
      if (Object.prototype.hasOwnProperty.call(rotation, axis)) {
        const value = Number(rotation[axis]);
        if (!Number.isNaN(value)) {
          const clamped = THREE.MathUtils.clamp(value, -180, 180);
          if (Math.abs(next[axis] - clamped) > 1e-4) {
            next[axis] = clamped;
            changed = true;
          }
        }
      }
    });
    if (!changed) {
      return this.getModelRotation();
    }
    this.modelRotationDegrees = next;
    this.modelRotation.set(
      THREE.MathUtils.degToRad(next.x),
      THREE.MathUtils.degToRad(next.y),
      THREE.MathUtils.degToRad(next.z),
    );
    this.applyModelRotation();
    return this.getModelRotation();
  };

  viewerProto.setModelRotationAxis = function (axis, degrees) {
    if (!axis || typeof axis !== 'string') {
      return this.getModelRotation();
    }
    const normalized = axis.toLowerCase();
    if (!['x', 'y', 'z'].includes(normalized)) {
      return this.getModelRotation();
    }
    return this.setModelRotation({ [normalized]: degrees });
  };

  viewerProto.updateModelRotationFromGroup = function () {
    if (!this.currentModelGroup) {
      return;
    }
    const euler = new THREE.Euler().setFromQuaternion(this.currentModelGroup.quaternion, 'XYZ');
    const toDegrees = (radians) => THREE.MathUtils.radToDeg(radians);
    const normalizeDegrees = (deg) => {
      const wrapped = THREE.MathUtils.euclideanModulo(deg + 180, 360) - 180;
      return wrapped;
    };
    const nextDegrees = {
      x: normalizeDegrees(toDegrees(euler.x)),
      y: normalizeDegrees(toDegrees(euler.y)),
      z: normalizeDegrees(toDegrees(euler.z)),
    };
    this.modelRotationDegrees = nextDegrees;
    this.modelRotation.set(
      THREE.MathUtils.degToRad(nextDegrees.x),
      THREE.MathUtils.degToRad(nextDegrees.y),
      THREE.MathUtils.degToRad(nextDegrees.z),
      'XYZ'
    );
    this.applyModelRotation({ skipGroupRotation: true });
  };

  viewerProto.applyModelRotation = function ({ skipGroupRotation = false } = {}) {
    const hasModel = Boolean(this.currentModelGroup);
    if (hasModel) {
      if (!skipGroupRotation) {
        this.currentModelGroup.rotation.copy(this.modelRotation);
      }
      this.currentModelGroup.updateMatrixWorld(true);
      this.updateMeasurementsForCurrentModel();
      this.updateClippingBoundsFromCurrentModel();
      this.updateScaleReference();
      this.updateRotationGizmoState();
    } else {
      this.updateMeasurementLabels();
      this.updateRotationGizmoState();
    }
    this.emit('modelrotationchange', {
      rotation: this.getModelRotation(),
      hasModel,
    });
  };

  // Determine whether the rotation gizmo is currently presented to the user.
  viewerProto.isRotationGizmoEnabled = function () {
    return Boolean(this.rotation?.enabled && this.rotation?.gizmo?.visible);
  };

  viewerProto.setRotationGizmoEnabled = function (enabled) {
    if (!this.rotation || !this.rotation.gizmo) {
      return false;
    }
    const next = Boolean(enabled);
    const gizmo = this.rotation.gizmo;
    if (this.rotation.enabled === next && gizmo.visible === next) {
      return gizmo.visible;
    }
    this.rotation.enabled = next;
    gizmo.visible = next;
    this.updateRotationGizmoState();
    return gizmo.visible;
  };

  // rendu de l'overlay
  viewerProto.renderRotationGizmoOverlay = function () {
    const gizmo = this.rotation?.gizmo;
    const overlayScene = this.rotation?.overlayScene;
    if (!gizmo || !overlayScene || !gizmo.visible) {
      return;
    }

    const renderer = this.renderer;
    const prevAutoClear = renderer.autoClear;
    const prevLocalClipping = renderer.localClippingEnabled;
    const prevPlanes = renderer.clippingPlanes;

    renderer.autoClear = false;
    renderer.localClippingEnabled = false;
    renderer.clippingPlanes = [];
    renderer.clearDepth();

    renderer.render(overlayScene, this.camera);

    renderer.clippingPlanes = prevPlanes;
    renderer.localClippingEnabled = prevLocalClipping;
    renderer.autoClear = prevAutoClear;
  };
}
