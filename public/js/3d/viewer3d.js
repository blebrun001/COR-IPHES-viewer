/**
 * Three.js based viewer tailored for Dataverse OBJ/MTL datasets,
 * including material management, measurement tools, and camera controls.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { getDefaultFetch } from '../utils/defaultFetch.js';

const DEFAULT_ORTHO_HEIGHT = 2;
const CAMERA_OFFSET = new THREE.Vector3(0.75, 0.45, 1.1).normalize();
const ORBIT_UPRIGHT_EPS = THREE.MathUtils.degToRad(3);
const DEFAULT_FETCH = getDefaultFetch();
const MEASURE_LINE_COLOR = 0x38bdf8;
const MEASURE_START_COLOR = 0x404040;
const MEASURE_END_COLOR = 0x404040;
const MEASURE_CLICK_DRAG_THRESHOLD = 4;
const VIEWER_BACKGROUND_CSS_VAR = '--color-viewer-bg';
const FALLBACK_VIEWER_BACKGROUND = '#111827';

/**
 * Reads a CSS custom property from the document root and returns a usable colour string.
 *
 * @param {string} variableName - CSS variable name to read.
 * @param {string} fallback - Value to use when the variable is unavailable.
 * @returns {string} Normalised colour string.
 */
function readCssColorVariable(variableName, fallback) {
  if (typeof window === 'undefined' || !window.getComputedStyle) {
    return fallback;
  }
  try {
    const styles = window.getComputedStyle(document.documentElement);
    if (!styles) {
      return fallback;
    }
    const value = styles.getPropertyValue(variableName);
    if (!value) {
      return fallback;
    }
    const trimmed = value.trim();
    return trimmed || fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * Extracts referenced material library files from an OBJ source.
 *
 * @param {string} objText - Raw OBJ file content.
 * @returns {string[]} Array of referenced MTL filenames.
 */
function extractMtllibReferences(objText) {
  return Array.from(objText.matchAll(/^[ \t]*mtllib\s+(.+?)\s*$/gim))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

/**
 * Parses MTL material files and returns a map of material descriptors.
 *
 * @param {string} content - Raw MTL file content.
 * @returns {Map<string, object>} Material descriptors keyed by material name.
 */
function parseMtl(content) {
  const materials = new Map();
  let current = null;

  function parseMapSpec(raw) {
    const result = {
      path: null,
      scale: [1, 1],
      offset: [0, 0],
      clamp: false,
    };

    if (!raw) return result;

    const tokens = raw.trim().split(/\s+/);
    let i = 0;
    while (i < tokens.length) {
      const token = tokens[i];
      const lower = token.toLowerCase();

      const readVector = (length) => {
        const values = [];
        for (let j = 1; j <= length && i + j < tokens.length; j += 1) {
          values.push(Number(tokens[i + j]));
        }
        i += length;
        return values;
      };

      if (lower === '-s' || lower === '-scale') {
        const vec = readVector(3);
        result.scale = [vec[0] ?? 1, vec[1] ?? vec[0] ?? 1];
      } else if (lower === '-o' || lower === '-offset' || lower === '-t') {
        const vec = readVector(3);
        result.offset = [vec[0] ?? 0, vec[1] ?? 0];
      } else if (lower === '-clamp') {
        const value = tokens[i + 1] ? tokens[i + 1].toLowerCase() : '';
        result.clamp = value === 'on' || value === '1';
        i += 1;
      } else if (lower.startsWith('-')) {
        const maybeNumber = tokens[i + 1];
        if (maybeNumber && /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(maybeNumber)) {
          i += 1;
        }
      } else {
        result.path = tokens.slice(i).join(' ');
        break;
      }

      i += 1;
    }

    if (!result.path && tokens.length) {
      result.path = tokens[tokens.length - 1];
    }

    return result;
  }

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split(/\s+/);
    const keyword = parts.shift();
    if (!keyword) return;
    const lower = keyword.toLowerCase();
    const value = parts.join(' ');

    switch (lower) {
      case 'newmtl': {
        const name = value.trim();
        if (!name) return;
        current = {
          name,
          kd: [1, 1, 1],
          mapKd: null,
          mapAo: null,
          mapRoughness: null,
          mapNormal: null,
        };
        materials.set(name, current);
        break;
      }
      case 'kd':
        if (current && parts.length >= 3) {
          current.kd = parts.slice(0, 3).map((n) => Number(n) || 1);
        }
        break;
      case 'map_kd':
        if (current) current.mapKd = parseMapSpec(value);
        break;
      case 'map_ao':
        if (current) current.mapAo = parseMapSpec(value);
        break;
      case 'map_roughness':
      case 'map_pr':
        if (current) current.mapRoughness = parseMapSpec(value);
        break;
      case 'map_tangentspacenormal':
      case 'map_normal':
      case 'map_bump':
      case 'bump':
      case 'norm':
        if (current) current.mapNormal = parseMapSpec(value);
        break;
      default:
        break;
    }
  });

  return materials;
}

/**
 * Creates a safe clone of a material, preserving userData metadata.
 *
 * @param {THREE.Material} source - Material to clone.
 * @returns {THREE.Material} Cloned material with userData preserved.
 */
function cloneMaterial(source) {
  const clone = source.clone();
  clone.userData = Object.assign({}, source.userData || {});
  if (source.userData?.originalMaps) {
    clone.userData.originalMaps = Object.assign({}, source.userData.originalMaps);
  }
  if (source.userData?.baseColor) {
    clone.userData.baseColor = source.userData.baseColor.clone();
  }
  if (source.userData?.baseRoughness !== undefined) {
    clone.userData.baseRoughness = source.userData.baseRoughness;
  }
  return clone;
}

/**
 * Ensures the material has a stored baseline texture state before toggling.
 *
 * @param {THREE.Material} material - Material to prepare.
 * @param {boolean} texturesEnabled - Whether textures should remain enabled.
 */
function ensureMaterialTextureState(material, texturesEnabled) {
  if (!material) return;
  material.userData = material.userData || {};
  if (!material.userData.originalMaps) {
    material.userData.originalMaps = {
      map: material.map || null,
      roughnessMap: material.roughnessMap || null,
      aoMap: material.aoMap || null,
      normalMap: material.normalMap || null,
    };
  }
  applyMaterialTextures(material, texturesEnabled);
}

/**
 * Applies or removes texture maps depending on the viewer state.
 *
 * @param {THREE.Material} material - Target material.
 * @param {boolean} texturesEnabled - Toggle flag determining texture usage.
 */
function applyMaterialTextures(material, texturesEnabled) {
  if (!material) return;
  const original = material.userData && material.userData.originalMaps;
  if (!original) return;

  if (texturesEnabled) {
    material.map = original.map || null;
    material.roughnessMap = original.roughnessMap || null;
    material.aoMap = original.aoMap || null;
    material.normalMap = original.normalMap || null;

    if (material.userData.baseColor) {
      material.color.set(0xffffff);
    }

    if (original.roughnessMap && material.userData.baseRoughness !== undefined) {
      material.roughness = material.userData.baseRoughness;
    }
  } else {
    material.map = null;
    material.roughnessMap = original.roughnessMap || null;
    material.aoMap = original.aoMap || null;
    material.normalMap = original.normalMap || null;

    if (material.userData.baseColor) {
      material.color.copy(material.userData.baseColor);
    } else {
      material.color.set(0xff9300);
    }

    if (material.userData.baseRoughness !== undefined) {
      material.roughness = material.userData.baseRoughness;
    }
  }

  material.needsUpdate = true;
}

/**
 * Configures texture wrapping, offsets, and repetition using MTL hints.
 *
 * @param {object} descriptor - Parsed texture descriptor from the MTL.
 * @param {THREE.Texture} texture - Texture instance to configure.
 * @param {THREE.Material} material - Material owning the texture.
 */
function applyTextureSpec(descriptor, texture, material) {
  if (!descriptor || !texture) return;

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  if (texture.offset) {
    const [offsetX = 0, offsetY = 0] = descriptor.offset || [];
    if (Number.isFinite(offsetX) && Number.isFinite(offsetY)) {
      texture.offset.set(offsetX, offsetY);
    }
  }

  if (texture.repeat) {
    const [repeatX = 1, repeatY = 1] = descriptor.scale || [];
    if (Number.isFinite(repeatX) && Number.isFinite(repeatY)) {
      texture.repeat.set(repeatX, repeatY);
    }
  }

  if (descriptor.clamp) {
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  texture.needsUpdate = true;
  material.needsUpdate = true;
}

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
    this.scene.background = new THREE.Color(FALLBACK_VIEWER_BACKGROUND);

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

    const pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.setClearColor(this.scene.background, 1);

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
    this.loadToken = null;
    this.size = { width: 1, height: 1 };

    this.listeners = new Map();
    this.updateBackgroundFromTheme();
    this.handleThemeChange = () => {
      this.updateBackgroundFromTheme();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('themechange', this.handleThemeChange);
    }

    this.setupLights();
    this.setupGrid();
    this.setupMeasurements();
    this.applyLightDimState();
    this.applyOrbitMode(true);
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  /**
   * Synchronises the Three.js scene background with the current theme colour.
   */
  updateBackgroundFromTheme() {
    const targetColorValue = readCssColorVariable(VIEWER_BACKGROUND_CSS_VAR, FALLBACK_VIEWER_BACKGROUND);
    const backgroundColor =
      this.scene.background instanceof THREE.Color ? this.scene.background : new THREE.Color(FALLBACK_VIEWER_BACKGROUND);
    try {
      backgroundColor.set(targetColorValue);
    } catch (error) {
      backgroundColor.set(FALLBACK_VIEWER_BACKGROUND);
    }
    this.scene.background = backgroundColor;
    if (this.renderer && typeof this.renderer.setClearColor === 'function') {
      this.renderer.setClearColor(backgroundColor, 1);
    }
  }

  /**
   * @private Sets up the default lighting rig and records base intensities.
   */
  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xf8fafc, 0.75);
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 0.85);
    hemiLight.position.set(0, 4, 0);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(3, 5, 4);

    const fillLight = new THREE.DirectionalLight(0xbad7ff, 0.8);
    fillLight.position.set(-2.5, 1.5, -3);

    const rimLight = new THREE.DirectionalLight(0x60a5fa, 0.55);
    rimLight.position.set(0, 4.5, -5);

    const lights = [ambientLight, hemiLight, keyLight, fillLight, rimLight];
    lights.forEach((light) => {
      light.userData = Object.assign({}, light.userData, {
        baseIntensity: light.intensity,
      });
      this.scene.add(light);
    });

    this.lights = lights;
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
   * @private Initialises measurement helpers, materials and event handlers.
   */
  setupMeasurements() {
    this.measureGroup = new THREE.Group();
    this.measureGroup.name = 'Measurements';
    this.scene.add(this.measureGroup);

    this.measurements = [];
    this.measurementCounter = 0;
    this.measurementMode = false;
    this.pendingMeasurement = null;
    this.measureOverlay = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this.measureMaterials = {
      line: new THREE.LineBasicMaterial({
        color: MEASURE_LINE_COLOR,
        linewidth: 2,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
      start: new THREE.MeshBasicMaterial({
        color: MEASURE_START_COLOR,
        depthTest: false,
        depthWrite: false,
      }),
      end: new THREE.MeshBasicMaterial({
        color: MEASURE_END_COLOR,
        depthTest: false,
        depthWrite: false,
      }),
    };

    this.measurePointerDown = null;
    this.handleMeasurePointerDown = this.handleMeasurePointerDown.bind(this);
    this.handleMeasurePointerUp = this.handleMeasurePointerUp.bind(this);

    const domElement = this.renderer.domElement;
    domElement.addEventListener('pointerdown', this.handleMeasurePointerDown);
    domElement.addEventListener('pointerup', this.handleMeasurePointerUp);
  }

  /**
   * Returns the renderer canvas element to embed in the DOM.
   *
   * @returns {HTMLCanvasElement} WebGL canvas used by the viewer.
   */
  getCanvas() {
    return this.renderer.domElement;
  }

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
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((handler) => {
      try {
        handler(detail);
      } catch (error) {
        console.error(error);
      }
    });
  }

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
  }

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

  /**
   * @private Applies the current light dim state to all tracked lights.
   */
  applyLightDimState() {
    if (!Array.isArray(this.lights)) {
      return;
    }
    this.lights.forEach((light) => {
      if (!light) return;
      const base = light.userData?.baseIntensity ?? light.intensity ?? 1;
      const factor = this.lightsDimmed ? 0.4 : 1;
      light.intensity = base * factor;
    });
  }

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
   * @private Applies the current texture state to every mesh in the scene.
   */
  applyTexturesToCurrentModel() {
    if (!this.currentModelGroup) return;
    this.currentModelGroup.traverse((child) => {
      if (!child.isMesh) return;
      const mats = child.material;
      if (Array.isArray(mats)) {
        mats.forEach((mat) => ensureMaterialTextureState(mat, this.texturesEnabled));
      } else {
        ensureMaterialTextureState(mats, this.texturesEnabled);
      }
    });
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

  /**
   * Attaches a DOM overlay used to render measurement labels.
   *
   * @param {HTMLElement|null} element - Overlay container; null clears the overlay.
   */
  attachMeasurementOverlay(element) {
    if (this.measureOverlay && this.measureOverlay !== element) {
      this.measurements.forEach((measurement) => {
        if (measurement.labelEl && measurement.labelEl.parentElement === this.measureOverlay) {
          measurement.labelEl.remove();
        }
        measurement.labelEl = null;
      });
    }

    this.measureOverlay = element || null;

    if (this.measureOverlay) {
      this.measureOverlay.innerHTML = '';
      this.measurements.forEach((measurement) => {
        measurement.labelEl = this.createMeasurementLabel(measurement.distance);
      });
      this.updateMeasurementLabels();
    }
  }

  /**
   * Indicates whether measurement mode is currently enabled.
   *
   * @returns {boolean} True when measurement mode is active.
   */
  isMeasurementModeEnabled() {
    return this.measurementMode;
  }

  /**
   * Activates or deactivates measurement mode.
   *
   * @param {boolean} enabled - Desired measurement state.
   * @returns {boolean} Applied state.
   */
  setMeasurementModeEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.measurementMode === next) {
      return this.measurementMode;
    }
    this.measurementMode = next;
    if (!next) {
      this.cancelPendingMeasurement();
      this.measurePointerDown = null;
    }
    this.emit('measurementmode', { enabled: this.measurementMode });
    return this.measurementMode;
  }

  /**
   * Clears all measurements from the scene and overlay.
   */
  clearMeasurements() {
    this.cancelPendingMeasurement();

    if (this.measurements.length) {
      this.measurements.forEach((measurement) => {
        if (measurement.line) {
          this.measureGroup.remove(measurement.line);
          if (measurement.line.geometry) {
            measurement.line.geometry.dispose();
          }
        }
        if (measurement.startMarker) {
          this.measureGroup.remove(measurement.startMarker);
          if (measurement.startMarker.geometry) {
            measurement.startMarker.geometry.dispose();
          }
        }
        if (measurement.endMarker) {
          this.measureGroup.remove(measurement.endMarker);
          if (measurement.endMarker.geometry) {
            measurement.endMarker.geometry.dispose();
          }
        }
        if (measurement.labelEl && measurement.labelEl.parentElement) {
          measurement.labelEl.remove();
        }
      });
    }

    this.measurements = [];
    if (this.measureOverlay) {
      this.measureOverlay.innerHTML = '';
    }
    this.emit('measurementscleared');
    if (this.measureOverlay) {
      this.updateMeasurementLabels();
    }
  }

  /**
   * @private Handles pointer down events when measurement mode is enabled.
   *
   * @param {PointerEvent} event - Pointer event from the canvas.
   */
  handleMeasurePointerDown(event) {
    if (!this.measurementMode || event.button !== 0) {
      return;
    }
    this.measurePointerDown = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  }

  /**
   * @private Completes measurement clicks if the pointer up is not a drag.
   *
   * @param {PointerEvent} event - Pointer event from the canvas.
   */
  handleMeasurePointerUp(event) {
    if (!this.measurementMode || event.button !== 0) {
      this.measurePointerDown = null;
      return;
    }

    if (!this.measurePointerDown) {
      return;
    }

    const dx = event.clientX - this.measurePointerDown.x;
    const dy = event.clientY - this.measurePointerDown.y;
    const dragDistance = Math.sqrt(dx * dx + dy * dy);
    this.measurePointerDown = null;

    if (dragDistance > MEASURE_CLICK_DRAG_THRESHOLD) {
      return;
    }

    this.handleMeasureClick(event);
  }

  /**
   * @private Registers a measurement point or finalises a measurement.
   *
   * @param {PointerEvent} event - Pointer event from the canvas.
   */
  handleMeasureClick(event) {
    const point = this.pickMeasurementPoint(event);
    if (!point) {
      return;
    }

    if (!this.pendingMeasurement) {
      const startMarker = this.createMeasurementMarker(point, true);
      this.pendingMeasurement = {
        start: point.clone(),
        startMarker,
      };
      return;
    }

    const startPoint = this.pendingMeasurement.start;
    if (startPoint.distanceTo(point) <= 1e-6) {
      return;
    }

    const startMarker = this.pendingMeasurement.startMarker;
    this.pendingMeasurement = null;
    this.createMeasurement(startPoint, point, startMarker);
  }

  /**
   * @private Projects a pointer event into 3D space on the current model.
   *
   * @param {PointerEvent} event - Pointer event from the canvas.
   * @returns {THREE.Vector3|null} Intersection point or null.
   */
  pickMeasurementPoint(event) {
    if (!this.currentModelGroup) {
      return null;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.raycaster.intersectObject(this.currentModelGroup, true);
    if (!intersects.length) {
      return null;
    }

    return intersects[0].point.clone();
  }

  /**
   * @private Creates the visual objects representing a completed measurement.
   *
   * @param {THREE.Vector3} startPoint - First point selected by the user.
   * @param {THREE.Vector3} endPoint - Second point selected by the user.
   * @param {THREE.Object3D|null} startMarker - Optional reused marker.
   */
  createMeasurement(startPoint, endPoint, startMarker) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      startPoint.clone(),
      endPoint.clone(),
    ]);
    const line = new THREE.Line(geometry, this.measureMaterials.line);
    line.renderOrder = 999;
    this.measureGroup.add(line);

    if (!startMarker) {
      startMarker = this.createMeasurementMarker(startPoint, true);
    } else {
      startMarker.position.copy(startPoint);
    }

    const endMarker = this.createMeasurementMarker(endPoint, false);

    const distance = startPoint.distanceTo(endPoint);
    const midpoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);

    const measurement = {
      id: ++this.measurementCounter,
      start: startPoint.clone(),
      end: endPoint.clone(),
      line,
      startMarker,
      endMarker,
      distance,
      midpoint,
      labelEl: this.createMeasurementLabel(distance),
    };

    this.measurements.push(measurement);
    this.emit('measurementadd', { measurement });
    if (this.measureOverlay) {
      this.updateMeasurementLabels();
    }
  }

  /**
   * @private Creates a marker sphere for measurement endpoints.
   *
   * @param {THREE.Vector3} position - Marker position in world space.
   * @param {boolean} isStart - Whether this represents the first point.
   * @returns {THREE.Mesh} Marker mesh.
   */
  createMeasurementMarker(position, isStart) {
    const radius = this.computeMarkerRadius();
    const geometry = new THREE.SphereGeometry(radius, 20, 16);
    const marker = new THREE.Mesh(geometry, isStart ? this.measureMaterials.start : this.measureMaterials.end);
    marker.position.copy(position);
    marker.renderOrder = 1000;
    this.measureGroup.add(marker);
    return marker;
  }

  /**
   * @private Computes marker radius relative to the current view scale.
   *
   * @returns {number} Marker radius.
   */
  computeMarkerRadius() {
    const base = this.viewState?.radius || 1;
    return THREE.MathUtils.clamp(base * 0.03, 0.0025, 0.03);
  }

  /**
   * @private Creates a DOM element for a measurement label.
   *
   * @param {number} distance - Distance to display.
   * @returns {HTMLElement|null} Label element when overlay is present.
   */
  createMeasurementLabel(distance) {
    if (!this.measureOverlay) {
      return null;
    }
    const label = document.createElement('div');
    label.className = 'measurement-label hidden';
    label.textContent = this.formatMeasurementDistance(distance);
    this.measureOverlay.appendChild(label);
    return label;
  }

  /**
   * @private Formats the measurement distance for display.
   *
   * @param {number} distance - Distance in centimeters.
   * @returns {string} Formatted distance string.
   */
  formatMeasurementDistance(distance) {
    return `${distance.toFixed(2)} cm`;
  }

  /**
   * @private Removes any in-progress measurement, cleaning temporary markers.
   */
  cancelPendingMeasurement() {
    if (!this.pendingMeasurement) {
      return;
    }
    if (this.pendingMeasurement.startMarker) {
      this.measureGroup.remove(this.pendingMeasurement.startMarker);
      if (this.pendingMeasurement.startMarker.geometry) {
        this.pendingMeasurement.startMarker.geometry.dispose();
      }
    }
    this.pendingMeasurement = null;
  }

  /**
   * @private Repositions measurement labels according to the current camera view.
   */
  updateMeasurementLabels() {
    if (!this.measureOverlay || !this.measurements.length) {
      return;
    }

    const width = this.size.width;
    const height = this.size.height;

    this.measurements.forEach((measurement) => {
      const label = measurement.labelEl;
      if (!label) {
        return;
      }

      const projected = measurement.midpoint.clone().project(this.camera);
      const visible = projected.z >= -1 && projected.z <= 1;
      if (!visible) {
        label.classList.add('hidden');
        return;
      }

      const screenX = (projected.x * 0.5 + 0.5) * width;
      const screenY = (-projected.y * 0.5 + 0.5) * height;
      label.style.transform = `translate(-50%, -50%) translate(${screenX}px, ${screenY}px)`;
      label.classList.remove('hidden');
    });
  }

  /**
   * Renders the scene and returns a base64-encoded screenshot.
   *
   * @param {object} [options]
   * @param {string} [options.mimeType='image/png'] - Desired image MIME type.
   * @returns {string|null} Data URL or null when capture fails.
   */
  captureScreenshot({ mimeType = 'image/png' } = {}) {
    try {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL(mimeType);
    } catch (error) {
      console.error('Failed to capture screenshot', error);
      return null;
    }
  }

  /**
   * @private Animation loop updating controls, labels, and rendering.
   */
  animate() {
    if (this.controls) {
      this.controls.update();
    }
    this.updateMeasurementLabels();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.animate);
  }

  /**
   * Clears the current model and measurement artifacts.
   */
  clear() {
    this.clearMeasurements();
    if (this.currentModelGroup) {
      this.scene.remove(this.currentModelGroup);
      this.currentModelGroup = null;
    }
    this.viewState = null;
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
  }

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

    const progressState = {
      obj: 0,
      mtl: 0,
      final: 0,
    };
    const emitLoadProgress = () => {
      const percent = Math.round(progressState.obj * 70 + progressState.mtl * 20 + progressState.final * 10);
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

      let materialDefs = new Map();
      let textures = new Map();

      if (materialLibrary?.url) {
        const mtlText = await this._fetchTextWithProgress(materialLibrary.url, (ratio) => {
          progressState.mtl = Math.min(Math.max(ratio, 0), 1);
          emitLoadProgress();
        });
        if (this.loadToken !== loadToken) {
          return;
        }
        materialDefs = parseMtl(mtlText);
        progressState.mtl = 1;
        emitLoadProgress();

        const texturesNeeded = new Map();

        materialDefs.forEach((def, name) => {
          const descriptor = {};
          const maps = [
            ['diffuse', def.mapKd],
            ['normal', def.mapNormal],
            ['roughness', def.mapRoughness],
            ['ao', def.mapAo],
          ];

          maps.forEach(([kind, spec]) => {
            if (!spec || !spec.path) return;
            if (!source.resolveTexturePath) return;
            const resolved = source.resolveTexturePath(spec.path, {
              textureBaseDir: materialLibrary.textureBaseDir,
            });
            if (!resolved) return;
            const cacheKey = resolved.cacheKey;
            descriptor[kind] = {
              cacheKey,
              scale: spec.scale,
              offset: spec.offset,
              clamp: spec.clamp,
            };
            if (!texturesNeeded.has(cacheKey)) {
              texturesNeeded.set(cacheKey, {
                cacheKey,
                url: resolved.url,
                kind,
                colorSpace:
                  kind === 'diffuse'
                    ? THREE.SRGBColorSpace
                    : THREE.LinearSRGBColorSpace,
              });
            }
          });

          materialDefs.set(name, { ...def, descriptor });
        });

        textures = await this.loadTextures(texturesNeeded);
        if (this.loadToken !== loadToken) {
          return;
        }
      }

      const object = this.objLoader.parse(objText);
      if (this.loadToken !== loadToken) {
        return;
      }

      const materialInstances = new Map();

      const buildMaterial = (name, def) => {
        const baseColor = new THREE.Color(0xff9300);
        const descriptor = def?.descriptor || {};

        const material = new THREE.MeshStandardMaterial({
          color: baseColor.clone(),
          metalness: 0.0,
          roughness: 1.0,
        });

        material.userData = Object.assign({}, material.userData || {});
        material.userData.baseColor = baseColor.clone();
        material.userData.baseRoughness = material.roughness;

        const assignTexture = (kind, apply) => {
          const info = descriptor[kind];
          if (!info) return;
          const texture = textures.get(info.cacheKey);
          if (!texture) return;
          applyTextureSpec(info, texture, material);
          apply(texture);
        };

        assignTexture('diffuse', (texture) => {
          material.map = texture;
          material.color.set(0xffffff);
        });

        assignTexture('roughness', (texture) => {
          material.roughnessMap = texture;
        });

        assignTexture('ao', (texture) => {
          material.aoMap = texture;
          material.aoMapIntensity = 1.0;
        });

        assignTexture('normal', (texture) => {
          material.normalMap = texture;
          if (!material.normalScale) {
            material.normalScale = new THREE.Vector2(1, 1);
          }
        });

        material.userData.originalMaps = material.userData.originalMaps || {
          map: material.map || null,
          roughnessMap: material.roughnessMap || null,
          aoMap: material.aoMap || null,
          normalMap: material.normalMap || null,
        };

        material.name = name;
        ensureMaterialTextureState(material, this.texturesEnabled);
        return material;
      };

      materialDefs.forEach((def, name) => {
        materialInstances.set(name, buildMaterial(name, def));
      });

      const defaultMaterial = buildMaterial('default', {});

      const modelGroup = new THREE.Group();

      object.traverse((child) => {
        if (!child.isMesh) return;

        const originalMaterial = child.material;
        const applyMaterial = (mat) => {
          if (!mat) return mat;
          ensureMaterialTextureState(mat, this.texturesEnabled);
          mat.wireframe = this.wireframeEnabled;
          mat.needsUpdate = true;
          return mat;
        };

        if (Array.isArray(originalMaterial)) {
          child.material = originalMaterial.map((mat) => {
            const name = mat?.name;
            if (name && materialInstances.get(name)) {
              return applyMaterial(materialInstances.get(name));
            }
            return applyMaterial(cloneMaterial(defaultMaterial));
          });
        } else {
          const name = originalMaterial?.name;
          if (name && materialInstances.get(name)) {
            child.material = applyMaterial(materialInstances.get(name));
          } else {
            child.material = applyMaterial(cloneMaterial(defaultMaterial));
          }
        }

        if (child.geometry && child.geometry.attributes.uv && !child.geometry.attributes.uv2) {
          child.geometry.setAttribute('uv2', child.geometry.attributes.uv);
        }

        child.castShadow = true;
        child.receiveShadow = true;
      });

      modelGroup.add(object);
      this.centerObjectForView(modelGroup);
      this.scene.add(modelGroup);
      this.currentModelGroup = modelGroup;
      this.applyTexturesToCurrentModel();
      this.applyWireframeToCurrentModel();
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

  /**
   * Télécharge une ressource texte en émettant des informations de progression.
   *
   * @param {string} url - Ressource à récupérer.
   * @param {(ratio: number) => void} [onProgressRatio] - Callback recevant un ratio 0-1.
   * @returns {Promise<string>} Contenu texte de la ressource.
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
   * @private Loads textures described by the requests map, with caching.
   *
   * @param {Map<string, {cacheKey: string, url: string, colorSpace: string}>} requestsMap - Texture requests.
   * @returns {Promise<Map<string, THREE.Texture>>} Map of cacheKey → loaded texture.
   */
  async loadTextures(requestsMap) {
    const result = new Map();
    const requests = Array.from(requestsMap.values());
    if (!requests.length) {
      return result;
    }

    await Promise.all(
      requests.map(async (request) => {
        const cacheKey = request.cacheKey;
        if (this.textureCache.has(cacheKey)) {
          const cached = this.textureCache.get(cacheKey);
          result.set(cacheKey, cached);
          return;
        }
        try {
          const texture = await this.textureLoader.loadAsync(request.url);
          texture.colorSpace = request.colorSpace;
          texture.anisotropy = 8;
          this.textureCache.set(cacheKey, texture);
          result.set(cacheKey, texture);
        } catch (error) {
          console.warn(`Failed to load texture ${request.url}`, error);
        }
      })
    );

    return result;
  }

  /**
   * Cleans up event listeners and renderer resources.
   */
  destroy() {
    if (typeof window !== 'undefined' && this.handleThemeChange) {
      window.removeEventListener('themechange', this.handleThemeChange);
    }
    this.handleThemeChange = null;
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

    this.updateViewState(viewCenter, radius);
  }
}

export { Viewer3D };
