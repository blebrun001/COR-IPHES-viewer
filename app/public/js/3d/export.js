// Handles screenshot capture, watermarking, and overlay projection for exports.
import * as THREE from 'three';

export function applyExportMixin(viewerProto) {
  // Main screenshot capture routine, optionally producing transparent backgrounds.
  viewerProto.captureScreenshot = async function ({ mimeType = 'image/png' } = {}) {
    try {
      const oldBackground = this.scene.background;
      const oldClearColor = this.renderer.getClearColor(new THREE.Color()).clone();
      const oldClearAlpha =
        typeof this.renderer.getClearAlpha === 'function' ? this.renderer.getClearAlpha() : 1;

      if (this.screenshotTransparentBackground) {
        this.scene.background = null;
        this.renderer.setClearColor(0x000000, 0);
      }

      this.renderer.render(this.scene, this.camera);

      const baseImageDataURL = this.renderer.domElement.toDataURL(mimeType);

      this.scene.background = oldBackground;
      this.renderer.setClearColor(oldClearColor, oldClearAlpha);

      const tempCanvas = document.createElement('canvas');
      const ctx = tempCanvas.getContext('2d');

      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.src = baseImageDataURL;
        i.onload = () => resolve(i);
        i.onerror = reject;
      });

      tempCanvas.width = img.width;
      tempCanvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // Render measurement labels before applying the watermark overlay.
      this.addMeasurementLabelsToCanvas(tempCanvas, ctx);

      await this.addWatermark(tempCanvas, ctx);

      return tempCanvas.toDataURL(mimeType);
    } catch (error) {
      console.error('Failed to capture screenshot with watermark', error);
      return null;
    }
  };

  // Apply watermark logo and footer text to the screenshot canvas.
  viewerProto.addWatermark = function (canvas, ctx, options = {}) {
    const { logoSrc = './public/ressources/cc.png' } = options;
    return new Promise((resolve, reject) => {
      const logo = new Image();
      logo.src = logoSrc;
      logo.onload = () => {
        const { width, height } = canvas;
        const logoWidth = width * 0.12;
        const ratio = logo.height / logo.width;
        const logoHeight = logoWidth * ratio;
        const margin = 30;

        const posX = width - logoWidth - margin;
        const posY = height - logoHeight - margin;

        ctx.globalAlpha = 0.85;
        ctx.drawImage(logo, posX, posY, logoWidth, logoHeight);

        const fontSize = Math.floor(width / 55);
        ctx.font = `${fontSize}px Arial`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';

        const text =
          'This image has been generated with COR-IPHES 3D Model Viewer (beta)';
        const textMaxWidth = width * 0.75;

        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 3;

        ctx.fillText(text, width - margin, height - logoHeight - margin - 10, textMaxWidth);

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1.0;

        resolve();
      };
      logo.onerror = reject;
    });
  };

  // Project measurement HUD labels into the captured canvas.
  viewerProto.addMeasurementLabelsToCanvas = function (canvas, ctx) {
    const width = canvas.width;
    const height = canvas.height;
    if (
      !this.measureOverlay ||
      (this.measurements.length === 0 && !this.shouldRenderScaleReferenceLabel())
    ) {
      return;
    }

    this.measurements.forEach((measurement) => {
      const label = measurement.labelEl;
      if (!label || label.classList.contains('hidden')) {
        return;
      }

      const projected = measurement.midpoint.clone().project(this.camera);
      const visible = projected.z >= -1 && projected.z <= 1;
      if (!visible) {
        return;
      }

      const screenX = (projected.x * 0.5 + 0.5) * width;
      const screenY = (-projected.y * 0.5 + 0.5) * height;
      const text = this.formatMeasurementDistance(measurement.distance);
      const fontSize = Math.max(12, Math.floor(width / 80));
      ctx.font = `500 ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const textWidth = metrics.width;
      const textHeight = fontSize * 1.4;
      const padding = fontSize * 0.4;

      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1;

      const boxX = screenX - textWidth / 2 - padding;
      const boxY = screenY - textHeight / 2 - padding / 2;
      const boxWidth = textWidth + padding * 2;
      const boxHeight = textHeight + padding;
      const borderRadius = fontSize * 0.4;

      ctx.beginPath();
      ctx.moveTo(boxX + borderRadius, boxY);
      ctx.lineTo(boxX + boxWidth - borderRadius, boxY);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + borderRadius);
      ctx.lineTo(boxX + boxWidth, boxY + boxHeight - borderRadius);
      ctx.quadraticCurveTo(
        boxX + boxWidth,
        boxY + boxHeight,
        boxX + boxWidth - borderRadius,
        boxY + boxHeight
      );
      ctx.lineTo(boxX + borderRadius, boxY + boxHeight);
      ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - borderRadius);
      ctx.lineTo(boxX, boxY + borderRadius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillText(text, screenX, screenY);
    });

    if (this.shouldRenderScaleReferenceLabel() && this.scaleReferenceLabel?.position) {
      const label = this.scaleReferenceLabel.el;
      if (!label || label.classList.contains('hidden')) {
        return;
      }
      const projected = this.scaleReferenceLabel.position.clone().project(this.camera);
      const visible = projected.z >= -1 && projected.z <= 1;
      if (!visible) {
        return;
      }

      const screenX = (projected.x * 0.5 + 0.5) * width;
      const screenY = (-projected.y * 0.5 + 0.5) * height;
      const text = label.textContent || '1 cm';

      const fontSize = Math.max(12, Math.floor(width / 90));
      ctx.font = `600 ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const metrics = ctx.measureText(text);
      const textWidth = metrics.width;
      const textHeight = fontSize * 1.4;
      const padding = fontSize * 0.4;

      ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.lineWidth = 1;

      const boxX = screenX - textWidth / 2 - padding;
      const boxY = screenY - textHeight / 2 - padding / 2;
      const boxWidth = textWidth + padding * 2;
      const boxHeight = textHeight + padding;
      const borderRadius = fontSize * 0.4;

      ctx.beginPath();
      ctx.moveTo(boxX + borderRadius, boxY);
      ctx.lineTo(boxX + boxWidth - borderRadius, boxY);
      ctx.quadraticCurveTo(boxX + boxWidth, boxY, boxX + boxWidth, boxY + borderRadius);
      ctx.lineTo(boxX + boxWidth, boxY + boxHeight - borderRadius);
      ctx.quadraticCurveTo(
        boxX + boxWidth,
        boxY + boxHeight,
        boxX + boxWidth - borderRadius,
        boxY + boxHeight
      );
      ctx.lineTo(boxX + borderRadius, boxY + boxHeight);
      ctx.quadraticCurveTo(boxX, boxY + boxHeight, boxX, boxY + boxHeight - borderRadius);
      ctx.lineTo(boxX, boxY + borderRadius);
      ctx.quadraticCurveTo(boxX, boxY, boxX + borderRadius, boxY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fillText(text, screenX, screenY);
    }
  };

  // Canvas-specific helpers reserved for future extensions.
}
