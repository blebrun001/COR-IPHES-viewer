// Manages creation and positioning of model labels within the viewer overlay.
import * as THREE from 'three';

/**
 * Adds model label helpers to a Viewer3D prototype.
 *
 * @param {typeof import('./viewer3d.js').Viewer3D.prototype} viewerProto
 */
export function applyLabelsMixin(viewerProto) {
  // Connect the DOM overlay responsible for rendering model labels.
  viewerProto.attachLabelOverlay = function attachLabelOverlay(element) {
    if (this.labelOverlay && this.labelOverlay !== element) {
      this.modelLabels.forEach((label) => {
        if (label.el && label.el.parentElement === this.labelOverlay) {
          label.el.remove();
        }
        label.el = null;
      });
    }

    this.labelOverlay = element || null;

    if (this.labelOverlay) {
      this.labelOverlay.innerHTML = '';
      this.modelLabels.forEach((label) => {
        label.el = this.createModelLabel(label.text);
      });
      this.updateModelLabels();
    }
  };

  // Toggle label visibility based on viewer state.
  viewerProto.setModelLabelsEnabled = function setModelLabelsEnabled(enabled) {
    const next = Boolean(enabled);
    if (this.modelLabelsEnabled === next) {
      return this.modelLabelsEnabled;
    }
    this.modelLabelsEnabled = next;

    if (this.labelOverlay) {
      this.modelLabels.forEach((label) => {
        if (label.el) {
          if (next) {
            label.el.classList.remove('hidden');
          } else {
            label.el.classList.add('hidden');
          }
        }
      });
    }

    this.emit('modellabels', { enabled: this.modelLabelsEnabled });
    return this.modelLabelsEnabled;
  };

  viewerProto.areModelLabelsEnabled = function areModelLabelsEnabled() {
    return this.modelLabelsEnabled;
  };

  // Build labels for the primary and comparison models.
  viewerProto.createModelLabel = function createModelLabel(text) {
    if (!this.labelOverlay) {
      return null;
    }
    const label = document.createElement('div');
    label.className = 'measurement-label hidden';
    label.textContent = text;
    this.labelOverlay.appendChild(label);
    return label;
  };

  viewerProto.createComparisonLabels = function createComparisonLabels() {
    this.clearModelLabels();

    if (this.comparisonModelA && this.comparisonModelA.group) {
      const boxA = new THREE.Box3().setFromObject(this.comparisonModelA.group);
      const centerA = boxA.getCenter(new THREE.Vector3());
      const sizeA = boxA.getSize(new THREE.Vector3());
      const labelPosA = new THREE.Vector3(centerA.x, boxA.max.y + sizeA.y * 0.1, centerA.z);

      const metaA = this.comparisonModelA.metadata || {};
      const textA = `${metaA.specimenName || 'Unknown specimen'} — ${metaA.modelName || 'Unknown'}`;

      this.modelLabels.push({
        text: textA,
        position: labelPosA,
        el: this.createModelLabel(textA)
      });
    }

    if (this.comparisonModelB && this.comparisonModelB.group) {
      const boxB = new THREE.Box3().setFromObject(this.comparisonModelB.group);
      const centerB = boxB.getCenter(new THREE.Vector3());
      const sizeB = boxB.getSize(new THREE.Vector3());
      const labelPosB = new THREE.Vector3(centerB.x, boxB.max.y + sizeB.y * 0.1, centerB.z);

      const metaB = this.comparisonModelB.metadata || {};
      const textB = `${metaB.specimenName || 'Unknown specimen'} — ${metaB.modelName || 'Unknown'}`;

      this.modelLabels.push({
        text: textB,
        position: labelPosB,
        el: this.createModelLabel(textB)
      });
    }

    if (this.labelOverlay) {
      this.updateModelLabels();
    }
  };

  // Update label positions according to the latest camera projection.
  viewerProto.updateModelLabels = function updateModelLabels() {
    if (!this.labelOverlay || !this.modelLabels.length || !this.modelLabelsEnabled) {
      return;
    }

    const width = this.size.width;
    const height = this.size.height;

    this.modelLabels.forEach((label) => {
      const el = label.el;
      if (!el) {
        return;
      }

      const projected = label.position.clone().project(this.camera);
      const visible = projected.z >= -1 && projected.z <= 1;
      if (!visible) {
        el.classList.add('hidden');
        return;
      }

      const screenX = (projected.x * 0.5 + 0.5) * width;
      const screenY = (-projected.y * 0.5 + 0.5) * height;
      el.style.transform = `translate(-50%, -50%) translate(${screenX}px, ${screenY}px)`;
      el.classList.remove('hidden');
    });
  };

  // Remove label markup and reset the tracking array.
  viewerProto.clearModelLabels = function clearModelLabels() {
    this.modelLabels.forEach((label) => {
      if (label.el && label.el.parentElement) {
        label.el.remove();
      }
    });
    this.modelLabels = [];
    if (this.labelOverlay) {
      this.labelOverlay.innerHTML = '';
    }
  };
}
