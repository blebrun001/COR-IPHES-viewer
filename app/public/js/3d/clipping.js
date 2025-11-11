/**
 * Clipping mixin wiring plane management, renderer integration, and UI controls for the viewer.
 */
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

// ---------------------------------------------------------------------------
// Clipping configuration constants
// ---------------------------------------------------------------------------

const DEFAULT_CLIPPING_COLOR = 0x38bdf8;
const DEFAULT_CLIPPING_OPACITY = 1;
const CLIP_CAP_OFFSET = 0.001;
const PLANE_DEFAULT_NORMAL = new THREE.Vector3(0, 0, 1);
const CLIP_EPSILON = 1e-5;
const LOOP_TOLERANCE = 1e-4;

// ---------------------------------------------------------------------------
// Reusable scratch objects
// ---------------------------------------------------------------------------

const _clipMatrixInverse = new THREE.Matrix4();
const _clipV0 = new THREE.Vector3();
const _clipV1 = new THREE.Vector3();
const _clipV2 = new THREE.Vector3();
const _clipI0 = new THREE.Vector3();

/**
 * Adds clipping-related helpers to a Viewer3D prototype.
 *
 * @param {typeof import('./viewer3d.js').Viewer3D.prototype} viewerProto
 */
export function applyClippingMixin(viewerProto) {
  // -------------------------------------------------------------------------
  // Setup & lifecycle integration
  // -------------------------------------------------------------------------

  /**
   * @private Prepares clipping helpers, state containers, and transform controls.
   */
  viewerProto.setupClipping = function setupClipping() {
    // Initialize the clipping helper group and shared state buckets.
    this.clippingGroup = new THREE.Group();
    this.clippingGroup.name = 'ClippingHelpers';
    this.scene.add(this.clippingGroup);

    // Track current state, axis descriptors, and transform handles.
    this.clipping = {
      enabled: false,
      activeAxis: 'x',
      fillEnabled: true,
      fillColor: new THREE.Color(DEFAULT_CLIPPING_COLOR),
      fillOpacity: DEFAULT_CLIPPING_OPACITY,
      axes: new Map(),
      transform: null,
      size: 2,
      suppressTransformChange: false,
    };

    ['x', 'y', 'z'].forEach((axis) => {
      const descriptor = this.createClippingDescriptor(axis);
      this.clipping.axes.set(axis, descriptor);
    });

    // Configure transform controls to follow the active clipping anchor.
    const transformControls = new TransformControls(this.camera, this.renderer.domElement);
    transformControls.visible = false;
    transformControls.enabled = false;
    transformControls.setMode('translate');
    transformControls.addEventListener('dragging-changed', (event) => {
      if (this.controls) {
        this.controls.enabled = !event.value;
      }
    });
    const handleTransformUpdate = () => {
      this.handleTransformObjectChange();
    };
    transformControls.addEventListener('objectChange', handleTransformUpdate);
    transformControls.addEventListener('change', handleTransformUpdate);
    this.clipping.transform = transformControls;
    this.scene.add(transformControls);
    this.syncTransformControlsCamera();
  };

  const previousSyncTransformControlsCamera = viewerProto.syncTransformControlsCamera;

  /**
   * @private Ensures transform controls keep using the active camera.
   */
  viewerProto.syncTransformControlsCamera = function syncTransformControlsCamera() {
    if (typeof previousSyncTransformControlsCamera === 'function') {
      previousSyncTransformControlsCamera.call(this);
    }
    if (this.clipping?.transform) {
      this.clipping.transform.camera = this.camera;
      this.clipping.transform.updateMatrixWorld();
    }
  };

  // -------------------------------------------------------------------------
  // Public API: enablement & active axis
  // -------------------------------------------------------------------------

  /**
   * Reports whether clipping planes are currently active.
   */
  viewerProto.isClippingEnabled = function isClippingEnabled() {
    return Boolean(this.clipping?.enabled);
  };

  /**
   * Enables or disables clipping, updating fill meshes and renderer planes.
   */
  viewerProto.setClippingEnabled = function setClippingEnabled(enabled) {
    if (!this.clipping) {
      return false;
    }
    const next = Boolean(enabled);
    if (this.clipping.enabled === next) {
      this.updateRendererClippingPlanes();
      this.refreshClippingVisibility();
      return this.clipping.enabled;
    }
    this.clipping.enabled = next;
    this.updateRendererClippingPlanes();
    this.refreshClippingVisibility();
    this.emit('clippingchange', this.getClippingState());
    return this.clipping.enabled;
  };

  /**
   * Sets the currently active clipping axis and refreshes helpers.
   */
  viewerProto.setActiveClippingAxis = function setActiveClippingAxis(axis) {
    if (!this.clipping || !this.clipping.axes.has(axis)) {
      return this.clipping?.activeAxis || 'x';
    }
    this.clipping.activeAxis = axis;
    this.refreshClippingVisibility();
    this.emit('clippingactiveplane', this.getClippingState());
    return this.clipping.activeAxis;
  };

  /**
   * Retrieves the descriptor for the currently active clipping axis.
   */
  viewerProto.getActiveClippingDescriptor = function getActiveClippingDescriptor() {
    if (!this.clipping) return null;
    return this.clipping.axes.get(this.clipping.activeAxis) || null;
  };

  // -------------------------------------------------------------------------
  // Descriptor construction & loop collection
  // -------------------------------------------------------------------------

  /**
   * @private Creates helper objects and fill mesh for a clipping plane.
   */
  viewerProto.createClippingDescriptor = function createClippingDescriptor(axis) {
    const axisVector = this.getAxisVector(axis);
    if (!axisVector) {
      throw new Error(`Unsupported clipping axis: ${axis}`);
    }

    const plane = new THREE.Plane(axisVector.clone(), 0);
    const helperGeometry = new THREE.PlaneGeometry(1, 1);
    const helperEdges = new THREE.EdgesGeometry(helperGeometry);
    const helperMaterial = new THREE.LineBasicMaterial({
      color: DEFAULT_CLIPPING_COLOR,
      transparent: true,
      opacity: 0.45,
      depthTest: false,
      depthWrite: false,
    });
    const helper = new THREE.LineSegments(helperEdges, helperMaterial);
    helper.renderOrder = 10;
    helper.visible = false;
    this.clippingGroup.add(helper);

    const anchor = new THREE.Object3D();
    anchor.name = `ClippingAnchor_${axis.toUpperCase()}`;
    anchor.visible = false;

    const fillMaterial = new THREE.MeshBasicMaterial({
      color: this.clipping.fillColor.clone(),
      transparent: true,
      opacity: this.clipping.fillOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const fillGeometry = new THREE.BufferGeometry();
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.name = `ClippingFill_${axis.toUpperCase()}`;
    fillMesh.visible = false;
    fillMesh.renderOrder = 2;
    anchor.add(fillMesh);
    this.clippingGroup.add(anchor);

    return {
      axis,
      plane,
      helper,
      anchor,
      fillMesh,
      enabled: false,
      min: -1,
      max: 1,
      offset: 0,
      normalSign: 1,
    };
  };

  /**
   * @private Collects closed loops produced by intersecting geometry with a plane.
   */
  viewerProto.collectClippingLoops = function collectClippingLoops(descriptor) {
    const plane = descriptor?.plane;
    if (!plane || !this.currentModelGroup) {
      return [];
    }

    const segments = [];
    const traverse = (object) => {
      if (!object.visible) {
        return;
      }
      if (object.isMesh && object.geometry) {
        this.collectSegmentsFromMesh(object, plane, segments);
      }
      object.children.forEach(traverse);
    };

    traverse(this.currentModelGroup);

    if (!segments.length) {
      return [];
    }

    const loops = this.buildLoopsFromSegments(segments);
    if (!loops.length) {
      return [];
    }

    return loops.filter((loopPoints) => loopPoints.length >= 3);
  };

  // -------------------------------------------------------------------------
  // State queries & descriptor updates
  // -------------------------------------------------------------------------

  /**
   * Builds a serialisable snapshot of the current clipping configuration.
   */
  viewerProto.getClippingState = function getClippingState() {
    if (!this.clipping) {
      return {
        enabled: false,
        activeAxis: 'x',
        fillEnabled: false,
        fillColor: '#000000',
        fillOpacity: 0,
        planes: {},
      };
    }
    const planes = {};
    this.clipping.axes.forEach((descriptor, axis) => {
      planes[axis] = {
        enabled: descriptor.enabled,
        offset: descriptor.offset,
        min: descriptor.min,
        max: descriptor.max,
        inverted: descriptor.normalSign < 0,
      };
    });
    return {
      enabled: this.clipping.enabled,
      activeAxis: this.clipping.activeAxis,
      fillEnabled: this.clipping.fillEnabled,
      fillColor: `#${this.clipping.fillColor.getHexString()}`,
      fillOpacity: this.clipping.fillOpacity,
      planes,
    };
  };

  /**
   * @private Updates plane math, helper visibility, and fill mesh material.
   */
  viewerProto.updateClippingDescriptor = function updateClippingDescriptor(descriptor) {
    if (!descriptor) return;
    const axisVector = this.getAxisVector(descriptor.axis);
    if (!axisVector) return;

    const normal = axisVector.clone().multiplyScalar(descriptor.normalSign);
    descriptor.offset = THREE.MathUtils.clamp(descriptor.offset, descriptor.min, descriptor.max);
    const point = axisVector.clone().multiplyScalar(descriptor.offset);

    descriptor.plane.normal.copy(normal);
    descriptor.plane.constant = -normal.dot(point);

    if (descriptor.helper && descriptor.anchor) {
      descriptor.helper.visible = this.clipping.enabled && descriptor.enabled;
      descriptor.helper.scale.set(this.clipping.size, this.clipping.size, 1);
      descriptor.helper.position.copy(descriptor.anchor.position);
      descriptor.helper.quaternion.copy(descriptor.anchor.quaternion);
    }

    if (descriptor.anchor) {
      descriptor.anchor.position.set(
        descriptor.axis === 'x' ? descriptor.offset : 0,
        descriptor.axis === 'y' ? descriptor.offset : 0,
        descriptor.axis === 'z' ? descriptor.offset : 0,
      );
      const targetNormal = normal.clone().normalize();
      descriptor.anchor.quaternion.setFromUnitVectors(PLANE_DEFAULT_NORMAL, targetNormal);
      descriptor.anchor.visible = this.clipping.enabled && descriptor.enabled;
    }

    if (descriptor.fillMesh) {
      descriptor.fillMesh.visible =
        this.clipping.enabled && descriptor.enabled && this.clipping.fillEnabled;
      descriptor.fillMesh.position.set(0, 0, descriptor.normalSign > 0 ? CLIP_CAP_OFFSET : -CLIP_CAP_OFFSET);
      const material = descriptor.fillMesh.material;
      if (material) {
        material.color.copy(this.clipping.fillColor);
        material.opacity = this.clipping.fillOpacity;
        material.polygonOffsetFactor = descriptor.normalSign > 0 ? -1 : 1;
        material.polygonOffsetUnits = descriptor.normalSign > 0 ? -1 : 1;
        material.needsUpdate = true;
      }
    }
    this.updateClippingCap(descriptor);
  };

  /**
   * @private Rebuilds the cap geometry used when fill mode is active.
   */
  viewerProto.updateClippingCap = function updateClippingCap(descriptor) {
    if (!descriptor?.fillMesh) {
      return;
    }

    const mesh = descriptor.fillMesh;
    const existingGeometry = mesh.geometry;

    if (existingGeometry) {
      existingGeometry.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    mesh.geometry = geometry;

    if (
      !this.clipping?.enabled ||
      !descriptor.enabled ||
      !this.currentModelGroup ||
      !this.currentModelGroup.children.length
    ) {
      mesh.visible = false;
      return;
    }

    const loops = this.collectClippingLoops(descriptor);
    if (!loops.length) {
      mesh.visible = false;
      return;
    }

    const anchor = descriptor.anchor;
    if (!anchor) {
      mesh.visible = false;
      return;
    }

    anchor.updateMatrixWorld(true);
    _clipMatrixInverse.copy(anchor.matrixWorld).invert();

    const positions = [];
    const normals = [];
    const indices = [];

    const normalZ = descriptor.normalSign >= 0 ? 1 : -1;

    loops.forEach((loop) => {
      if (loop.length < 3) {
        return;
      }

      const localPoints = loop.map((pt) => pt.clone().applyMatrix4(_clipMatrixInverse));
      const projected = localPoints.map((pt) => new THREE.Vector2(pt.x, pt.y));

      const area = THREE.ShapeUtils.area(projected);
      if (Math.abs(area) <= 1e-6) {
        return;
      }
      if (area < 0) {
        localPoints.reverse();
        projected.reverse();
      }

      const triangles = THREE.ShapeUtils.triangulateShape(projected, []);
      if (!triangles.length) {
        return;
      }
      const baseIndex = positions.length / 3;
      localPoints.forEach((pt) => {
        positions.push(pt.x, pt.y, pt.z);
        normals.push(0, 0, normalZ);
      });
      triangles.forEach(([a, b, c]) => {
        indices.push(baseIndex + a, baseIndex + b, baseIndex + c);
      });
    });

    if (!positions.length) {
      mesh.visible = false;
      return;
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();

    mesh.visible = Boolean(this.clipping.fillEnabled && descriptor.enabled && this.clipping.enabled);
  };

  // -------------------------------------------------------------------------
  // Plane adjustment helpers
  // -------------------------------------------------------------------------

  /**
   * Enables or disables a specific clipping plane.
   */
  viewerProto.setClippingPlaneEnabled = function setClippingPlaneEnabled(axis, enabled) {
    if (!this.clipping) {
      return false;
    }
    const descriptor = this.clipping.axes.get(axis);
    if (!descriptor) {
      return false;
    }
    const next = Boolean(enabled);
    if (descriptor.enabled === next) {
      this.updateClippingDescriptor(descriptor);
      this.updateRendererClippingPlanes();
      this.refreshClippingVisibility();
      return descriptor.enabled;
    }
    descriptor.enabled = next;
    this.clipping.suppressTransformChange = true;
    this.updateClippingDescriptor(descriptor);
    this.clipping.suppressTransformChange = false;
    this.updateRendererClippingPlanes();
    this.refreshClippingVisibility();
    this.emit('clippingplanechange', {
      axis,
      enabled: descriptor.enabled,
      offset: descriptor.offset,
      inverted: descriptor.normalSign < 0,
    });
    return descriptor.enabled;
  };

  /**
   * Sets the offset distance for the plane along its normal.
   */
  viewerProto.setClippingPlaneOffset = function setClippingPlaneOffset(axis, offset) {
    if (!this.clipping) {
      return 0;
    }
    const descriptor = this.clipping.axes.get(axis);
    if (!descriptor) {
      return 0;
    }
    const clamped = THREE.MathUtils.clamp(offset, descriptor.min, descriptor.max);
    if (Math.abs(clamped - descriptor.offset) < 1e-4) {
      return descriptor.offset;
    }
    descriptor.offset = clamped;
    this.clipping.suppressTransformChange = true;
    this.updateClippingDescriptor(descriptor);
    this.clipping.suppressTransformChange = false;
    this.updateRendererClippingPlanes();
    this.refreshClippingVisibility();
    this.emit('clippingplanechange', {
      axis,
      enabled: descriptor.enabled,
      offset: descriptor.offset,
      inverted: descriptor.normalSign < 0,
    });
    return descriptor.offset;
  };

  /**
   * Flips the plane normal while keeping the effective offset.
   */
  viewerProto.invertClippingPlane = function invertClippingPlane(axis) {
    if (!this.clipping) {
      return false;
    }
    const descriptor = this.clipping.axes.get(axis);
    if (!descriptor) {
      return false;
    }
    descriptor.normalSign *= -1;
    this.clipping.suppressTransformChange = true;
    this.updateClippingDescriptor(descriptor);
    this.clipping.suppressTransformChange = false;
    this.updateRendererClippingPlanes();
    this.refreshClippingVisibility();
    this.emit('clippingplanechange', {
      axis,
      enabled: descriptor.enabled,
      offset: descriptor.offset,
      inverted: descriptor.normalSign < 0,
    });
    return descriptor.normalSign < 0;
  };

  /**
   * Resets all planes to defaults and detaches transform controls.
   */
  viewerProto.resetClippingPlanes = function resetClippingPlanes(silent = false) {
    if (!this.clipping) return;
    this.clipping.suppressTransformChange = true;
    this.clipping.axes.forEach((descriptor) => {
      descriptor.enabled = false;
      descriptor.offset = 0;
      descriptor.normalSign = 1;
      this.updateClippingDescriptor(descriptor);
    });
    this.clipping.suppressTransformChange = false;
    this.updateRendererClippingPlanes();
    this.refreshClippingVisibility();
    if (this.clipping.transform) {
      this.clipping.transform.detach();
      this.clipping.transform.visible = false;
      this.clipping.transform.enabled = false;
    }
    if (!silent) {
      this.emit('clippingreset', this.getClippingState());
    }
  };

  /**
   * Enables or disables the fill mesh rendering for the active plane.
   */
  viewerProto.setClippingFillEnabled = function setClippingFillEnabled(enabled) {
    if (!this.clipping) {
      return false;
    }
    const next = Boolean(enabled);
    if (this.clipping.fillEnabled === next) {
      return this.clipping.fillEnabled;
    }
    this.clipping.fillEnabled = next;
    this.refreshClippingVisibility();
    this.emit('clippingfill', this.getClippingState());
    return this.clipping.fillEnabled;
  };

  /**
   * Updates the fill color used by clipping caps.
   */
  viewerProto.setClippingFillColor = function setClippingFillColor(color) {
    if (!this.clipping) {
      return '#000000';
    }
    try {
      this.clipping.fillColor.set(color);
    } catch (error) {
      return `#${this.clipping.fillColor.getHexString()}`;
    }
    this.refreshClippingVisibility();
    this.emit('clippingfill', this.getClippingState());
    return `#${this.clipping.fillColor.getHexString()}`;
  };

  /**
   * Adjusts the opacity applied to clipping cap materials.
   */
  viewerProto.setClippingFillOpacity = function setClippingFillOpacity(opacity) {
    if (!this.clipping) {
      return 0;
    }
    const clamped = THREE.MathUtils.clamp(opacity, 0, 1);
    if (Math.abs(clamped - this.clipping.fillOpacity) < 1e-3) {
      return this.clipping.fillOpacity;
    }
    this.clipping.fillOpacity = clamped;
    this.refreshClippingVisibility();
    this.emit('clippingfill', this.getClippingState());
    return this.clipping.fillOpacity;
  };

  // -------------------------------------------------------------------------
  // Bounds & renderer synchronisation
  // -------------------------------------------------------------------------

  /**
   * Updates plane bounds using the provided axis-aligned bounding box.
   */
  viewerProto.updateClippingBoundsFromBox = function updateClippingBoundsFromBox(box) {
    if (!this.clipping) {
      return;
    }
    this.boundingBox = box ? box.clone() : null;
    let size = 2;
    if (box && box.isBox3) {
      const dimensions = new THREE.Vector3();
      box.getSize(dimensions);
      size = Math.max(dimensions.x, dimensions.y, dimensions.z) * 1.75;
      this.clipping.axes.forEach((descriptor) => {
        descriptor.min = box.min[descriptor.axis];
        descriptor.max = box.max[descriptor.axis];
        descriptor.offset = THREE.MathUtils.clamp(descriptor.offset, descriptor.min, descriptor.max);
      });
    } else {
      this.clipping.axes.forEach((descriptor) => {
        descriptor.min = -1;
        descriptor.max = 1;
        descriptor.offset = THREE.MathUtils.clamp(descriptor.offset, descriptor.min, descriptor.max);
      });
    }
    this.clipping.size = Math.max(size, 0.5);
    this.clipping.suppressTransformChange = true;
    this.clipping.axes.forEach((descriptor) => {
      this.updateClippingDescriptor(descriptor);
    });
    this.clipping.suppressTransformChange = false;
    this.updateRendererClippingPlanes();
    this.emit('clippingbounds', this.getClippingState());
  };

  /**
   * Recomputes bounds from the currently loaded model.
   */
  viewerProto.updateClippingBoundsFromCurrentModel = function updateClippingBoundsFromCurrentModel() {
    if (!this.clipping) {
      return;
    }
    if (!this.currentModelGroup) {
      this.updateClippingBoundsFromBox(null);
      return;
    }
    const box = new THREE.Box3().setFromObject(this.currentModelGroup);
    this.updateClippingBoundsFromBox(box);
  };

  /**
   * Applies active plane list to the renderer instance.
   */
  viewerProto.updateRendererClippingPlanes = function updateRendererClippingPlanes() {
    if (!this.clipping) return;
    if (!this.clipping.enabled) {
      this.renderer.clippingPlanes = [];
      this.renderer.localClippingEnabled = false;
      return;
    }
    const planes = [];
    this.clipping.axes.forEach((descriptor) => {
      if (descriptor.enabled) {
        planes.push(descriptor.plane);
      }
    });
    this.renderer.clippingPlanes = planes;
    this.renderer.localClippingEnabled = planes.length > 0;
  };

  /**
   * Syncs helper visibility and attaches transform controls when needed.
   */
  viewerProto.refreshClippingVisibility = function refreshClippingVisibility() {
    if (!this.clipping) return;
    this.clipping.suppressTransformChange = true;
    this.clipping.axes.forEach((descriptor) => {
      this.updateClippingDescriptor(descriptor);
    });
    this.clipping.suppressTransformChange = false;
    const active = this.getActiveClippingDescriptor();
    if (!active || !this.clipping.enabled || !active.enabled) {
      if (this.clipping.transform) {
        this.clipping.transform.detach();
        this.clipping.transform.visible = false;
        this.clipping.transform.enabled = false;
      }
      return;
    }
    this.attachTransformControls(active);
  };

  // -------------------------------------------------------------------------
  // Geometry utilities
  // -------------------------------------------------------------------------

  /**
   * @private Collects line segments created by slicing a mesh with a plane.
   */
  viewerProto.collectSegmentsFromMesh = function collectSegmentsFromMesh(mesh, plane, outSegments) {
    const geometry = mesh.geometry;
    const positionAttr = geometry?.attributes?.position;
    if (!positionAttr || positionAttr.count < 3) {
      return;
    }

    const indexAttr = geometry.index;
    const matrixWorld = mesh.matrixWorld;

    mesh.updateWorldMatrix(true, false);

    const extractVertex = (target, index) => {
      target.fromBufferAttribute(positionAttr, index).applyMatrix4(matrixWorld);
      return target;
    };

    const triangleVertices = (a, b, c) => {
      extractVertex(_clipV0, a);
      extractVertex(_clipV1, b);
      extractVertex(_clipV2, c);
      this.collectTriangleSegment(_clipV0.clone(), _clipV1.clone(), _clipV2.clone(), plane, outSegments);
    };

    if (indexAttr) {
      for (let i = 0; i < indexAttr.count; i += 3) {
        triangleVertices(indexAttr.getX(i), indexAttr.getX(i + 1), indexAttr.getX(i + 2));
      }
    } else {
      for (let i = 0; i < positionAttr.count; i += 3) {
        triangleVertices(i, i + 1, i + 2);
      }
    }
  };

  /**
   * @private Finds intersection segments between a triangle and the clipping plane.
   */
  viewerProto.collectTriangleSegment = function collectTriangleSegment(v0, v1, v2, plane, outSegments) {
    const d0 = plane.distanceToPoint(v0);
    const d1 = plane.distanceToPoint(v1);
    const d2 = plane.distanceToPoint(v2);

    const intersections = [];

    const pushIfOnPlane = (vertex, distance) => {
      if (Math.abs(distance) <= CLIP_EPSILON) {
        intersections.push(vertex.clone());
        return true;
      }
      return false;
    };

    const sampleEdge = (a, da, b, db) => {
      if ((da > CLIP_EPSILON && db < -CLIP_EPSILON) || (da < -CLIP_EPSILON && db > CLIP_EPSILON)) {
        const t = da / (da - db);
        const point = _clipI0.copy(a).lerp(b, t);
        intersections.push(point.clone());
      }
    };

    pushIfOnPlane(v0, d0);
    pushIfOnPlane(v1, d1);
    pushIfOnPlane(v2, d2);

    sampleEdge(v0, d0, v1, d1);
    sampleEdge(v1, d1, v2, d2);
    sampleEdge(v2, d2, v0, d0);

    if (intersections.length < 2) {
      return;
    }

    const unique = [];
    intersections.forEach((point) => {
      if (!unique.some((existing) => existing.distanceToSquared(point) < LOOP_TOLERANCE * LOOP_TOLERANCE)) {
        unique.push(point);
      }
    });

    if (unique.length < 2) {
      return;
    }

    if (unique.length > 2) {
      unique.length = 2;
    }

    outSegments.push([unique[0], unique[1]]);
  };

  /**
   * @private Converts disjoint segments into ordered closed loops.
   */
  viewerProto.buildLoopsFromSegments = function buildLoopsFromSegments(segments) {
    const loops = [];
    const remaining = segments.slice();
    const toleranceSq = LOOP_TOLERANCE * LOOP_TOLERANCE;

    const connect = (point, appendToEnd, currentLoop) => {
      for (let i = 0; i < remaining.length; i += 1) {
        const [start, end] = remaining[i];
        if (start.distanceToSquared(point) <= toleranceSq) {
          const newPoint = end.clone();
          if (appendToEnd) {
            currentLoop.push(newPoint);
          } else {
            currentLoop.unshift(newPoint);
          }
          remaining.splice(i, 1);
          return newPoint;
        }
        if (end.distanceToSquared(point) <= toleranceSq) {
          const newPoint = start.clone();
          if (appendToEnd) {
            currentLoop.push(newPoint);
          } else {
            currentLoop.unshift(newPoint);
          }
          remaining.splice(i, 1);
          return newPoint;
        }
      }
      return null;
    };

    while (remaining.length) {
      const segment = remaining.pop();
      if (!segment) {
        break;
      }
      const loop = [segment[0].clone(), segment[1].clone()];

      let extended = true;
      while (extended) {
        extended = false;
        const tail = loop[loop.length - 1];
        const head = loop[0];

        const nextTail = connect(tail, true, loop);
        if (nextTail) {
          extended = true;
        }
        const nextHead = connect(head, false, loop);
        if (nextHead) {
          extended = true;
        }
      }

      if (loop.length >= 3 && loop[loop.length - 1].distanceToSquared(loop[0]) <= toleranceSq) {
        loop.pop();
        loops.push(loop);
      }
    }

    return loops;
  };

  // -------------------------------------------------------------------------
  // Transform control integration
  // -------------------------------------------------------------------------

  /**
   * @private Attaches transform controls to the active clipping anchor.
   */
  viewerProto.attachTransformControls = function attachTransformControls(descriptor) {
    if (!this.clipping?.transform || !descriptor || !descriptor.anchor) {
      return;
    }
    if (!this.clipping.enabled || !descriptor.enabled) {
      this.clipping.transform.detach();
      this.clipping.transform.visible = false;
      this.clipping.transform.enabled = false;
      return;
    }
    this.clipping.transform.showX = descriptor.axis === 'x';
    this.clipping.transform.showY = descriptor.axis === 'y';
    this.clipping.transform.showZ = descriptor.axis === 'z';
    this.clipping.transform.attach(descriptor.anchor);
    this.clipping.transform.enabled = true;
    this.clipping.transform.visible = true;
    this.syncTransformControlsCamera();
  };

  /**
   * @private Applies transform control changes back to plane descriptors.
   */
  viewerProto.handleTransformObjectChange = function handleTransformObjectChange() {
    if (!this.clipping || this.clipping.suppressTransformChange) {
      return;
    }
    const descriptor = this.getActiveClippingDescriptor();
    if (!descriptor || !descriptor.enabled || !descriptor.anchor) {
      return;
    }
    const offset = this.extractAxisOffset(descriptor.axis, descriptor.anchor.position);
    const clamped = THREE.MathUtils.clamp(offset, descriptor.min, descriptor.max);
    if (Math.abs(clamped - descriptor.offset) < 1e-4) {
      return;
    }
    descriptor.offset = clamped;
    this.clipping.suppressTransformChange = true;
    this.updateClippingDescriptor(descriptor);
    this.clipping.suppressTransformChange = false;
    this.updateRendererClippingPlanes();
    this.emit('clippingplanechange', {
      axis: descriptor.axis,
      offset: descriptor.offset,
      enabled: descriptor.enabled,
      inverted: descriptor.normalSign < 0,
    });
  };

  /**
   * @private Extracts the axis-aligned offset from a vector.
   */
  viewerProto.extractAxisOffset = function extractAxisOffset(axis, vector) {
    switch (axis) {
      case 'x':
        return vector.x;
      case 'y':
        return vector.y;
      case 'z':
        return vector.z;
      default:
        return 0;
    }
  };
}
