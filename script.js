// Bootstraps the lightweight landing viewer by loading a cranial model and wiring subtle interactive behaviors.
import * as THREE from "https://esm.sh/three@0.160.0";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls";
import { OBJLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/OBJLoader";

const container = document.getElementById("app");

// Core Three.js scene configuration tailored for a transparent embedded viewer.
const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0, 1, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);
container.appendChild(renderer.domElement);

// Restrict orbit controls to maintain a fixed framing while still allowing subtle smoothing.
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enableRotate = false;
controls.enablePan = false;
controls.enableZoom = false;
controls.target.set(0, 0, 0);
controls.minDistance = 0.5;
controls.maxDistance = 20;

scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const light = new THREE.DirectionalLight(0xffffff, 1.2);
light.position.set(3, 5, 5);
scene.add(light);

// Use a manager so that any asset failure is surfaced to the console.
const manager = new THREE.LoadingManager();
manager.onError = (url) => console.error(`Erreur de chargement pour ${url}`);

const textureLoader = new THREE.TextureLoader(manager);
textureLoader.setPath("./ressources/model/");

const textures = {
  map: textureLoader.load("baked_mesh_63bf1aaf_tex0.jpeg"),
  aoMap: textureLoader.load("baked_mesh_63bf1aaf_ao0.jpeg"),
  roughnessMap: textureLoader.load("baked_mesh_63bf1aaf_roughness0.jpeg"),
  normalMap: textureLoader.load("baked_mesh_63bf1aaf_norm0.jpeg"),
};

if (textures.map) {
  textures.map.colorSpace = THREE.SRGBColorSpace;
}

let currentModel = null;
let baseModelScale = 1;
const targetRotation = new THREE.Vector2(0, 0); // x -> pitch, y -> yaw
const maxPitch = THREE.MathUtils.degToRad(25);
const maxYaw = THREE.MathUtils.degToRad(35);
const pointer = new THREE.Vector2();
const baseQuaternion = new THREE.Quaternion();
const targetQuaternion = new THREE.Quaternion();
const tempQuaternion = new THREE.Quaternion();
const lookEuler = new THREE.Euler(0, 0, 0, "YXZ");
const scrollButtons = document.querySelectorAll('[data-scroll]');

const loader = new OBJLoader(manager);
loader.setPath("./ressources/model/");
loader.load("cranium.obj", (object) => {
  currentModel = object;

  // Apply PBR textures to each mesh and ensure secondary UVs exist for AO usage.
  object.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        map: textures.map || null,
        aoMap: textures.aoMap || null,
        roughnessMap: textures.roughnessMap || null,
        normalMap: textures.normalMap || null,
        roughness: 1,
        metalness: 0,
      });

      if (!child.geometry.attributes.uv2 && child.geometry.attributes.uv) {
        child.geometry.setAttribute(
          "uv2",
          new THREE.BufferAttribute(child.geometry.attributes.uv.array, 2)
        );
      }
    }
  });

  // Normalize the object so camera and control defaults work across models.
  const { center, radius } = centerAndScale(object);
  scene.add(object);

  baseQuaternion.copy(object.quaternion);
  baseModelScale = object.scale.x;

  controls.target.copy(center);
  controls.update();

  positionCamera(center, radius);
  updateModelScale();
});

window.addEventListener("pointermove", (event) => {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = (event.clientY / window.innerHeight) * 2 - 1;

  targetRotation.y = pointer.x * maxYaw;
  targetRotation.x = pointer.y * maxPitch;
});

window.addEventListener("pointerleave", () => {
  targetRotation.set(0, 0);
});

// Smooth-scroll to content blocks when CTA buttons are used.
scrollButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const targetId = button.getAttribute("data-scroll");
    const targetEl = targetId ? document.getElementById(targetId) : null;
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

window.addEventListener("scroll", updateModelScale, { passive: true });

function centerAndScale(object) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  object.position.sub(center); // recenters geometry around the origin
  const maxAxis = Math.max(size.x, size.y, size.z);
  if (maxAxis > 0) {
    const scale = 1.75 / maxAxis;
    object.scale.setScalar(scale);
  }

  const centeredBox = new THREE.Box3().setFromObject(object);
  const newCenter = centeredBox.getCenter(new THREE.Vector3());
  const radius = centeredBox.getSize(new THREE.Vector3()).length() * 0.5;

  return { center: newCenter, radius };
}

function onResize() {
  const { clientWidth, clientHeight } = container;
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(clientWidth, clientHeight);
  updateModelScale();
}

window.addEventListener("resize", onResize);
onResize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Interpolate the model toward the pointer-driven target orientation.
  if (currentModel) {
    lookEuler.set(targetRotation.x, targetRotation.y, 0);
    tempQuaternion.setFromEuler(lookEuler);
    targetQuaternion.copy(baseQuaternion).multiply(tempQuaternion);
    currentModel.quaternion.slerp(targetQuaternion, 0.12);
  }

  renderer.render(scene, camera);
}

animate();

function positionCamera(center, radius) {
  const distance = radius > 0 ? radius * 3 : 5;
  const verticalOffset = radius * 0.2;
  camera.position.copy(center).add(new THREE.Vector3(0, verticalOffset, distance));
  camera.near = Math.max(0.01, radius * 0.05);
  camera.far = Math.max(100, radius * 10);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  controls.minDistance = Math.max(0.1, radius * 0.6);
  controls.maxDistance = Math.max(distance * 2, radius * 6);
  controls.target.copy(center);
  controls.update();
}

function updateModelScale() {
  if (!currentModel) return;
  const maxScroll = document.body.scrollHeight - window.innerHeight;
  const progress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
  const scaleFactor = 1 + 0.5 * THREE.MathUtils.clamp(progress, 0, 1);
  const targetScale = baseModelScale * scaleFactor;
  currentModel.scale.setScalar(targetScale);
}
