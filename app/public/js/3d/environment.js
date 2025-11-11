// Augments the viewer prototype with lighting and environment management utilities.
import * as THREE from 'three';
import { readCssColorVariable } from './materials.js';

export function applyEnvironmentMixin(viewerProto) {
  // Prepare the lighting rig that illuminates the primary model.
  viewerProto.setupLights = function setupLights() {
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
  };

  // Configure background color, tone mapping, and renderer color space.
  viewerProto.setupEnvironment = function setupEnvironment({
    fallbackColor = '#111827',
    cssVariable = '--color-viewer-bg',
    toneMapping = THREE.ACESFilmicToneMapping,
    toneMappingExposure = 1.25,
    outputColorSpace = THREE.SRGBColorSpace,
  } = {}) {
    this.environmentBackgroundFallback = fallbackColor;
    this.environmentBackgroundCssVar = cssVariable;
    this.environmentToneMapping = toneMapping;
    this.environmentToneMappingExposure = toneMappingExposure;
    this.environmentOutputColorSpace = outputColorSpace;

    const fallback = this.environmentBackgroundFallback;

    const ensureBackgroundColor = () => {
      if (this.scene?.background instanceof THREE.Color) {
        this.scene.background.set(fallback);
      } else if (this.scene) {
        this.scene.background = new THREE.Color(fallback);
      }
    };

    ensureBackgroundColor();

    if (this.renderer) {
      this.renderer.outputColorSpace = this.environmentOutputColorSpace;
      this.renderer.toneMapping = this.environmentToneMapping;
      this.renderer.toneMappingExposure = this.environmentToneMappingExposure;
      if (typeof this.renderer.setClearColor === 'function' && this.scene?.background instanceof THREE.Color) {
        this.renderer.setClearColor(this.scene.background, 1);
      }
    }

    this.updateBackgroundFromTheme();
  };

  // Sync the viewer background with the current theme palette.
  viewerProto.updateBackgroundFromTheme = function updateBackgroundFromTheme() {
    const fallback = this.environmentBackgroundFallback || '#111827';
    const cssVariable = this.environmentBackgroundCssVar || '--color-viewer-bg';

    const backgroundColor =
      this.scene?.background instanceof THREE.Color ? this.scene.background : new THREE.Color(fallback);

    const targetColorValue = readCssColorVariable(cssVariable, fallback);
    try {
      backgroundColor.set(targetColorValue);
    } catch (error) {
      backgroundColor.set(fallback);
    }

    if (this.scene) {
      this.scene.background = backgroundColor;
    }

    if (this.renderer && typeof this.renderer.setClearColor === 'function') {
      this.renderer.setClearColor(backgroundColor, 1);
    }
  };

  // Dim or restore lighting intensities depending on the viewer state.
  viewerProto.applyLightDimState = function applyLightDimState() {
    if (!Array.isArray(this.lights)) {
      return;
    }
    this.lights.forEach((light) => {
      if (!light) return;
      const base = light.userData?.baseIntensity ?? light.intensity ?? 1;
      const factor = this.lightsDimmed ? 0.4 : 1;
      light.intensity = base * factor;
    });
  };

  // Future cleanup logic can be implemented here when needed.
}
