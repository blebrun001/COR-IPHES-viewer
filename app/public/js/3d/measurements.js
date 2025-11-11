// Implements distance measurement tools, overlays, and lifecycle management.
import * as THREE from 'three';

const MEASURE_LINE_COLOR = 0x38bdf8;
const MEASURE_START_COLOR = 0x404040;
const MEASURE_END_COLOR = 0x404040;
const MEASURE_CLICK_DRAG_THRESHOLD = 4;

/**
 * Adds measurement-related helpers to a Viewer3D prototype.
 *
 * @param {typeof import('./viewer3d.js').Viewer3D.prototype} viewerProto
 */
export function applyMeasurementsMixin(viewerProto) {
  viewerProto.setupMeasurements = function setupMeasurements() {
    // Initialize measurement containers and register them on the scene.
    this.measureGroup = new THREE.Group();
    this.measureGroup.name = 'Measurements';
    this.scene.add(this.measureGroup);

    // Track measurement state for pointer interaction and selection.
    this.measurements = [];
    this.measurementCounter = 0;
    this.measurementMode = false;
    this.pendingMeasurement = null;
    this.measureOverlay = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Shared materials define the look of measurement markers and segments.
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

    // Bind DOM event handlers that translate pointer input into measurements.
    this.measurePointerDown = null;
    this.handleMeasurePointerDown = this.handleMeasurePointerDown.bind(this);
    this.handleMeasurePointerUp = this.handleMeasurePointerUp.bind(this);

    const domElement = this.renderer.domElement;
    domElement.addEventListener('pointerdown', this.handleMeasurePointerDown);
    domElement.addEventListener('pointerup', this.handleMeasurePointerUp);
  };

  viewerProto.isMeasurementModeEnabled = function isMeasurementModeEnabled() {
    return this.measurementMode;
  };

  viewerProto.setMeasurementModeEnabled = function setMeasurementModeEnabled(enabled) {
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
  };

  viewerProto.handleMeasurePointerDown = function handleMeasurePointerDown(event) {
    if (!this.measurementMode || event.button !== 0) {
      return;
    }
    this.measurePointerDown = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
    };
  };

  viewerProto.handleMeasurePointerUp = function handleMeasurePointerUp(event) {
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
  };

  viewerProto.handleMeasureClick = function handleMeasureClick(event) {
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
  };

  viewerProto.clearMeasurements = function clearMeasurements() {
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
  };

  viewerProto.attachMeasurementOverlay = function attachMeasurementOverlay(element) {
    if (this.measureOverlay && this.measureOverlay !== element) {
      this.measurements.forEach((measurement) => {
        if (measurement.labelEl && measurement.labelEl.parentElement === this.measureOverlay) {
          measurement.labelEl.remove();
        }
        measurement.labelEl = null;
      });
    }

    if (this.scaleReferenceLabel?.el && this.scaleReferenceLabel.el.parentElement && this.scaleReferenceLabel.el.parentElement !== element) {
      this.scaleReferenceLabel.el.remove();
      this.scaleReferenceLabel.el = null;
    }

    this.measureOverlay = element || null;

    if (this.measureOverlay) {
      this.measureOverlay.innerHTML = '';
      this.measurements.forEach((measurement) => {
        measurement.labelEl = this.createMeasurementLabel(measurement.distance);
      });
      this.updateMeasurementLabels();
      if (this.scaleReference?.enabled) {
        this.ensureScaleReferenceLabel();
      }
    } else {
      this.removeScaleReferenceLabel();
    }
  };

  viewerProto.cancelPendingMeasurement = function cancelPendingMeasurement() {
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
  };

  viewerProto.pickMeasurementPoint = function pickMeasurementPoint(event) {
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
  };

  viewerProto.createMeasurement = function createMeasurement(startPoint, endPoint, startMarker) {
    const geometry = new THREE.BufferGeometry().setFromPoints([startPoint.clone(), endPoint.clone()]);
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

    const startLocal = startPoint.clone();
    const endLocal = endPoint.clone();
    if (this.currentModelGroup) {
      this.currentModelGroup.worldToLocal(startLocal);
      this.currentModelGroup.worldToLocal(endLocal);
    }
    const midpointLocal = startLocal.clone().add(endLocal).multiplyScalar(0.5);

    const measurement = {
      id: ++this.measurementCounter,
      start: startPoint.clone(),
      end: endPoint.clone(),
      line,
      startMarker,
      endMarker,
      distance,
      midpoint,
      startLocal,
      endLocal,
      midpointLocal,
      labelEl: this.createMeasurementLabel(distance),
    };

    this.measurements.push(measurement);
    this.emit('measurementadd', { measurement });
    if (this.measureOverlay) {
      this.updateMeasurementLabels();
    }
  };

  viewerProto.createMeasurementMarker = function createMeasurementMarker(position, isStart) {
    const radius = this.computeMarkerRadius();
    const geometry = new THREE.SphereGeometry(radius, 20, 16);
    const marker = new THREE.Mesh(geometry, isStart ? this.measureMaterials.start : this.measureMaterials.end);
    marker.position.copy(position);
    marker.renderOrder = 1000;
    this.measureGroup.add(marker);
    return marker;
  };

  viewerProto.computeMarkerRadius = function computeMarkerRadius() {
    const base = this.viewState?.radius || 1;
    return THREE.MathUtils.clamp(base * 0.03, 0.0025, 0.03);
  };

  viewerProto.createMeasurementLabel = function createMeasurementLabel(distance) {
    if (!this.measureOverlay) {
      return null;
    }
    const label = document.createElement('div');
    label.className = 'measurement-label hidden';
    label.textContent = this.formatMeasurementDistance(distance);
    this.measureOverlay.appendChild(label);
    return label;
  };

  viewerProto.formatMeasurementDistance = function formatMeasurementDistance(distance) {
    return `${distance.toFixed(2)} cm`;
  };

  viewerProto.updateMeasurementLabels = function updateMeasurementLabels() {
    if (!this.measureOverlay) {
      return;
    }

    const hasMeasurements = this.measurements.length > 0;
    const hasScaleLabel =
      this.scaleReference?.enabled &&
      this.scaleReference?.group?.visible &&
      !!this.scaleReferenceLabel?.el;

    if (!hasMeasurements && !hasScaleLabel) {
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

    if (hasScaleLabel && this.scaleReferenceLabel?.position) {
      const projected = this.scaleReferenceLabel.position.clone().project(this.camera);
      const visible = projected.z >= -1 && projected.z <= 1;
      const label = this.scaleReferenceLabel.el;
      if (!visible || !label) {
        this.hideScaleReferenceLabel();
        return;
      }
      const screenX = (projected.x * 0.5 + 0.5) * width;
      const screenY = (-projected.y * 0.5 + 0.5) * height;
      label.style.transform = `translate(-50%, -50%) translate(${screenX}px, ${screenY}px)`;
      label.classList.remove('hidden');
    } else {
      this.hideScaleReferenceLabel();
    }
  };
  viewerProto.shouldRenderScaleReferenceLabel = function shouldRenderScaleReferenceLabel() {
    return (
      this.scaleReference?.enabled &&
      this.scaleReference?.group?.visible &&
      this.scaleReferenceLabel?.position &&
      !!this.scaleReferenceLabel?.el &&
      !this.scaleReferenceLabel.el.classList.contains('hidden')
    );
  };
  viewerProto.updateMeasurementsForCurrentModel = function updateMeasurementsForCurrentModel() {
    if (!this.measurements || !this.measurements.length || !this.currentModelGroup) {
      if (this.measurements && this.measurements.length) {
        this.updateMeasurementLabels();
      }
      return;
    }
    this.currentModelGroup.updateMatrixWorld(true);
    this.measurements.forEach((measurement) => {
      if (!measurement) {
        return;
      }
      if (!measurement.startLocal || !measurement.endLocal) {
        measurement.startLocal = measurement.start.clone();
        measurement.endLocal = measurement.end.clone();
        this.currentModelGroup.worldToLocal(measurement.startLocal);
        this.currentModelGroup.worldToLocal(measurement.endLocal);
        measurement.midpointLocal = measurement.startLocal.clone().add(measurement.endLocal).multiplyScalar(0.5);
      }
      const startWorld = measurement.startLocal.clone();
      const endWorld = measurement.endLocal.clone();
      this.currentModelGroup.localToWorld(startWorld);
      this.currentModelGroup.localToWorld(endWorld);
      measurement.start.copy(startWorld);
      measurement.end.copy(endWorld);
      measurement.midpoint.copy(startWorld).add(endWorld).multiplyScalar(0.5);
      measurement.distance = startWorld.distanceTo(endWorld);
      if (measurement.line?.geometry) {
        measurement.line.geometry.setFromPoints([startWorld, endWorld]);
        const position = measurement.line.geometry.getAttribute('position');
        if (position) {
          position.needsUpdate = true;
        }
        measurement.line.geometry.computeBoundingSphere();
      }
      if (measurement.startMarker) {
        measurement.startMarker.position.copy(startWorld);
      }
      if (measurement.endMarker) {
        measurement.endMarker.position.copy(endWorld);
      }
      if (measurement.labelEl) {
        measurement.labelEl.textContent = this.formatMeasurementDistance(measurement.distance);
      }
    });
    this.updateMeasurementLabels();
  };
}
