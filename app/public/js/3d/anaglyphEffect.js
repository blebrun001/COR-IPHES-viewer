// Implements a managed anaglyph effect wrapper with runtime configuration hooks.
import {
  LinearFilter,
  Matrix3,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  StereoCamera,
  WebGLRenderTarget,
} from 'three';

/**
 * Lightweight copy of Three.js' AnaglyphEffect that exposes helpers to adjust
 * the stereoscopic eye separation at runtime.
 */
export class ManagedAnaglyphEffect {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {number} [width=512]
   * @param {number} [height=512]
   */
  constructor(renderer, width = 512, height = 512) {
    const colorMatrixLeft = new Matrix3().fromArray([
      0.4561, -0.0400822, -0.0152161,
      0.500484, -0.0378246, -0.0205971,
      0.176381, -0.0157589, -0.00546856,
    ]);

    const colorMatrixRight = new Matrix3().fromArray([
      -0.0434706, 0.378476, -0.0721527,
      -0.0879388, 0.73364, -0.112961,
      -0.00155529, -0.0184503, 1.2264,
    ]);

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const scene = new Scene();
    const stereoCamera = new StereoCamera();
    const params = { minFilter: LinearFilter, magFilter: NearestFilter, format: RGBAFormat };
    const renderTargetL = new WebGLRenderTarget(width, height, params);
    const renderTargetR = new WebGLRenderTarget(width, height, params);

    const material = new ShaderMaterial({
      uniforms: {
        mapLeft: { value: renderTargetL.texture },
        mapRight: { value: renderTargetR.texture },
        colorMatrixLeft: { value: colorMatrixLeft },
        colorMatrixRight: { value: colorMatrixRight },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = vec2(uv.x, uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D mapLeft;
        uniform sampler2D mapRight;
        varying vec2 vUv;
        uniform mat3 colorMatrixLeft;
        uniform mat3 colorMatrixRight;
        void main() {
          vec2 uv = vUv;
          vec4 colorL = texture2D(mapLeft, uv);
          vec4 colorR = texture2D(mapRight, uv);
          vec3 color = clamp(
            colorMatrixLeft * colorL.rgb +
            colorMatrixRight * colorR.rgb, 0., 1.);
          gl_FragColor = vec4(
            color.r, color.g, color.b,
            max(colorL.a, colorR.a));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const mesh = new Mesh(new PlaneGeometry(2, 2), material);
    scene.add(mesh);

    this.setSize = (desiredWidth, desiredHeight) => {
      renderer.setSize(desiredWidth, desiredHeight);
      const pixelRatio = renderer.getPixelRatio();
      renderTargetL.setSize(desiredWidth * pixelRatio, desiredHeight * pixelRatio);
      renderTargetR.setSize(desiredWidth * pixelRatio, desiredHeight * pixelRatio);
    };

    this.render = (srcScene, srcCamera) => {
      const currentTarget = renderer.getRenderTarget();
      if (srcScene.matrixWorldAutoUpdate === true) srcScene.updateMatrixWorld();
      if (srcCamera.parent === null && srcCamera.matrixWorldAutoUpdate === true) {
        srcCamera.updateMatrixWorld();
      }
      stereoCamera.update(srcCamera);

      renderer.setRenderTarget(renderTargetL);
      renderer.clear();
      renderer.render(srcScene, stereoCamera.cameraL);

      renderer.setRenderTarget(renderTargetR);
      renderer.clear();
      renderer.render(srcScene, stereoCamera.cameraR);

      renderer.setRenderTarget(null);
      renderer.render(scene, camera);

      renderer.setRenderTarget(currentTarget);
    };

    this.dispose = () => {
      renderTargetL.dispose();
      renderTargetR.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    };

    this.getEyeSeparation = () => stereoCamera.eyeSep;
    this.setEyeSeparation = (value) => {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        stereoCamera.eyeSep = parsed;
      }
    };
  }
}
