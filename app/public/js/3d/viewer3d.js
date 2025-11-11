/**
 * Three.js based viewer tailored for Dataverse OBJ/MTL datasets,
 * including material management, measurement tools, and camera controls.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ManagedAnaglyphEffect } from './anaglyphEffect.js';
import { applyClippingMixin } from './clipping.js';
import { applyScaleReferenceMixin } from './scaleReference.js';
import { applyLabelsMixin } from './labels.js';
import { applyMeasurementsMixin } from './measurements.js';
import { applyMaterialsMixin, extractMtllibReferences, parseMtl } from './materials.js';
import { applyEnvironmentMixin } from './environment.js';
import { applyComparisonMixin } from './comparison.js';
import { applyRotationMixin } from './rotation.js';
import { applyExportMixin } from './export.js';
import { getDefaultFetch } from '../utils/defaultFetch.js';

// ---------------------------------------------------------------------------
// Viewer configuration constants
// ---------------------------------------------------------------------------

const DEFAULT_ORTHO_HEIGHT = 2;
const CAMERA_OFFSET = new THREE.Vector3(0.75, 0.45, 1.1).normalize();
const ORBIT_UPRIGHT_EPS = THREE.MathUtils.degToRad(3);
const DEFAULT_FETCH = getDefaultFetch();
const VIEWER_BACKGROUND_CSS_VAR = '--color-viewer-bg';
const FALLBACK_VIEWER_BACKGROUND = '#111827';
const UNIT_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const DEFAULT_ANAGLYPH_EYE_SEPARATION = 0.064;
const MIN_ANAGLYPH_EYE_SEPARATION = 0.01;
const MAX_ANAGLYPH_EYE_SEPARATION = 0.2;

/**
 * High-level controller wrapping Three.js primitives, providing the viewer API
 * used by the UI layer (loading models, camera/lighting toggles, measurements).
 */
class Viewer3D {
  /**
   * @param {object} [options]
   * @param {Function} [options.fetchImpl] - Fetch implementation used for remote resources.
   */
  constructor({ fetchImpl } = {}) {
    const resolvedFetch = fetchImpl || DEFAULT_FETCH;
    if (typeof resolvedFetch !== 'function') {
      throw new Error('Fetch API is not available in this environment');
    }
    this.fetchImpl = resolvedFetch;
    this.scene = new THREE.Scene();

    this.perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.perspectiveCamera.position.set(0, 0.4, 1.2);

    this.orthographicCamera = new THREE.OrthographicCamera(
      -DEFAULT_ORTHO_HEIGHT,
      DEFAULT_ORTHO_HEIGHT,
      DEFAULT_ORTHO_HEIGHT,
      -DEFAULT_ORTHO_HEIGHT,
      0.01,
      1000
    );

    this.cameraMode = 'perspective';
    this.camera = this.perspectiveCamera;
    this.orbitMode = 'upright';
    this.viewState = null;
    this.texturesEnabled = true;
    this.wireframeEnabled = false;
    this.lightsDimmed = false;
    this.lights = [];
    this.anaglyphEnabled = false;
    this.anaglyphEffect = null;
    this.anaglyphEyeSeparation = DEFAULT_ANAGLYPH_EYE_SEPARATION;

    const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.localClippingEnabled = false;
    this.renderer.clippingPlanes = [];

    this.controls = null;
    this.controlsType = null;

    this.textureLoader = new THREE.TextureLoader();
    if (this.textureLoader.setCrossOrigin) {
      this.textureLoader.setCrossOrigin('anonymous');
    } else {
      this.textureLoader.crossOrigin = 'anonymous';
    }

    this.objLoader = new OBJLoader();

    this.textureCache = new Map();
    this.currentModelGroup = null;
    this.currentModelMetadata = null;
    this.loadToken = null;
    this.size = { width: 1, height: 1 };
    this.boundingBox = null;
    this.clipping = null;
    this.modelRotation = new THREE.Euler(0, 0, 0, 'XYZ');
    this.modelRotationDegrees = { x: 0, y: 0, z: 0 };
    this.rotation = {
      gizmo: null,
      overlayScene: null,
      enabled: false,
      suppressUpdate: false,
    };

    this.setupEnvironment({
      fallbackColor: FALLBACK_VIEWER_BACKGROUND,
      cssVariable: VIEWER_BACKGROUND_CSS_VAR,
    });

    this.listeners = new Map();
    this.screenshotTransparentBackground = false;
    this.handleThemeChange = () => {
      this.updateBackgroundFromTheme();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('themechange', this.handleThemeChange);
    }

    this.setupLights();
    this.setupGrid();
    this.setupMeasurements();
    this.setupComparison();
    this.setupScaleReference();
    this.setupClipping();
    this.setupRotationGizmo();
    this.applyLightDimState();
    this.applyOrbitMode(true);
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  // ---------------------------------------------------------------------------
  // DOM integration & lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Returns the renderer canvas element to embed in the DOM.
   *
   * @returns {HTMLCanvasElement} WebGL canvas used by the viewer.
   */
  getCanvas() {
    return this.renderer.domElement;
  }

  setScreenshotBackgroundTransparent(enabled) {
    this.screenshotTransparentBackground = !!enabled;
  }

  /**
   * Clears the primary model, measurement artifacts, and derived metadata.
   */
  clear() {
    if (this.comparisonMode) {
      console.log('clear() blocked - comparison mode is active');
      return;
    }

    console.log('clear() executing - removing all models and labels');

    this.clearMeasurements();
    this.clearModelLabels();

    if (this.currentModelGroup) {
      this.scene.remove(this.currentModelGroup);
      this.disposeGroup(this.currentModelGroup);
      this.currentModelGroup = null;
      console.log('currentModelGroup removed');
    }

    if (this.comparisonModelA && this.comparisonModelA.group) {
      this.scene.remove(this.comparisonModelA.group);
      this.disposeGroup(this.comparisonModelA.group);
      this.comparisonModelA = null;
      console.log('comparisonModelA removed');
    }

    if (this.comparisonModelB && this.comparisonModelB.group) {
      this.scene.remove(this.comparisonModelB.group);
      this.disposeGroup(this.comparisonModelB.group);
      this.comparisonModelB = null;
      console.log('comparisonModelB removed');
    }

    this.currentModelMetadata = null;
    this.viewState = null;
    this.updateClippingBoundsFromBox(null);
    this.resetClippingPlanes(true);
    this.setClippingEnabled(false);

    this.updateScaleReference();
    this.resetModelRotation();
    this.emit('modelrotationchange', {
      rotation: this.getModelRotation(),
      hasModel: false,
    });
    console.log('clear() completed - viewer is empty');
  }

  /**
   * Indicates whether a primary model is loaded in the viewer.
   *
   * @returns {boolean} True when a model is present.
   */
  hasModel() {
    return Boolean(this.currentModelGroup);
  }

  /**
   * Re-applies the current view state (camera and grid positioning).
   */
  resetView() {
    if (!this.viewState) return;
    this.positionSceneForView();
  }

  /**
   * Stores view parameters and positions the scene accordingly.
   *
   * @param {THREE.Vector3} center - Model bounding sphere centre.
   * @param {number} radius - Model bounding sphere radius.
   */
  updateViewState(center, radius) {
    this.viewState = {
      center: center.clone(),
      radius,
    };
    this.positionSceneForView();
  }

  /**
   * @private Positions cameras, grid, and controls according to viewState.
  */
  positionSceneForView() {
    if (!this.renderer) return;

    if (!this.viewState) {
      this.updateOrthographicFrustum();
      const activeCamera = this.cameraMode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
      this.camera = activeCamera;
      this.applyOrbitMode();
      if (this.controls) {
        this.controls.object = activeCamera;
        this.controls.target.set(0, 0, 0);
        if (typeof this.controls.handleResize === 'function') {
          this.controls.handleResize();
        }
        this.controls.update();
      }
      this.syncTransformControlsCamera();
      return;
    }

    const { center, radius } = this.viewState;
    const offset = CAMERA_OFFSET.clone();
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov * 0.5));
    const cameraDistance = distance * 1.3;
    const cameraPosition = center.clone().add(offset.multiplyScalar(cameraDistance));

    this.perspectiveCamera.position.copy(cameraPosition);
    this.perspectiveCamera.near = Math.max(0.01, radius / 500);
    this.perspectiveCamera.far = Math.max(this.perspectiveCamera.near + 5, radius * 60);
    this.perspectiveCamera.lookAt(center);
    this.perspectiveCamera.updateProjectionMatrix();

    this.updateOrthographicFrustum(radius);
    this.orthographicCamera.position.copy(cameraPosition);
    this.orthographicCamera.lookAt(center);

    const gridScale = Math.max(1.5, radius * 2.5);
    this.grid.scale.setScalar(gridScale);
    this.grid.position.y = center.y - radius * 0.5;

    const activeCamera = this.cameraMode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
    this.camera = activeCamera;
    this.applyOrbitMode();
    if (this.controls) {
      this.controls.object = activeCamera;
      this.controls.target.copy(center);
      if (typeof this.controls.handleResize === 'function') {
        this.controls.handleResize();
      }
      this.controls.update();
    }
    this.syncTransformControlsCamera();
  }

  /**
   * Cleans up event listeners and renderer resources.
   */
  destroy() {
    if (typeof window !== 'undefined' && this.handleThemeChange) {
      window.removeEventListener('themechange', this.handleThemeChange);
    }
    this.handleThemeChange = null;
    this.disposeScaleReference();
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  /**
   * Registers an event listener for viewer lifecycle events.
   *
   * @param {string} event - Event name.
   * @param {Function} handler - Callback invoked with the event detail.
   */
  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
  }

  /**
   * Removes an event listener previously registered with `on`.
   *
   * @param {string} event - Event name.
   * @param {Function} handler - Listener function to remove.
   */
  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * Emits a custom event to registered listeners.
   *
   * @param {string} event - Event name.
   * @param {unknown} detail - Arbitrary payload.
   */
  emit(event, detail) {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.forEach((handler) => {
      try {
        handler(detail);
      } catch (error) {
        console.error(error);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Viewport sizing & camera orchestration
  // ---------------------------------------------------------------------------

  /**
   * Resizes the renderer and updates camera projections.
   *
   * @param {number} width - New viewport width.
   * @param {number} height - New viewport height.
   */
  resize(width, height) {
    const safeWidth = Math.max(1, Math.floor(width || 1));
    const safeHeight = Math.max(1, Math.floor(height || 1));
    this.size = { width: safeWidth, height: safeHeight };
    this.renderer.setSize(safeWidth, safeHeight);
    if (this.anaglyphEffect) {
      this.anaglyphEffect.setSize(safeWidth, safeHeight);
    }
    this.perspectiveCamera.aspect = safeWidth / safeHeight;
    this.perspectiveCamera.updateProjectionMatrix();
    this.updateOrthographicFrustum();
    this.camera = this.cameraMode === 'perspective' ? this.perspectiveCamera : this.orthographicCamera;
    if (this.controls) {
      this.controls.object = this.camera;
      if (typeof this.controls.handleResize === 'function') {
        this.controls.handleResize();
      }
      this.controls.update();
    }
    this.syncTransformControlsCamera();
  }

  /**
   * @private Recomputes the orthographic frustum based on the model radius.
   *
   * @param {number} [radius=DEFAULT_ORTHO_HEIGHT] - Scene radius estimate.
   */
  updateOrthographicFrustum(radius = DEFAULT_ORTHO_HEIGHT) {
    const aspectRatio = this.size.width / this.size.height || 1;
    const minRadius = DEFAULT_ORTHO_HEIGHT * 0.5;
    const effectiveRadius = typeof radius === 'number' && radius > 0 ? radius : minRadius;
    const orthoHeight = Math.max(effectiveRadius * 2.2, DEFAULT_ORTHO_HEIGHT);
    const orthoWidth = orthoHeight * aspectRatio;

    this.orthographicCamera.left = -orthoWidth;
    this.orthographicCamera.right = orthoWidth;
    this.orthographicCamera.top = orthoHeight;
    this.orthographicCamera.bottom = -orthoHeight;

    const near = Math.max(0.01, effectiveRadius / 500);
    const far = Math.max(near + 5, effectiveRadius * 60);
    this.orthographicCamera.near = near;
    this.orthographicCamera.far = far;
    this.orthographicCamera.updateProjectionMatrix();
  }

  /**
   * @private Applies the current orbit mode, re-instantiating controls if needed.
   *
   * @param {boolean} [force=false] - If true, forces reconfiguration.
   */
  applyOrbitMode(force = false) {
    if (!this.renderer || !this.camera) {
      return;
    }

    const desiredType = this.orbitMode === 'free' ? 'trackball' : 'orbit';

    if (force || this.controlsType !== desiredType || !this.controls) {
      if (this.controls && typeof this.controls.dispose === 'function') {
        this.controls.dispose();
      }

      if (desiredType === 'trackball') {
        this.controls = new TrackballControls(this.camera, this.renderer.domElement);
        this.controls.rotateSpeed = 2.2;
        this.controls.zoomSpeed = 1.2;
        this.controls.panSpeed = 1.0;
        this.controls.noPan = false;
        this.controls.noZoom = false;
        this.controls.noRotate = false;
        this.controls.staticMoving = false;
        this.controls.dynamicDampingFactor = 0.15;
        this.controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.ZOOM,
          RIGHT: THREE.MOUSE.PAN,
        };
      } else {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.075;
        this.controls.minDistance = 0.2;
        this.controls.maxDistance = 5000;
        this.controls.zoomSpeed = 1.1;
        this.controls.rotateSpeed = 0.9;
        this.controls.panSpeed = 0.9;
        this.controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
      }

      this.controlsType = desiredType;
    }

    this.controls.object = this.camera;

    const target = this.viewState?.center ? this.viewState.center : new THREE.Vector3();

    if (desiredType === 'trackball') {
      this.controls.target.copy(target);
      if (typeof this.controls.handleResize === 'function') {
        this.controls.handleResize();
      }
    } else {
      this.camera.up.set(0, 1, 0);
      this.controls.enableRotate = true;
      this.controls.enableZoom = true;
      this.controls.enablePan = true;
      this.controls.screenSpacePanning = false;
      this.controls.minPolarAngle = ORBIT_UPRIGHT_EPS;
      this.controls.maxPolarAngle = Math.PI - ORBIT_UPRIGHT_EPS;
      this.controls.minAzimuthAngle = -Infinity;
      this.controls.maxAzimuthAngle = Infinity;
      this.controls.target.copy(target);
    }

    this.controls.update();
    this.syncTransformControlsCamera();
  }

  // ---------------------------------------------------------------------------
  // Public API: camera modes & navigation controls
  // ---------------------------------------------------------------------------

  /**
   * Switches between perspective and orthographic cameras.
   *
   * @param {'perspective'|'orthographic'} mode - Desired camera mode.
   * @returns {'perspective'|'orthographic'} Applied camera mode.
   */
  setCameraMode(mode) {
    if (mode !== 'perspective' && mode !== 'orthographic') {
      return this.cameraMode;
    }
    if (mode === this.cameraMode) {
      return this.cameraMode;
    }
    this.cameraMode = mode;
    this.positionSceneForView();
    return this.cameraMode;
  }

  /**
   * Switches between free trackball controls and upright orbit controls.
   *
   * @param {'free'|'upright'} mode - Desired orbit mode.
   * @returns {'free'|'upright'} Applied mode.
   */
  setOrbitMode(mode) {
    if (mode !== 'free' && mode !== 'upright') {
      return this.orbitMode;
    }
    if (mode === this.orbitMode) {
      return this.orbitMode;
    }
    this.orbitMode = mode;
    this.applyOrbitMode();
    return this.orbitMode;
  }

  /**
   * Retrieves the current camera mode.
   *
   * @returns {'perspective'|'orthographic'} Current camera mode.
   */
  getCameraMode() {
    return this.cameraMode;
  }

  /**
   * Retrieves the current orbit mode.
   *
   * @returns {'free'|'upright'} Current orbit mode.
   */
  getOrbitMode() {
    return this.orbitMode;
  }

  /**
   * Reports whether the lighting rig is in the dimmed state.
   *
   * @returns {boolean} True when dimmed.
   */
  areLightsDimmed() {
    return this.lightsDimmed;
  }

  /**
   * Toggles the lighting rig between base intensities and a dimmed variant.
   *
   * @param {boolean} dimmed - Desired dimmed state.
   * @returns {boolean} Applied state.
   */
  setLightsDimmed(dimmed) {
    const next = Boolean(dimmed);
    if (this.lightsDimmed === next) {
      return this.lightsDimmed;
    }
    this.lightsDimmed = next;
    this.applyLightDimState();
    return this.lightsDimmed;
  }

  // applyLightDimState is injected by environment mixin.
  /**
   * Indicates whether anaglyph mode is currently enabled.
   *
   * @returns {boolean} True when anaglyph rendering is active.
   */
  isAnaglyphEnabled() {
    return this.anaglyphEnabled;
  }

  /**
   * Enables or disables anaglyph (red-cyan stereoscopic) rendering.
   *
   * @param {boolean} enabled - Desired anaglyph state.
   * @returns {boolean} Applied state.
   */
  setAnaglyphEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.anaglyphEnabled === next) {
      return this.anaglyphEnabled;
    }
    this.anaglyphEnabled = next;

    if (this.anaglyphEnabled) {
      if (!this.anaglyphEffect) {
        this.anaglyphEffect = new ManagedAnaglyphEffect(this.renderer);
      }
      this.anaglyphEffect.setSize(this.size.width, this.size.height);
      if (typeof this.anaglyphEffect.setEyeSeparation === 'function') {
        this.anaglyphEffect.setEyeSeparation(this.anaglyphEyeSeparation);
      }
    } else {
      if (this.anaglyphEffect && typeof this.anaglyphEffect.dispose === 'function') {
        this.anaglyphEffect.dispose();
      }
      this.anaglyphEffect = null;
    }

    return this.anaglyphEnabled;
  }

  /**
   * Retrieves the current eye separation used for the anaglyph effect.
   *
   * @returns {number} Eye separation distance.
   */
  getAnaglyphEyeSeparation() {
    return this.anaglyphEyeSeparation;
  }

  /**
   * Reports the supported range for anaglyph eye separation.
   *
   * @returns {{min: number, max: number}} Inclusive range.
   */
  getAnaglyphEyeSeparationRange() {
    return {
      min: MIN_ANAGLYPH_EYE_SEPARATION,
      max: MAX_ANAGLYPH_EYE_SEPARATION,
    };
  }

  /**
   * Adjusts the eye separation used by the anaglyph stereoscopic effect.
   *
   * @param {number} value - Desired eye separation.
   * @returns {number} Applied separation.
   */
  setAnaglyphEyeSeparation(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return this.anaglyphEyeSeparation;
    }
    const clamped = THREE.MathUtils.clamp(
      parsed,
      MIN_ANAGLYPH_EYE_SEPARATION,
      MAX_ANAGLYPH_EYE_SEPARATION,
    );
    if (Math.abs(clamped - this.anaglyphEyeSeparation) < 1e-6) {
      return this.anaglyphEyeSeparation;
    }
    this.anaglyphEyeSeparation = clamped;
    if (this.anaglyphEffect && typeof this.anaglyphEffect.setEyeSeparation === 'function') {
      this.anaglyphEffect.setEyeSeparation(this.anaglyphEyeSeparation);
    }
    return this.anaglyphEyeSeparation;
  }

  // ---------------------------------------------------------------------------
  // Public API: material and shading toggles
  // ---------------------------------------------------------------------------

  /**
   * Indicates whether textures are currently enabled.
   *
   * @returns {boolean} True when textures are used.
   */
  areTexturesEnabled() {
    return this.texturesEnabled;
  }

  /**
   * Turns textures on or off for the current model.
   *
   * @param {boolean} enabled - Desired texture state.
   * @returns {boolean} Applied state.
   */
  setTexturesEnabled(enabled) {
    if (this.texturesEnabled === enabled) {
      return this.texturesEnabled;
    }
    this.texturesEnabled = Boolean(enabled);
    this.applyTexturesToCurrentModel();
    return this.texturesEnabled;
  }

  /**
   * Indicates whether wireframe rendering is enabled.
   *
   * @returns {boolean} True when wireframe mode is active.
   */
  isWireframeEnabled() {
    return this.wireframeEnabled;
  }

  /**
   * Toggles wireframe rendering for the active model.
   *
   * @param {boolean} enabled - Desired wireframe state.
   * @returns {boolean} Applied state.
   */
  setWireframeEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.wireframeEnabled === next) {
      return this.wireframeEnabled;
    }
    this.wireframeEnabled = next;
    this.applyWireframeToCurrentModel();
    return this.wireframeEnabled;
  }

  /**
   * @private Applies the wireframe state to all meshes in the scene.
   */
  applyWireframeToCurrentModel() {
    if (!this.currentModelGroup) return;
    this.currentModelGroup.traverse((child) => {
      if (!child.isMesh) return;
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => {
          if (mat) {
            mat.wireframe = this.wireframeEnabled;
            mat.needsUpdate = true;
          }
        });
      } else if (child.material) {
        child.material.wireframe = this.wireframeEnabled;
        child.material.needsUpdate = true;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  /**
   * @private Animation loop updating controls, labels, and rendering.
   */
  animate() {
    if (this.controls) {
      this.controls.update();
    }
    this.updateMeasurementLabels();
    this.updateModelLabels();
    if (this.anaglyphEnabled && this.anaglyphEffect) {
      this.anaglyphEffect.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.renderRotationGizmoOverlay();
    requestAnimationFrame(this.animate);
  }

  // ---------------------------------------------------------------------------
  // Resource disposal helpers
  // ---------------------------------------------------------------------------

  /**
   * Recursively disposes of Three.js resources in a group to prevent memory leaks.
   * @private
   * @param {THREE.Group} group - The group to dispose.
   */
  disposeGroup(group) {
    if (!group) return;
    
    group.traverse((object) => {
      // Dispose geometry
      if (object.geometry) {
        object.geometry.dispose();
      }
      
      // Dispose material(s)
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach((material) => {
            this.disposeMaterial(material);
          });
        } else {
          this.disposeMaterial(object.material);
        }
      }
    });
  }

  /**
   * Disposes of a Three.js material and its textures.
   * @private
   * @param {THREE.Material} material - The material to dispose.
   */
  disposeMaterial(material) {
    if (!material) return;
    
    // Dispose textures
    if (material.map) material.map.dispose();
    if (material.lightMap) material.lightMap.dispose();
    if (material.bumpMap) material.bumpMap.dispose();
    if (material.normalMap) material.normalMap.dispose();
    if (material.specularMap) material.specularMap.dispose();
    if (material.envMap) material.envMap.dispose();
    if (material.alphaMap) material.alphaMap.dispose();
    if (material.aoMap) material.aoMap.dispose();
    if (material.displacementMap) material.displacementMap.dispose();
    if (material.emissiveMap) material.emissiveMap.dispose();
    if (material.gradientMap) material.gradientMap.dispose();
    if (material.metalnessMap) material.metalnessMap.dispose();
    if (material.roughnessMap) material.roughnessMap.dispose();
    
    // Dispose material itself
    material.dispose();
  }

  // ---------------------------------------------------------------------------
  // Model loading
  // ---------------------------------------------------------------------------

  /**
   * Loads an OBJ model (and related materials/textures) into the scene.
   *
   * @param {object} source - Descriptor returned by DataverseClient.
   * @returns {Promise<void>}
   */
  async loadModel(source) {
    if (!source || !source.objUrl) {
      throw new Error('A model source with an objUrl is required');
    }

    const loadToken = Symbol('load');
    this.loadToken = loadToken;
    this.emit('loadstart', { source });
    this.clear();
    this.resetModelRotation();

    const progressState = {
      obj: 0,
      mtl: 0,
      textures: 0,
      final: 0,
    };
    const emitLoadProgress = () => {
      const percent = Math.round(
        progressState.obj * 50 + 
        progressState.mtl * 15 + 
        progressState.textures * 15 + 
        progressState.final * 20
      );
      this.emit('loadprogress', {
        loaded: percent,
        total: 100,
        percent,
      });
    };
    emitLoadProgress();

    try {
      const objText = await this._fetchTextWithProgress(source.objUrl, (ratio) => {
        progressState.obj = Math.min(Math.max(ratio, 0), 1);
        emitLoadProgress();
      });
      if (this.loadToken !== loadToken) {
        return;
      }

      const mtllibRefs = extractMtllibReferences(objText);
      let materialLibrary = null;
      if (!mtllibRefs.length) {
        progressState.mtl = 1;
        emitLoadProgress();
      }
      if (Array.isArray(mtllibRefs) && mtllibRefs.length && source.resolveMaterialLibrary) {
        for (const ref of mtllibRefs) {
          const resolved = source.resolveMaterialLibrary(ref, {
            objDirectory: source.objDirectory,
          });
          if (resolved) {
            materialLibrary = resolved;
            break;
          }
        }
      }

      if (!materialLibrary && source.defaultMaterialLibrary) {
        materialLibrary = source.defaultMaterialLibrary;
      }

      if (!materialLibrary?.url) {
        progressState.mtl = 1;
        emitLoadProgress();
      }

      let parsedMaterialDefs = new Map();
      let textures = new Map();

      if (materialLibrary?.url) {
        const mtlText = await this._fetchTextWithProgress(materialLibrary.url, (ratio) => {
          progressState.mtl = Math.min(Math.max(ratio, 0), 1);
          emitLoadProgress();
        });
        if (this.loadToken !== loadToken) {
          return;
        }
        parsedMaterialDefs = parseMtl(mtlText);
        progressState.mtl = 1;
        emitLoadProgress();
      }

      const { materialDefs, texturesNeeded } = this.prepareMaterialDefinitions(
        parsedMaterialDefs,
        source,
        materialLibrary
      );

      if (texturesNeeded.size) {
        const textureCount = texturesNeeded.size;
        let loadedTextures = 0;
        textures = await this.loadTextures(texturesNeeded, () => {
          loadedTextures++;
          progressState.textures = Math.min(loadedTextures / textureCount, 1);
          emitLoadProgress();
        });
        if (this.loadToken !== loadToken) {
          return;
        }
      } else {
        textures = new Map();
        progressState.textures = 1;
        emitLoadProgress();
      }

      progressState.final = 0.05;
      emitLoadProgress();
      
      const object = this.objLoader.parse(objText);
      if (this.loadToken !== loadToken) {
        return;
      }

      progressState.final = 0.2;
      emitLoadProgress();

      const { materialInstances, defaultMaterial } = this.buildMaterialInstances(materialDefs, textures);

      progressState.final = 0.35;
      emitLoadProgress();

      const modelGroup = new THREE.Group();

      this.applyMaterialsToObject(object, materialInstances, defaultMaterial);

      modelGroup.add(object);
      
      progressState.final = 0.5;
      emitLoadProgress();
      
      this.centerObjectForView(modelGroup);
      
      progressState.final = 0.65;
      emitLoadProgress();
      
      this.scene.add(modelGroup);
      this.currentModelGroup = modelGroup;
      
      progressState.final = 0.75;
      emitLoadProgress();
      
      this.applyModelRotation();
      
      progressState.final = 0.85;
      emitLoadProgress();
      
      this.applyTexturesToCurrentModel();
      this.applyWireframeToCurrentModel();
      
      progressState.final = 0.95;
      emitLoadProgress();
      
      this.updateScaleReference();
      
      progressState.final = 1;
      emitLoadProgress();
      if (this.loadToken === loadToken) {
        this.emit('loadend', { source });
      }
    } catch (error) {
      if (this.loadToken === loadToken) {
        this.emit('loaderror', { source, error });
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Private utilities
  // ---------------------------------------------------------------------------

  /**
   * Fetches a text resource while emitting incremental progress information.
   *
   * @param {string} url - Resource URL to retrieve.
   * @param {(ratio: number) => void} [onProgressRatio] - Optional callback receiving a 0-1 ratio.
   * @returns {Promise<string>} Text content retrieved from the resource.
   */
  async _fetchTextWithProgress(url, onProgressRatio) {
    const response = await this.fetchImpl(url);
    if (!response || !response.ok) {
      const status = response ? response.status : 'unknown';
      throw new Error(`Failed to load resource (${status})`);
    }

    const lengthHeader = response.headers ? response.headers.get('content-length') : null;
    const totalBytes = lengthHeader ? Number(lengthHeader) : 0;

    if (!response.body || typeof response.body.getReader !== 'function') {
      const text = await response.text();
      if (typeof onProgressRatio === 'function') {
        onProgressRatio(1);
      }
      return text;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let chunks = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        received += value.length;
        chunks += decoder.decode(value, { stream: true });
        if (totalBytes > 0 && typeof onProgressRatio === 'function') {
          onProgressRatio(Math.min(received / totalBytes, 1));
        }
      }
    }

    chunks += decoder.decode();
    if (typeof onProgressRatio === 'function') {
      onProgressRatio(1);
    }

    return chunks;
  }

  /**
   * Retrieves a cloned unit vector for the given axis key.
   *
   * @param {'x'|'y'|'z'} axis - Axis identifier.
   * @returns {THREE.Vector3|null} Unit axis vector or null when unknown.
   */
  getAxisVector(axis) {
    const base = UNIT_VECTORS[axis];
    return base ? base.clone() : null;
  }

  /**
   * @private Adds a reference grid beneath the model for spatial context.
   */
  setupGrid() {
    this.grid = new THREE.GridHelper(2, 20, 0x64748b, 0x1f2937);
    this.grid.material.opacity = 0.18;
    this.grid.material.transparent = true;
    this.grid.position.y = -0.5;
    this.scene.add(this.grid);
  }

  /**
   * @private Recentres the loaded object and updates the view state.
   *
   * @param {THREE.Object3D} object - Loaded model root.
   */
  centerObjectForView(object) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      return;
    }

    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);

    const recenteredBox = new THREE.Box3().setFromObject(object);
    const sphere = recenteredBox.getBoundingSphere(new THREE.Sphere());

    const radius = Math.max(sphere.radius || 0, 1e-4);
    const viewCenter = sphere.center.clone();

    this.updateClippingBoundsFromBox(recenteredBox);
    this.updateViewState(viewCenter, radius);
  }
}

applyMaterialsMixin(Viewer3D.prototype);
applyEnvironmentMixin(Viewer3D.prototype);
applyComparisonMixin(Viewer3D.prototype);
applyMeasurementsMixin(Viewer3D.prototype);
applyClippingMixin(Viewer3D.prototype);
applyScaleReferenceMixin(Viewer3D.prototype);
applyLabelsMixin(Viewer3D.prototype);
applyRotationMixin(Viewer3D.prototype);
applyExportMixin(Viewer3D.prototype);

export { Viewer3D };
